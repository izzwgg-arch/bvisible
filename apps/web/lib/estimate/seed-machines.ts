import { prisma } from '@bvisible/db';

// Default machine catalog seeded per tenant. Rates from
// docs/ai-context/ESTIMATE_ENGINE.md § Machine rates. They live in
// the DB so a shop owner can edit them without a code deploy; this
// helper only inserts missing rows (upsert-by-name) so an admin's
// later edits are never overwritten on tenant re-seed.

const DEFAULT_MACHINES: ReadonlyArray<{ name: string; ratePerHourCents: number }> = [
  { name: 'Colex Sharp Cut Cutter — CNC', ratePerHourCents: 9078 },
  { name: 'Laser cutter', ratePerHourCents: 6877 },
  { name: 'Flatbed printer', ratePerHourCents: 3345 },
  { name: 'Roll-to-roll printer', ratePerHourCents: 4421 },
];

export async function ensureDefaultMachines(tenantId: string): Promise<void> {
  // Bulk createMany with skipDuplicates is one round trip and idempotent
  // against the @@unique([tenantId, name]) index.
  await prisma.machine.createMany({
    data: DEFAULT_MACHINES.map((m) => ({
      tenantId,
      name: m.name,
      ratePerHourCents: m.ratePerHourCents,
    })),
    skipDuplicates: true,
  });
}
