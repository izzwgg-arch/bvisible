#!/usr/bin/env bash
# Delete all smoke test data from the production database.
# Run on the app host: bash server-scripts/db/cleanup-smoke-data.sh
# Requires: docker compose running with the bvisible-db container.
set -euo pipefail

APP_ROOT="${BVISIBLE_APP_ROOT:-/opt/bvisible/app}"
cd "$APP_ROOT"

psql_q() {
  docker compose exec -T db psql -U bvisible -d bvisible -t -A -c "$1"
}

echo "=== Smoke data BEFORE deletion ==="
psql_q "SELECT 'estimates',       COUNT(*)::text FROM estimates       WHERE title LIKE 'SMOKE-%'"
psql_q "SELECT 'clients',         COUNT(*)::text FROM clients         WHERE \"companyName\" LIKE 'SMOKE-%'"
psql_q "SELECT 'items',           COUNT(*)::text FROM items           WHERE name LIKE 'SMOKE-%'"
psql_q "SELECT 'purchase_orders', COUNT(*)::text FROM purchase_orders WHERE number LIKE 'SMOKE-%' OR number IN ('PO-901001','PO-901002','PO-901003','PO-901004')"
psql_q "SELECT 'ingested_emails', COUNT(*)::text FROM ingested_emails WHERE subject LIKE 'SMOKE-%' OR \"fromAddress\" LIKE '%bvisible.local%' OR \"messageId\" LIKE '%smoke%'"
psql_q "SELECT 'vendors',         COUNT(*)::text FROM vendors         WHERE name LIKE 'SMOKE-%' OR email LIKE '%bvisible.local%'"

echo ""
echo "=== Starting deletion (in FK-safe order) ==="

# 1. Ingested emails linked to smoke POs (timeline materialize refs)
echo "-- spend_alerts on smoke POs"
psql_q "DELETE FROM spend_alerts
  WHERE \"purchaseOrderId\" IN (
    SELECT id FROM purchase_orders
    WHERE number LIKE 'SMOKE-%' OR number IN ('PO-901001','PO-901002','PO-901003','PO-901004')
  )"

echo "-- po_reconciliation_lines on smoke POs"
psql_q "DELETE FROM po_reconciliation_lines
  WHERE \"reconciliationId\" IN (
    SELECT id FROM po_reconciliations
    WHERE \"purchaseOrderId\" IN (
      SELECT id FROM purchase_orders
      WHERE number LIKE 'SMOKE-%' OR number IN ('PO-901001','PO-901002','PO-901003','PO-901004')
    )
  )"

echo "-- po_reconciliations on smoke POs"
psql_q "DELETE FROM po_reconciliations
  WHERE \"purchaseOrderId\" IN (
    SELECT id FROM purchase_orders
    WHERE number LIKE 'SMOKE-%' OR number IN ('PO-901001','PO-901002','PO-901003','PO-901004')
  )"

echo "-- vendor_price_histories on smoke PO attachments"
psql_q "DELETE FROM vendor_price_histories
  WHERE \"sourcePoAttachmentId\" IN (
    SELECT id FROM po_attachments
    WHERE \"purchaseOrderId\" IN (
      SELECT id FROM purchase_orders
      WHERE number LIKE 'SMOKE-%' OR number IN ('PO-901001','PO-901002','PO-901003','PO-901004')
    )
  )"

echo "-- ocr_line_items on smoke PO attachments"
psql_q "DELETE FROM ocr_line_items
  WHERE \"ocrDocumentId\" IN (
    SELECT id FROM ocr_documents
    WHERE \"poAttachmentId\" IN (
      SELECT id FROM po_attachments
      WHERE \"purchaseOrderId\" IN (
        SELECT id FROM purchase_orders
        WHERE number LIKE 'SMOKE-%' OR number IN ('PO-901001','PO-901002','PO-901003','PO-901004')
      )
    )
  )"

echo "-- ocr_documents on smoke PO attachments"
psql_q "DELETE FROM ocr_documents
  WHERE \"poAttachmentId\" IN (
    SELECT id FROM po_attachments
    WHERE \"purchaseOrderId\" IN (
      SELECT id FROM purchase_orders
      WHERE number LIKE 'SMOKE-%' OR number IN ('PO-901001','PO-901002','PO-901003','PO-901004')
    )
  )"

