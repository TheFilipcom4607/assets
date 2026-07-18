# Pixel tracker backend (Cloudflare Worker)

A tracking pixel needs a tiny piece of compute to record who loaded the image — a
purely static site can serve the image but can't log the open. This folder is
that piece: a single-file Cloudflare Worker (`worker.js`) plus free KV storage.

- **Free forever**, no credit card.
- Serves the 1×1 GIF you embed in emails and records each open.
- Exposes a token-protected API that the dashboard at
  `assets.thefilip.com/pixel` reads from.

---

## Deploy it (dashboard clicks, ~3 minutes)

1. **Sign up** for Cloudflare (free): https://dash.cloudflare.com/sign-up
2. **Create the Worker.** Left sidebar → **Workers & Pages** → **Create** →
   **Worker**. Name it something like `pixel-track`, click **Deploy**.
3. **Paste the code.** Open the Worker → **Edit code**. Delete the sample and
   paste the entire contents of [`worker.js`](./worker.js). Click **Deploy**.
4. **Create KV storage.** Left sidebar → **Storage & Databases** → **KV** →
   **Create a namespace**. Name it `pixel_data`.
5. **Bind KV to the Worker.** Worker → **Settings** → **Bindings** → **Add** →
   **KV namespace**. Set:
   - Variable name: `PIXELS`  ← must be exactly this
   - KV namespace: `pixel_data`
   Save.
6. **Set your dashboard password.** Worker → **Settings** → **Variables and
   Secrets** → **Add**:
   - Name: `DASH_TOKEN`
   - Value: a long random string (this protects your data — treat it like a
     password). Save & deploy.
7. **Grab your URL.** It's shown on the Worker's page, like
   `https://pixel-track.<your-subdomain>.workers.dev`.

Now open `assets.thefilip.com/pixel`, click **Settings**, and paste the Worker
URL + your `DASH_TOKEN`. Hit **Test connection** — you should see ✓ Connected.

---

## Deploy it (CLI alternative, using Wrangler)

```bash
npm i -g wrangler
wrangler login
wrangler kv namespace create PIXELS      # note the printed id
```

Create `wrangler.toml` next to `worker.js`:

```toml
name = "pixel-track"
main = "worker.js"
compatibility_date = "2024-01-01"

[[kv_namespaces]]
binding = "PIXELS"
id = "PASTE_THE_ID_FROM_ABOVE"

[vars]
# For a real secret prefer:  wrangler secret put DASH_TOKEN
DASH_TOKEN = "change-me-to-a-long-random-string"
```

```bash
wrangler deploy
```

---

## Use your own domain (optional)

By default the pixel lives on `*.workers.dev`. To make it look like your own
site, add a route in **Worker → Settings → Domains & Routes** (any domain you've
added to Cloudflare). Then use that hostname as the Backend URL in the app.

---

## API reference

| Method   | Path                     | Auth        | Purpose                                   |
|----------|--------------------------|-------------|-------------------------------------------|
| `GET`    | `/p/<id>.gif`            | none        | The tracking pixel — logs an open, returns a 1×1 GIF |
| `GET`    | `/api/overview`          | Bearer token| All pixels + their opens (dashboard)      |
| `POST`   | `/api/pixels`            | Bearer token| Register a pixel `{id,label,recipient}`   |
| `DELETE` | `/api/pixels?id=<id>`    | Bearer token| Delete a pixel and its opens              |
| `GET`    | `/` or `/health`         | none        | Health check                              |

Auth is `Authorization: Bearer <DASH_TOKEN>`.

## Notes

- Opens auto-expire after 120 days (`EVENT_TTL` in `worker.js`).
- Free KV tier allows ~1,000 writes/day — plenty for personal email tracking
  (one write per open).
- The pixel endpoint is intentionally public and never fails: if logging errors,
  the recipient still gets a valid image.
