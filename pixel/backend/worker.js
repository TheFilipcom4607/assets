// ─────────────────────────────────────────────────────────────────────────────
// Email open-tracking pixel — Cloudflare Worker backend
// ─────────────────────────────────────────────────────────────────────────────
// This is the ONE piece of compute that makes tracking possible. A static site
// can serve a pixel image, but it can't record who loaded it — this Worker does.
//
// What it does:
//   GET    /p/<id>.gif          Serves a 1x1 transparent GIF and logs the open.
//                               This is the URL you embed in an email. Public.
//   GET    /api/overview        Returns every pixel + its opens (for the dashboard).
//   POST   /api/pixels          Registers a new pixel {id,label,recipient}.
//   DELETE /api/pixels?id=<id>  Deletes a pixel and all of its opens.
//   GET    /  or  /health       Plain-text health check.
//
// Requirements (see backend/README.md for click-by-click setup):
//   • A KV namespace bound to this Worker under the variable name  PIXELS
//   • An environment variable  DASH_TOKEN  = a long random password
//     (this gates the /api/* endpoints so only your dashboard can read your data)
//
// Everything is free-tier friendly (Cloudflare Workers + KV, no credit card).
// ─────────────────────────────────────────────────────────────────────────────

// A 1x1 fully-transparent GIF (43 bytes), decoded from base64 at cold start.
const GIF = Uint8Array.from(
  atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),
  (c) => c.charCodeAt(0)
);

const EVENT_TTL = 60 * 60 * 24 * 120; // opens auto-expire after 120 days
const MAX_EVENTS = 5000;              // safety cap when aggregating the overview

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight for the dashboard's fetch() calls.
    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));

    // ── The tracking pixel itself (public, no auth) ──────────────────────────
    const pixelMatch = path.match(/^\/p\/([A-Za-z0-9_-]{1,32})\.gif$/);
    if (pixelMatch && request.method === 'GET') {
      const id = pixelMatch[1];
      // Log the open, but NEVER let a logging error stop the image from returning.
      try {
        if (env.PIXELS) {
          const ua = (request.headers.get('user-agent') || '').slice(0, 400);
          const event = {
            ts: Date.now(),
            ip: request.headers.get('cf-connecting-ip') || '',
            ua,
            country: (request.cf && request.cf.country) || '',
            city: (request.cf && request.cf.city) || '',
            region: (request.cf && request.cf.region) || '',
          };
          const key = `evt:${id}:${event.ts}:${Math.random().toString(36).slice(2, 8)}`;
          await env.PIXELS.put(key, '', { metadata: event, expirationTtl: EVENT_TTL });
        }
      } catch (_) {
        /* swallow — the recipient must always get a valid image */
      }
      return new Response(GIF, {
        status: 200,
        headers: {
          'Content-Type': 'image/gif',
          'Content-Length': String(GIF.length),
          // Ask intermediaries not to cache, so repeat opens have a chance to log.
          'Cache-Control': 'no-store, no-cache, must-revalidate, private, max-age=0',
          'Pragma': 'no-cache',
          'Expires': '0',
        },
      });
    }

    // ── Dashboard API (token-gated) ──────────────────────────────────────────
    if (path.startsWith('/api/')) {
      const token = env.DASH_TOKEN || 'change-me';
      const given = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
      if (given !== token) return cors(json({ error: 'unauthorized' }, 401));
      if (!env.PIXELS) return cors(json({ error: 'KV namespace not bound as PIXELS' }, 500));

      // Register a new pixel.
      if (path === '/api/pixels' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const id = String(body.id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
        if (!id) return cors(json({ error: 'missing or invalid id' }, 400));
        const meta = {
          id,
          label: String(body.label || '').slice(0, 200),
          recipient: String(body.recipient || '').slice(0, 200),
          created: Date.now(),
        };
        await env.PIXELS.put(`meta:${id}`, '', { metadata: meta });
        return cors(json({ ok: true, pixel: meta }));
      }

      // Delete a pixel and all of its opens.
      if (path === '/api/pixels' && request.method === 'DELETE') {
        const id = url.searchParams.get('id');
        if (!id) return cors(json({ error: 'missing id' }, 400));
        await env.PIXELS.delete(`meta:${id}`);
        let cursor;
        do {
          const list = await env.PIXELS.list({ prefix: `evt:${id}:`, cursor });
          await Promise.all(list.keys.map((k) => env.PIXELS.delete(k.name)));
          cursor = list.list_complete ? undefined : list.cursor;
        } while (cursor);
        return cors(json({ ok: true }));
      }

      // Everything the dashboard needs, in one call: pixels + their opens.
      if (path === '/api/overview' && request.method === 'GET') {
        const pixels = {};

        // 1) Registered pixels.
        for await (const key of listAll(env.PIXELS, 'meta:')) {
          const meta = key.metadata || { id: key.name.slice(5) };
          pixels[meta.id] = { ...meta, opens: 0, firstOpen: null, lastOpen: null, events: [] };
        }

        // 2) Opens, grouped onto their pixel.
        let seen = 0;
        for await (const key of listAll(env.PIXELS, 'evt:')) {
          if (seen++ >= MAX_EVENTS) break;
          const ev = key.metadata;
          if (!ev) continue;
          const id = key.name.split(':')[1];
          let p = pixels[id];
          if (!p) {
            // An open with no surviving registration (e.g. deleted meta) — still show it.
            p = pixels[id] = { id, label: '(unregistered)', recipient: '', created: ev.ts,
                               opens: 0, firstOpen: null, lastOpen: null, events: [] };
          }
          p.opens++;
          if (p.firstOpen === null || ev.ts < p.firstOpen) p.firstOpen = ev.ts;
          if (p.lastOpen === null || ev.ts > p.lastOpen) p.lastOpen = ev.ts;
          p.events.push(ev);
        }

        const out = Object.values(pixels)
          .map((p) => {
            p.events.sort((a, b) => b.ts - a.ts);
            p.events = p.events.slice(0, 100); // most recent 100 opens per pixel
            return p;
          })
          .sort((a, b) => (b.created || 0) - (a.created || 0));

        return cors(json({ pixels: out, generated: Date.now() }));
      }

      return cors(json({ error: 'not found' }, 404));
    }

    // ── Health check ─────────────────────────────────────────────────────────
    if (path === '/' || path === '/health') {
      return cors(new Response('pixel tracker: ok', {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      }));
    }

    return new Response('not found', { status: 404 });
  },
};

// Iterate every key under a prefix, transparently following KV pagination.
async function* listAll(kv, prefix) {
  let cursor;
  do {
    const list = await kv.list({ prefix, cursor });
    for (const key of list.keys) yield key;
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// Allow the dashboard (served from any origin) to read the API.
// Safe because every /api/* call still requires the bearer token.
function cors(resp) {
  const h = new Headers(resp.headers);
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  h.set('Access-Control-Max-Age', '86400');
  return new Response(resp.body, { status: resp.status, headers: h });
}
