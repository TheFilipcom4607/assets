# Polaroid Kit — full setup guide

Everything from a blank SD card to printing photos from your phone, plus the
mistakes that bite people. Target hardware: **Raspberry Pi Zero 1 W** + your
XIAO thermal printer. Should take ~30–40 minutes, most of it waiting on
downloads.

The end result: the Pi is a self-contained Wi-Fi network called **`dom`**. Your
phone and the printer both join it; you open a web page on the Pi and print. No
internet required in the field.

---

## What you need

- Raspberry Pi Zero 1 W (or any Pi; the Zero 1 W is the tested target).
- microSD card (4 GB+), and a way to write it from your computer.
- 5 V power for the Pi (a power bank is fine for the backpack).
- The XIAO thermal printer, already flashed with firmware that joins Wi-Fi
  **`dom`** / password **`test4test`** and exposes `/ping`, `/print`, `/test`.
- Your home Wi-Fi (used **once** during setup to download packages).
- A phone (the guide assumes iPhone, but Android is the same idea).

---

## Phase 1 — Flash the SD card

1. Install **Raspberry Pi Imager** on your computer (raspberrypi.com/software).
2. **Choose OS** → *Raspberry Pi OS (other)* → **Raspberry Pi OS Lite (32-bit)**.
   - ⚠️ It must be **32-bit Raspberry Pi OS**. The Zero 1 W is ARMv6; the 64-bit
     image and Ubuntu are ARMv7+/ARMv8 and **will not boot** on it.
3. **Choose Storage** → your SD card.
4. Click the **gear / “Edit Settings”** (advanced options) and set:
   - **Hostname:** e.g. `polaroid`.
   - **Enable SSH** → *use password authentication*.
   - **Username & password:** set and remember these (e.g. user `pi`).
   - **Configure wireless LAN:** enter **your home Wi-Fi** (NOT `dom` — we need
     real internet for setup). Set the correct **Wi-Fi country** here too.
   - **Locale / time zone:** set your country.
5. Write the card. When done, eject it and put it in the Pi.

> Why home Wi-Fi now? The installer downloads nginx/hostapd/dnsmasq from the
> internet. After it runs, the Pi switches its radio to *be* the `dom` network
> and won't be an internet client anymore. So: internet first, AP second.

---

## Phase 2 — First boot and SSH in

1. Power the Pi. First boot takes a minute or two (the Zero 1 W is slow — be
   patient; the green LED will flicker and settle).
2. From your computer (on the same home network), SSH in using the hostname:
   ```bash
   ssh pi@polaroid.local
   ```
   - If `polaroid.local` doesn't resolve, find the Pi's IP from your router's
     device list and use `ssh pi@<that-ip>` instead.
3. Enter the password you set in the Imager.

You're now on the Pi's command line.

---

## Phase 3 — Get the kit files onto the Pi

You need this repo's `thermal/` folder on the Pi. Easiest is git:

```bash
sudo apt update
sudo apt install -y git
git clone https://github.com/TheFilipcom4607/assets.git
cd assets/thermal/deploy
```

(If you keep the repo private, use `scp` from your computer instead:
`scp -r thermal pi@polaroid.local:~/` then `cd ~/thermal/deploy`.)

---

## Phase 4 — Run the installer

```bash
sudo ./install.sh
```

It will:
- install `hostapd`, `dnsmasq`, `nginx`, `curl`,
- give `wlan0` the static IP `192.168.50.1`,
- write the `dom` access-point config,
- deploy the composer + status page to `/var/www/thermal`,
- set up the printer auto-discovery timer.

Watch for errors. If it finishes with the “Done.” banner, reboot:

```bash
sudo reboot
```

> After this reboot the Pi **stops** being on your home Wi-Fi and **starts**
> broadcasting `dom`. Your SSH session will drop — that's expected. To SSH in
> again later, join `dom` from your computer and use `ssh pi@192.168.50.1`.

---

## Phase 5 — Bring up the printer and phone

1. **Power on the XIAO.** It joins `dom` by itself (that's what its firmware is
   set to). Give it ~15 seconds.
2. **On your phone**, open Wi-Fi settings and join:
   - Network: **`dom`**
   - Password: **`test4test`**
   - iOS will say “No Internet Connection” — that's fine, stay on it.
