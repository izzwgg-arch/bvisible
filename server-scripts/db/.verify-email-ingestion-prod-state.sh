#!/usr/bin/env bash
# Production email-ingestion state checks (no secrets printed).
set -euo pipefail
echo "== health =="
curl -fsS http://127.0.0.1:3000/api/health
echo ""
echo "== ingest timer =="
systemctl is-active bvisible-ingest-tick.timer 2>/dev/null || true
systemctl is-enabled bvisible-ingest-tick.timer 2>/dev/null || true
echo "== INGEST_TICK_SECRET set =="
if [ -f /opt/bvisible/shared/env/.env ] && grep -q '^INGEST_TICK_SECRET=.\+' /opt/bvisible/shared/env/.env; then
  echo "yes"
else
  echo "no"
fi
echo "== inbox rows (enabled) =="
cd /opt/bvisible/app
docker compose exec -T db psql -U bvisible -d bvisible -t -c \
  "SELECT COUNT(*) FROM tenant_email_inboxes WHERE enabled = true;"
