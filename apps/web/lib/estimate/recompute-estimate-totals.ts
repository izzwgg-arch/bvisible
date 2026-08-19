// Recompute an estimate's cached subtotal + final sell price from its
// current line rows using the SAME engine as the grid editor and
// saveEstimateAction (computeEstimate). Runs on the passed client so it can
// join a surrounding transaction. Used by the Bid Estimator whenever it
// creates, reprices, or removes lines.

import { computeEstimate } from '@bvisible/pricing';
import type { Prisma, PrismaClient } from '@bvisible/db';

type Db = Prisma.TransactionClient | PrismaClient;

export async function recomputeEstimateTotals(
  db: Db,
  tenantId: string,
  estimateId: string
): Promise<{ subtotalCostCents: number; finalPriceCents: number } | null> {
  const estimate = await db.estimate.findFirst({
    where: { id: estimateId, tenantId },
    select: {
      multiplierMilli: true,
      designFlatCents: true,
      lines: {
        select: { id: true, kind: true, qtyMilli: true, unitCostCents: true, markupExempt: true },
      },
    },
  });
  if (!estimate) return null;
  const computed = computeEstimate({
    multiplierMilli: estimate.multiplierMilli,
    designFlatCents: estimate.designFlatCents,
    lines: estimate.lines.map((l) => ({
      id: l.id,
      kind: l.kind,
      qtyMilli: l.qtyMilli,
      unitCostCents: l.unitCostCents,
      markupExempt: l.markupExempt,
    })),
  });
  // Keep every line's cached computedCostCents in step with the engine.
  await Promise.all(
    estimate.lines.map((l) =>
      db.estimateLineItem.updateMany({
        where: { id: l.id, tenantId, computedCostCents: { not: computed.lineCosts[l.id] ?? 0 } },
        data: { computedCostCents: computed.lineCosts[l.id] ?? 0 },
      })
    )
  );
  await db.estimate.update({
    where: { id: estimateId, tenantId },
    data: { subtotalCostCents: computed.subtotalCostCents, finalPriceCents: computed.finalPriceCents },
  });
  return { subtotalCostCents: computed.subtotalCostCents, finalPriceCents: computed.finalPriceCents };
}
