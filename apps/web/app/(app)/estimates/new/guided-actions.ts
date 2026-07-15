'use server';

// Guided estimate creation (customer-flow redesign). Lines arrive
// pre-expanded from the client builder; this action re-runs the central
// pricing engine (R-EST-05 markup exemption included), creates the
// client on the fly when needed, and persists a completely standard
// Estimate + EstimateLineItem set — quotes, approval, PO creation, and
// finalize gates all behave exactly as before.

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma } from '@bvisible/db';
import { computeEstimate, type LineKind } from '@bvisible/pricing';
import { writeAuditLog } from '@/lib/auth/audit';
import { requireTenantId } from '@/lib/auth/current-user';
import { readRequestContext } from '@/lib/request-context';
import { nextEstimateNumber } from '@/lib/estimate/number';

const guidedLineSchema = z.object({
  kind: z.enum(['MATERIAL', 'MACHINE', 'LABOR', 'DESIGN', 'INSTALL', 'MISC']),
  description: z.string().trim().min(1).max(400),
  qtyMilli: z.number().int().min(0).max(1_000_000_000),
  unitCostCents: z.number().int().min(0).max(1_000_000_000),
  markupExempt: z.boolean().default(false),
  sourceKind: z.enum(['READY_ITEM', 'BUNDLE', 'VEHICLE_WRAP', 'SQFT_ITEM', 'CUSTOM']),
  /// Normalized Sheet item key — resolved to catalogItemId server-side.
  sheetKey: z.string().trim().max(400).nullish(),
  machineName: z.string().trim().max(200).nullish(),
  notes: z.string().trim().max(2000).nullish(),
});

const guidedEstimateSchema = z.object({
  title: z.string().trim().min(1, 'Job name is required.').max(200),
  clientId: z.string().trim().min(1).nullish(),
  newClientName: z.string().trim().max(200).nullish(),
  markupPercent: z.number().min(0).max(10000),
  intent: z.enum(['save', 'custom-build']),
  lines: z.array(guidedLineSchema).max(200),
});

export interface GuidedEstimateState {
  error: string | null;
}

export async function createGuidedEstimateAction(
  _prev: GuidedEstimateState,
  formData: FormData
): Promise<GuidedEstimateState> {
  const me = await requireTenantId();
  const ctx = await readRequestContext();

  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get('payload') ?? '{}'));
  } catch {
    return { error: 'Invalid request payload.' };
  }
  const parsed = guidedEstimateSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const data = parsed.data;

  if (!data.clientId && !data.newClientName) {
    return { error: 'Pick a customer or enter a new customer name.' };
  }
  if (data.intent === 'save' && data.lines.length === 0) {
    return { error: 'Add at least one line (or use Custom build to open the editor).' };
  }

  // Resolve / create the client.
  let clientId = data.clientId ?? null;
  if (clientId) {
    const ok = await prisma.client.findFirst({
      where: { id: clientId, tenantId: me.tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!ok) return { error: 'That customer does not exist.' };
  } else {
    const name = data.newClientName!;
    const existing = await prisma.client.findFirst({
      where: { tenantId: me.tenantId, companyName: name, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      clientId = existing.id;
    } else {
      const created = await prisma.client.create({
        data: { tenantId: me.tenantId, companyName: name },
        select: { id: true },
      });
      clientId = created.id;
      await writeAuditLog({
        action: 'client_created',
        userId: me.id,
        tenantId: me.tenantId,
        targetType: 'client',
        targetId: created.id,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        metadata: { companyName: name, via: 'guided_estimate' },
      });
    }
  }

  // Resolve Sheet-synced catalog + machine references in bulk.
  const sheetKeys = Array.from(
    new Set(data.lines.map((l) => l.sheetKey).filter((k): k is string => !!k))
  );
  const catalogByKey = new Map<string, string>();
  if (sheetKeys.length > 0) {
    const items = await prisma.shopMaterialItem.findMany({
      where: { tenantId: me.tenantId, sheetKey: { in: sheetKeys } },
      select: { id: true, sheetKey: true },
    });
    for (const item of items) {
      if (item.sheetKey) catalogByKey.set(item.sheetKey, item.id);
    }
  }
  const machineNames = Array.from(
    new Set(data.lines.map((l) => l.machineName).filter((n): n is string => !!n))
  );
  const machineByName = new Map<string, string>();
  if (machineNames.length > 0) {
    const machines = await prisma.machine.findMany({
      where: { tenantId: me.tenantId, name: { in: machineNames } },
      select: { id: true, name: true },
    });
    for (const m of machines) machineByName.set(m.name, m.id);
  }

  // 200% markup → ×3.000 multiplier. Guided estimates carry no automatic
  // design flat fee — bundles/custom builds add design lines explicitly.
  const multiplierMilli = Math.round((1 + data.markupPercent / 100) * 1000);
  const designFlatCents = 0;

  const computed = computeEstimate({
    multiplierMilli,
    designFlatCents,
    lines: data.lines.map((l, i) => ({
      id: `line-${i}`,
      kind: l.kind as LineKind,
      qtyMilli: l.qtyMilli,
      unitCostCents: l.unitCostCents,
      markupExempt: l.markupExempt,
    })),
  });

  const estimate = await prisma.$transaction(async (tx) => {
    const number = await nextEstimateNumber(tx, me.tenantId);
    const created = await tx.estimate.create({
      data: {
        tenantId: me.tenantId,
        clientId: clientId!,
        number,
        title: data.title,
        estimateType: 'CUSTOM',
        multiplierMilli,
        designFlatCents,
        subtotalCostCents: computed.subtotalCostCents,
        finalPriceCents: computed.finalPriceCents,
        createdById: me.id,
      },
      select: { id: true, number: true },
    });
    if (data.lines.length > 0) {
      await tx.estimateLineItem.createMany({
        data: data.lines.map((l, i) => ({
          tenantId: me.tenantId,
          estimateId: created.id,
          sortOrder: i,
          kind: l.kind,
          description: l.description,
          qtyMilli: l.qtyMilli,
          unitCostCents: l.unitCostCents,
          computedCostCents: computed.lineCosts[`line-${i}`] ?? 0,
          markupExempt: l.markupExempt,
          sourceKind: l.sourceKind,
          machineId: l.machineName ? (machineByName.get(l.machineName) ?? null) : null,
          catalogItemId: l.sheetKey ? (catalogByKey.get(l.sheetKey) ?? null) : null,
          notes: l.notes ?? null,
        })),
      });
    }
    return created;
  });

  await writeAuditLog({
    action: 'estimate_created',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'estimate',
    targetId: estimate.id,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: {
      number: estimate.number,
      clientId,
      title: data.title,
      via: 'guided_flow',
      markupPercent: data.markupPercent,
      lineCount: data.lines.length,
      intent: data.intent,
    },
  });

  redirect(
    data.intent === 'custom-build'
      ? `/estimates/${estimate.id}#estimate-line-grid`
      : `/estimates/${estimate.id}`
  );
}
