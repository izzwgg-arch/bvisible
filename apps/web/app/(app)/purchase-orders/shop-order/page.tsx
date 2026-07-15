import Link from 'next/link';
import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { getSheetSnapshot } from '@/lib/sheet-sync/sync';
import { loadSmtpConfigFromDb, MailerConfigError } from '@/lib/mailer';
import { ShopOrderFlow, type CatalogEntry } from './shop-order-flow';

export const metadata = { title: 'Shop order' };
export const dynamic = 'force-dynamic';

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
  }));

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
