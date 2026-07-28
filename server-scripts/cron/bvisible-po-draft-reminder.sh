#!/usr/bin/env bash
# Morning draft-PO reminder. Hits the internal Next.js route
# /api/internal/po-draft-reminder/tick on the loopback bvisible-web
# upstream, presenting the shared secret in a header. The per-tenant
# once-per-day guard lives in the route handler, so an accidental
# double-fire is harmless.
#
# Auth: PO_REMINDER_TICK_SECRET (falls back to INGEST_TICK_SECRET),
# read from /opt/bvisible/shared/env/.env. Never echoed to logs.
#
# Exit codes:
#   0 — request accepted (route returned 200)
#   1 — env missing
#   2 — http failure (non-2xx)
#   3 — curl/network failure

set -uo pipefail

ENV_FILE="/opt/bvisible/shared/env/.env"
LOG_FILE="/opt/bvisible/shared/logs/po-draft-reminder.log"
URL="http://127.0.0.1:3000/api/internal/po-draft-reminder/tick"

mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true

ts() { date -u +%FT%TZ; }

if [ ! -f "$ENV_FILE" ]; then
  echo "[$(ts)] po-draft-reminder: env file missing at $ENV_FILE" | tee -a "$LOG_FILE" >&2
  exit 1
fi

SECRET="$( ( set -a && . "$ENV_FILE" && set +a && printf '%s' "${PO_REMINDER_TICK_SECRET:-${INGEST_TICK_SECRET:-}}" ) || true)"
if [ -z "$SECRET" ]; then
  echo "[$(ts)] po-draft-reminder: no PO_REMINDER_TICK_SECRET / INGEST_TICK_SECRET in $ENV_FILE" | tee -a "$LOG_FILE" >&2
  exit 1
fi

HTTP_CODE=$(curl -sS -o /tmp/.po-draft-reminder-resp.json -w '%{http_code}' \
  --max-time 110 \
  -X POST \
  -H "x-bvisible-po-reminder-secret: $SECRET" \
  -H 'content-length: 0' \
  "$URL" 2>>"$LOG_FILE") || {
  echo "[$(ts)] po-draft-reminder: curl failed" | tee -a "$LOG_FILE" >&2
  exit 3
}

if [ "$HTTP_CODE" -lt 200 ] || [ "$HTTP_CODE" -ge 300 ]; then
  BODY=$(head -c 500 /tmp/.po-draft-reminder-resp.json 2>/dev/null || true)
  echo "[$(ts)] po-draft-reminder: http $HTTP_CODE :: $BODY" | tee -a "$LOG_FILE" >&2
  rm -f /tmp/.po-draft-reminder-resp.json
  exit 2
fi

SUMMARY=$(head -c 500 /tmp/.po-draft-reminder-resp.json 2>/dev/null || echo '{}')
echo "[$(ts)] po-draft-reminder: ok $SUMMARY" >> "$LOG_FILE"
rm -f /tmp/.po-draft-reminder-resp.json
exit 0
