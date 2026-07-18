// ─────────────────────────────────────────────────────────────────────────────
// Email open + click tracking — Cloudflare Worker backend
// ─────────────────────────────────────────────────────────────────────────────
// A static site can serve a pixel image but can't record who loaded it. This
// Worker is the compute that makes tracking work — and it does three things the
// naive version can't:
//
//   1. OPENS      GET /p/<id>.gif        1x1 GIF, logs an open.
//   2. CLICKS     GET /c/<linkId>        Logs a click, then redirects to the
//                                        real URL. Clicks are the reliable
//                                        signal — Apple/most bots don't follow
//                                        links, so a click ≈ a real human.
//   3. FILTERING  Every hit is later classified as a real (human) event or a
//                 machine/prefetch (Apple Mail Privacy Protection, corporate
//                 security scanners, or anything that fires within seconds of
//                 send). Cloudflare hands us request.cf.asn / asOrganization
//                 for free, which makes this reliable.
//
// Dashboard API (all token-gated with Authorization: Bearer <DASH_TOKEN>):
//   GET    /api/overview        Pixels + classified opens/clicks counts + events
//   POST   /api/pixels          Register a pixel {id,label,recipient,sentAt}
//   POST   /api/links           Create a tracked link {pixelId,url} -> {linkId}
//   DELETE /api/pixels?id=<id>  Delete a pixel, its events, and its links
//
// Requirements: a KV namespace bound as PIXELS, and env var DASH_TOKEN.
// See backend/README.md for the 3-minute setup.
// ─────────────────────────────────────────────────────────────────────────────

const GIF = Uint8Array.from(
  atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),
  (c) => c.charCodeAt(0)
);

const EVENT_TTL = 60 * 60 * 24 * 120; // opens/clicks auto-expire after 120 days
const MAX_EVENTS = 5000;              // safety cap when aggregating the overview

// An open/click that fires within this window of the send time is almost
// certainly an automated prefetch or scanner, not a person. (A human basically
// can't send→deliver→open this fast.) Used only when a send time is provided.
const PREFETCH_WINDOW_MS = 120 * 1000; // 2 minutes

