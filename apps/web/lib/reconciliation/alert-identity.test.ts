import { describe, expect, it } from 'vitest';
import { SpendAlertKind } from '@bvisible/db';
import { reconciliationAlertIdentityKey } from './alert-identity';
import { reconciliationDedupeKey } from './dedupe';

describe('reconciliationAlertIdentityKey', () => {
  const tenantId = 'tenant_a';
  const poId = 'po_1';

  it('returns stable 64-char hex', () => {
    const k = reconciliationAlertIdentityKey({
      tenantId,
      kind: SpendAlertKind.PO_TOTAL_OVER_EXPECTED,
      purchaseOrderId: poId,
    });
    expect(k).toMatch(/^[a-f0-9]{64}$/);
  });

  it('is deterministic for same inputs', () => {
    const a = reconciliationAlertIdentityKey({
      tenantId,
      kind: SpendAlertKind.RECONCILIATION_AMBIGUOUS,
      purchaseOrderId: poId,
    });
    const b = reconciliationAlertIdentityKey({
      tenantId,
      kind: SpendAlertKind.RECONCILIATION_AMBIGUOUS,
      purchaseOrderId: poId,
    });
    expect(a).toBe(b);
  });

  it('differs by PO line id for missing-receipt alerts', () => {
    const a = reconciliationAlertIdentityKey({
      tenantId,
      kind: SpendAlertKind.MISSING_PO_RECEIPT_LINE,
      purchaseOrderId: poId,
      poLineItemId: 'line_a',
    });
    const b = reconciliationAlertIdentityKey({
      tenantId,
      kind: SpendAlertKind.MISSING_PO_RECEIPT_LINE,
      purchaseOrderId: poId,
      poLineItemId: 'line_b',
    });
    expect(a).not.toBe(b);
  });

  it('separates price vs qty on same PO line + history pair', () => {
    const pair = {
      tenantId,
      purchaseOrderId: poId,
      poLineItemId: 'pl_1',
      vendorPriceHistoryId: 'vh_1',
    };
    const price = reconciliationAlertIdentityKey({
      ...pair,
      kind: SpendAlertKind.PRICE_OVER_PO_EXPECTED,
    });
    const qty = reconciliationAlertIdentityKey({
      ...pair,
      kind: SpendAlertKind.QTY_MISMATCH,
    });
    expect(price).not.toBe(qty);
  });
});

describe('replay safety', () => {
  it('identity repeats across snapshots but dedupeKey stays per-run unique', () => {
    const tenantId = 't';
    const purchaseOrderId = 'p';
    const identity = reconciliationAlertIdentityKey({
      tenantId,
      kind: SpendAlertKind.PO_TOTAL_OVER_EXPECTED,
      purchaseOrderId,
    });
    const d1 = reconciliationDedupeKey({
      kind: 'po_over_total',
      tenantId,
      purchaseOrderId,
      reconciliationId: 'recon_1',
    });
    const d2 = reconciliationDedupeKey({
      kind: 'po_over_total',
      tenantId,
      purchaseOrderId,
      reconciliationId: 'recon_2',
    });
    expect(
      reconciliationAlertIdentityKey({
        tenantId,
        kind: SpendAlertKind.PO_TOTAL_OVER_EXPECTED,
        purchaseOrderId,
      }),
    ).toBe(identity);
    expect(d1).not.toBe(d2);
  });
});

describe('reconciliationAlertIdentityKey coverage', () => {
  it('splits unmatched receipt lines by vendorPriceHistoryId', () => {
    const tenantId = 'tenant_a';
    const poId = 'po_1';
    const a = reconciliationAlertIdentityKey({
      tenantId,
      purchaseOrderId: poId,
      kind: SpendAlertKind.UNMATCHED_RECEIPT_LINE,
      vendorPriceHistoryId: 'vh_a',
    });
    const b = reconciliationAlertIdentityKey({
      tenantId,
      purchaseOrderId: poId,
      kind: SpendAlertKind.UNMATCHED_RECEIPT_LINE,
      vendorPriceHistoryId: 'vh_b',
    });
    expect(a).not.toBe(b);
  });
});
