import { SpendAlertKind } from '@bvisible/db';
import { reconciliationDedupeKey } from './dedupe';

export type ReconciliationAlertIdentityInput =
  | {
      tenantId: string;
      kind: typeof SpendAlertKind.RECONCILIATION_AMBIGUOUS;
      purchaseOrderId: string;
    }
  | {
      tenantId: string;
      kind: typeof SpendAlertKind.PO_TOTAL_OVER_EXPECTED;
      purchaseOrderId: string;
    }
  | {
      tenantId: string;
      kind:
        | typeof SpendAlertKind.PRICE_OVER_PO_EXPECTED
        | typeof SpendAlertKind.QTY_MISMATCH;
      purchaseOrderId: string;
      poLineItemId: string;
      vendorPriceHistoryId: string;
    }
  | {
      tenantId: string;
      kind: typeof SpendAlertKind.UNMATCHED_RECEIPT_LINE;
      purchaseOrderId: string;
      vendorPriceHistoryId: string;
    }
  | {
      tenantId: string;
      kind: typeof SpendAlertKind.MISSING_PO_RECEIPT_LINE;
      purchaseOrderId: string;
      poLineItemId: string;
    };

/**
 * Stable 64-char hex identity for a reconciliation-driven SpendAlert.
 * Uses only structural ids + enum kind — no fuzzy text, no reconciliation id.
 */
export function reconciliationAlertIdentityKey(
  input: ReconciliationAlertIdentityInput,
): string {
  const scope = 'reconciliation_spend_alert_identity' as const;

  switch (input.kind) {
    case SpendAlertKind.RECONCILIATION_AMBIGUOUS:
      return reconciliationDedupeKey({
        scope,
        tenantId: input.tenantId,
        kind: input.kind,
        purchaseOrderId: input.purchaseOrderId,
      });
    case SpendAlertKind.PO_TOTAL_OVER_EXPECTED:
      return reconciliationDedupeKey({
        scope,
        tenantId: input.tenantId,
        kind: input.kind,
        purchaseOrderId: input.purchaseOrderId,
      });
    case SpendAlertKind.PRICE_OVER_PO_EXPECTED:
    case SpendAlertKind.QTY_MISMATCH:
      return reconciliationDedupeKey({
        scope,
        tenantId: input.tenantId,
        kind: input.kind,
        purchaseOrderId: input.purchaseOrderId,
        poLineItemId: input.poLineItemId,
        vendorPriceHistoryId: input.vendorPriceHistoryId,
      });
    case SpendAlertKind.UNMATCHED_RECEIPT_LINE:
      return reconciliationDedupeKey({
        scope,
        tenantId: input.tenantId,
        kind: input.kind,
        purchaseOrderId: input.purchaseOrderId,
        vendorPriceHistoryId: input.vendorPriceHistoryId,
      });
    case SpendAlertKind.MISSING_PO_RECEIPT_LINE:
      return reconciliationDedupeKey({
        scope,
        tenantId: input.tenantId,
        kind: input.kind,
        purchaseOrderId: input.purchaseOrderId,
        poLineItemId: input.poLineItemId,
      });
  }
}
