# Portable Polaroid kit — Raspberry Pi hub

This turns a Raspberry Pi (tested target: **Pi Zero 1 W**) into a battery-powered
backpack hub for the Thermal Composer's Polaroid mode.

## Why this exists

The hosted composer runs over **HTTPS**, but the XIAO thermal printer is plain
**HTTP** on a LAN address. Browsers block an HTTPS page from talking to an HTTP
device ("mixed content"), which is the `Load failed` / `json` errors you saw.

The fix is to serve the page over **HTTP from the same origin as the printer**.
This Pi:

- is its own Wi-Fi access point (`PolaroidKit`), so it needs no internet,
- serves the composer over HTTP via nginx, and
- **reverse-proxies** `/ping`, `/test` and `/print` to the XIAO, so the browser
  only ever talks to the Pi — no mixed content, no CORS, no firmware changes.

The heavy work (dithering the photo, packing the 1-bit raster) happens in the
phone's browser; the Pi just serves one file and relays bytes, which is why a
Zero 1 W is plenty.

## Will the Polaroid flow work over plain HTTP?

Yes. The photo picker is a normal `<input type="file" accept="image/*">`, which
opens the iOS camera/library without needing a secure context (unlike
`getUserMedia`). You can also **Add to Home Screen** from the Pi's HTTP page and
get the full-screen standalone app — you just won't get the service-worker
offline cache, which doesn't matter because the Pi is always there.

## Requirements

- **Raspberry Pi OS (Bullseye) Lite.** On a Zero 1 W this must be the ARMv6
  Raspberry Pi OS build. **Do not use Ubuntu** — it is ARMv7+ and won't boot on
  a Zero 1 W.
- First-boot internet access (join your home Wi-Fi) just long enough to run the
  installer. After that the Pi becomes the AP and drops the home connection.

## Install

1. Flash Raspberry Pi OS Lite, enable SSH, and set your Wi-Fi + Wi-Fi country
   (Raspberry Pi Imager's advanced options, or `raspi-config`). The country
   setting matters — hostapd won't start the radio without it.
2. Copy this whole `thermal/` folder onto the Pi (so `index.html` and `sw.js`
   sit next to `deploy/`).
3. Run the installer **while still on your home Wi-Fi**:
   ```bash
   cd thermal/deploy
   sudo ./install.sh
   sudo reboot
   ```

After reboot the Pi broadcasts `PolaroidKit`.

## Point the XIAO at the kit

Set the XIAO firmware's Wi-Fi credentials to the kit network:

- SSID: `PolaroidKit`
- Password: whatever you set in `hostapd.conf`

## Pin the printer's IP (recommended)

The nginx proxy targets `192.168.50.2`. To guarantee the XIAO lands there:

1. Let the XIAO connect once, then on the Pi read its MAC + IP:
   ```bash
   cat /var/lib/misc/dnsmasq.leases
   ```
2. Put that MAC in `deploy/dnsmasq.conf` (`dhcp-host=...,192.168.50.2`), re-run
   `sudo ./install.sh` (or just `sudo cp dnsmasq.conf /etc/dnsmasq.conf &&
   sudo systemctl restart dnsmasq`).

If you'd rather give the XIAO a different fixed IP in its own firmware, just set
that same IP in the three `proxy_pass` lines of `nginx-thermal.conf`.

## Use it

1. Phone joins Wi-Fi `PolaroidKit`.
2. Open `http://192.168.50.1/` (or `http://polaroid.box/`).
3. Set the printer URL in the app to `http://192.168.50.1`.
4. Tap **📷 Polaroid**, pick a photo, print.

## Updating the app later

Copy a fresh `index.html` (and `sw.js`) over the deployed copy:

```bash
sudo cp thermal/index.html /var/www/thermal/index.html
sudo cp thermal/sw.js      /var/www/thermal/sw.js
```

No service restart needed.

## Bookworm notes

Raspberry Pi OS **Bookworm** uses NetworkManager instead of dhcpcd. The
installer detects this and marks `wlan0` as unmanaged so hostapd can own it.
This works, but Bullseye Lite is the lighter, better-trodden path on a Zero 1 W.

## Files

| File | Purpose |
|------|---------|
| `install.sh` | One-shot setup: installs packages, writes configs, deploys the app |
| `hostapd.conf` | Wi-Fi access point (SSID / password / channel) |
| `dnsmasq.conf` | DHCP + DNS, static lease for the XIAO |
| `nginx-thermal.conf` | Serves the app, proxies `/ping` `/test` `/print` to the XIAO |

## Reverting

The installer backs up each file it replaces to `*.orig` (e.g.
`/etc/dnsmasq.conf.orig`). To undo, restore those and remove the
`# >>> polaroid-kit` block from `/etc/dhcpcd.conf`.
