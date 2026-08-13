// The complete orderable materials catalog — every material the shop can
// buy, merged from the live Sheet (Vendor Catalog + "Meterial price" +
// Internal Materials tabs) and enriched with the Items catalog's
// configured preferred vendors. Shared by the Order materials flow and
// the PO editor's item picker so both search the exact same list.

import { prisma } from '@bvisible/db';
import { getSheetSnapshot } from '@/lib/sheet-sync/sync';
import { normalizeVendorItemName } from '@/lib/vendor-pricing/normalize';
import type { SheetAlias } from '@/lib/sheet-sync/types';

export interface OrderableCatalogEntry {
  id: string;
  name: string;
  category: string;
  subcategory: string;
  spec: string;
  size: string;
  priceCents: number;
  vendor: string;
  vendorPrices: Array<{ vendor: string; priceCents: number }>;
  vendorSku: string;
  productUrl: string;
  /// Configured preferred vendor ('' when none).
  preferredVendor: string;
}

export interface OrderableCatalog {
  entries: OrderableCatalogEntry[];
  aliases: SheetAlias[];
  vendorEmails: Record<string, string>;
  sheetOk: boolean;
  sheetError: string | null;
}

/// Loose name key for de-duplicating the merged catalog (case,
/// punctuation, and whitespace insensitive).
export function normalizeCatalogName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export async function buildOrderableCatalog(tenantId: string): Promise<OrderableCatalog> {
  const [snapshot, preferredRows] = await Promise.all([
    getSheetSnapshot(tenantId),
    // Items catalog rows with a configured preferred vendor. The Sheet has
    // no preferred column for its Vendor Catalog / Meterial price tabs, so
    // this is where the shop's preferred-vendor choices live for those.
    prisma.shopMaterialItem.findMany({
      where: { tenantId, isActive: true, preferredVendorId: { not: null } },
      select: {
        nameNormalized: true,
        sheetKey: true,
        preferredVendor: { select: { name: true } },
      },
    }),
  ]);
  const data = snapshot.data;

  // Preferred vendor lookup: by sheetKey (exact Sheet identity) and by
  // normalized name (covers Vendor Catalog rows that sync by name).
  const preferredBySheetKey = new Map<string, string>();
  const preferredByName = new Map<string, string>();
  for (const row of preferredRows) {
    const vendorName = row.preferredVendor?.name;
    if (!vendorName) continue;
    if (row.sheetKey) preferredBySheetKey.set(row.sheetKey, vendorName);
    if (row.nameNormalized) preferredByName.set(row.nameNormalized, vendorName);
  }
  const preferredFor = (name: string, sheetKey?: string): string => {
    if (sheetKey) {
      const hit = preferredBySheetKey.get(sheetKey);
      if (hit) return hit;
    }
    return preferredByName.get(normalizeVendorItemName(name)) ?? '';
  };

  const entries: OrderableCatalogEntry[] = data.vendorCatalog.map((item) => ({
    id: item.id,
    name: item.name,
    category: item.category,
    subcategory: item.subcategory,
    spec: item.spec,
    size: item.size,
    priceCents: item.priceCents,
    vendor: item.vendor,
    vendorPrices: item.vendorPrices,
    vendorSku: item.vendorSku,
    productUrl: item.productUrl,
    preferredVendor: preferredFor(item.name),
  }));

  // The Vendor Catalog tab alone misses materials that only exist on the
  // Sheet's "Meterial price" tab (Amazon / Home Depot / Walmart shop
  // supplies like blue tape). Merge those in so the whole Sheet catalog
  // is orderable — de-duplicated by normalized name so nothing shows twice.
  // Unpriced rows are skipped: they reach the snapshot so the Catalog can show
  // them as "Price not set", but a PO line at $0.00 would be sent to a vendor.
  const seenNames = new Set(entries.map((c) => normalizeCatalogName(c.name)));
  for (const material of data.materials) {
    if (material.unpriced) continue;
    const norm = normalizeCatalogName(material.name);
    if (!norm || seenNames.has(norm)) continue;
    seenNames.add(norm);
    entries.push({
      id: `sheet-material:${material.key}`,
      name: material.name,
      category: material.category || 'Materials',
      subcategory: '',
      spec: '',
      size: '',
      priceCents: material.priceCents,
      vendor: material.vendor,
      vendorPrices: material.vendorPrices,
      // Cols M/N of the "Meterial price" tab — where the Amazon links and
      // ASINs are actually maintained. These were previously dropped here on
      // the assumption retail items lived on the Internal Materials tab, so
      // every Amazon order arrived without a SKU and no cart could ever be
      // prefilled, however carefully the Sheet was filled in.
      vendorSku: material.vendorSku,
      productUrl: material.productUrl,
      preferredVendor: preferredFor(material.name, material.key),
    });
  }

  // "Internal Materials" tab: the ~1,000-row shop-supply catalog (blue
  // tape, adhesives, primers, retail items from Amazon / Home Depot /
  // Walmart). Variants differ by spec/size ("3M #94 Tape Primer" 8 oz vs
  // Quart), so de-dupe on name+spec+size — name-only would drop variants.
  for (const item of data.internalMaterials ?? []) {
    if (item.unpriced) continue; // same reason as above — no $0.00 PO lines
    const fullKey = normalizeCatalogName(`${item.name} ${item.spec} ${item.size}`);
    const nameKey = normalizeCatalogName(item.name);
    if (!fullKey || seenNames.has(fullKey)) continue;
    if (!item.spec && !item.size && seenNames.has(nameKey)) continue;
    seenNames.add(fullKey);
    entries.push({
      id: `internal:${item.id}`,
      name: item.name,
      category: item.category || 'Shop Supplies',
      subcategory: item.subcategory,
      spec: item.spec,
      size: item.size,
      priceCents: item.priceCents,
      vendor: item.vendor,
      vendorPrices: item.vendor ? [{ vendor: item.vendor, priceCents: item.priceCents }] : [],
      // Sheet cols 13/14 on this tab. These are the ONLY source of an Amazon
      // ASIN for shop supplies — the Vendor Catalog tab covers sign materials
      // (Grimco/S&F), not the retail items ordered here.
      vendorSku: item.vendorSku,
      productUrl: item.productUrl,
      // Col 7 on this tab is the explicit preferred vendor. Snapshots cached
      // before the field existed fall back to the Items-catalog lookup.
      preferredVendor: item.preferredVendor ?? preferredFor(item.name),
    });
  }

  const vendorEmails: Record<string, string> = {};
  for (const v of data.vendorDirectory) {
    if (v.email) vendorEmails[v.vendor] = v.email;
  }

  return {
    entries,
    aliases: data.aliases,
    vendorEmails,
    sheetOk: snapshot.status === 'OK' && entries.length > 0,
    sheetError: snapshot.lastError,
  };
}
