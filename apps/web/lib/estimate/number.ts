import { Prisma } from '@bvisible/db';

// Per-tenant, monotonically increasing estimate number. Format:
//   EST-{6 digits}, e.g. EST-000001.
//
// Allocation strategy: take a tenant-scoped advisory lock, count the
// max existing number, increment, release. Done inside the same
// transaction that creates the Estimate row so two concurrent
// "create estimate" actions never collide on the unique
// (tenantId, number) index.
//
// We use a Postgres advisory lock keyed by a 32-bit hash of the
// tenant id so we don't hold a row lock against the entire estimates
// table. That's overkill for the tenant counts we expect (1-100s) and
// would block reads during commit.

const PREFIX = 'EST-';
const PAD = 6;

function tenantLockKey(tenantId: string): number {
  // Cheap deterministic 32-bit hash (FNV-1a). Postgres advisory locks
  // accept two ints; we pin the second to a constant so all "estimate
  // numbering" locks live in the same logical namespace.
  let hash = 0x811c9dc5;
  for (let i = 0; i < tenantId.length; i++) {
    hash ^= tenantId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Postgres int4 is signed; coerce to a 32-bit signed range.
  return hash | 0;
}

const LOCK_NAMESPACE = 0x65737421; // "est!" — arbitrary constant tag.

export async function nextEstimateNumber(
  tx: Prisma.TransactionClient,
  tenantId: string
): Promise<string> {
  const key = tenantLockKey(tenantId);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${key}, ${LOCK_NAMESPACE})`;

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
