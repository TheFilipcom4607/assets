# Portable Polaroid kit — Raspberry Pi hub

Turns a Raspberry Pi (tested target: **Pi Zero 1 W**) into a battery-powered
backpack hub for the Thermal Composer's Polaroid mode.

> **Setting it up for the first time? Follow [GUIDE.md](GUIDE.md)** — a complete
> step-by-step from flashing the SD card to printing, with troubleshooting.
> This README is the short technical reference.

## Why this exists

The hosted composer runs over **HTTPS**, but the XIAO thermal printer is plain
**HTTP** on a LAN address. Browsers block an HTTPS page from talking to an HTTP
device ("mixed content") — that's the `Load failed` / `json` errors you saw.

The fix is to serve the page over **HTTP from the same origin as the printer**.
This Pi:

- is its own Wi-Fi access point (named **`polaroidkit`** — unique, so it never
  clashes with a home network), so it needs no internet,
- serves the composer over HTTP via nginx,
- **reverse-proxies** `/ping`, `/test` and `/print` to the XIAO, so the browser
  only ever talks to the Pi — no mixed content, no CORS, and
- **auto-discovers** the printer, so you never need to know its IP or MAC.

Intended use: **at home you don't need the Pi** (print to the XIAO on your home
network from your PC); the Pi is the **away** hub. The XIAO lists both networks
(home + `polaroidkit`) and uses whichever is in range — see [GUIDE.md](GUIDE.md).

The heavy work (dithering the photo, packing the 1-bit raster) happens in the
phone's browser; the Pi just serves one file and relays bytes, which is why a
Zero 1 W is plenty.

## Quick install

On Raspberry Pi OS (Bullseye) Lite, **while the Pi still has internet**:

```bash
cd thermal/deploy
sudo ./install.sh
sudo reboot
```

After reboot the Pi broadcasts Wi-Fi **`polaroidkit`** (password `test4test`).
Add that network to the XIAO's firmware (alongside home `dom`), join
`polaroidkit` on your phone, and open `http://192.168.50.1/`. Full details and
gotchas are in **[GUIDE.md](GUIDE.md)**.

## Network at a glance

| Thing | Value |
|-------|-------|
| Wi-Fi SSID / password | `polaroidkit` / `test4test` (the XIAO must list this) |
| Pi (gateway, web UI) | `192.168.50.1` |
| DHCP range for clients | `192.168.50.10`–`192.168.50.100` |
| App URL | `http://192.168.50.1/` (or `http://polaroid.box/`) |
| Status page | `http://192.168.50.1/status` |
| Printer URL to type in the app | `http://192.168.50.1` |

To rename the kit network, change `ssid=` in `hostapd.conf` and the matching
entry in the XIAO's firmware — keep it different from your home SSID.

## Finding the printer — automatic

You **don't** need to know the printer's IP or MAC. `find-printer.sh` (run by
`printer-discovery.timer` every ~10 s) probes each DHCP-leased device for
`GET /ping`; the XIAO answers, phones don't. The responder becomes the nginx
upstream, reloaded only when the address changes — so a printer reboot onto a
new IP is picked up automatically. The result is published to `status.json`
(shown on the status page).

- First print after the XIAO joins may take up to ~10 s while it's discovered.
- `502 Bad Gateway` = printer not found yet (check it's on and joined `polaroidkit`).

Inspect live:
```bash
journalctl -t printer-discovery -f
cat /var/lib/misc/dnsmasq.leases              # everything that has joined
cat /etc/nginx/conf.d/printer-upstream.conf   # where nginx is currently pointed
```

## Updating the app later

```bash
sudo cp thermal/index.html /var/www/thermal/index.html
sudo cp thermal/sw.js      /var/www/thermal/sw.js
```
No restart needed.

## Bookworm note

Raspberry Pi OS **Bookworm** uses NetworkManager instead of dhcpcd. The
installer detects this and marks `wlan0` unmanaged so hostapd can own it. It
works, but Bullseye Lite is the lighter, better-trodden path on a Zero 1 W.

## Files

| File | Purpose |
|------|---------|
| `GUIDE.md` | Full first-boot-to-printing walkthrough + troubleshooting |
| `install.sh` | One-shot setup: installs packages, writes configs, deploys the app |
| `hostapd.conf` | Wi-Fi access point (SSID `polaroidkit` / password / channel) |
| `dnsmasq.conf` | DHCP + DNS for the kit network |
| `nginx-thermal.conf` | Serves the app + status page, proxies `/ping` `/test` `/print` |
| `printer-upstream.conf` | Auto-managed pointer to the printer's current address |
| `find-printer.sh` | Discovers the printer (the device answering `/ping`) |
| `printer-discovery.{service,timer}` | Runs discovery every ~10 s |
| `status.html` / `status.json` | Field status/debug page and its live data |

## Reverting

The installer backs up each file it replaces to `*.orig` (e.g.
`/etc/dnsmasq.conf.orig`). To undo, restore those and remove the
`# >>> polaroid-kit` block from `/etc/dhcpcd.conf`.