// AS organizations that fetch mail content on delivery to scan it (not humans).
const SCANNER_RE = /proofpoint|mimecast|barracuda|forcepoint|cloudmark|fireeye|trend ?micro|symantec|fortinet|sophos|messagelabs|mailcontrol/i;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));

    // ── 1. Tracking pixel (open) — public ────────────────────────────────────
    const pixelMatch = path.match(/^\/p\/([A-Za-z0-9_-]{1,32})\.gif$/);
    if (pixelMatch && request.method === 'GET') {
      const id = pixelMatch[1];
      try {
        if (env.PIXELS) {
          const ev = captureEvent(request, 'open');
          await env.PIXELS.put(eventKey(id, ev.ts), '', { metadata: ev, expirationTtl: EVENT_TTL });
        }
      } catch (_) { /* never break the image */ }
      return gifResponse();
    }

    // ── 2. Tracked link (click) — public, redirects ──────────────────────────
    const linkMatch = path.match(/^\/c\/([A-Za-z0-9_-]{1,40})$/);
    if (linkMatch && request.method === 'GET') {
      const linkId = linkMatch[1];
      let dest = null;
      try {
        if (env.PIXELS) {
          const rec = await env.PIXELS.get(`link:${linkId}`);
          if (rec) {
            const link = JSON.parse(rec);
            dest = link.url;
            const ev = captureEvent(request, 'click', { u: String(link.url || '').slice(0, 300) });
            await env.PIXELS.put(eventKey(link.pixelId, ev.ts), '', { metadata: ev, expirationTtl: EVENT_TTL });
          }
        }
      } catch (_) { /* fall through to redirect if we can */ }
      if (dest) return new Response(null, { status: 302, headers: { Location: dest, 'Cache-Control': 'no-store' } });
      return new Response('link not found', { status: 404 });
    }

    // ── Dashboard API (token-gated) ──────────────────────────────────────────
    if (path.startsWith('/api/')) {
      const token = env.DASH_TOKEN || 'change-me';
      const given = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
      if (given !== token) return cors(json({ error: 'unauthorized' }, 401));
      if (!env.PIXELS) return cors(json({ error: 'KV namespace not bound as PIXELS' }, 500));

      // Register or update a pixel. Merges onto any existing record so a later
      // "set send time" update (which sends only {id, sentAt}) doesn't wipe the
      // label / recipient / created.
      if (path === '/api/pixels' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const id = String(body.id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
        if (!id) return cors(json({ error: 'missing or invalid id' }, 400));
        const existing = (await env.PIXELS.getWithMetadata(`meta:${id}`)).metadata || {};
        let sentAt = existing.sentAt ?? null;
        if ('sentAt' in body) { const n = Number(body.sentAt); sentAt = Number.isFinite(n) && n > 0 ? n : null; }
        const meta = {
          id,
          label: 'label' in body ? String(body.label || '').slice(0, 200) : (existing.label || ''),
          recipient: 'recipient' in body ? String(body.recipient || '').slice(0, 200) : (existing.recipient || ''),
          sentAt,
          created: existing.created || Date.now(),
        };
        await env.PIXELS.put(`meta:${id}`, '', { metadata: meta });
        return cors(json({ ok: true, pixel: meta }));
      }

      // Create a tracked link. We store the destination server-side and hand
      // back a short /c/<linkId> — so this can never become an open redirector.
      if (path === '/api/links' && request.method === 'POST') {
        const body = await request.json().catch(() => ({}));
        const dest = String(body.url || '').trim();
        const pixelId = String(body.pixelId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
        if (!pixelId) return cors(json({ error: 'missing pixelId' }, 400));
        if (!/^https?:\/\//i.test(dest)) return cors(json({ error: 'url must start with http:// or https://' }, 400));
        const linkId = randId();
        await env.PIXELS.put(`link:${linkId}`, JSON.stringify({
          linkId, pixelId, url: dest.slice(0, 2000), created: Date.now(),
        }));
        return cors(json({ ok: true, linkId, path: `/c/${linkId}` }));
      }

      // Delete a pixel, its events, and its links.
      if (path === '/api/pixels' && request.method === 'DELETE') {
        const id = url.searchParams.get('id');
        if (!id) return cors(json({ error: 'missing id' }, 400));
        await env.PIXELS.delete(`meta:${id}`);
        for await (const key of listAll(env.PIXELS, `evt:${id}:`)) await env.PIXELS.delete(key.name);
        for await (const key of listAll(env.PIXELS, 'link:')) {
          try {
            const rec = await env.PIXELS.get(key.name);
            if (rec && JSON.parse(rec).pixelId === id) await env.PIXELS.delete(key.name);
          } catch (_) { /* ignore */ }
        }
        return cors(json({ ok: true }));
      }

      // Everything the dashboard needs: pixels + classified opens/clicks.
      if (path === '/api/overview' && request.method === 'GET') {
        const pixels = {};
        for await (const key of listAll(env.PIXELS, 'meta:')) {
          const meta = key.metadata || { id: key.name.slice(5) };
          pixels[meta.id] = { ...meta, ...emptyCounts(), events: [] };
        }

        let seen = 0;
        for await (const key of listAll(env.PIXELS, 'evt:')) {
          if (seen++ >= MAX_EVENTS) break;
          const ev = key.metadata;
          if (!ev) continue;
          const id = key.name.split(':')[1];
          let p = pixels[id];
          if (!p) {
            p = pixels[id] = { id, label: '(unregistered)', recipient: '', sentAt: null,
                               created: ev.ts, ...emptyCounts(), events: [] };
          }
          const cls = classify(ev, p.sentAt);
          ev.category = cls.category;   // 'human' | 'machine'
          ev.reason = cls.reason;
          const human = cls.category === 'human';
          if (ev.type === 'click') {
            p.clicksTotal++; human ? p.clicksHuman++ : p.clicksMachine++;
          } else {
            p.opensTotal++; human ? p.opensHuman++ : p.opensMachine++;
            if (human && (p.firstOpen === null || ev.ts < p.firstOpen)) p.firstOpen = ev.ts;
          }
          if (human && (p.lastActivity === null || ev.ts > p.lastActivity)) p.lastActivity = ev.ts;
          p.events.push(ev);
        }

        const out = Object.values(pixels)
          .map((p) => { p.events.sort((a, b) => b.ts - a.ts); p.events = p.events.slice(0, 100); return p; })
          .sort((a, b) => (b.created || 0) - (a.created || 0));

        return cors(json({ pixels: out, generated: Date.now() }));
      }

      return cors(json({ error: 'not found' }, 404));
    }

    if (path === '/' || path === '/health') {
      return cors(new Response('pixel tracker: ok', { status: 200, headers: { 'Content-Type': 'text/plain' } }));
    }
    return new Response('not found', { status: 404 });
  },
};

// ── Classification: is this a real (human) event or a machine/prefetch? ──────
function classify(ev, sentAt) {
  const org = (ev.asOrg || '').toLowerCase();
  const ua = ev.ua || '';
  const asn = ev.asn || 0;

  // Apple Mail Privacy Protection pre-loads every image on delivery from Apple's
  // network (ASN 714 / 17.x.x.x) — no human involved.
  if (asn === 714 || /\bapple\b/.test(org))
    return { category: 'machine', reason: 'Apple Mail Privacy Protection — image was pre-loaded, not necessarily read' };

  // Corporate security gateways fetch content on delivery to scan it.
  if (SCANNER_RE.test(org))
    return { category: 'machine', reason: 'Security scanner' + (ev.asOrg ? ' (' + ev.asOrg + ')' : '') };

  // Gmail/Yahoo proxy the image when the *person* opens the mail — a real open,
  // just fetched through the provider (so the location shown isn't the reader's).
  if (/GoogleImageProxy/i.test(ua))
    return { category: 'human', reason: 'Opened in Gmail (fetched via Google proxy — location shown is Google’s)' };
  if (/YahooMailProxy/i.test(ua))
    return { category: 'human', reason: 'Opened in Yahoo Mail (proxied)' };

  // Timing: fired within moments of the send time — almost certainly automated.
  if (sentAt && ev.ts >= sentAt - 60 * 1000 && ev.ts - sentAt <= PREFETCH_WINDOW_MS)
    return { category: 'machine', reason: 'Fired within ' + Math.round(PREFETCH_WINDOW_MS / 1000) + 's of send — almost certainly an automated prefetch, not a person' };

  return { category: 'human', reason: '' };
}

function captureEvent(request, type, extra) {
  const cf = request.cf || {};
  return {
    ts: Date.now(),
    ip: request.headers.get('cf-connecting-ip') || '',
    ua: (request.headers.get('user-agent') || '').slice(0, 300),
    country: cf.country || '',
    city: cf.city || '',
    asn: cf.asn || 0,
    asOrg: (cf.asOrganization || '').slice(0, 60),
    type,
    ...extra,
  };
}

const emptyCounts = () => ({
  opensTotal: 0, opensHuman: 0, opensMachine: 0,
  clicksTotal: 0, clicksHuman: 0, clicksMachine: 0,
  firstOpen: null, lastActivity: null,
});

const eventKey = (id, ts) => `evt:${id}:${ts}:${Math.random().toString(36).slice(2, 8)}`;
const randId = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 12) : Math.random().toString(36).slice(2, 14));

function gifResponse() {
  return new Response(GIF, {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Content-Length': String(GIF.length),
      'Cache-Control': 'no-store, no-cache, must-revalidate, private, max-age=0',
      'Pragma': 'no-cache',
      'Expires': '0',
    },
  });
}

async function* listAll(kv, prefix) {
  let cursor;
  do {
    const list = await kv.list({ prefix, cursor });
    for (const key of list.keys) yield key;
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

function cors(resp) {
  const h = new Headers(resp.headers);
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  h.set('Access-Control-Max-Age', '86400');
  return new Response(resp.body, { status: resp.status, headers: h });
}
