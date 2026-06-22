#!/usr/bin/env bash
#
# Portable Polaroid kit installer.
# Turns a Raspberry Pi into a self-contained Wi-Fi access point that serves the
# Thermal Composer over HTTP and relays printing to a XIAO thermal printer.
#
# Target OS: Raspberry Pi OS (Bullseye) Lite — works on the Pi Zero 1 W (ARMv6).
#   Do NOT use Ubuntu on a Zero 1 W: it is ARMv7+ only and will not boot.
# Bookworm notes are in README.md.
#
# Run it ONCE while the Pi still has internet (e.g. joined to your home Wi-Fi):
#   sudo ./install.sh
# Afterwards the Pi stops being a Wi-Fi client and becomes the "polaroidkit" AP.

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Please run with sudo:  sudo ./install.sh" >&2
  exit 1
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AP_IP="192.168.50.1"
WEBROOT="/var/www/thermal"

backup() { [[ -f "$1" && ! -f "$1.orig" ]] && cp "$1" "$1.orig" || true; }

echo "==> Installing packages (hostapd, dnsmasq, nginx, curl)..."
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y hostapd dnsmasq nginx curl

echo "==> Stopping services while configuring..."
systemctl stop hostapd dnsmasq nginx 2>/dev/null || true

# ---- Give wlan0 a static IP ----
if command -v NetworkManager >/dev/null 2>&1 && systemctl is-enabled NetworkManager >/dev/null 2>&1; then
  echo "==> NetworkManager detected (Bookworm?) — telling it to ignore wlan0..."
  mkdir -p /etc/NetworkManager/conf.d
  cat >/etc/NetworkManager/conf.d/unmanaged-wlan0.conf <<EOF
[keyfile]
unmanaged-devices=interface-name:wlan0
EOF
  systemctl restart NetworkManager || true
fi

if [[ -f /etc/dhcpcd.conf ]]; then
  echo "==> Setting static IP via dhcpcd..."
  backup /etc/dhcpcd.conf
  sed -i '/# >>> polaroid-kit/,/# <<< polaroid-kit/d' /etc/dhcpcd.conf
  cat >>/etc/dhcpcd.conf <<EOF
# >>> polaroid-kit
interface wlan0
    static ip_address=${AP_IP}/24
    nohook wpa_supplicant
# <<< polaroid-kit
EOF
  systemctl restart dhcpcd || true
else
  echo "==> dhcpcd not found — setting static IP via systemd-networkd..."
  cat >/etc/systemd/network/10-wlan0-ap.network <<EOF
[Match]
Name=wlan0
[Network]
Address=${AP_IP}/24
EOF
  systemctl enable systemd-networkd
  systemctl restart systemd-networkd || true
fi

# ---- hostapd ----
echo "==> Configuring hostapd..."
backup /etc/hostapd/hostapd.conf
install -m 644 "$HERE/hostapd.conf" /etc/hostapd/hostapd.conf
if grep -qE '^#?DAEMON_CONF=' /etc/default/hostapd 2>/dev/null; then
  sed -i -E 's|^#?DAEMON_CONF=.*|DAEMON_CONF="/etc/hostapd/hostapd.conf"|' /etc/default/hostapd
else
  echo 'DAEMON_CONF="/etc/hostapd/hostapd.conf"' >>/etc/default/hostapd
fi
systemctl unmask hostapd
systemctl enable hostapd

# ---- dnsmasq ----
echo "==> Configuring dnsmasq..."
backup /etc/dnsmasq.conf
install -m 644 "$HERE/dnsmasq.conf" /etc/dnsmasq.conf
systemctl enable dnsmasq

# ---- nginx + the app ----
echo "==> Deploying the composer to ${WEBROOT}..."
install -m 644 "$HERE/nginx-thermal.conf" /etc/nginx/sites-available/thermal
ln -sf /etc/nginx/sites-available/thermal /etc/nginx/sites-enabled/thermal
rm -f /etc/nginx/sites-enabled/default
# Upstream placeholder so nginx starts before the printer is ever seen; the
# discovery service overwrites it with the real address once the XIAO connects.
[[ -f /etc/nginx/conf.d/printer-upstream.conf ]] || \
  install -m 644 "$HERE/printer-upstream.conf" /etc/nginx/conf.d/printer-upstream.conf
mkdir -p "$WEBROOT"
install -m 644 "$HERE/../index.html" "$WEBROOT/index.html"
[[ -f "$HERE/../sw.js" ]] && install -m 644 "$HERE/../sw.js" "$WEBROOT/sw.js" || true
install -m 644 "$HERE/status.html" "$WEBROOT/status.html"
[[ -f "$WEBROOT/status.json" ]] || install -m 644 "$HERE/status.json" "$WEBROOT/status.json"
nginx -t
systemctl enable nginx

# ---- printer auto-discovery ----
echo "==> Installing printer auto-discovery..."
install -m 755 "$HERE/find-printer.sh" /usr/local/bin/find-printer.sh
install -m 644 "$HERE/printer-discovery.service" /etc/systemd/system/printer-discovery.service
install -m 644 "$HERE/printer-discovery.timer" /etc/systemd/system/printer-discovery.timer
systemctl daemon-reload
systemctl enable printer-discovery.timer

echo "==> Starting services..."
rfkill unblock wlan 2>/dev/null || true
systemctl start hostapd dnsmasq nginx printer-discovery.timer

cat <<EOF

------------------------------------------------------------
Done. Reboot once (sudo reboot), then:

  1. Power on the XIAO — it joins Wi-Fi "polaroidkit" on its own.
  2. On your phone, join Wi-Fi:  polaroidkit   (password: test4test)
  3. Open  http://${AP_IP}/   (or http://polaroid.box/)
  4. In the app, set the printer URL to  http://${AP_IP}
     (nginx relays /ping, /test and /print to the XIAO).

Check http://${AP_IP}/status to see whether the printer's been found.

You do NOT need to know the printer's IP: once the XIAO joins, discovery
finds it (the device that answers /ping) within ~10s and points nginx at
it automatically. The first print may take a few seconds while it's found.
------------------------------------------------------------
EOF
