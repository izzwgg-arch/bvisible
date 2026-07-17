import Link from 'next/link';
import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { getSheetSnapshot } from '@/lib/sheet-sync/sync';
import { loadSmtpConfigFromDb, MailerConfigError } from '@/lib/mailer';
import { ShopOrderFlow, type CatalogEntry } from './shop-order-flow';

export const metadata = { title: 'Shop order' };
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

  const [snapshot, smtp] = await Promise.all([
    getSheetSnapshot(me.tenantId),
    loadSmtpConfigFromDb(),
  ]);
  const data = snapshot.data;

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
  }));

  // The Vendor Catalog tab alone misses materials that only exist on the
  // Sheet's "Meterial price" tab (Amazon / Home Depot / Walmart shop
  // supplies like blue tape). Merge those in so the whole Sheet catalog
  // is orderable — de-duplicated by normalized name so nothing shows twice.
  const seenNames = new Set(catalog.map((c) => normalizeCatalogName(c.name)));
  for (const material of data.materials) {
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
      vendorSku: '',
      productUrl: '',
    });
  }

  // "Internal Materials" tab: the ~1,000-row shop-supply catalog (blue
  // tape, adhesives, primers, retail items from Amazon / Home Depot /
  // Walmart). Variants differ by spec/size ("3M #94 Tape Primer" 8 oz vs
  // Quart), so de-dupe on name+spec+size — name-only would drop variants.
  for (const item of data.internalMaterials ?? []) {
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
      vendorSku: '',
      productUrl: '',
    });
  }

  const vendorEmails: Record<string, string> = {};
  for (const v of data.vendorDirectory) {
    if (v.email) vendorEmails[v.vendor] = v.email;
  }

  const sheetOk = snapshot.status === 'OK' && catalog.length > 0;

  return (
    <>
      <PageHeader
        title="What materials do you need?"
        subtitle="Type the material name — misspellings are okay. The lowest-price vendor is selected first, but you can change it on any line."
        actions={
          <Link
            href="/purchase-orders"
            className="inline-flex items-center justify-center rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3.5 py-2 text-[13.5px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
          >
            All purchase orders
          </Link>
        }
      />

      <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-4 py-1.5 text-[12px] text-[var(--color-bv-muted)] shadow-[var(--shadow-bv-card)]">
        <span className={`h-2 w-2 rounded-full ${sheetOk ? 'bg-emerald-500' : 'bg-amber-500'}`} />
        {sheetOk ? (
          <span>
            Live Sheet · {catalog.length} orderable materials · lowest vendors selected
            automatically
          </span>
        ) : (
          <span>
            Pricing Sheet unavailable{snapshot.lastError ? ` — ${snapshot.lastError}` : ''}. Custom
            materials still work.
          </span>
        )}
      </div>

      <ShopOrderFlow
        catalog={catalog}
        aliases={data.aliases}
        vendorEmails={vendorEmails}
        smtpConfigured={!(smtp instanceof MailerConfigError)}
      />
    </>
  );
}
