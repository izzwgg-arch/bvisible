import { describe, expect, it } from 'vitest';
import { SpendAlertStatus } from '@bvisible/db';
import { spendAlertSupersedeWhereForNewPoReconciliationSnapshot } from './supersede-open-recon-alerts';

describe('spendAlertSupersedeWhereForNewPoReconciliationSnapshot', () => {
  it('targets only OPEN reconciliation-linked alerts for the PO', () => {
    const where = spendAlertSupersedeWhereForNewPoReconciliationSnapshot({
      tenantId: 'tenant_1',
      purchaseOrderId: 'po_1',
    });
    expect(where).toEqual({
      tenantId: 'tenant_1',
      purchaseOrderId: 'po_1',
      status: SpendAlertStatus.OPEN,
      poReconciliationId: { not: null },
    });
  });

  it('excludes DISMISSED rows by status filter (manual dismiss never auto-reopened)', () => {
    const where = spendAlertSupersedeWhereForNewPoReconciliationSnapshot({
      tenantId: 't',
      purchaseOrderId: 'p',
    });
    expect(where.status).toBe(SpendAlertStatus.OPEN);
    expect(where.status).not.toBe(SpendAlertStatus.DISMISSED);
    expect(where.status).not.toBe(SpendAlertStatus.SUPERSEDED);
  });
});
