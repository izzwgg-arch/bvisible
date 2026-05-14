import { SpendAlertStatus } from '@bvisible/db';

/**
 * Prior OPEN alerts tied to an older reconciliation snapshot for this PO.
 * Manual dismiss uses DISMISSED and is excluded. Operator-only rows without
 * poReconciliationId (non-reconciliation sources, if any) are excluded.
 */
export function spendAlertSupersedeWhereForNewPoReconciliationSnapshot(args: {
  tenantId: string;
  purchaseOrderId: string;
}) {
  return {
    tenantId: args.tenantId,
    purchaseOrderId: args.purchaseOrderId,
    status: SpendAlertStatus.OPEN,
    poReconciliationId: { not: null },
  };
}
