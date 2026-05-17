#!/usr/bin/env bash
# Optional smoke fixture cleanup — DRY RUN by default.
# Deletes only rows matching SMOKE- prefixes or PO-90100* fixture numbers.
#
#   bash server-scripts/db/.cleanup-smoke-data.sh          # dry-run counts
#   CONFIRM_SMOKE_CLEANUP=1 bash server-scripts/db/.cleanup-smoke-data.sh  # execute
#
# Never deletes non-smoke rows. Does not print secrets.
set -euo pipefail

cd "${BVISIBLE_APP_ROOT:-/opt/bvisible/app}"

DRY=1
if [ "${CONFIRM_SMOKE_CLEANUP:-}" = "1" ]; then
  DRY=0
  echo "WARNING: CONFIRM_SMOKE_CLEANUP=1 — destructive deletes will run."
else
  echo "DRY RUN (set CONFIRM_SMOKE_CLEANUP=1 to delete)."
fi

psql_q() {
  docker compose exec -T db psql -U bvisible -d bvisible -t -A -c "$1"
}

count_po_fixture() {
  psql_q "SELECT COUNT(*) FROM purchase_orders WHERE (number LIKE 'SMOKE%' OR number LIKE 'PO-90100%') AND \"deletedAt\" IS NULL;" | tr -d '[:space:]'
}

echo "== before =="
echo "fixture POs: $(count_po_fixture)"
psql_q "SELECT 'ingested_emails', COUNT(*) FROM ingested_emails WHERE subject LIKE 'SMOKE-EMAIL%';"
psql_q "SELECT 'estimates', COUNT(*) FROM estimates WHERE title LIKE 'SMOKE%' AND \"deletedAt\" IS NULL;"

if [ "$DRY" -eq 1 ]; then
  echo ""
  echo "Dry-run only. To delete smoke rows (tenant-scoped fixtures):"
  echo "  CONFIRM_SMOKE_CLEANUP=1 bash server-scripts/db/.cleanup-smoke-data.sh"
  echo ""
  echo "Manual SQL may be safer for FK-heavy chains — see docs/ai-context/DEBUGGING.md."
  exit 0
fi

# Order: child tables first. Soft-delete where the schema uses deletedAt.
run_delete() {
  local label="$1"
  local sql="$2"
  echo "-- $label"
  docker compose exec -T db psql -U bvisible -d bvisible -c "$sql"
}

# Ingested email attachments + emails (SMOKE-EMAIL subjects only)
run_delete "ingested_email_attachments (SMOKE-EMAIL)" \
  "DELETE FROM ingested_email_attachments WHERE \"ingestedEmailId\" IN (SELECT id FROM ingested_emails WHERE subject LIKE 'SMOKE-EMAIL%');"

run_delete "ingested_emails (SMOKE-EMAIL)" \
  "DELETE FROM ingested_emails WHERE subject LIKE 'SMOKE-EMAIL%';"

# PO events on fixture POs then soft-delete POs
run_delete "po_events on fixture POs" \
  "DELETE FROM po_events WHERE \"purchaseOrderId\" IN (SELECT id FROM purchase_orders WHERE number LIKE 'SMOKE%' OR number LIKE 'PO-90100%');"

run_delete "soft-delete fixture POs" \
  "UPDATE purchase_orders SET \"deletedAt\" = NOW() WHERE (number LIKE 'SMOKE%' OR number LIKE 'PO-90100%') AND \"deletedAt\" IS NULL;"

run_delete "soft-delete SMOKE estimates" \
  "UPDATE estimates SET \"deletedAt\" = NOW() WHERE title LIKE 'SMOKE%' AND \"deletedAt\" IS NULL;"

run_delete "soft-delete SMOKE clients" \
  "UPDATE clients SET \"deletedAt\" = NOW() WHERE \"companyName\" LIKE 'SMOKE%' AND \"deletedAt\" IS NULL;"

run_delete "soft-delete SMOKE vendors" \
  "UPDATE vendors SET \"deletedAt\" = NOW() WHERE name LIKE 'SMOKE%' AND \"deletedAt\" IS NULL;"

echo ""
echo "== after =="
echo "fixture POs: $(count_po_fixture)"
echo "OK — smoke cleanup finished."
