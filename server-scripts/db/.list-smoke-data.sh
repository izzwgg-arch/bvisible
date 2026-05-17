#!/usr/bin/env bash
# Read-only inventory of SMOKE test rows (no secrets, no deletes).
# Run on app host: bash server-scripts/db/.list-smoke-data.sh
set -euo pipefail

cd "${BVISIBLE_APP_ROOT:-/opt/bvisible/app}"

psql_q() {
  docker compose exec -T db psql -U bvisible -d bvisible -P pager=off -c "$1"
}

section() {
  echo ""
  echo "== $1 =="
}

section "SMOKE clients"
psql_q "SELECT id, \"companyName\", \"createdAt\"::date
FROM clients
WHERE \"companyName\" LIKE 'SMOKE%' AND \"deletedAt\" IS NULL
ORDER BY \"companyName\" LIMIT 50;"

section "SMOKE vendors"
psql_q "SELECT id, name, email, \"createdAt\"::date
FROM vendors
WHERE name LIKE 'SMOKE%' AND \"deletedAt\" IS NULL
ORDER BY name LIMIT 50;"

section "SMOKE estimates (title)"
psql_q "SELECT id, number, title, status::text, \"createdAt\"::date
FROM estimates
WHERE title LIKE 'SMOKE%' AND \"deletedAt\" IS NULL
ORDER BY \"updatedAt\" DESC LIMIT 50;"

section "SMOKE / fixture purchase orders"
psql_q "SELECT id, number, status::text, \"qboPoNumber\", \"updatedAt\"::date
FROM purchase_orders
WHERE (number LIKE 'SMOKE%' OR number LIKE 'PO-90100%')
  AND \"deletedAt\" IS NULL
ORDER BY number LIMIT 50;"

section "SMOKE ingested emails"
psql_q "SELECT id, status::text, subject, \"messageId\", \"createdAt\"::date
FROM ingested_emails
WHERE subject LIKE 'SMOKE-EMAIL%' OR subject LIKE 'SMOKE%'
ORDER BY \"createdAt\" DESC LIMIT 50;"

section "SMOKE OCR documents (via PO attachment)"
psql_q "SELECT od.id, od.status::text, po.number AS po_number, od.\"createdAt\"::date
FROM ocr_documents od
INNER JOIN po_attachments pa ON pa.id = od.\"poAttachmentId\"
INNER JOIN purchase_orders po ON po.id = pa.\"purchaseOrderId\"
WHERE po.number LIKE 'SMOKE%' OR po.number LIKE 'PO-90100%'
ORDER BY od.\"createdAt\" DESC LIMIT 50;"

section "SMOKE-linked invoices (estimate title)"
psql_q "SELECT i.id, i.number, i.status::text, e.title AS estimate_title
FROM invoices i
INNER JOIN estimates e ON e.id = i.\"estimateId\"
WHERE e.title LIKE 'SMOKE%' AND i.\"deletedAt\" IS NULL
ORDER BY i.\"updatedAt\" DESC LIMIT 50;"

section "Counts summary"
psql_q "SELECT 'clients' AS kind, COUNT(*)::text AS n FROM clients WHERE \"companyName\" LIKE 'SMOKE%' AND \"deletedAt\" IS NULL
UNION ALL SELECT 'vendors', COUNT(*)::text FROM vendors WHERE name LIKE 'SMOKE%' AND \"deletedAt\" IS NULL
UNION ALL SELECT 'estimates', COUNT(*)::text FROM estimates WHERE title LIKE 'SMOKE%' AND \"deletedAt\" IS NULL
UNION ALL SELECT 'purchase_orders', COUNT(*)::text FROM purchase_orders WHERE (number LIKE 'SMOKE%' OR number LIKE 'PO-90100%') AND \"deletedAt\" IS NULL
UNION ALL SELECT 'ingested_emails', COUNT(*)::text FROM ingested_emails WHERE subject LIKE 'SMOKE-EMAIL%' OR subject LIKE 'SMOKE%'
UNION ALL SELECT 'ocr_on_fixture_pos', COUNT(*)::text FROM ocr_documents od
  INNER JOIN po_attachments pa ON pa.id = od.\"poAttachmentId\"
  INNER JOIN purchase_orders po ON po.id = pa.\"purchaseOrderId\"
  WHERE po.number LIKE 'SMOKE%' OR po.number LIKE 'PO-90100%';"

echo ""
echo "OK — smoke data inventory (read-only)."
