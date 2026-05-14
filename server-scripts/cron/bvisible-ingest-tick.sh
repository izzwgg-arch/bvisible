#!/usr/bin/env bash
# Trigger one tick of the vendor email ingestion loop. Hits the
# internal Next.js route /api/internal/email-ingest/tick on the
# loopback bvisible-web upstream, presenting the shared secret in a
# header. The loop / locking / idempotency lives in the route handler
# (apps/web/lib/email-ingest/run.ts).
#
# Auth: a single shared secret in INGEST_TICK_SECRET, read from
# /opt/bvisible/shared/env/.env. We never echo the secret to logs.
#
# Exit codes:
#   0 — request accepted (route returned 200)
#   1 — env missing
#   2 — http failure (non-2xx)
#   3 — curl/network failure

set -uo pipefail

ENV_FILE="/opt/bvisible/shared/env/.env"
LOG_FILE="/opt/bvisible/shared/logs/email-ingest-tick.log"
URL="http://127.0.0.1:3000/api/internal/email-ingest/tick"

mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || true

ts() { date -u +%FT%TZ; }

if [ ! -f "$ENV_FILE" ]; then
  echo "[$(ts)] ingest-tick: env file missing at $ENV_FILE" | tee -a "$LOG_FILE" >&2
  exit 1
fi

# Pull the secret in a subshell so we don't pollute the current
# environment with the rest of .env.
SECRET="$( ( set -a && . "$ENV_FILE" && set +a && printf '%s' "${INGEST_TICK_SECRET:-}" ) || true)"
if [ -z "$SECRET" ]; then
  echo "[$(ts)] ingest-tick: INGEST_TICK_SECRET not set in $ENV_FILE" | tee -a "$LOG_FILE" >&2
  exit 1
fi

HTTP_CODE=$(curl -sS -o /tmp/.ingest-tick-resp.json -w '%{http_code}' \
  --max-time 110 \
  -X POST \
  -H "x-bvisible-ingest-secret: $SECRET" \
  -H 'content-length: 0' \
  "$URL" 2>>"$LOG_FILE") || {
  echo "[$(ts)] ingest-tick: curl failed" | tee -a "$LOG_FILE" >&2
  exit 3
}

if [ "$HTTP_CODE" -lt 200 ] || [ "$HTTP_CODE" -ge 300 ]; then
  # Truncate the response body to keep the log slim and never leak
  # sensitive content.
  BODY=$(head -c 500 /tmp/.ingest-tick-resp.json 2>/dev/null || true)
  echo "[$(ts)] ingest-tick: http $HTTP_CODE :: $BODY" | tee -a "$LOG_FILE" >&2
  rm -f /tmp/.ingest-tick-resp.json
  exit 2
fi

# Success line — short, parseable, no secret material.
SUMMARY=$(head -c 300 /tmp/.ingest-tick-resp.json 2>/dev/null || echo '{}')
echo "[$(ts)] ingest-tick: ok $SUMMARY" >> "$LOG_FILE"
rm -f /tmp/.ingest-tick-resp.json
exit 0