echo "-- po_attachments on smoke POs"
psql_q "DELETE FROM po_attachments
  WHERE \"purchaseOrderId\" IN (
    SELECT id FROM purchase_orders
    WHERE number LIKE 'SMOKE-%' OR number IN ('PO-901001','PO-901002','PO-901003','PO-901004')
  )"

echo "-- po_events on smoke POs"
psql_q "DELETE FROM po_events
  WHERE \"purchaseOrderId\" IN (
    SELECT id FROM purchase_orders
    WHERE number LIKE 'SMOKE-%' OR number IN ('PO-901001','PO-901002','PO-901003','PO-901004')
  )"

echo "-- po_line_items on smoke POs"
psql_q "DELETE FROM po_line_items
  WHERE \"purchaseOrderId\" IN (
    SELECT id FROM purchase_orders
    WHERE number LIKE 'SMOKE-%' OR number IN ('PO-901001','PO-901002','PO-901003','PO-901004')
  )"

echo "-- ingested_email attachments on smoke emails"
psql_q "DELETE FROM ingested_email_attachments
  WHERE \"emailId\" IN (
    SELECT id FROM ingested_emails
    WHERE subject LIKE 'SMOKE-%' OR \"fromAddress\" LIKE '%bvisible.local%' OR \"messageId\" LIKE '%smoke%'
  )"

echo "-- ingested_emails (smoke)"
psql_q "DELETE FROM ingested_emails
  WHERE subject LIKE 'SMOKE-%' OR \"fromAddress\" LIKE '%bvisible.local%' OR \"messageId\" LIKE '%smoke%'"

echo "-- purchase_orders (smoke)"
psql_q "DELETE FROM purchase_orders
  WHERE number LIKE 'SMOKE-%' OR number IN ('PO-901001','PO-901002','PO-901003','PO-901004')"

echo "-- estimate_line_items on smoke estimates"
psql_q "DELETE FROM estimate_line_items
  WHERE \"estimateId\" IN (
    SELECT id FROM estimates WHERE title LIKE 'SMOKE-%'
  )"

echo "-- invoices on smoke estimates"
psql_q "DELETE FROM invoices
  WHERE \"estimateId\" IN (
    SELECT id FROM estimates WHERE title LIKE 'SMOKE-%'
  )"

echo "-- estimates (smoke)"
psql_q "DELETE FROM estimates WHERE title LIKE 'SMOKE-%'"

echo "-- smoke vendors"
psql_q "DELETE FROM vendors WHERE name LIKE 'SMOKE-%' OR email LIKE '%bvisible.local%'"

echo "-- smoke catalog items"
psql_q "DELETE FROM items WHERE name LIKE 'SMOKE-%'"

echo "-- smoke clients"
psql_q "DELETE FROM clients WHERE \"companyName\" LIKE 'SMOKE-%'"

echo ""
echo "=== Smoke data AFTER deletion ==="
psql_q "SELECT 'estimates',       COUNT(*)::text FROM estimates       WHERE title LIKE 'SMOKE-%'"
psql_q "SELECT 'clients',         COUNT(*)::text FROM clients         WHERE \"companyName\" LIKE 'SMOKE-%'"
psql_q "SELECT 'items',           COUNT(*)::text FROM items           WHERE name LIKE 'SMOKE-%'"
psql_q "SELECT 'purchase_orders', COUNT(*)::text FROM purchase_orders WHERE number LIKE 'SMOKE-%' OR number IN ('PO-901001','PO-901002','PO-901003','PO-901004')"
psql_q "SELECT 'ingested_emails', COUNT(*)::text FROM ingested_emails WHERE subject LIKE 'SMOKE-%' OR \"fromAddress\" LIKE '%bvisible.local%' OR \"messageId\" LIKE '%smoke%'"
psql_q "SELECT 'vendors',         COUNT(*)::text FROM vendors         WHERE name LIKE 'SMOKE-%' OR email LIKE '%bvisible.local%'"

echo ""
echo "=== Done ==="
