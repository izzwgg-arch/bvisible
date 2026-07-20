// Operator actions for the AI assistant.
//
// The assistant can perform ANY normal user action in the app — create,
// edit, delete — but never touches code/backend/server, payments, or
// pension (those simply aren't reachable from here). Two safety rails:
//
//  1. Irreversible actions (delete, send, approve/finalize) never run
//     from the agent loop. The tool returns a PendingAction; the operator
//     approves it with one tap; only then does executeConfirmedAction run.
//  2. Every delete is a SOFT delete (deletedAt / isActive=false) — the row
//     moves to the 30-day Recycle Bin and can be restored. A nightly purge
//     hard-deletes anything deleted more than 30 days ago.

import { prisma, EstimateLineKind, ShopCatalogUnit, EstimateStatus, POLineKind, POEventKind } from '@bvisible/db';
import { normalizeVendorItemName } from '@/lib/vendor-pricing/normalize';
import { writeAuditLog } from '@/lib/auth/audit';
import { nextPoNumber } from '@/lib/po/number';
import { sheetItemKey } from '@/lib/sheet-sync/types';

export const RECYCLE_RETENTION_DAYS = 30;

/// Entities the assistant can soft-delete / restore. Each maps to a table
/// with a recoverable "deleted" state (deletedAt, or isActive=false).
export type RecyclableEntity =
  | 'estimate'
  | 'customer'
  | 'vendor'
  | 'purchase_order'
  | 'catalog_item';

/// A side-effectful action awaiting the operator's one-tap approval.
export interface PendingAction {
  /// Stable opaque id so the client can echo the exact action back.
  token: string;
  kind: 'delete' | 'set_estimate_status';
  /// For deletes.
  entity?: RecyclableEntity;
  recordId: string;
  /// For status changes.
  targetStatus?: 'DRAFT' | 'SENT' | 'APPROVED' | 'REJECTED';
  /// Human label shown on the approval card, e.g. "Estimate EST-000021 — test 3".
  label: string;
  /// One-line description of the consequence, shown under the label.
  detail: string;
  /// Card heading, e.g. "Approve delete?" / "Approve this estimate?".
  question: string;
  /// Confirm button text, e.g. "Approve delete".
  confirmLabel: string;
}

const ENTITY_LABEL: Record<RecyclableEntity, string> = {
  estimate: 'Estimate',
  customer: 'Customer',
  vendor: 'Vendor',
  purchase_order: 'Purchase order',
  catalog_item: 'Catalog item',
};

