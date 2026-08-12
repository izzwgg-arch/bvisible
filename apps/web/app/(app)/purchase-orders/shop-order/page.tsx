import { prisma } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { getSheetSnapshot } from '@/lib/sheet-sync/sync';
import { normalizeVendorItemName } from '@/lib/vendor-pricing/normalize';
import { loadSmtpConfigFromDb, MailerConfigError } from '@/lib/mailer';
import { ShopOrderFlow, type CatalogEntry } from './shop-order-flow';

export const metadata = { title: 'Order materials' };
export const dynamic = 'force-dynamic';

/// Loose name key for de-duplicating the merged catalog (case,
/// punctuation, and whitespace insensitive).
function normalizeCatalogName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export default async function ShopOrderPage() {
  const me = await requireTenantId();

  const [snapshot, smtp, preferredRows] = await Promise.all([
    getSheetSnapshot(me.tenantId),
    loadSmtpConfigFromDb(),
    // Items catalog rows with a configured preferred vendor. The Sheet has
    // no preferred column for its Vendor Catalog / Meterial price tabs, so
    // this is where the shop's preferred-vendor choices live for those.
    prisma.shopMaterialItem.findMany({
      where: { tenantId: me.tenantId, isActive: true, preferredVendorId: { not: null } },
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

  const catalog: CatalogEntry[] = data.vendorCatalog.map((item) => ({
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
  const seenNames = new Set(catalog.map((c) => normalizeCatalogName(c.name)));
  for (const material of data.materials) {
    if (material.unpriced) continue;
    const norm = normalizeCatalogName(material.name);
    if (!norm || seenNames.has(norm)) continue;
    seenNames.add(norm);
    catalog.push({
      id: `sheet-material:${material.key}`,
      name: material.name,
      category: material.category || 'Materials',
      subcategory: '',
      spec: '',
      size: '',
      priceCents: material.priceCents,
      vendor: material.vendor,
      vendorPrices: material.vendorPrices,
      // Deliberately blank: the "Meterial price" tab reads its vendor prices
      // from every column after index 2 by label, so fixed trailing columns
      // can't be added there without ambiguity. Retail items belong on the
      // Internal Materials tab, which does carry URL/SKU. Anything landing
      // here falls back to per-item store searches.
      vendorSku: '',
      productUrl: '',
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
    catalog.push({
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

  const sheetOk = snapshot.status === 'OK' && catalog.length > 0;

  // The flow renders its own per-screen headers (Order materials /
  // Review order) so each screen matches its mockup exactly.
  return (
    <ShopOrderFlow
      catalog={catalog}
      aliases={data.aliases}
      vendorEmails={vendorEmails}
      smtpConfigured={!(smtp instanceof MailerConfigError)}
      sheetWarning={
        sheetOk
          ? null
          : `Material list is temporarily unavailable${snapshot.lastError ? ` — ${snapshot.lastError}` : ''}. You can still add custom materials.`
      }
    />
  );
}
