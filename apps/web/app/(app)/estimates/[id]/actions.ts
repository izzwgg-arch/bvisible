'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { Prisma, prisma, EstimateLineKind, EstimateStatus, Role } from '@bvisible/db';
import { computeEstimate } from '@bvisible/pricing';
import {
  createClientSchema,
  finalizeEstimateSchema,
  saveEstimateSchema,
  updateEstimateStatusSchema,
  type FinalizeEstimateInput,
  type SaveEstimateInput,
  type UpdateEstimateStatusInput,
} from '@/lib/validators';
import { writeAuditLog } from '@/lib/auth/audit';
import {
  requireRole,
  requireRoleWithEffectiveCompany,
  requireTenantId,
} from '@/lib/auth/current-user';
import { readRequestContext } from '@/lib/request-context';
import { createPoFromInternalMaterials } from '@/lib/purchase-orders/create-po-from-internal-materials';

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
      status: true,
      multiplierMilli: true,
      designFlatCents: true,
      number: true,
      lines: { select: { machineId: true }, take: 0 },
    },
  });
  if (!existing) {
    return { error: 'Estimate not found.' };
  }
  if (existing.status === EstimateStatus.FINALIZED) {
    return {
      error: 'Estimate is finalized. Unfinalize before editing lines or totals.',
    };
  }

  // Markup (multiplier) and design fee changes are reserved for admins.
  // Regular users can still edit lines; the pricing knobs are read-only
  // for them in the UI and rejected here as the enforcement of record.
  const isPricingAdmin = me.role === Role.ADMIN || me.role === Role.SUPER_ADMIN;
  if (
    !isPricingAdmin &&
    (data.multiplierMilli !== existing.multiplierMilli ||
      data.designFlatCents !== existing.designFlatCents)
  ) {
    return {
      error: 'Only an admin can change the markup or design fee on an estimate.',
    };
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

  const catalogItemIds = Array.from(
    new Set(data.lines.map((l) => l.catalogItemId).filter((x): x is string => !!x))
  );
  if (catalogItemIds.length > 0) {
    const valid = await prisma.shopMaterialItem.findMany({
      where: { id: { in: catalogItemIds }, tenantId: me.tenantId },
      select: { id: true },
    });
    const validSet = new Set(valid.map((item) => item.id));
    const bad = catalogItemIds.find((id) => !validSet.has(id));
    if (bad) {
      return { error: 'One or more catalog item references are invalid.' };
    }
  }

  const selectedVendorIds = Array.from(
    new Set(data.lines.map((l) => l.selectedVendorId).filter((x): x is string => !!x))
  );
  if (selectedVendorIds.length > 0) {
    const valid = await prisma.vendor.findMany({
      where: { id: { in: selectedVendorIds }, tenantId: me.tenantId, deletedAt: null },
      select: { id: true },
    });
    const validSet = new Set(valid.map((vendor) => vendor.id));
    const bad = selectedVendorIds.find((id) => !validSet.has(id));
    if (bad) {
      return { error: 'One or more vendor references are invalid.' };
    }
  }

  // R-EST-05: preserve markup exemption + guided-flow provenance for
  // lines that round-trip through the grid editor (the editor doesn't
  // surface these flags). Lines keep their DB ids across a save, so we
  // key both off the existing rows before replace-all below.
  const flagRows = await prisma.estimateLineItem.findMany({
    where: { estimateId: data.estimateId, tenantId: me.tenantId },
    select: { id: true, markupExempt: true, sourceKind: true },
  });
  const exemptIds = new Set(flagRows.filter((r) => r.markupExempt).map((r) => r.id));
  const sourceKindById = new Map(
    flagRows.filter((r) => r.sourceKind != null).map((r) => [r.id, r.sourceKind as string])
  );

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
      markupExempt: l.id ? exemptIds.has(l.id) : false,
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
          materialCostCents: l.materialCostCents ?? null,
          partialUsageMilli: l.partialUsageMilli ?? null,
          laborHoursMilli: l.laborHoursMilli ?? null,
          machineTimeMilli: l.machineTimeMilli ?? null,
          designTimeMilli: l.designTimeMilli ?? null,
          installTimeMilli: l.installTimeMilli ?? null,
          vendorCostCents: l.vendorCostCents ?? null,
          catalogItemId: l.catalogItemId ?? null,
          pricingMethod: l.pricingMethod ?? null,
          pricingEngine: l.pricingEngine ?? null,
          pricingInputsSnapshotJson: l.pricingInputsSnapshotJson == null ? Prisma.DbNull : (l.pricingInputsSnapshotJson as Prisma.InputJsonValue),
          pricingOutputSnapshotJson: l.pricingOutputSnapshotJson == null ? Prisma.DbNull : (l.pricingOutputSnapshotJson as Prisma.InputJsonValue),
          formulaVersion: l.formulaVersion ?? null,
          selectedVendorId: l.selectedVendorId ?? null,
          selectedVendorMode: l.selectedVendorMode ?? null,
          internalNotes: l.internalNotes ?? null,
          hiddenFromCustomer: l.hiddenFromCustomer ?? false,
          customerDescription: l.customerDescription ?? null,
          // R-EST-05 flags survive the replace-all save via the old row id.
          markupExempt: l.id ? exemptIds.has(l.id) : false,
          sourceKind: l.id ? (sourceKindById.get(l.id) ?? null) : null,
          // Bundle grouping is edited in the grid, so unlike the flags
          // above it comes straight from the payload rather than the
          // old row. Members are already contiguous in `data.lines`.
          lineGroupId: l.lineGroupId ?? null,
          lineGroupLabel: l.lineGroupId ? (l.lineGroupLabel ?? null) : null,
        })),
      });
    }
    await tx.estimate.update({
      where: { id: data.estimateId, tenantId: me.tenantId },
      data: {
        title: data.title,
        notes: data.notes,
        estimateType: data.estimateType,
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
      estimateType: data.estimateType,
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

  // R-EST-04: FINALIZED is gated. Routing it through the generic status
  // changer would let any caller bypass the linked-PO + qbo-number
  // checks. Steer them to finalizeEstimateAction instead.
  if (status === EstimateStatus.FINALIZED) {
    return {
      error: 'Use the Finalize action — finalize is gated by R-EST-04.',
    };
  }

  const existing = await prisma.estimate.findFirst({
    where: { id: estimateId, tenantId: me.tenantId, deletedAt: null },
    select: { id: true, status: true, number: true },
  });
  if (!existing) return { error: 'Estimate not found.' };
  if (existing.status === status) return { error: null };
  // Once FINALIZED, only ADMIN+ can leave (via unfinalizeEstimateAction).
  if (existing.status === EstimateStatus.FINALIZED) {
    return {
      error: 'Estimate is finalized. Use Unfinalize to release the lock first.',
    };
  }

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
  const me = await requireRoleWithEffectiveCompany(Role.ADMIN, Role.SUPER_ADMIN);
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

// R-EST-04: An Estimate can only enter FINALIZED when closeout gates pass
// (APPROVED, ≥1 linked PO, QBO on every linked PO, clean reconciliation).
// Status-only update + audit — no pricing recompute.
export type FinalizeEstimateError =
  | { kind: 'not_found' }
  | { kind: 'already_finalized' }
  | { kind: 'not_approved' }
  | { kind: 'no_linked_po' }
  | { kind: 'no_qbo_number' }
  | { kind: 'reconciliation_unresolved' }
  | { kind: 'invalid'; message: string };

export interface FinalizeEstimateResult {
  ok: boolean;
  error: FinalizeEstimateError | null;
  message: string | null;
  purchaseOrderId?: string;
}

const FINALIZE_MESSAGES: Record<FinalizeEstimateError['kind'], string> = {
  not_found: 'Estimate not found.',
  already_finalized: 'Estimate is already finalized.',
  not_approved: 'Estimate must be Approved before finalizing.',
  no_linked_po: 'No internal material lines were available to create a PO.',
  no_qbo_number: 'QuickBooks PO number is not required before auto-creating a PO.',
  reconciliation_unresolved: 'Clear reconciliation on all linked POs before finalizing.',
  invalid: 'Invalid input.',
};

export async function finalizeEstimateAction(
  payload: FinalizeEstimateInput
): Promise<FinalizeEstimateResult> {
  const me = await requireTenantId();
  const ctx = await readRequestContext();

  const parsed = finalizeEstimateSchema.safeParse(payload);
  if (!parsed.success) {
    const e: FinalizeEstimateError = {
      kind: 'invalid',
      message: parsed.error.issues[0]?.message ?? 'Invalid input.',
    };
    return { ok: false, error: e, message: e.message };
  }
  const { estimateId } = parsed.data;

  const estimate = await prisma.estimate.findFirst({
    where: { id: estimateId, tenantId: me.tenantId, deletedAt: null },
    select: { id: true, status: true, number: true },
  });
  if (!estimate) {
    return {
      ok: false,
      error: { kind: 'not_found' },
      message: FINALIZE_MESSAGES.not_found,
    };
  }
  if (estimate.status === EstimateStatus.FINALIZED) {
    return {
      ok: false,
      error: { kind: 'already_finalized' },
      message: FINALIZE_MESSAGES.already_finalized,
    };
  }

  if (estimate.status !== EstimateStatus.APPROVED) {
    return {
      ok: false,
      error: { kind: 'not_approved' },
      message: FINALIZE_MESSAGES.not_approved,
    };
  }

  const finalized = await prisma.$transaction(async (tx) => {
    const poResult = await createPoFromInternalMaterials(tx, {
      tenantId: me.tenantId,
      estimateId: estimate.id,
      actorId: me.id,
    });
    if (!poResult.ok) return poResult;

    await tx.estimate.update({
      where: { id: estimate.id, tenantId: me.tenantId },
      data: { status: EstimateStatus.FINALIZED },
    });

    return poResult;
  });

  if (!finalized.ok) {
    return {
      ok: false,
      error: { kind: 'no_linked_po' },
      message: finalized.error,
    };
  }

  await writeAuditLog({
    action: 'estimate_finalized',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'estimate',
    targetId: estimate.id,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: {
      number: estimate.number,
      from: estimate.status,
      purchaseOrderId: finalized.purchaseOrderId,
      purchaseOrderNumber: finalized.purchaseOrderNumber,
      purchaseOrderCreated: finalized.created,
      linkedPoCount: 1,
      lineCount: finalized.lineCount,
      vendorCount: finalized.vendorCount,
      subtotalCents: finalized.subtotalCents,
    },
  });

  revalidatePath(`/estimates/${estimate.id}`);
  revalidatePath('/estimates');
  revalidatePath(`/purchase-orders/${finalized.purchaseOrderId}`);
  revalidatePath('/purchase-orders');
  return { ok: true, error: null, message: null, purchaseOrderId: finalized.purchaseOrderId };
}

// Unfinalize is ADMIN+ only — once we've committed against the
// estimate, walking back is a deliberate act, not an accidental click.
// Audit-logged separately from regular status changes so leaks are
// obvious in the timeline.
export async function unfinalizeEstimateAction(
  payload: FinalizeEstimateInput
): Promise<{ error: string | null }> {
  const me = await requireRoleWithEffectiveCompany(Role.ADMIN, Role.SUPER_ADMIN);
  const ctx = await readRequestContext();

  const parsed = finalizeEstimateSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const { estimateId } = parsed.data;

  const estimate = await prisma.estimate.findFirst({
    where: { id: estimateId, tenantId: me.tenantId, deletedAt: null },
    select: { id: true, status: true, number: true },
  });
  if (!estimate) return { error: 'Estimate not found.' };
  if (estimate.status !== EstimateStatus.FINALIZED) {
    return { error: 'Estimate is not finalized.' };
  }

  await prisma.estimate.update({
    where: { id: estimate.id, tenantId: me.tenantId },
    data: { status: EstimateStatus.APPROVED },
  });

  await writeAuditLog({
    action: 'estimate_unfinalized',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'estimate',
    targetId: estimate.id,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { number: estimate.number },
  });

  revalidatePath(`/estimates/${estimate.id}`);
  revalidatePath('/estimates');
  return { error: null };
}

export async function updateEstimateClientAction(payload: {
  estimateId: string;
  clientId: string;
}): Promise<{ error: string | null }> {
  const me = await requireTenantId();
  const ctx = await readRequestContext();
  const estimateId = payload.estimateId?.trim();
  const clientId = payload.clientId?.trim();
  if (!estimateId || !clientId) return { error: 'Estimate and customer are required.' };

  const [estimate, client] = await Promise.all([
    prisma.estimate.findFirst({
      where: { id: estimateId, tenantId: me.tenantId, deletedAt: null },
      select: { id: true, number: true, status: true },
    }),
    prisma.client.findFirst({
      where: { id: clientId, tenantId: me.tenantId, deletedAt: null },
      select: { id: true },
    }),
  ]);

  if (!estimate) return { error: 'Estimate not found.' };
  if (!client) return { error: 'Customer not found.' };
  if (estimate.status === EstimateStatus.FINALIZED) {
    return { error: 'Finalize lock active. Unfinalize before changing customer.' };
  }

  await prisma.estimate.update({
    where: { id: estimate.id, tenantId: me.tenantId },
    data: { clientId: client.id },
  });

  await writeAuditLog({
    action: 'estimate_client_changed',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'estimate',
    targetId: estimate.id,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { number: estimate.number, clientId: client.id },
  });

  revalidatePath(`/estimates/${estimate.id}`);
  revalidatePath('/estimates');
  return { error: null };
}

export async function updateEstimateSalesRepAction(payload: {
  estimateId: string;
  salesRepId: string;
}): Promise<{ error: string | null }> {
  const me = await requireTenantId();
  const ctx = await readRequestContext();
  const estimateId = payload.estimateId?.trim();
  const salesRepId = payload.salesRepId?.trim();
  if (!estimateId || !salesRepId) return { error: 'Estimate and sales rep are required.' };

  const [estimate, rep] = await Promise.all([
    prisma.estimate.findFirst({
      where: { id: estimateId, tenantId: me.tenantId, deletedAt: null },
      select: { id: true, number: true },
    }),
    prisma.user.findFirst({
      where: { id: salesRepId, tenantId: me.tenantId, disabledAt: null },
      select: { id: true, name: true, email: true },
    }),
  ]);
  if (!estimate) return { error: 'Estimate not found.' };
  if (!rep) return { error: 'That user is not available as a sales rep.' };

  await prisma.estimate.update({
    where: { id: estimate.id, tenantId: me.tenantId },
    data: { salesRepId: rep.id },
  });
  await writeAuditLog({
    action: 'estimate_saved',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'estimate',
    targetId: estimate.id,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { number: estimate.number, salesRepId: rep.id, field: 'salesRep' },
  });
  // Refresh every surface that renders the representative: the editor,
  // the customer-facing preview (Rep box on the document), and the list.
  revalidatePath(`/estimates/${estimate.id}`);
  revalidatePath(`/estimates/${estimate.id}/preview`);
  revalidatePath('/estimates');
  return { error: null };
}

export async function createClientAndAttachEstimateAction(payload: {
  estimateId: string;
  companyName: string;
  contactName?: string;
  email?: string;
  phone?: string;
}): Promise<{ error: string | null; clientId: string | null }> {
  const me = await requireTenantId();
  const ctx = await readRequestContext();
  const estimateId = payload.estimateId?.trim();
  if (!estimateId) return { error: 'Estimate is required.', clientId: null };

  const estimate = await prisma.estimate.findFirst({
    where: { id: estimateId, tenantId: me.tenantId, deletedAt: null },
    select: { id: true, status: true, number: true },
  });
  if (!estimate) return { error: 'Estimate not found.', clientId: null };
  if (estimate.status === EstimateStatus.FINALIZED) {
    return { error: 'Finalize lock active. Unfinalize before creating customer.', clientId: null };
  }

  const parsed = createClientSchema.safeParse({
    companyName: payload.companyName,
    contactName: payload.contactName ?? '',
    email: payload.email ?? '',
    phone: payload.phone ?? '',
    notes: '',
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid customer input.', clientId: null };
  }

  const created = await prisma.client.create({
    data: {
      tenantId: me.tenantId,
      companyName: parsed.data.companyName,
      contactName: parsed.data.contactName,
      email: parsed.data.email,
      phone: parsed.data.phone,
    },
    select: { id: true, companyName: true },
  });

  await prisma.estimate.update({
    where: { id: estimate.id, tenantId: me.tenantId },
    data: { clientId: created.id },
  });

  await writeAuditLog({
    action: 'estimate_client_created_and_attached',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'estimate',
    targetId: estimate.id,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { number: estimate.number, clientId: created.id, companyName: created.companyName },
  });

  revalidatePath(`/estimates/${estimate.id}`);
  revalidatePath('/estimates');
  revalidatePath('/clients');
  return { error: null, clientId: created.id };
}
