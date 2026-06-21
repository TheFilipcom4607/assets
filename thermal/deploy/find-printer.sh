#!/usr/bin/env bash
#
# Find the thermal printer on the kit network and point nginx's "xiao" upstream
# at it. The printer is identified as the leased device that answers GET /ping
# with HTTP 200 (phones/tablets don't), so no MAC or fixed IP is needed.
# Safe to run repeatedly; only reloads nginx when the address actually changes.

set -euo pipefail

LEASES="/var/lib/misc/dnsmasq.leases"
CONF="/etc/nginx/conf.d/printer-upstream.conf"
SELF_IP="192.168.50.1"     # the Pi itself — never probe this
PORT=80

[[ -r "$LEASES" ]] || exit 0

found=""
# dnsmasq lease line: <expiry> <mac> <ip> <hostname> <client-id>
while read -r _expiry _mac ip _host _rest; do
  [[ "$ip" =~ ^[0-9]+(\.[0-9]+){3}$ ]] || continue
  [[ "$ip" == "$SELF_IP" ]] && continue
  code="$(curl -fsS -o /dev/null -m 2 -w '%{http_code}' "http://${ip}:${PORT}/ping" 2>/dev/null || true)"
  if [[ "$code" == "200" ]]; then found="$ip"; break; fi
done < "$LEASES"

[[ -n "$found" ]] || exit 0

new="upstream xiao { server ${found}:${PORT}; }"
if [[ "$(cat "$CONF" 2>/dev/null || true)" != "$new" ]]; then
  echo "$new" > "$CONF"
  if nginx -t 2>/dev/null; then
    systemctl reload nginx || true
    logger -t printer-discovery "pointed nginx at printer ${found}"
  fi
fi
