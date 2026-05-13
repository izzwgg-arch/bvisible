'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { prisma, EstimateLineKind, EstimateStatus, Role } from '@bvisible/db';
import { computeEstimate } from '@bvisible/pricing';
import {
  saveEstimateSchema,
  updateEstimateStatusSchema,
  type SaveEstimateInput,
  type UpdateEstimateStatusInput,
} from '@/lib/validators';
import { writeAuditLog } from '@/lib/auth/audit';
import {
  requireRole,
  requireTenantId,
} from '@/lib/auth/current-user';
import { readRequestContext } from '@/lib/request-context';

export interface SaveEstimateState {
  error: string | null;
  // Echoes back the cached totals so the client can confirm what the
  // server stored. Optional — the editor recomputes locally too.
  subtotalCostCents?: number;
  finalPriceCents?: number;
  savedAt?: number;
}

const DEFAULT_MULTIPLIER_MILLI = 3000;

export async function saveEstimateAction(
  _prev: SaveEstimateState,
  payload: SaveEstimateInput
): Promise<SaveEstimateState> {
  const me = await requireTenantId();
  const ctx = await readRequestContext();

  const parsed = saveEstimateSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const data = parsed.data;

  // Tenant gate. Refusing here means a stray cuid in the URL bar
  // can't write to another tenant's estimate.
  const existing = await prisma.estimate.findFirst({
    where: { id: data.estimateId, tenantId: me.tenantId, deletedAt: null },
    select: {
      id: true,
      multiplierMilli: true,
      number: true,
      lines: { select: { machineId: true }, take: 0 },
    },
  });
  if (!existing) {
    return { error: 'Estimate not found.' };
  }

  // Validate every machineId belongs to this tenant. One query, not
  // one-per-line.
  const machineIds = Array.from(
    new Set(data.lines.map((l) => l.machineId).filter((x): x is string => !!x))
  );
  if (machineIds.length > 0) {
    const valid = await prisma.machine.findMany({
      where: { id: { in: machineIds }, tenantId: me.tenantId },
      select: { id: true },
    });
    const validSet = new Set(valid.map((m) => m.id));
    const bad = machineIds.find((id) => !validSet.has(id));
    if (bad) {
      return { error: 'One or more machine references are invalid.' };
    }
  }

  // Run the central pricing engine on the incoming lines so the
  // cached totals on the Estimate row match what the editor showed
  // the user, byte-for-byte. The same function runs in the browser
  // — this is the canonical second opinion.
  const computed = computeEstimate({
    multiplierMilli: data.multiplierMilli,
    designFlatCents: data.designFlatCents,
    lines: data.lines.map((l, i) => ({
      id: l.id ?? `tmp-${i}`,
      kind: l.kind,
      qtyMilli: l.qtyMilli,
      unitCostCents: l.unitCostCents,
    })),
  });

  const multiplierChanged = data.multiplierMilli !== existing.multiplierMilli;

  await prisma.$transaction(async (tx) => {
    // Replace-all-lines: simplest correct strategy at this scale
    // (estimates are small). For huge grids we'd diff, but
    // saveEstimateSchema caps lines at 500 so this is fine.
    await tx.estimateLineItem.deleteMany({
      where: { estimateId: data.estimateId, tenantId: me.tenantId },
    });
    if (data.lines.length > 0) {
      await tx.estimateLineItem.createMany({
        data: data.lines.map((l, i) => ({
          tenantId: me.tenantId,
          estimateId: data.estimateId,
          sortOrder: i,
          kind: l.kind,
          description: l.description,
          qtyMilli: l.qtyMilli,
          unitCostCents: l.unitCostCents,
          computedCostCents:
            // The engine returned costs keyed by the id we sent in.
            // Re-derive the same key here (same fallback) to look up.
            computed.lineCosts[l.id ?? `tmp-${i}`] ?? 0,
          machineId: l.machineId ?? null,
          notes: l.notes ?? null,
        })),
      });
    }
    await tx.estimate.update({
      where: { id: data.estimateId, tenantId: me.tenantId },
      data: {
        title: data.title,
        notes: data.notes,
        multiplierMilli: data.multiplierMilli,
        designFlatCents: data.designFlatCents,
        subtotalCostCents: computed.subtotalCostCents,
        finalPriceCents: computed.finalPriceCents,
      },
    });
  });

  // Log multiplier overrides separately so the audit trail clearly
  // surfaces R-EST-01 deviations from the default 3.000× multiplier.
  if (multiplierChanged) {
    await writeAuditLog({
      action: 'estimate_multiplier_overridden',
      userId: me.id,
      tenantId: me.tenantId,
      targetType: 'estimate',
      targetId: data.estimateId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: {
        from: existing.multiplierMilli,
        to: data.multiplierMilli,
        defaultMultiplierMilli: DEFAULT_MULTIPLIER_MILLI,
      },
    });
  }

  await writeAuditLog({
    action: 'estimate_saved',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'estimate',
    targetId: data.estimateId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: {
      number: existing.number,
      lineCount: data.lines.length,
      subtotalCostCents: computed.subtotalCostCents,
      finalPriceCents: computed.finalPriceCents,
    },
  });

  revalidatePath(`/estimates/${data.estimateId}`);
  revalidatePath('/estimates');

  return {
    error: null,
    subtotalCostCents: computed.subtotalCostCents,
    finalPriceCents: computed.finalPriceCents,
    savedAt: Date.now(),
  };
}

export async function updateEstimateStatusAction(
  payload: UpdateEstimateStatusInput
): Promise<{ error: string | null }> {
  const me = await requireTenantId();
  const ctx = await readRequestContext();

  const parsed = updateEstimateStatusSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const { estimateId, status } = parsed.data;

  const existing = await prisma.estimate.findFirst({
    where: { id: estimateId, tenantId: me.tenantId, deletedAt: null },
    select: { id: true, status: true, number: true },
  });
  if (!existing) return { error: 'Estimate not found.' };
  if (existing.status === status) return { error: null };

  await prisma.estimate.update({
    where: { id: estimateId, tenantId: me.tenantId },
    data: { status },
  });

  await writeAuditLog({
    action: 'estimate_status_changed',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'estimate',
    targetId: estimateId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { number: existing.number, from: existing.status, to: status },
  });

  revalidatePath(`/estimates/${estimateId}`);
  revalidatePath('/estimates');
  return { error: null };
}

// Soft delete. Restricted to ADMIN / SUPER_ADMIN per spec; USERs can
// edit but not destroy. The row stays in the DB so the audit trail and
// any downstream PO references keep working.
export async function deleteEstimateAction(estimateId: string): Promise<void> {
  const me = await requireRole(Role.ADMIN, Role.SUPER_ADMIN);
  if (!me.tenantId) {
    redirect('/dashboard?error=no-tenant');
  }
  const ctx = await readRequestContext();

  const existing = await prisma.estimate.findFirst({
    where: { id: estimateId, tenantId: me.tenantId, deletedAt: null },
    select: { id: true, number: true },
  });
  if (!existing) {
    redirect('/estimates');
  }

  await prisma.estimate.update({
    where: { id: estimateId, tenantId: me.tenantId },
    data: { deletedAt: new Date() },
  });

  await writeAuditLog({
    action: 'estimate_deleted',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'estimate',
    targetId: estimateId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { number: existing.number },
  });

  revalidatePath('/estimates');
  redirect(`/estimates?deleted=${encodeURIComponent(existing.number)}`);
}