3. Open Safari and go to:
   ```
   http://192.168.50.1/status
   ```
   - 🟢 **Printer connected** → discovery found the XIAO. 
   - 🟠 **Searching…** → wait ~10 s and let the page refresh; make sure the XIAO
     is powered and joined `dom`.
   - Tap **Test printer (/ping)** — `HTTP 200` means the whole path works.

---

## Phase 6 — Print

1. Open the app: `http://192.168.50.1/`
2. In the IP/printer box at the top, type:
   ```
   http://192.168.50.1
   ```
   (You're pointing the app at the Pi; the Pi relays to the printer.)
3. Tap **Ping** — it should say connected.
4. Tap **📷 Polaroid**, pick/take a photo, adjust brightness, **Print**.

**Add to Home Screen** (Safari share sheet) to get the full-screen app icon. It
won't cache offline (that needs HTTPS), but the Pi is always there, so it loads
instantly anyway.

---

## Common mistakes & fixes

**“It won't boot / no green light activity at all.”**
You probably flashed the 64-bit image or Ubuntu. Re-flash **Raspberry Pi OS
Lite 32-bit**. This is the #1 Zero 1 W mistake.

**`install.sh` fails on `apt` (“Could not resolve…”, “Unable to fetch”).**
The Pi has no internet. Run the installer while joined to your **home** Wi-Fi
(Phase 1–4), not after it has become the `dom` AP.

**Wi-Fi `dom` never appears after reboot.**
Usually the Wi-Fi country isn't set, so the radio stays blocked. Set it:
```bash
sudo raspi-config   # Localisation Options → WLAN Country
```
Check hostapd:
```bash
sudo systemctl status hostapd
sudo rfkill list           # wlan should be "Soft blocked: no"
sudo rfkill unblock wlan
```

**The XIAO isn't found (status stays orange, printing gives `502`).**
- Confirm the XIAO is powered and that its firmware really joins SSID `dom` /
  `test4test` (these must match `hostapd.conf` exactly — same case, no spaces).
- See what has actually joined:
  ```bash
  cat /var/lib/misc/dnsmasq.leases
  journalctl -t printer-discovery -f
  ```
- Make sure nothing **else** on the network also answers `/ping` (discovery
  picks the first device that does).

**Two networks called `dom`.**
If your XIAO previously joined a different real router also named `dom`, or you
left another AP up, the phone/printer may attach to the wrong one. Make sure the
Pi is the only thing broadcasting `dom` when you're using the kit.

**iPhone keeps dropping `dom` / jumping to cellular.**
iOS dislikes networks with no internet. Stay on the Wi-Fi screen until the page
loads; if it keeps bouncing, temporarily turn off Wi-Fi “Auto-Join” for your
other known networks, or toggle Airplane mode + Wi-Fi on.

**Still getting “Load failed” / mixed-content errors.**
You're opening the **HTTPS** hosted site, not the Pi. Use the **`http://`**
address `http://192.168.50.1/`. (If you Added to Home Screen from the old HTTPS
site, delete that icon and re-add from the Pi page.)

**Page loads but Ping fails with `502 Bad Gateway`.**
nginx is up but the printer isn't discovered yet — same as the “not found”
fixes above. Wait ~10 s after the XIAO joins.

**Camera won't open.**
The Polaroid picker is a normal file input and works over HTTP. If nothing
happens, it's a Safari permissions prompt — allow photo/camera access.

**I changed `hostapd.conf` / `dnsmasq.conf` and want it applied.**
Re-run `sudo ./install.sh` (safe to repeat) or:
```bash
sudo systemctl restart hostapd dnsmasq nginx
```

**Lost SSH after setup.**
Expected — the Pi is now the `dom` AP. Join `dom` from your computer and
`ssh pi@192.168.50.1`.

---

## Handy commands

```bash
# Is everything running?
systemctl status hostapd dnsmasq nginx printer-discovery.timer

# Who's on the network?
cat /var/lib/misc/dnsmasq.leases

# Where is nginx sending prints right now?
cat /etc/nginx/conf.d/printer-upstream.conf

# Watch the printer get discovered
journalctl -t printer-discovery -f

# Force a discovery pass immediately
sudo /usr/local/bin/find-printer.sh
```

---

## Updating the app later

When `thermal/index.html` changes, copy it over (join `dom`, SSH to the Pi):

```bash
cd ~/assets && git pull
sudo cp thermal/index.html /var/www/thermal/index.html
sudo cp thermal/sw.js      /var/www/thermal/sw.js
```

No restart needed — just reload the page on your phone.
