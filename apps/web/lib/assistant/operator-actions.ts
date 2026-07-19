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

import { prisma, EstimateLineKind, ShopCatalogUnit, EstimateStatus } from '@bvisible/db';
import { normalizeVendorItemName } from '@/lib/vendor-pricing/normalize';
import { writeAuditLog } from '@/lib/auth/audit';

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
  kind: 'delete';
  entity: RecyclableEntity;
  recordId: string;
  /// Human label shown on the approval card, e.g. "Estimate EST-000021 — test 3".
  label: string;
  /// One-line description of the consequence, shown under the label.
  detail: string;
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
  };
}

/// Execute a delete the operator approved. Soft delete only (recoverable).
export async function executeConfirmedAction(
  me: { id: string; tenantId: string },
  action: PendingAction,
): Promise<{ ok: true; label: string } | { error: string }> {
  if (action.kind !== 'delete') return { error: 'Unsupported action.' };
  const { entity, recordId } = action;
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
