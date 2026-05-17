#!/usr/bin/env bash
# Production smoke: PO receipt reconciliation workflow (DB + static checks).
# Never prints secrets. Run on app host: bash server-scripts/db/.verify-po-receipt-smoke-prod.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "${BVISIBLE_APP_ROOT:-/opt/bvisible/app}"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }

psql_q() {
  docker compose exec -T db psql -U bvisible -d bvisible -t -A -c "$1"
}

echo "== static: OCR approve triggers reconciliation =="
grep -q 'runPoReconciliationSnapshot' apps/web/app/\(app\)/admin/ocr-review/actions.ts
grep -q 'buildOcrApproveTriggerDedupeKey' apps/web/app/\(app\)/admin/ocr-review/actions.ts
pass "approve action wires reconciliation snapshot"

echo "== db: no VendorPriceHistory on non-CONFIRMED OCR docs =="
BAD=$(psql_q "SELECT COUNT(*) FROM vendor_price_histories vph
  INNER JOIN ocr_line_items oli ON oli.id = vph.\"ocrLineItemId\"
  INNER JOIN ocr_documents od ON od.id = oli.\"ocrDocumentId\"
  WHERE od.status <> 'CONFIRMED';" | tr -d '[:space:]')
[ "$BAD" = "0" ] || fail "found $BAD VPH rows on non-CONFIRMED OCR docs"
pass "VPH only after OCR CONFIRMED"

echo "== db: CONFIRMED OCR docs with approved lines should have reconciliation or dedupe skip =="
# At least one CONFIRMED doc on a PO should have a POReconciliation row (workflow hardened).
CONFIRMED_WITH_PO=$(psql_q "SELECT COUNT(DISTINCT od.id) FROM ocr_documents od
  INNER JOIN po_attachments pa ON pa.id = od.\"poAttachmentId\"
  WHERE od.status = 'CONFIRMED';" | tr -d '[:space:]')
if [ "${CONFIRMED_WITH_PO:-0}" = "0" ]; then
  echo "WARN: no CONFIRMED OCR docs on POs — operator smoke needs manual approve"
else
  RECON_FOR_CONFIRMED=$(psql_q "SELECT COUNT(DISTINCT od.id) FROM ocr_documents od
    INNER JOIN po_attachments pa ON pa.id = od.\"poAttachmentId\"
    INNER JOIN purchase_orders po ON po.id = pa.\"purchaseOrderId\"
    INNER JOIN po_reconciliations pr ON pr.\"purchaseOrderId\" = po.id
    WHERE od.status = 'CONFIRMED';" | tr -d '[:space:]')
  if [ "${RECON_FOR_CONFIRMED:-0}" = "0" ]; then
    echo "WARN: CONFIRMED OCR on POs but no po_reconciliations yet — approve one line in /admin/ocr-review"
  else
    pass "found reconciliation snapshot(s) for CONFIRMED OCR PO(s) ($RECON_FOR_CONFIRMED doc PO pairings)"
  fi
fi

echo "== db: REJECTED/FAILED OCR must not create VPH =="
BAD2=$(psql_q "SELECT COUNT(*) FROM vendor_price_histories vph
  INNER JOIN ocr_line_items oli ON oli.id = vph.\"ocrLineItemId\"
  INNER JOIN ocr_documents od ON od.id = oli.\"ocrDocumentId\"
  WHERE od.status IN ('REJECTED', 'FAILED');" | tr -d '[:space:]')
[ "$BAD2" = "0" ] || fail "found $BAD2 VPH on REJECTED/FAILED OCR"
pass "rejected/failed OCR has no vendor price history"

echo "== db: sample PO-901004 / SMOKE PO posture =="
psql_q "SELECT po.number, od.id, od.status,
  (SELECT COUNT(*) FROM ocr_line_items WHERE \"ocrDocumentId\" = od.id) AS lines,
  (SELECT COUNT(*) FROM po_reconciliations WHERE \"purchaseOrderId\" = po.id) AS recons
FROM purchase_orders po
LEFT JOIN po_attachments pa ON pa.\"purchaseOrderId\" = po.id
LEFT JOIN ocr_documents od ON od.\"poAttachmentId\" = pa.id
WHERE po.number IN ('PO-901004', 'SMOKE-RECON')
   OR po.number LIKE 'SMOKE%'
ORDER BY po.number, od.\"createdAt\" DESC NULLS LAST
LIMIT 8;" | while IFS='|' read -r pon ocrid st lines recons; do
  [ -z "$pon" ] && continue
  echo "  PO=$pon ocr=${ocrid:-none} status=${st:-n/a} lines=${lines:-0} recons=${recons:-0}"
done
pass "sample PO listing printed"

echo "OK — PO receipt reconciliation production smoke (DB) complete."
