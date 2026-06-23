import Link from 'next/link';
import { EstimateLineKind, Role, ShopMaterialItemType, prisma } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { BundleForm, type BundleSourceRow } from '../bundle-form';

export const metadata = { title: 'Create bundle' };
export const dynamic = 'force-dynamic';

export default async function NewBundlePage() {
  const me = await requireTenantId();
  const canManage = me.role === Role.ADMIN || me.role === Role.SUPER_ADMIN;

  const [items, savedCategories] = await Promise.all([
    prisma.shopMaterialItem.findMany({
      where: { tenantId: me.tenantId, isActive: true, itemType: ShopMaterialItemType.SINGLE },
      orderBy: [{ name: 'asc' }],
      take: 500,
      select: {
        id: true,
        name: true,
        nameNormalized: true,
        kind: true,
        categories: true,
        catalogUnit: true,
        customUnitLabel: true,
        internalCostCents: true,
        markupPercentMilli: true,
        defaultSellPriceCents: true,
        defaultQtyMilli: true,
        preferredVendorId: true,
        pricingMethod: true,
        pricingInputsJson: true,
        preferredVendor: { select: { name: true } },
        vendorCatalogLinks: {
          select: {
            vendorId: true,
            vendorSku: true,
            vendor: { select: { name: true } },
            priceHistory: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: {
                priceCents: true,
                unit: true,
                effectiveAt: true,
                createdAt: true,
              },
            },
          },
        },
      },
    }),
    prisma.shopItemCategory.findMany({
      where: { tenantId: me.tenantId },
      orderBy: [{ name: 'asc' }],
      select: { name: true },
      take: 200,
    }),
  ]);

  const sources: BundleSourceRow[] = items.map((item) => {
    const latestRows = item.vendorCatalogLinks
      .map((link) => ({ link, latest: link.priceHistory[0] ?? null }))
      .filter((row) => row.latest !== null);
    const cheapest = latestRows.reduce<(typeof latestRows)[number] | null>((best, row) => {
      if (!row.latest) return best;
      if (!best?.latest || row.latest.priceCents < best.latest.priceCents) return row;
      return best;
    }, null);
    const preferred = latestRows.find((row) => row.link.vendorId === item.preferredVendorId) ?? null;
    const selectedVendorId = preferred?.link.vendorId ?? cheapest?.link.vendorId ?? null;

    return {
      id: item.id,
      name: item.name,
      nameNormalized: item.nameNormalized,
      kind: item.kind,
      categories: item.categories.length > 0 ? item.categories : [item.kind],
      catalogUnit: item.catalogUnit,
      customUnitLabel: item.customUnitLabel,
      internalCostCents: item.internalCostCents,
      markupPercentMilli: item.markupPercentMilli,
      defaultSellPriceCents: item.defaultSellPriceCents,
      defaultQtyMilli: item.defaultQtyMilli,
      preferredVendorId: item.preferredVendorId,
      cheapestVendorId: cheapest?.link.vendorId ?? null,
      selectedVendorId,
      pricingMethod: item.pricingMethod,
      pricingInputsJson: item.pricingInputsJson,
      vendorSnapshot:
        item.kind === EstimateLineKind.MATERIAL
          ? item.vendorCatalogLinks.map((link) => {
              const latest = link.priceHistory[0] ?? null;
              return {
                vendorId: link.vendorId,
                vendorName: link.vendor.name,
                vendorSku: link.vendorSku,
                latestPriceCents: latest?.priceCents ?? null,
                latestUnit: latest?.unit ?? null,
                effectiveAt: latest?.effectiveAt?.toISOString() ?? null,
                createdAt: latest?.createdAt?.toISOString() ?? null,
                isPreferred: link.vendorId === item.preferredVendorId,
                isCheapest: link.vendorId === cheapest?.link.vendorId,
              };
            })
          : [],
    };
  });

  if (!canManage) {
    return (
      <>
        <PageHeader title="Create bundle" subtitle="Admin access required." />
        <p className="text-[13px] text-[var(--color-bv-muted)]">Ask an administrator to create bundles.</p>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Create bundle"
        subtitle="Build one sellable catalog item from multiple internal component snapshots."
        actions={
          <Link
            href="/items"
            className="inline-flex items-center justify-center rounded-[12px] border border-white/80 bg-white/90 px-4 py-2.5 text-[13.5px] font-semibold text-slate-700 shadow-sm transition-all hover:-translate-y-0.5 hover:bg-white"
          >
            All items
          </Link>
        }
      />
      <BundleForm mode="create" sources={sources} savedCategories={savedCategories.map((category) => category.name)} />
    </>
  );
}