function newToken(): string {
  return `pa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/* ----------------------- immediate write actions ----------------------- */

/// Create a catalog (shop material) item. Reversible via delete, so it
/// runs immediately — no approval needed.
export async function createCatalogItem(
  me: { id: string; tenantId: string },
  args: Record<string, unknown>,
): Promise<{ ok: true; id: string; name: string } | { error: string }> {
  const name = String(args.name ?? '').trim().slice(0, 400);
  if (!name) return { error: 'A name is required to create a catalog item.' };

  const kind = (['MATERIAL', 'MACHINE', 'LABOR', 'DESIGN', 'INSTALL', 'MISC'].includes(String(args.kind))
    ? String(args.kind)
    : 'MATERIAL') as EstimateLineKind;
  const unit = (['EACH', 'SHEET', 'SQ_FT', 'HOUR', 'LINEAR_FT', 'ROLL', 'CUSTOM'].includes(String(args.unit))
    ? String(args.unit)
    : 'EACH') as ShopCatalogUnit;
  const internalCostCents = Math.max(0, Math.round(Number(args.internalCostCents ?? args.unitCostCents ?? 0) || 0));
  const markupPercent = Math.max(0, Number(args.markupPercent ?? 200) || 200);
  const category = String(args.category ?? '').trim().slice(0, 120) || 'Uncategorized';

  const created = await prisma.shopMaterialItem.create({
    data: {
      tenantId: me.tenantId,
      name,
      nameNormalized: normalizeVendorItemName(name),
      kind,
      catalogUnit: unit,
      categories: [category],
      internalCostCents,
      markupPercentMilli: Math.round(markupPercent * 1000),
      isActive: true,
    },
    select: { id: true, name: true },
  });

  await writeAuditLog({
    action: 'shop_material_item_created',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'shop_material_item',
    targetId: created.id,
    metadata: { via: 'ai_assistant', name: created.name },
  });

  return { ok: true, id: created.id, name: created.name };
}

/// Append a line to an existing estimate (by number or id). Reversible by
/// editing the estimate, so it runs immediately.
export async function addEstimateLine(
  me: { id: string; tenantId: string },
  args: Record<string, unknown>,
): Promise<{ ok: true; estimateId: string; number: string } | { error: string }> {
  const ref = String(args.estimate ?? args.estimateId ?? args.number ?? '').trim();
  if (!ref) return { error: 'Which estimate? Give an estimate number like EST-000021.' };

  const estimate = await prisma.estimate.findFirst({
    where: {
      tenantId: me.tenantId,
      deletedAt: null,
      OR: [{ id: ref }, { number: { equals: ref, mode: 'insensitive' } }],
    },
    select: { id: true, number: true, status: true, _count: { select: { lines: true } } },
  });
  if (!estimate) return { error: `No estimate found matching "${ref}".` };
  if (estimate.status === EstimateStatus.FINALIZED) {
    return { error: `${estimate.number} is finalized — its lines are locked.` };
  }

  const description = String(args.description ?? '').trim().slice(0, 400);
  if (!description) return { error: 'The line needs a description.' };
  const kind = (['MATERIAL', 'MACHINE', 'LABOR', 'DESIGN', 'INSTALL', 'MISC'].includes(String(args.kind))
    ? String(args.kind)
    : 'MATERIAL') as EstimateLineKind;
  const qtyMilli = Math.max(1, Math.round((Number(args.qty) || 1) * 1000));
  const unitCostCents = Math.max(0, Math.round(Number(args.unitCostCents) || 0));
  const markupExempt = Boolean(args.markupExempt);

  await prisma.estimateLineItem.create({
    data: {
      tenantId: me.tenantId,
      estimateId: estimate.id,
      sortOrder: estimate._count.lines,
      kind,
      description,
      qtyMilli,
      unitCostCents,
      computedCostCents: markupExempt ? Math.round((unitCostCents * qtyMilli) / 1000) : Math.round((unitCostCents * qtyMilli) / 1000),
      markupExempt,
      sourceKind: 'CUSTOM',
    },
  });

  await writeAuditLog({
    action: 'estimate_saved',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'estimate',
    targetId: estimate.id,
    metadata: { via: 'ai_assistant', number: estimate.number, addedLine: description },
  });

  return { ok: true, estimateId: estimate.id, number: estimate.number };
}

/// Create a DRAFT purchase order to order materials from a vendor. This is
/// reversible (soft-delete → Recycle Bin), so it runs immediately — exactly
/// like a draft estimate. It never emails anyone: the operator sends the PO
/// to vendors later with the deliberate "Send PO" action on the PO page.
///
/// Each line is linked to the shop catalog (by Sheet key, then exact name)
/// so vendor + pricing context show up on the PO, and the vendor is resolved
/// from (in order) an explicit per-line vendor, the PO-level vendor, or the
/// catalog item's preferred/selected vendor. Named vendors that don't exist
/// yet are created.
export async function createPurchaseOrder(
  me: { id: string; tenantId: string },
  args: Record<string, unknown>,
): Promise<
  | { ok: true; purchaseOrderId: string; number: string; url: string; lineCount: number; vendorCount: number; subtotalCents: number; subtotal: string }
  | { error: string }
> {
  const rawLines = Array.isArray(args.lines) ? (args.lines as Array<Record<string, unknown>>) : [];
  if (rawLines.length === 0 || rawLines.length > 100) {
    return { error: '1–100 lines are required to create a purchase order.' };
  }
  const poVendorName = String(args.vendorName ?? '').trim().slice(0, 200);
  const notes = String(args.notes ?? '').trim().slice(0, 2000) || null;

  const lines = rawLines
    .map((l) => {
      const kind = (['MATERIAL', 'MACHINE', 'LABOR', 'DESIGN', 'INSTALL', 'MISC'].includes(String(l.kind))
        ? String(l.kind)
        : 'MATERIAL') as POLineKind;
      const unit = (['EACH', 'SHEET', 'SQ_FT', 'HOUR', 'LINEAR_FT', 'ROLL', 'CUSTOM'].includes(String(l.unit))
        ? String(l.unit)
        : 'EACH') as ShopCatalogUnit;
      const qtyMilli = Math.max(1, Math.round((Number(l.qty) || 1) * 1000));
      const unitCostCents = Math.max(0, Math.round(Number(l.unitCostCents) || 0));
      return {
        kind,
        unit,
        qtyMilli,
        unitCostCents,
        computedCostCents: Math.round((unitCostCents * qtyMilli) / 1000),
        description: String(l.description ?? '').trim().slice(0, 400),
        materialName: String(l.materialName ?? '').trim().slice(0, 400),
        vendorName: String(l.vendorName ?? '').trim().slice(0, 200),
      };
    })
    .filter((l) => l.description.length > 0);

  if (lines.length === 0) return { error: 'Each purchase-order line needs a description.' };

  // Find-or-create a vendor by name, cached so we never create duplicates
  // within one PO. Sequential (not Promise.all) to avoid a create race.
  const vendorIdByName = new Map<string, string>();
  const resolveVendorByName = async (name: string): Promise<string | null> => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const cacheKey = trimmed.toLowerCase();
    const cached = vendorIdByName.get(cacheKey);
    if (cached) return cached;
    let vendor = await prisma.vendor.findFirst({
      where: { tenantId: me.tenantId, name: { equals: trimmed, mode: 'insensitive' }, deletedAt: null },
      select: { id: true },
    });
    if (!vendor) {
      vendor = await prisma.vendor.create({
        data: { tenantId: me.tenantId, name: trimmed.slice(0, 200) },
        select: { id: true },
      });
    }
    vendorIdByName.set(cacheKey, vendor.id);
    return vendor.id;
  };

  const resolved: Array<{
    kind: POLineKind;
    unit: ShopCatalogUnit;
    qtyMilli: number;
    unitCostCents: number;
    computedCostCents: number;
    description: string;
    catalogItemId: string | null;
    vendorId: string | null;
  }> = [];

  for (const line of lines) {
    // Link to the shop catalog by Sheet key first, then exact name.
    const orClauses: Array<Record<string, unknown>> = [];
    if (line.materialName) {
      orClauses.push({ sheetKey: sheetItemKey(line.materialName) });
      orClauses.push({ name: { equals: line.materialName, mode: 'insensitive' } });
    }
    const catalog =
      line.kind === POLineKind.MATERIAL && orClauses.length > 0
        ? await prisma.shopMaterialItem.findFirst({
            where: { tenantId: me.tenantId, isActive: true, OR: orClauses },
            select: { id: true, catalogUnit: true, preferredVendorId: true, selectedVendorId: true },
          })
        : null;

    let vendorId: string | null = null;
    const explicitVendor = line.vendorName || poVendorName;
    if (explicitVendor) vendorId = await resolveVendorByName(explicitVendor);
    else vendorId = catalog?.preferredVendorId ?? catalog?.selectedVendorId ?? null;

    resolved.push({
      kind: line.kind,
      unit: catalog?.catalogUnit ?? line.unit,
      qtyMilli: line.qtyMilli,
      unitCostCents: line.unitCostCents,
      computedCostCents: line.computedCostCents,
      description: line.description,
      catalogItemId: catalog?.id ?? null,
      vendorId,
    });
  }

  const subtotalCents = resolved.reduce((sum, l) => sum + l.computedCostCents, 0);
  const vendorIds = [...new Set(resolved.map((l) => l.vendorId).filter((v): v is string => Boolean(v)))];
  const primaryVendorId = vendorIds.length === 1 ? vendorIds[0] : null;

  const po = await prisma.$transaction(async (tx) => {
    const number = await nextPoNumber(tx, me.tenantId);
    const created = await tx.purchaseOrder.create({
      data: {
        tenantId: me.tenantId,
        vendorId: primaryVendorId,
        number,
        subtotalCents,
        notes,
        createdById: me.id,
      },
      select: { id: true, number: true },
    });
    await tx.pOLineItem.createMany({
      data: resolved.map((l, index) => ({
        tenantId: me.tenantId,
        purchaseOrderId: created.id,
        sortOrder: index,
        kind: l.kind,
        description: l.description,
        qtyMilli: l.qtyMilli,
        unitCostCents: l.unitCostCents,
        computedCostCents: l.computedCostCents,
        catalogItemId: l.catalogItemId,
        vendorId: l.vendorId,
        unit: l.unit,
      })),
    });
    if (vendorIds.length > 0) {
      await tx.purchaseOrderVendor.createMany({
        data: vendorIds.map((vendorId) => ({ tenantId: me.tenantId, purchaseOrderId: created.id, vendorId })),
      });
    }
    await tx.pOEvent.create({
      data: {
        tenantId: me.tenantId,
        purchaseOrderId: created.id,
        kind: POEventKind.CREATED,
        message: `Created by the assistant with ${resolved.length} line${resolved.length === 1 ? '' : 's'} across ${vendorIds.length} vendor${vendorIds.length === 1 ? '' : 's'}`,
        metadata: { via: 'ai_assistant', lineCount: resolved.length, vendorCount: vendorIds.length, subtotalCents },
        actorId: me.id,
      },
    });
    return created;
  });

  await writeAuditLog({
    action: 'po_created',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'purchase_order',
    targetId: po.id,
    metadata: { via: 'ai_assistant', number: po.number, lineCount: resolved.length, vendorCount: vendorIds.length },
  });

  return {
    ok: true,
    purchaseOrderId: po.id,
    number: po.number,
    url: `/purchase-orders/${po.id}`,
    lineCount: resolved.length,
    vendorCount: vendorIds.length,
    subtotalCents,
    subtotal: `$${(subtotalCents / 100).toFixed(2)}`,
  };
}

/* --------------------- delete (approval-gated) --------------------- */

/// Resolve the record the operator wants to delete and build a PendingAction
/// for approval. Does NOT delete anything.
export async function prepareDelete(
  me: { tenantId: string },
  entity: RecyclableEntity,
  ref: string,
): Promise<PendingAction | { error: string }> {
  const trimmed = ref.trim();
  if (!trimmed) return { error: 'Which record should I delete? Give a name or number.' };

  let recordId: string | null = null;
  let label = '';

  if (entity === 'estimate') {
    const r = await prisma.estimate.findFirst({
      where: { tenantId: me.tenantId, deletedAt: null, OR: [{ id: trimmed }, { number: { equals: trimmed, mode: 'insensitive' } }] },
      select: { id: true, number: true, title: true },
    });
    if (r) { recordId = r.id; label = `${r.number} — ${r.title}`; }
  } else if (entity === 'customer') {
    const r = await prisma.client.findFirst({
      where: { tenantId: me.tenantId, deletedAt: null, OR: [{ id: trimmed }, { companyName: { equals: trimmed, mode: 'insensitive' } }] },
      select: { id: true, companyName: true },
    });
    if (r) { recordId = r.id; label = r.companyName; }
  } else if (entity === 'vendor') {
    const r = await prisma.vendor.findFirst({
      where: { tenantId: me.tenantId, deletedAt: null, OR: [{ id: trimmed }, { name: { equals: trimmed, mode: 'insensitive' } }] },
      select: { id: true, name: true },
    });
    if (r) { recordId = r.id; label = r.name; }
  } else if (entity === 'purchase_order') {
    const r = await prisma.purchaseOrder.findFirst({
      where: { tenantId: me.tenantId, deletedAt: null, OR: [{ id: trimmed }, { number: { equals: trimmed, mode: 'insensitive' } }] },
      select: { id: true, number: true },
    });
    if (r) { recordId = r.id; label = r.number; }
  } else if (entity === 'catalog_item') {
    const r = await prisma.shopMaterialItem.findFirst({
      where: { tenantId: me.tenantId, isActive: true, OR: [{ id: trimmed }, { name: { equals: trimmed, mode: 'insensitive' } }] },
      select: { id: true, name: true },
    });
    if (r) { recordId = r.id; label = r.name; }
  }

  if (!recordId) return { error: `No ${ENTITY_LABEL[entity].toLowerCase()} found matching "${trimmed}".` };

  return {
    token: newToken(),
    kind: 'delete',
    entity,
    recordId,
    label: `${ENTITY_LABEL[entity]} ${label}`,
    detail: `Moves to the Recycle Bin — recoverable for ${RECYCLE_RETENTION_DAYS} days.`,
    question: 'Approve delete?',
    confirmLabel: 'Approve delete',
  };
}

/* ------------------- create / edit (immediate) ------------------- */

export async function createCustomer(
  me: { id: string; tenantId: string },
  args: Record<string, unknown>,
): Promise<{ ok: true; id: string; name: string } | { error: string }> {
  const companyName = String(args.companyName ?? args.name ?? '').trim().slice(0, 200);
  if (!companyName) return { error: 'A company/customer name is required.' };
  const created = await prisma.client.create({
    data: {
      tenantId: me.tenantId,
      companyName,
      contactName: String(args.contactName ?? '').trim().slice(0, 200) || null,
      email: String(args.email ?? '').trim().slice(0, 200) || null,
      phone: String(args.phone ?? '').trim().slice(0, 60) || null,
    },
    select: { id: true, companyName: true },
  });
  await writeAuditLog({ action: 'client_created', userId: me.id, tenantId: me.tenantId, targetType: 'client', targetId: created.id, metadata: { via: 'ai_assistant', name: created.companyName } });
  return { ok: true, id: created.id, name: created.companyName };
}

export async function createVendor(
  me: { id: string; tenantId: string },
  args: Record<string, unknown>,
): Promise<{ ok: true; id: string; name: string } | { error: string }> {
  const name = String(args.name ?? '').trim().slice(0, 200);
  if (!name) return { error: 'A vendor name is required.' };
  const existing = await prisma.vendor.findFirst({ where: { tenantId: me.tenantId, name: { equals: name, mode: 'insensitive' }, deletedAt: null }, select: { id: true } });
  if (existing) return { error: `A vendor named "${name}" already exists.` };
  const created = await prisma.vendor.create({
    data: {
      tenantId: me.tenantId,
      name,
      email: String(args.email ?? '').trim().slice(0, 200) || null,
      phone: String(args.phone ?? '').trim().slice(0, 60) || null,
    },
    select: { id: true, name: true },
  });
  await writeAuditLog({ action: 'vendor_created', userId: me.id, tenantId: me.tenantId, targetType: 'vendor', targetId: created.id, metadata: { via: 'ai_assistant', name: created.name } });
  return { ok: true, id: created.id, name: created.name };
}

export async function updateCustomer(
  me: { id: string; tenantId: string },
  args: Record<string, unknown>,
): Promise<{ ok: true; name: string } | { error: string }> {
  const ref = String(args.reference ?? args.id ?? '').trim();
  if (!ref) return { error: 'Which customer? Give their name.' };
  const rec = await prisma.client.findFirst({ where: { tenantId: me.tenantId, deletedAt: null, OR: [{ id: ref }, { companyName: { equals: ref, mode: 'insensitive' } }] }, select: { id: true } });
  if (!rec) return { error: `No customer found matching "${ref}".` };
  const data: Record<string, string> = {};
  if (args.newName != null && String(args.newName).trim()) data.companyName = String(args.newName).trim().slice(0, 200);
  if (args.contactName != null) data.contactName = String(args.contactName).trim().slice(0, 200);
  if (args.email != null) data.email = String(args.email).trim().slice(0, 200);
  if (args.phone != null) data.phone = String(args.phone).trim().slice(0, 60);
  if (Object.keys(data).length === 0) return { error: 'Nothing to change — tell me what to update (name, contact, email, phone).' };
  const updated = await prisma.client.update({ where: { id: rec.id }, data, select: { companyName: true } });
  await writeAuditLog({ action: 'client_updated', userId: me.id, tenantId: me.tenantId, targetType: 'client', targetId: rec.id, metadata: { via: 'ai_assistant', fields: Object.keys(data) } });
  return { ok: true, name: updated.companyName };
}

export async function updateVendor(
  me: { id: string; tenantId: string },
  args: Record<string, unknown>,
): Promise<{ ok: true; name: string } | { error: string }> {
  const ref = String(args.reference ?? args.id ?? '').trim();
  if (!ref) return { error: 'Which vendor? Give their name.' };
  const rec = await prisma.vendor.findFirst({ where: { tenantId: me.tenantId, deletedAt: null, OR: [{ id: ref }, { name: { equals: ref, mode: 'insensitive' } }] }, select: { id: true } });
  if (!rec) return { error: `No vendor found matching "${ref}".` };
  const data: Record<string, string> = {};
  if (args.newName != null && String(args.newName).trim()) data.name = String(args.newName).trim().slice(0, 200);
  if (args.email != null) data.email = String(args.email).trim().slice(0, 200);
  if (args.phone != null) data.phone = String(args.phone).trim().slice(0, 60);
  if (Object.keys(data).length === 0) return { error: 'Nothing to change — tell me what to update (name, email, phone).' };
  const updated = await prisma.vendor.update({ where: { id: rec.id }, data, select: { name: true } });
  await writeAuditLog({ action: 'vendor_updated', userId: me.id, tenantId: me.tenantId, targetType: 'vendor', targetId: rec.id, metadata: { via: 'ai_assistant', fields: Object.keys(data) } });
  return { ok: true, name: updated.name };
}

export async function updateCatalogItem(
  me: { id: string; tenantId: string },
  args: Record<string, unknown>,
): Promise<{ ok: true; name: string } | { error: string }> {
  const ref = String(args.reference ?? args.id ?? '').trim();
  if (!ref) return { error: 'Which catalog item? Give its name.' };
  const rec = await prisma.shopMaterialItem.findFirst({ where: { tenantId: me.tenantId, isActive: true, OR: [{ id: ref }, { name: { equals: ref, mode: 'insensitive' } }] }, select: { id: true } });
  if (!rec) return { error: `No catalog item found matching "${ref}".` };
  const data: Record<string, unknown> = {};
  if (args.newName != null && String(args.newName).trim()) {
    data.name = String(args.newName).trim().slice(0, 400);
    data.nameNormalized = normalizeVendorItemName(String(args.newName));
  }
  if (args.internalCostCents != null) data.internalCostCents = Math.max(0, Math.round(Number(args.internalCostCents) || 0));
  if (args.markupPercent != null) data.markupPercentMilli = Math.max(0, Math.round((Number(args.markupPercent) || 0) * 1000));
  if (args.category != null && String(args.category).trim()) data.categories = [String(args.category).trim().slice(0, 120)];
  if (Object.keys(data).length === 0) return { error: 'Nothing to change — tell me what to update (name, cost, markup, category).' };
  const updated = await prisma.shopMaterialItem.update({ where: { id: rec.id }, data, select: { name: true } });
  await writeAuditLog({ action: 'shop_material_item_saved', userId: me.id, tenantId: me.tenantId, targetType: 'shop_material_item', targetId: rec.id, metadata: { via: 'ai_assistant', fields: Object.keys(data) } });
  return { ok: true, name: updated.name };
}

export async function updateEstimate(
  me: { id: string; tenantId: string },
  args: Record<string, unknown>,
): Promise<{ ok: true; number: string } | { error: string }> {
  const ref = String(args.estimate ?? args.reference ?? args.id ?? '').trim();
  if (!ref) return { error: 'Which estimate? Give its number (e.g. EST-000021).' };
  const rec = await prisma.estimate.findFirst({ where: { tenantId: me.tenantId, deletedAt: null, OR: [{ id: ref }, { number: { equals: ref, mode: 'insensitive' } }] }, select: { id: true, number: true, status: true } });
  if (!rec) return { error: `No estimate found matching "${ref}".` };
  if (rec.status === EstimateStatus.FINALIZED) return { error: `${rec.number} is finalized and locked.` };
  const data: Record<string, unknown> = {};
  if (args.title != null && String(args.title).trim()) data.title = String(args.title).trim().slice(0, 200);
  if (args.markupPercent != null) data.multiplierMilli = Math.round((1 + (Number(args.markupPercent) || 0) / 100) * 1000);
  if (args.customerName != null && String(args.customerName).trim()) {
    const name = String(args.customerName).trim().slice(0, 200);
    let client = await prisma.client.findFirst({ where: { tenantId: me.tenantId, companyName: { equals: name, mode: 'insensitive' }, deletedAt: null }, select: { id: true } });
    if (!client) client = await prisma.client.create({ data: { tenantId: me.tenantId, companyName: name }, select: { id: true } });
    data.clientId = client.id;
  }
  if (Object.keys(data).length === 0) return { error: 'Nothing to change — tell me what to update (title, markup %, customer).' };
  await prisma.estimate.update({ where: { id: rec.id }, data });
  await writeAuditLog({ action: 'estimate_saved', userId: me.id, tenantId: me.tenantId, targetType: 'estimate', targetId: rec.id, metadata: { via: 'ai_assistant', fields: Object.keys(data) } });
  return { ok: true, number: rec.number };
}

/* ------------- approval-gated: estimate status change ------------- */

const STATUS_QUESTION: Record<string, string> = {
  APPROVED: 'Approve this estimate?',
  SENT: 'Mark this estimate as sent?',
  REJECTED: 'Mark this estimate rejected?',
  DRAFT: 'Move this estimate back to draft?',
};

export async function prepareStatusChange(
  me: { tenantId: string },
  ref: string,
  targetStatus: 'DRAFT' | 'SENT' | 'APPROVED' | 'REJECTED',
): Promise<PendingAction | { error: string }> {
  const trimmed = ref.trim();
  if (!trimmed) return { error: 'Which estimate? Give its number.' };
  const rec = await prisma.estimate.findFirst({ where: { tenantId: me.tenantId, deletedAt: null, OR: [{ id: trimmed }, { number: { equals: trimmed, mode: 'insensitive' } }] }, select: { id: true, number: true, title: true, status: true } });
  if (!rec) return { error: `No estimate found matching "${trimmed}".` };
  if (rec.status === EstimateStatus.FINALIZED) return { error: `${rec.number} is finalized and locked.` };
  return {
    token: newToken(),
    kind: 'set_estimate_status',
    recordId: rec.id,
    targetStatus,
    label: `${rec.number} — ${rec.title}`,
    detail: `Status will change to ${targetStatus}.`,
    question: STATUS_QUESTION[targetStatus] ?? 'Approve this change?',
    confirmLabel: 'Approve',
  };
}

/// Execute a delete the operator approved. Soft delete only (recoverable).
export async function executeConfirmedAction(
  me: { id: string; tenantId: string },
  action: PendingAction,
): Promise<{ ok: true; label: string } | { error: string }> {
  if (action.kind === 'set_estimate_status') {
    const target = action.targetStatus;
    if (!target) return { error: 'No target status.' };
    const r = await prisma.estimate.updateMany({
      where: { id: action.recordId, tenantId: me.tenantId, deletedAt: null, status: { not: EstimateStatus.FINALIZED } },
      data: { status: target as EstimateStatus },
    });
    if (r.count === 0) return { error: 'That estimate can no longer change status.' };
    await writeAuditLog({ action: 'estimate_status_changed', userId: me.id, tenantId: me.tenantId, targetType: 'estimate', targetId: action.recordId, metadata: { via: 'ai_assistant', status: target } });
    return { ok: true, label: action.label };
  }

  if (action.kind !== 'delete') return { error: 'Unsupported action.' };
  const { entity, recordId } = action;
  if (!entity) return { error: 'No entity to delete.' };
  const now = new Date();

  // Every branch re-checks tenant ownership — the confirm request is a
  // separate call, so never trust the client-supplied id blindly.
  if (entity === 'estimate') {
    const r = await prisma.estimate.updateMany({ where: { id: recordId, tenantId: me.tenantId, deletedAt: null }, data: { deletedAt: now } });
    if (r.count === 0) return { error: 'That estimate no longer exists.' };
    await writeAuditLog({ action: 'estimate_deleted', userId: me.id, tenantId: me.tenantId, targetType: 'estimate', targetId: recordId, metadata: { via: 'ai_assistant', recoverable: true } });
  } else if (entity === 'customer') {
    const r = await prisma.client.updateMany({ where: { id: recordId, tenantId: me.tenantId, deletedAt: null }, data: { deletedAt: now } });
    if (r.count === 0) return { error: 'That customer no longer exists.' };
    await writeAuditLog({ action: 'clients_bulk_deleted', userId: me.id, tenantId: me.tenantId, targetType: 'client', targetId: recordId, metadata: { via: 'ai_assistant', recoverable: true } });
  } else if (entity === 'vendor') {
    const r = await prisma.vendor.updateMany({ where: { id: recordId, tenantId: me.tenantId, deletedAt: null }, data: { deletedAt: now } });
    if (r.count === 0) return { error: 'That vendor no longer exists.' };
    await writeAuditLog({ action: 'vendors_bulk_deleted', userId: me.id, tenantId: me.tenantId, targetType: 'vendor', targetId: recordId, metadata: { via: 'ai_assistant', recoverable: true } });
  } else if (entity === 'purchase_order') {
    const r = await prisma.purchaseOrder.updateMany({ where: { id: recordId, tenantId: me.tenantId, deletedAt: null }, data: { deletedAt: now } });
    if (r.count === 0) return { error: 'That purchase order no longer exists.' };
    await writeAuditLog({ action: 'po_deleted', userId: me.id, tenantId: me.tenantId, targetType: 'purchase_order', targetId: recordId, metadata: { via: 'ai_assistant', recoverable: true } });
  } else if (entity === 'catalog_item') {
    const r = await prisma.shopMaterialItem.updateMany({ where: { id: recordId, tenantId: me.tenantId, isActive: true }, data: { isActive: false } });
    if (r.count === 0) return { error: 'That catalog item no longer exists.' };
    await writeAuditLog({ action: 'shop_material_items_bulk_deactivated', userId: me.id, tenantId: me.tenantId, targetType: 'shop_material_item', targetId: recordId, metadata: { via: 'ai_assistant', recoverable: true } });
  } else {
    return { error: 'Unsupported entity.' };
  }

  return { ok: true, label: action.label };
}
