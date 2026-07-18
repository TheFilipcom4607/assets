# Pixel — email open tracking

A polished tracking-pixel **generator + dashboard**, served statically at
[`assets.thefilip.com/pixel`](https://assets.thefilip.com/pixel). Create a
tracking pixel, drop the snippet into an email, and see when it's opened.

## What's here

```
pixel/
├── index.html        # The app (generator + dashboard). Pure static, self-contained.
├── backend/
│   ├── worker.js     # Cloudflare Worker that logs opens + serves the pixel
│   └── README.md     # 3-minute deploy guide
└── README.md         # this file
```

## Why there's a backend

The `index.html` app is fully static (that's all Vercel serves here). But a
static file **cannot record who loaded an image** — there's no server-side code
to log the request. Every real open-tracker, including the big email tools,
needs one small endpoint that receives the pixel request and writes it down.

That's the Cloudflare Worker in `backend/` — free, no credit card, ~3 minutes to
deploy. The static app just points at it. Your Vercel repo stays 100% static.

## Getting started

1. Deploy the backend — follow [`backend/README.md`](./backend/README.md).
2. Open `assets.thefilip.com/pixel`, click **Settings**, paste your Worker URL
   and token, **Test connection**.
3. **Create a tracking pixel**, give it a label, copy the HTML snippet.
4. Paste the snippet into your email (send as HTML). When it's opened, it shows
   up on the dashboard.

The app stores your Worker URL, token, and a local mirror of your pixels in this
browser's `localStorage`. Because pixels are also registered on the backend, the
dashboard works from any device once you enter the same URL + token.

## How reliable is open tracking, really?

It's a soft signal — the same caveats apply to every email tool:

- **Apple Mail Privacy Protection** pre-loads images the moment mail arrives, so
  those opens can register even if the message is never read, from an Apple relay.
- **Gmail and most webmail** fetch images through a proxy, so the IP/location you
  see is the provider's, not the reader's, and caching means first opens are
  caught more reliably than repeats.
- **Image blocking** means some genuine opens are never recorded at all.

Treat "opened" as a strong hint, not proof.

## Please use it responsibly

Tracking whether someone opened an email can be privacy-sensitive, and in some
places (e.g. the EU/UK) it may require disclosure or consent. Use it for your own
correspondence, not to track people who would object.
