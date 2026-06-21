#!/usr/bin/env bash
#
# Find the thermal printer on the kit network and point nginx's "xiao" upstream
# at it. The printer is identified as the leased device that answers GET /ping
# with HTTP 200 (phones/tablets don't), so no MAC or fixed IP is needed.
#
# Only acts when the result changes (state is tracked in tmpfs /run), so it
# doesn't churn the SD card or reload nginx needlessly.

set -euo pipefail

LEASES="/var/lib/misc/dnsmasq.leases"
CONF="/etc/nginx/conf.d/printer-upstream.conf"
STATUS="/var/www/thermal/status.json"
STATE="/run/printer-discovery.state"
SELF_IP="192.168.50.1"     # the Pi itself — never probe this
PORT=80

write_status() {  # $1 = true|false, $2 = ip
  local tmp="${STATUS}.tmp"
  printf '{"found":%s,"ip":"%s","checked":"%s"}\n' "$1" "$2" "$(date -Is 2>/dev/null || date)" >"$tmp" 2>/dev/null \
    && mv "$tmp" "$STATUS" 2>/dev/null || true
}

found=""
if [[ -r "$LEASES" ]]; then
  # dnsmasq lease line: <expiry> <mac> <ip> <hostname> <client-id>
  while read -r _expiry _mac ip _host _rest; do
    [[ "$ip" =~ ^[0-9]+(\.[0-9]+){3}$ ]] || continue
    [[ "$ip" == "$SELF_IP" ]] && continue
    code="$(curl -fsS -o /dev/null -m 2 -w '%{http_code}' "http://${ip}:${PORT}/ping" 2>/dev/null || true)"
    if [[ "$code" == "200" ]]; then found="$ip"; break; fi
  done < "$LEASES"
fi

# Skip all work if nothing changed since last run.
state="${found:-none}"
[[ "$state" == "$(cat "$STATE" 2>/dev/null || true)" ]] && exit 0
echo "$state" >"$STATE"

if [[ -n "$found" ]]; then
  echo "upstream xiao { server ${found}:${PORT}; }" >"$CONF"
  if nginx -t 2>/dev/null; then systemctl reload nginx || true; fi
  logger -t printer-discovery "pointed nginx at printer ${found}"
  write_status true "$found"
else
  logger -t printer-discovery "printer not found yet"
  write_status false ""
fi
