# Pixel tracker backend (Cloudflare Worker)

A tracking pixel needs a tiny piece of compute to record who loaded the image — a
purely static site can serve the image but can't log the open. This folder is
that piece: a single-file Cloudflare Worker (`worker.js`) plus free KV storage.

- **Free forever**, no credit card.
- Serves the 1×1 GIF you embed in emails and records each open.
- Exposes a token-protected API that the dashboard at
  `assets.thefilip.com/pixel` reads from.

---

## Deploy it (dashboard clicks, ~5 minutes)

Order matters: **create the KV storage first**, because you can only bind a KV
namespace to the Worker once it exists.

1. **Sign up** for Cloudflare (free, no card): https://dash.cloudflare.com/sign-up
2. **Create the KV storage first.** Left sidebar → **Storage & Databases** →
   **KV** → **Create** a namespace. Name it `pixel_data`. (Just create it —
   nothing to configure inside.)
3. **Create the Worker.** Left sidebar → **Workers & Pages** → **Create** →
   **Worker** → **Start with Hello World**. Name it `pixel-track` → **Deploy**.
   - ⚠️ Do **not** use the "Upload/Import files" option — that's the *static-site*
     uploader and it will warn about a "build process" and won't run the script.
     You want the Hello World starter, then paste the code.
4. **Paste the code.** Open the Worker → **Edit code**. Select all the sample code,
   delete it, and paste the entire contents of [`worker.js`](./worker.js) (or copy
   from the raw file on GitHub). Click **Deploy**.
5. **Bind the KV storage.** Worker → **Settings** → **Bindings** → **Add** →
   **KV namespace**. There are **two fields** — fill them like this:
   - **Variable name:** `PIXELS`  ← must be exactly this (it's what the code reads)
   - **KV namespace:** select `pixel_data` (the storage from step 2)
   Click **Add Binding** / Deploy. (Common mistake: typing `pixel_data` into the
   *Variable name* field — that field must be `PIXELS`.)
6. **Set your dashboard password.** Worker → **Settings** → **Variables and
   Secrets** → **Add**:
   - **Name:** `DASH_TOKEN`
   - **Value:** a long random string (this protects your data — treat it like a
     password). Deploy.
7. **Grab your URL.** It's on the Worker's page, like
   `https://pixel-track.<your-subdomain>.workers.dev`. Sanity-check it by opening
   `<that URL>/health` — it should say `pixel tracker: ok`.

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
| `GET`    | `/c/<linkId>`            | none        | Tracked link — logs a click, then 302-redirects to the stored URL |
| `GET`    | `/api/overview`          | Bearer token| All pixels + classified opens/clicks (dashboard) |
| `POST`   | `/api/pixels`            | Bearer token| Register a pixel `{id,label,recipient,sentAt}` |
| `POST`   | `/api/links`             | Bearer token| Create a tracked link `{pixelId,url}` → `{linkId}` |
| `DELETE` | `/api/pixels?id=<id>`    | Bearer token| Delete a pixel, its events, and its links |
| `GET`    | `/` or `/health`         | none        | Health check                              |

Auth is `Authorization: Bearer <DASH_TOKEN>`.

## How events are classified

Every open/click is tagged **confirmed** (a real person) or **machine/prefetch**,
so inflated numbers don't mislead you:

- **Apple Mail Privacy Protection** → ASN `714` / org "Apple" (pre-loads on delivery).
- **Security scanners** (Proofpoint, Mimecast, Barracuda, …) → matched by AS org.
- **Timing** → if you gave a send time, anything firing within ~2 min of it
  (`PREFETCH_WINDOW_MS`) is treated as an automated prefetch.
- **Gmail/Yahoo proxies** → still counted as real opens (a human triggered them),
  but flagged as proxied so you know the location is the provider's.

Cloudflare provides `request.cf.asn` / `asOrganization` for free, which is what
makes the ASN-based detection reliable.

## Notes

- Opens/clicks auto-expire after 120 days (`EVENT_TTL` in `worker.js`).
- Free KV tier allows ~1,000 writes/day — plenty for personal use (one write per
  open or click).
- `/p` and `/c` are intentionally public and never fail: if logging errors, the
  recipient still gets a valid image / redirect.
- Tracked links store the destination server-side, so `/c/<linkId>` can never be
  turned into an open redirector.
