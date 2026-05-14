import { Prisma } from '@bvisible/db';

// Per-tenant advisory lock used by sequence allocators
// (estimate numbers, PO numbers, ...). Two-int pg_advisory_xact_lock:
//   - int1 = 32-bit FNV-1a hash of the tenant id
//   - int2 = a per-resource constant tag so different sequences never
//     contend with each other
//
// Held for the duration of the surrounding transaction. Released on
// COMMIT/ROLLBACK by Postgres — no need to release manually.
//
// See apps/web/lib/estimate/number.ts and apps/web/lib/po/number.ts
// for the concrete sequence implementations.

export type SequenceKind = 'estimate' | 'purchase_order';

const NAMESPACE_TAGS: Record<SequenceKind, number> = {
  // ASCII tags chosen so a `pg_locks` query is human-readable.
  estimate: 0x65737421, // "est!"
  purchase_order: 0x706f2123, // "po!#"
};

function tenantLockKey(tenantId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < tenantId.length; i++) {
    hash ^= tenantId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Postgres int4 is signed; coerce to a 32-bit signed range.
  return hash | 0;
}

export async function acquireTenantSequenceLock(
  tx: Prisma.TransactionClient,
  tenantId: string,
  kind: SequenceKind
): Promise<void> {
  const key = tenantLockKey(tenantId);
  const tag = NAMESPACE_TAGS[kind];
  // Prisma may bind JS numbers as BIGINT parameters; Postgres only defines
  // pg_advisory_xact_lock(integer, integer). Cast explicitly for compatibility.
  await tx.$executeRawUnsafe(
    'SELECT pg_advisory_xact_lock($1::integer, $2::integer)',
    key,
    tag
  );
}
