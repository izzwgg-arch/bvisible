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
import { syncStandardSignsFromSheet } from '@/lib/bid/standard-sign-sync';
import type { SheetData, SheetSyncSnapshot } from './types';

export interface SheetSyncResult {
  ok: boolean;
  error?: string;
  materialCount?: number;
  machineCount?: number;
  vendorCount?: number;
  /// Bid Estimator standard-sign catalog ("Standard Signs" tab, optional).
  standardSigns?: {
    tabStatus: 'OK' | 'MISSING' | 'UNRECOGNIZED';
    count: number;
    created: number;
    updated: number;
    deactivated: number;
    skippedDuplicates: string[];
  };
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

  // --- Catalog items (estimate-side materials). Batched: one read for
  // all existing rows, createMany for new rows, and updates only for
  // rows whose Sheet-owned fields actually changed.
  const wanted = data.materials
    .map((material) => ({
      material,
      nameNormalized: normalizeVendorItemName(material.name),
    }))
    .filter((w) => w.nameNormalized.length >= 2);

  const existingRows = await prisma.shopMaterialItem.findMany({
    where: {
      tenantId,
      OR: [
        { sheetKey: { in: wanted.map((w) => w.material.key) } },
        { nameNormalized: { in: wanted.map((w) => w.nameNormalized) } },
      ],
    },
    select: {
      id: true,
      sheetKey: true,
      nameNormalized: true,
      name: true,
      internalCostCents: true,
      isActive: true,
      categories: true,
    },
  });
  const byKey = new Map(existingRows.filter((r) => r.sheetKey).map((r) => [r.sheetKey!, r]));
  const byNorm = new Map(existingRows.map((r) => [r.nameNormalized, r]));

  const toCreate: Prisma.ShopMaterialItemCreateManyInput[] = [];
  const updates: Array<{ id: string; data: Prisma.ShopMaterialItemUpdateInput }> = [];
  const seenNorms = new Set<string>();
  for (const { material, nameNormalized } of wanted) {
    if (seenNorms.has(nameNormalized)) continue;
    seenNorms.add(nameNormalized);
    const existing = byKey.get(material.key) ?? byNorm.get(nameNormalized);
    // Items the Sheet has not priced yet come in deactivated: visible in the
    // Catalog as "Price not set", but out of the estimate picker. The moment a
    // price lands in the Sheet the next sync flips this back to active on its
    // own — no manual step.
    const shouldBeActive = !material.unpriced;
    const sheetNote = material.vendor
      ? `Cheapest vendor (Sheet): ${material.vendor}`.slice(0, 2000)
      : undefined;
    const unpricedNote = 'Price not set in the Sheet — add one to use this in estimates.';
    if (existing) {
      const changed =
        existing.sheetKey !== material.key ||
        existing.name !== material.name.slice(0, 400) ||
        existing.internalCostCents !== material.priceCents ||
        existing.isActive !== shouldBeActive ||
        existing.categories[0] !== material.category;
      if (changed) {
        updates.push({
          id: existing.id,
          data: {
            name: material.name.slice(0, 400),
            nameNormalized,
            sheetKey: material.key,
            categories: [material.category],
            internalCostCents: material.priceCents,
            isActive: shouldBeActive,
            notes: material.unpriced ? unpricedNote : sheetNote,
          },
        });
      }
    } else {
      toCreate.push({
        tenantId,
        name: material.name.slice(0, 400),
        nameNormalized,
        sheetKey: material.key,
        categories: [material.category],
        catalogUnit: 'EACH',
        internalCostCents: material.priceCents,
        isActive: shouldBeActive,
        notes: material.unpriced
          ? unpricedNote
          : material.vendor
          ? `Cheapest vendor (Sheet): ${material.vendor}`.slice(0, 2000)
          : null,
      });
    }
  }
  if (toCreate.length > 0) {
    await prisma.shopMaterialItem.createMany({ data: toCreate, skipDuplicates: true });
  }
  // Small parallel chunks — typically only a handful of price changes.
  const CHUNK = 20;
  for (let i = 0; i < updates.length; i += CHUNK) {
    await Promise.all(
      updates
        .slice(i, i + CHUNK)
        .map((u) => prisma.shopMaterialItem.update({ where: { id: u.id }, data: u.data }))
    );
  }

