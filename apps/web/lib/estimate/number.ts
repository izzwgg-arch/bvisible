import { Prisma } from '@bvisible/db';
import { acquireTenantSequenceLock } from '@/lib/sequence/lock';

// Per-tenant, monotonically increasing estimate number. Format:
//   EST-{6 digits}, e.g. EST-000001.
//
// Allocation strategy: take a tenant-scoped advisory lock (see
// apps/web/lib/sequence/lock.ts), find the current max, increment.
// Done inside the same transaction that creates the Estimate row so
// two concurrent "create estimate" actions never collide on the
// unique (tenantId, number) index.

const PREFIX = 'EST-';
const PAD = 6;

export async function nextEstimateNumber(
  tx: Prisma.TransactionClient,
  tenantId: string
): Promise<string> {
  await acquireTenantSequenceLock(tx, tenantId, 'estimate');

  const last = await tx.estimate.findFirst({
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
