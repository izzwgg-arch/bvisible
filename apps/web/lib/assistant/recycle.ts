// Recycle Bin — soft-deleted records recoverable for 30 days.
//
// Deletes (from the assistant or elsewhere) set deletedAt / isActive=false
// rather than removing rows. This module lists what's recoverable, restores
// a record, and purges anything past the retention window.

import { prisma } from '@bvisible/db';
import { writeAuditLog } from '@/lib/auth/audit';
import { RECYCLE_RETENTION_DAYS, type RecyclableEntity } from './operator-actions';

export interface RecycleEntry {
  entity: RecyclableEntity;
  entityLabel: string;
  id: string;
  label: string;
  deletedAtIso: string;
  expiresAtIso: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function cutoff(): Date {
  return new Date(Date.now() - RECYCLE_RETENTION_DAYS * MS_PER_DAY);
}

function expires(deletedAt: Date): string {
  return new Date(deletedAt.getTime() + RECYCLE_RETENTION_DAYS * MS_PER_DAY).toISOString();
}

/// Everything still recoverable (deleted within the retention window).
export async function listRecycleBin(tenantId: string): Promise<RecycleEntry[]> {
  const since = cutoff();
  const [estimates, customers, vendors, pos, catalogItems] = await Promise.all([
    prisma.estimate.findMany({
      where: { tenantId, deletedAt: { gte: since } },
      orderBy: { deletedAt: 'desc' },
      select: { id: true, number: true, title: true, deletedAt: true },
    }),
    prisma.client.findMany({
      where: { tenantId, deletedAt: { gte: since } },
      orderBy: { deletedAt: 'desc' },
      select: { id: true, companyName: true, deletedAt: true },
    }),
    prisma.vendor.findMany({
      where: { tenantId, deletedAt: { gte: since } },
      orderBy: { deletedAt: 'desc' },
      select: { id: true, name: true, deletedAt: true },
    }),
    prisma.purchaseOrder.findMany({
      where: { tenantId, deletedAt: { gte: since } },
      orderBy: { deletedAt: 'desc' },
      select: { id: true, number: true, deletedAt: true },
    }),
    // Catalog items soft-delete via isActive=false; updatedAt ≈ time
    // deactivated (a recycled item isn't edited afterwards).
    prisma.shopMaterialItem.findMany({
      where: { tenantId, isActive: false, updatedAt: { gte: since } },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, name: true, updatedAt: true },
    }),
  ]);

  const rows: RecycleEntry[] = [];
  for (const e of estimates) {
    if (!e.deletedAt) continue;
    rows.push({ entity: 'estimate', entityLabel: 'Estimate', id: e.id, label: `${e.number} — ${e.title}`, deletedAtIso: e.deletedAt.toISOString(), expiresAtIso: expires(e.deletedAt) });
  }
  for (const c of customers) {
    if (!c.deletedAt) continue;
    rows.push({ entity: 'customer', entityLabel: 'Customer', id: c.id, label: c.companyName, deletedAtIso: c.deletedAt.toISOString(), expiresAtIso: expires(c.deletedAt) });
  }
  for (const v of vendors) {
    if (!v.deletedAt) continue;
    rows.push({ entity: 'vendor', entityLabel: 'Vendor', id: v.id, label: v.name, deletedAtIso: v.deletedAt.toISOString(), expiresAtIso: expires(v.deletedAt) });
  }
  for (const p of pos) {
    if (!p.deletedAt) continue;
    rows.push({ entity: 'purchase_order', entityLabel: 'Purchase order', id: p.id, label: p.number, deletedAtIso: p.deletedAt.toISOString(), expiresAtIso: expires(p.deletedAt) });
  }
  for (const it of catalogItems) {
    rows.push({ entity: 'catalog_item', entityLabel: 'Catalog item', id: it.id, label: it.name, deletedAtIso: it.updatedAt.toISOString(), expiresAtIso: expires(it.updatedAt) });
  }

  return rows.sort((a, b) => b.deletedAtIso.localeCompare(a.deletedAtIso));
}

/// Restore a soft-deleted record.
export async function restoreRecord(
  me: { id: string; tenantId: string },
  entity: RecyclableEntity,
  id: string,
): Promise<{ ok: true } | { error: string }> {
  let count = 0;
  if (entity === 'estimate') {
    count = (await prisma.estimate.updateMany({ where: { id, tenantId: me.tenantId, deletedAt: { not: null } }, data: { deletedAt: null } })).count;
  } else if (entity === 'customer') {
    count = (await prisma.client.updateMany({ where: { id, tenantId: me.tenantId, deletedAt: { not: null } }, data: { deletedAt: null } })).count;
  } else if (entity === 'vendor') {
    count = (await prisma.vendor.updateMany({ where: { id, tenantId: me.tenantId, deletedAt: { not: null } }, data: { deletedAt: null } })).count;
  } else if (entity === 'purchase_order') {
    count = (await prisma.purchaseOrder.updateMany({ where: { id, tenantId: me.tenantId, deletedAt: { not: null } }, data: { deletedAt: null } })).count;
  } else if (entity === 'catalog_item') {
    count = (await prisma.shopMaterialItem.updateMany({ where: { id, tenantId: me.tenantId, isActive: false }, data: { isActive: true } })).count;
  }
  if (count === 0) return { error: 'That record is no longer in the recycle bin.' };
  await writeAuditLog({ action: 'assistant_record_restored', userId: me.id, tenantId: me.tenantId, targetType: entity, targetId: id, metadata: { via: 'recycle_bin' } });
  return { ok: true };
}

/// Permanently remove records deleted more than 30 days ago. Idempotent —
/// safe to run nightly.
export async function purgeExpiredRecycleBin(): Promise<{ purged: number }> {
  const since = cutoff();
  let purged = 0;
  purged += (await prisma.estimate.deleteMany({ where: { deletedAt: { lt: since } } })).count;
  purged += (await prisma.purchaseOrder.deleteMany({ where: { deletedAt: { lt: since } } })).count;
  purged += (await prisma.invoice.deleteMany({ where: { deletedAt: { lt: since } } })).count;
  purged += (await prisma.client.deleteMany({ where: { deletedAt: { lt: since } } })).count;
  purged += (await prisma.vendor.deleteMany({ where: { deletedAt: { lt: since } } })).count;
  purged += (await prisma.shopMaterialItem.deleteMany({ where: { isActive: false, updatedAt: { lt: since } } })).count;
  return { purged };
}
