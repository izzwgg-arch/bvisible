// runSheetSync — pulls the live Google pricing Sheet into the tenant:
//
// 1. Caches the parsed snapshot in sheet_sync_state (all tabs, JSON).
// 2. Upserts estimate materials into shop_material_items keyed by
//    `sheetKey` so the Catalog page, estimate pickers, and vendor
//    intelligence all see the Sheet as the source of truth.
// 3. Updates Machine hourly rates by name ("Machinary Price" tab).
// 4. Upserts Vendors from the "Vendor Directory" tab (order emails).
//
// The Sheet wins on every sync for cost fields it owns; app-side price
// overrides live in sheet_price_overrides and are applied at read time
// (never written back into the catalog rows).

import { Prisma, prisma } from '@bvisible/db';
import { normalizeVendorItemName } from '@/lib/vendor-pricing/normalize';
import { pricingSheetId } from './gviz';
import { fetchAndParseSheet } from './parse';
import type { SheetData, SheetSyncSnapshot } from './types';

export interface SheetSyncResult {
  ok: boolean;
  error?: string;
  materialCount?: number;
  machineCount?: number;
  vendorCount?: number;
}

export async function runSheetSync(tenantId: string): Promise<SheetSyncResult> {
  let data: SheetData;
  try {
    data = await fetchAndParseSheet();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown Sheet error';
    await prisma.sheetSyncState.upsert({
      where: { tenantId },
      update: { status: 'ERROR', lastError: message.slice(0, 2000) },
      create: {
        tenantId,
        sheetId: pricingSheetId(),
        dataJson: {},
        status: 'ERROR',
        lastError: message.slice(0, 2000),
      },
    });
    return { ok: false, error: message };
  }

  const now = new Date();
  await prisma.sheetSyncState.upsert({
    where: { tenantId },
    update: {
      sheetId: pricingSheetId(),
      dataJson: data as unknown as Prisma.InputJsonValue,
      status: 'OK',
      lastError: null,
      syncedAt: now,
    },
    create: {
      tenantId,
      sheetId: pricingSheetId(),
      dataJson: data as unknown as Prisma.InputJsonValue,
      status: 'OK',
      syncedAt: now,
    },
  });

  // --- Catalog items (estimate-side materials). Upsert by sheetKey; the
  // (tenantId, nameNormalized) unique means a pre-existing hand-entered
  // item with the same normalized name is adopted (sheetKey stamped).
  for (const material of data.materials) {
    const nameNormalized = normalizeVendorItemName(material.name);
    if (nameNormalized.length < 2) continue;
    const existing = await prisma.shopMaterialItem.findFirst({
      where: {
        tenantId,
        OR: [{ sheetKey: material.key }, { nameNormalized }],
      },
      select: { id: true },
    });
    if (existing) {
      await prisma.shopMaterialItem.update({
        where: { id: existing.id },
        data: {
          name: material.name.slice(0, 400),
          nameNormalized,
          sheetKey: material.key,
          categories: [material.category],
          internalCostCents: material.priceCents,
          isActive: true,
          notes: material.vendor ? `Cheapest vendor (Sheet): ${material.vendor}`.slice(0, 2000) : undefined,
        },
      });
    } else {
      await prisma.shopMaterialItem.create({
        data: {
          tenantId,
          name: material.name.slice(0, 400),
          nameNormalized,
          sheetKey: material.key,
          categories: [material.category],
          catalogUnit: 'EACH',
          internalCostCents: material.priceCents,
          isActive: true,
          notes: material.vendor ? `Cheapest vendor (Sheet): ${material.vendor}`.slice(0, 2000) : null,
        },
      });
    }
  }

  // --- Machine hourly rates by exact name.
  for (const machine of data.machines) {
    await prisma.machine.upsert({
      where: { tenantId_name: { tenantId, name: machine.name } },
      update: { ratePerHourCents: machine.ratePerHourCents, isActive: true },
      create: {
        tenantId,
        name: machine.name,
        ratePerHourCents: machine.ratePerHourCents,
      },
    });
  }

  // --- Vendors from the directory (order emails for the shop-order flow).
  for (const entry of data.vendorDirectory) {
    const emails = entry.email
      .split(/[,;]/)
      .map((e) => e.trim())
      .filter(Boolean);
    await prisma.vendor.upsert({
      where: { tenantId_name: { tenantId, name: entry.vendor } },
      update: {
        email: emails[0] ?? undefined,
        emails,
        phone: entry.phone || undefined,
        deletedAt: null,
      },
      create: {
        tenantId,
        name: entry.vendor,
        email: emails[0] ?? null,
        emails,
        phone: entry.phone || null,
        notes: entry.notes || null,
      },
    });
  }

  return {
    ok: true,
    materialCount: data.materials.length,
    machineCount: data.machines.length,
    vendorCount: data.vendorDirectory.length,
  };
}

const SYNC_TTL_MS = 5 * 60 * 1000;

function parseSnapshot(row: {
  sheetId: string;
  dataJson: Prisma.JsonValue;
  status: string;
  lastError: string | null;
  syncedAt: Date | null;
}): SheetSyncSnapshot {
  const data =
    row.dataJson && typeof row.dataJson === 'object' && !Array.isArray(row.dataJson)
      ? (row.dataJson as unknown as SheetData)
      : null;
  return {
    sheetId: row.sheetId,
    data:
      data ?? {
        materials: [],
        machines: [],
        sqftRates: [],
        vehicleWraps: [],
        bundles: [],
        bundleComponents: [],
        recommendations: [],
        vendorCatalog: [],
        vendorDirectory: [],
        aliases: [],
        fetchedAt: '',
      },
    status: row.status === 'OK' ? 'OK' : 'ERROR',
    lastError: row.lastError,
    syncedAt: row.syncedAt,
  };
}

/// Read the cached snapshot; refresh inline when stale (5-minute TTL) or
/// missing. Refresh failures fall back to the last good snapshot.
export async function getSheetSnapshot(
  tenantId: string,
  opts: { forceRefresh?: boolean } = {}
): Promise<SheetSyncSnapshot> {
  const row = await prisma.sheetSyncState.findUnique({ where: { tenantId } });
  const stale =
    !row ||
    !row.syncedAt ||
    row.status !== 'OK' ||
    Date.now() - row.syncedAt.getTime() > SYNC_TTL_MS;

  if (opts.forceRefresh || stale) {
    await runSheetSync(tenantId);
    const fresh = await prisma.sheetSyncState.findUnique({ where: { tenantId } });
    if (fresh) return parseSnapshot(fresh);
  }
  if (row) return parseSnapshot(row);
  return parseSnapshot({
    sheetId: pricingSheetId(),
    dataJson: null,
    status: 'ERROR',
    lastError: 'Sheet has never been synced.',
    syncedAt: null,
  });
}
