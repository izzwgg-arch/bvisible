#!/usr/bin/env bash
# /opt/bvisible/deploy-queue/healthcheck.sh
#
# Validate that the bvisible-web runtime is serving /api/health correctly.
# Called by deploy-once.sh as the final gate before marking a deploy succeeded.
# Exit 0 only on a healthy JSON response. Exit non-zero on any failure.
#
# Tunables via env (defaults are sensible for production):
#   HEALTHCHECK_URL        target URL (default: http://127.0.0.1:3000/api/health)
#   HEALTHCHECK_TIMEOUT    total wall-clock seconds before giving up (default: 30)
#   HEALTHCHECK_INTERVAL   seconds between attempts (default: 1)

set -uo pipefail

URL="${HEALTHCHECK_URL:-http://127.0.0.1:3000/api/health}"
TIMEOUT_SECS="${HEALTHCHECK_TIMEOUT:-30}"
INTERVAL_SECS="${HEALTHCHECK_INTERVAL:-1}"
EXPECT_SERVICE="bvisible-web"

deadline=$(( $(date +%s) + TIMEOUT_SECS ))
attempt=0
last_body=""
last_code=""

while :; do
  attempt=$((attempt + 1))

  # -m caps each attempt at 5s so a hung upstream can't blow the global budget.
  http_out="$(curl -sS -m 5 -o /tmp/healthcheck.body -w '%{http_code}' "$URL" 2>/dev/null || true)"
  last_code="$http_out"
  last_body="$(cat /tmp/healthcheck.body 2>/dev/null || true)"

  if [ "$last_code" = "200" ] && [ -n "$last_body" ]; then
    if command -v jq >/dev/null 2>&1; then
      status="$(printf '%s' "$last_body" | jq -r '.status // empty' 2>/dev/null || true)"
      service="$(printf '%s' "$last_body" | jq -r '.service // empty' 2>/dev/null || true)"
    else
      # Fallback parser if jq is somehow missing. Anchored to avoid false
      # positives from a body that mentions "status" or "service" elsewhere.
      status="$(printf '%s' "$last_body" | sed -n 's/.*"status"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
      service="$(printf '%s' "$last_body" | sed -n 's/.*"service"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
    fi

    if [ "$status" = "ok" ] && [ "$service" = "$EXPECT_SERVICE" ]; then
      echo "[healthcheck] OK after ${attempt} attempt(s): ${last_body}"
      rm -f /tmp/healthcheck.body
      exit 0
    fi
  fi

  if [ "$(date +%s)" -ge "$deadline" ]; then
    break
  fi
  sleep "$INTERVAL_SECS"
done

# ---- Failure path: print enough diagnostics that the deploy log alone is
# enough to tell whether the runtime didn't start, started on the wrong port,
# crashed during boot, or is healthy-but-returning-the-wrong-shape.
echo "[healthcheck] FAILED after ${attempt} attempt(s) over ${TIMEOUT_SECS}s against ${URL}"
echo "[healthcheck] last HTTP code: ${last_code:-<none>}"
echo "[healthcheck] last body:      ${last_body:-<empty>}"

echo "[healthcheck] --- pm2 list ---"
bash -lc 'pm2 list --no-color' 2>&1 | head -n 40 || true

echo "[healthcheck] --- pm2 jlist (first 200 lines) ---"
bash -lc 'pm2 jlist' 2>&1 | head -n 200 || true

echo "[healthcheck] --- /opt/bvisible/shared/logs/pm2/bvisible-web.out.log (tail 50) ---"
tail -n 50 /opt/bvisible/shared/logs/pm2/bvisible-web.out.log 2>&1 || echo "<no out log>"

echo "[healthcheck] --- /opt/bvisible/shared/logs/pm2/bvisible-web.err.log (tail 50) ---"
tail -n 50 /opt/bvisible/shared/logs/pm2/bvisible-web.err.log 2>&1 || echo "<no err log>"

echo "[healthcheck] --- listening on :3000 ---"
ss -tlnp 2>&1 | grep -E ':3000([[:space:]]|$)' || echo "<nothing listening on :3000>"

rm -f /tmp/healthcheck.body
exit 1
