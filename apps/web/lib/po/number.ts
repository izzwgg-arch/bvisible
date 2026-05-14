import { Prisma } from '@bvisible/db';
import { acquireTenantSequenceLock } from '@/lib/sequence/lock';

// Per-tenant, monotonically increasing PO number. Format:
//   PO-{6 digits}, e.g. PO-000001.
//
// Allocation: tenant-scoped advisory lock + max(existing) + 1, all
// inside the same transaction that creates the PurchaseOrder row.
// Independent from QuickBooks's own PO number — this is our internal
// reference, separate from PurchaseOrder.qboPoNumber which is the
// number the user types in after creating the PO inside QuickBooks.

const PREFIX = 'PO-';
const PAD = 6;

export async function nextPoNumber(
  tx: Prisma.TransactionClient,
  tenantId: string
): Promise<string> {
  await acquireTenantSequenceLock(tx, tenantId, 'purchase_order');

  const last = await tx.purchaseOrder.findFirst({
    where: { tenantId, number: { startsWith: PREFIX } },
    orderBy: { number: 'desc' },
    select: { number: true },
  });

  let nextSeq = 1;
  if (last) {
    const parsed = Number.parseInt(last.number.slice(PREFIX.length), 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      nextSeq = parsed + 1;
    }
  }
  return `${PREFIX}${nextSeq.toString().padStart(PAD, '0')}`;
}