  // --- Machine hourly rates, matched by NORMALIZED name so punctuation
  // variants never duplicate ("Colex Sharp Cut Cutter — CNC" vs "-CNC").
  // The row whose name exactly matches the Sheet wins; other active rows
  // with the same normalized name are deactivated.
  const normalizeMachine = (name: string) =>
    name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const allMachines = await prisma.machine.findMany({
    where: { tenantId },
    select: { id: true, name: true, isActive: true, ratePerHourCents: true },
  });
  for (const machine of data.machines) {
    const norm = normalizeMachine(machine.name);
    const matches = allMachines.filter((m) => normalizeMachine(m.name) === norm);
    const exact = matches.find((m) => m.name === machine.name);
    const keeper = exact ?? matches[0];
    if (keeper) {
      if (
        keeper.name !== machine.name ||
        keeper.ratePerHourCents !== machine.ratePerHourCents ||
        !keeper.isActive
      ) {
        // Renaming is safe: any exact-name duplicate IS the keeper.
        await prisma.machine.update({
          where: { id: keeper.id },
          data:
            exact || matches.length === 1
              ? { name: machine.name, ratePerHourCents: machine.ratePerHourCents, isActive: true }
              : { ratePerHourCents: machine.ratePerHourCents, isActive: true },
        });
      }
      const dupes = matches.filter((m) => m.id !== keeper.id && m.isActive);
      if (dupes.length > 0) {
        await prisma.machine.updateMany({
          where: { id: { in: dupes.map((d) => d.id) } },
          data: { isActive: false },
        });
      }
    } else {
      await prisma.machine.create({
        data: { tenantId, name: machine.name, ratePerHourCents: machine.ratePerHourCents },
      });
    }
  }

  // --- Vendors from the directory (order emails for the shop-order flow).
  const CHUNK_V = 15;
  for (let i = 0; i < data.vendorDirectory.length; i += CHUNK_V) {
    await Promise.all(
      data.vendorDirectory.slice(i, i + CHUNK_V).map((entry) => {
        const emails = entry.email
          .split(/[,;]/)
          .map((e) => e.trim())
          .filter(Boolean);
        return prisma.vendor.upsert({
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
      })
    );
  }

  // --- Standard signs (Bid Estimator). Optional tab; upsert by signKey,
  // duplicates skipped, vanished rows deactivated. Isolated so a bad row
  // never breaks the material / machine / vendor sync above.
  let standardSigns: SheetSyncResult['standardSigns'];
  try {
    const signSync = await syncStandardSignsFromSheet(
      prisma,
      tenantId,
      data.standardSigns ?? [],
      data.standardSignsTabStatus ?? 'MISSING',
      now
    );
    standardSigns = { ...signSync, count: (data.standardSigns ?? []).length };
  } catch (err) {
    console.warn('standard_sign_sync_failed', err instanceof Error ? err.message : err);
  }

  return {
    ok: true,
    materialCount: data.materials.length,
    machineCount: data.machines.length,
    vendorCount: data.vendorDirectory.length,
    standardSigns,
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
        internalMaterials: [],
        vendorDirectory: [],
        aliases: [],
        fetchedAt: '',
      },
    status: row.status === 'OK' ? 'OK' : 'ERROR',
    lastError: row.lastError,
    syncedAt: row.syncedAt,
  };
}

// One background refresh at a time per tenant (per server process) —
// avoids a stampede of identical Sheet fetches on busy pages.
const inflightSyncs = new Map<string, Promise<SheetSyncResult>>();

function refreshInBackground(tenantId: string): void {
  if (inflightSyncs.has(tenantId)) return;
  const p = runSheetSync(tenantId)
    .catch(() => ({ ok: false as const, error: 'background sync failed' }))
    .finally(() => inflightSyncs.delete(tenantId));
  inflightSyncs.set(tenantId, p);
}

/// Read the cached snapshot — stale-while-revalidate. A good cached copy
/// is returned immediately; if it's older than the 5-minute TTL a refresh
/// runs in the background for the next request. Only a missing/broken
/// snapshot (first run) blocks on a live fetch.
export async function getSheetSnapshot(
  tenantId: string,
  opts: { forceRefresh?: boolean } = {}
): Promise<SheetSyncSnapshot> {
  const row = await prisma.sheetSyncState.findUnique({ where: { tenantId } });
  const usable = row && row.syncedAt && row.status === 'OK';
  const stale = !usable || Date.now() - row.syncedAt!.getTime() > SYNC_TTL_MS;

  if (opts.forceRefresh || !usable) {
    // First sync (or explicit refresh): block so the page has data.
    const existing = inflightSyncs.get(tenantId);
    if (existing) await existing;
    else {
      const p = runSheetSync(tenantId).finally(() => inflightSyncs.delete(tenantId));
      inflightSyncs.set(tenantId, p);
      await p;
    }
    const fresh = await prisma.sheetSyncState.findUnique({ where: { tenantId } });
    if (fresh) return parseSnapshot(fresh);
  } else if (stale) {
    // Serve the cached copy instantly; refresh for the next request.
    refreshInBackground(tenantId);
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
