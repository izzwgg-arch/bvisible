import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma, Role, VendorPriceExtractionMethod, EstimateLineKind } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { formatMoney, formatQty, kindLabel } from '@/lib/estimate/format';
import { labelVendorPriceExtractionMethod } from '@/lib/ui/status-labels';
import { sellPriceFromCostAndMarkup } from '@/lib/shop-material/markup';
import { formatCatalogUnitDisplay } from '@/lib/shop-material/catalog-unit-display';
import {
  linkVendorCatalogToShopItemAction,
  removeShopMaterialAliasAction,
  setShopMaterialActiveAction,
  setShopMaterialPreferredVendorAction,
} from '../actions';
import { ManualVendorPriceForm, ShopAliasForm } from './item-admin-forms';
import { ItemDetailPricingForm } from './item-detail-pricing-form';

export const dynamic = 'force-dynamic';

export default async function ItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireTenantId();
  const { id } = await params;
  const canManage = me.role === Role.ADMIN || me.role === Role.SUPER_ADMIN;

  const item = await prisma.shopMaterialItem.findFirst({
    where: { id, tenantId: me.tenantId },
    select: {
      id: true,
      name: true,
      nameNormalized: true,
      kind: true,
      catalogUnit: true,
      customUnitLabel: true,
      internalCostCents: true,
      markupPercentMilli: true,
      defaultSellPriceCents: true,
      defaultQtyMilli: true,
      machineId: true,
      notes: true,
      isActive: true,
      preferredVendorId: true,
      preferredVendor: { select: { id: true, name: true } },
      updatedAt: true,
      aliases: {
        orderBy: { aliasNormalized: 'asc' },
        select: { id: true, aliasNormalized: true },
      },
      vendorCatalogLinks: {
        select: {
          id: true,
          vendorId: true,
          vendorSku: true,
          vendor: { select: { name: true } },
          priceHistory: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              priceCents: true,
              createdAt: true,
              effectiveAt: true,
              extractionMethod: true,
            },
          },
        },
      },
    },
  });

  if (!item) notFound();

  const catalogIds = item.vendorCatalogLinks.map((l) => l.id);

  const history =
    catalogIds.length === 0
      ? []
      : await prisma.vendorPriceHistory.findMany({
          where: { tenantId: me.tenantId, vendorCatalogItemId: { in: catalogIds } },
          orderBy: { createdAt: 'desc' },
          take: 120,
          select: {
            id: true,
            priceCents: true,
            unit: true,
            createdAt: true,
            effectiveAt: true,
            extractionMethod: true,
            itemNameRaw: true,
            vendor: { select: { name: true } },
          },
        });

  const recentOcrish =
    catalogIds.length === 0
      ? []
      : await prisma.vendorPriceHistory.findMany({
          where: {
            tenantId: me.tenantId,
            vendorCatalogItemId: { in: catalogIds },
            extractionMethod: {
              in: [
                VendorPriceExtractionMethod.OCR_APPROVED,
                VendorPriceExtractionMethod.OCR_TEXT_REGEX,
              ],
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 15,
          select: {
            id: true,
            priceCents: true,
            createdAt: true,
            extractionMethod: true,
            vendor: { select: { name: true } },
          },
        });

  const strayCatalogRows =
    item.kind === EstimateLineKind.MATERIAL
      ? await prisma.vendorCatalogItem.findMany({
          where: {
            tenantId: me.tenantId,
            nameNormalized: item.nameNormalized,
            OR: [{ shopMaterialItemId: null }, { shopMaterialItemId: { not: item.id } }],
          },
          select: {
            id: true,
            shopMaterialItemId: true,
            vendor: { select: { name: true } },
          },
          take: 12,
        })
      : [];

  const [vendors, machines] = await Promise.all([
    prisma.vendor.findMany({
      where: { tenantId: me.tenantId, deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
      take: 400,
    }),
    prisma.machine.findMany({
      where: { tenantId: me.tenantId, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
      take: 200,
    }),
  ]);

  let cheapest: { vendor: string; cents: number } | null = null;
  for (const link of item.vendorCatalogLinks) {
    const h = link.priceHistory[0];
    if (!h) continue;
    if (!cheapest || h.priceCents < cheapest.cents) {
      cheapest = { vendor: link.vendor.name, cents: h.priceCents };
    }
  }

  const prefLatest =
    item.preferredVendorId != null
      ? item.vendorCatalogLinks.find((l) => l.vendorId === item.preferredVendorId)?.priceHistory[0]
      : undefined;

  const costBasisForSellHint =
    item.kind === EstimateLineKind.MATERIAL && prefLatest
      ? prefLatest.priceCents
      : item.kind === EstimateLineKind.MATERIAL && cheapest
        ? cheapest.cents
        : item.internalCostCents;
  const sellHint =
    item.defaultSellPriceCents ??
    sellPriceFromCostAndMarkup(costBasisForSellHint, item.markupPercentMilli);

  return (
    <>
      <PageHeader
        title={item.name}
        subtitle={`${kindLabel(item.kind)} · normalized key: ${item.nameNormalized}`}
        actions={
          <Link
            href="/items"
            className="inline-flex items-center justify-center rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3.5 py-2 text-[13.5px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
          >
            All items
          </Link>
        }
      />

      {!item.isActive ? (
        <div className="mb-5 rounded-[var(--radius-bv)] border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-950">
          This item is <strong>inactive</strong> — it stays in the catalog for audit but should not receive new pricing without review.
        </div>
      ) : null}

      {strayCatalogRows.length > 0 ? (
        <div className="mb-5 rounded-[var(--radius-bv)] border border-amber-200/90 bg-amber-50/60 px-4 py-3 text-[13px] text-amber-950 shadow-[var(--shadow-bv-card)]">
          <p className="font-semibold">Possible duplicate vendor catalog rows</p>
          <p className="mt-1 text-[12.5px] leading-snug text-amber-950/90">
            Other vendor pricing rows share this normalized key but are not linked to this item. Add aliases for spelling variants or link rows when the normalized keys truly match.
          </p>
          <ul className="mt-2 space-y-2 text-[12.5px]">
            {strayCatalogRows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white/70 px-3 py-2">
                <span>
                  <span className="font-medium">{r.vendor.name}</span>
                  <span className="text-[var(--color-bv-muted)]">
                    {' '}
                    · catalog row <span className="font-mono text-[11px]">{r.id.slice(0, 8)}…</span>
                  </span>
                  {r.shopMaterialItemId ? (
                    <span className="ml-2 text-[11px] font-semibold uppercase tracking-wide text-amber-900">
                      Linked elsewhere
                    </span>
                  ) : (
                    <span className="ml-2 text-[11px] font-semibold uppercase tracking-wide text-amber-900">
                      Unlinked
                    </span>
                  )}
                </span>
                {canManage && !r.shopMaterialItemId ? (
                  <form action={linkVendorCatalogToShopItemAction}>
                    <input type="hidden" name="shopMaterialItemId" value={item.id} />
                    <input type="hidden" name="vendorCatalogItemId" value={r.id} />
                    <button
                      type="submit"
                      className="rounded-[6px] border border-amber-300 bg-white px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-950 hover:bg-amber-50"
                    >
                      Link row
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-6">
          <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-5 shadow-[var(--shadow-bv-card)]">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[var(--color-bv-muted)]">
              Pricing overview
            </h2>
            <dl className="mt-3 grid gap-3 text-[13px] sm:grid-cols-2">
              <div>
                <dt className="text-[var(--color-bv-muted)]">Line type</dt>
                <dd className="font-medium">{kindLabel(item.kind)}</dd>
              </div>
              <div>
                <dt className="text-[var(--color-bv-muted)]">Catalog unit</dt>
                <dd className="font-medium">
                  {formatCatalogUnitDisplay(item.catalogUnit, item.customUnitLabel)}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--color-bv-muted)]">Internal unit cost</dt>
                <dd className="font-medium tabular-nums">{formatMoney(item.internalCostCents)}</dd>
              </div>
              <div>
                <dt className="text-[var(--color-bv-muted)]">Markup</dt>
                <dd className="font-medium tabular-nums">
                  {item.markupPercentMilli === 0
                    ? '—'
                    : `${(item.markupPercentMilli / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 })}%`}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--color-bv-muted)]">Sell hint (guidance)</dt>
                <dd className="font-medium tabular-nums text-emerald-900">{formatMoney(sellHint)}</dd>
              </div>
              <div>
                <dt className="text-[var(--color-bv-muted)]">Default qty</dt>
                <dd className="font-medium tabular-nums">{formatQty(item.defaultQtyMilli)}</dd>
              </div>
              <div>
                <dt className="text-[var(--color-bv-muted)]">Cheapest vendor (MATERIAL)</dt>
                <dd className="font-medium">
                  {item.kind === EstimateLineKind.MATERIAL && cheapest
                    ? `${cheapest.vendor} · ${formatMoney(cheapest.cents)}`
                    : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-[var(--color-bv-muted)]">Preferred vendor latest</dt>
                <dd className="font-medium">
                  {item.kind !== EstimateLineKind.MATERIAL ? (
                    '—'
                  ) : item.preferredVendor ? (
                    prefLatest ? (
                      `${formatMoney(prefLatest.priceCents)} (${labelVendorPriceExtractionMethod(prefLatest.extractionMethod)})`
                    ) : (
                      'No observations yet'
                    )
                  ) : (
                    'No preferred vendor set'
                  )}
                </dd>
              </div>
            </dl>
          </section>

          <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-5 shadow-[var(--shadow-bv-card)]">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[var(--color-bv-muted)]">
              Vendor offers (latest snapshot)
            </h2>
            {item.vendorCatalogLinks.length === 0 ? (
              <p className="mt-3 text-[13px] text-[var(--color-bv-muted)]">
                No vendor rows linked yet — record a manual price or link an existing vendor catalog row.
              </p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-[var(--color-bv-border)] text-left text-[11px] uppercase tracking-wide text-[var(--color-bv-muted)]">
                      <th className="py-2 pr-3 font-medium">Vendor</th>
                      <th className="py-2 pr-3 font-medium">SKU</th>
                      <th className="py-2 pr-3 font-medium">Latest price</th>
                      <th className="py-2 font-medium">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {item.vendorCatalogLinks.map((link) => {
                      const h = link.priceHistory[0];
                      return (
                        <tr key={link.id} className="border-b border-[var(--color-bv-border)] last:border-b-0">
                          <td className="py-2 pr-3">
                            <Link
                              href={`/vendors/${link.vendorId}`}
                              className="font-medium text-[var(--color-bv-accent)]"
                            >
                              {link.vendor.name}
                            </Link>
                          </td>
                          <td className="py-2 pr-3 font-mono text-[11px] text-[var(--color-bv-muted)]">
                            {link.vendorSku ?? '—'}
                          </td>
                          <td className="py-2 pr-3 tabular-nums">
                            {h ? (
                              <>
                                {formatMoney(h.priceCents)}
                                <div className="text-[11px] text-[var(--color-bv-muted)]">
                                  {(h.effectiveAt ?? h.createdAt).toISOString().slice(0, 10)}
                                </div>
                              </>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="py-2 text-[12px]">
                            {h ? labelVendorPriceExtractionMethod(h.extractionMethod) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-5 shadow-[var(--shadow-bv-card)]">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[var(--color-bv-muted)]">
              Price history (append-only)
            </h2>
            {history.length === 0 ? (
              <p className="mt-3 text-[13px] text-[var(--color-bv-muted)]">No observations recorded yet.</p>
            ) : (
              <div className="mt-3 max-h-[420px] overflow-auto">
                <table className="w-full text-[12.5px]">
                  <thead className="sticky top-0 bg-[var(--color-bv-surface)]">
                    <tr className="border-b border-[var(--color-bv-border)] text-left text-[10px] uppercase tracking-wide text-[var(--color-bv-muted)]">
                      <th className="py-2 pr-2 font-medium">When</th>
                      <th className="py-2 pr-2 font-medium">Vendor</th>
                      <th className="py-2 pr-2 font-medium">Price</th>
                      <th className="py-2 pr-2 font-medium">Src</th>
                      <th className="py-2 font-medium">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((h) => (
                      <tr key={h.id} className="border-b border-[var(--color-bv-border)]/70">
                        <td className="py-2 pr-2 tabular-nums text-[var(--color-bv-muted)]">
                          {(h.effectiveAt ?? h.createdAt).toISOString().slice(0, 16).replace('T', ' ')}
                        </td>
                        <td className="py-2 pr-2">{h.vendor.name}</td>
                        <td className="py-2 pr-2 tabular-nums font-medium">
                          {formatMoney(h.priceCents)}
                          {h.unit ? (
                            <span className="font-normal text-[var(--color-bv-muted)]"> / {h.unit}</span>
                          ) : null}
                        </td>
                        <td className="py-2 pr-2">{labelVendorPriceExtractionMethod(h.extractionMethod)}</td>
                        <td className="py-2 text-[11px] text-[var(--color-bv-muted)]">{h.itemNameRaw}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-5 shadow-[var(--shadow-bv-card)]">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[var(--color-bv-muted)]">
              Recent OCR / email-text observations
            </h2>
            <p className="mt-1 text-[12px] text-[var(--color-bv-muted)]">
              Receipt/email extraction only — same paths as vendor intelligence (no parsing changes here).
            </p>
            {recentOcrish.length === 0 ? (
              <p className="mt-3 text-[13px] text-[var(--color-bv-muted)]">None on linked vendor rows.</p>
            ) : (
              <ul className="mt-3 space-y-2 text-[13px]">
                {recentOcrish.map((r) => (
                  <li key={r.id} className="flex flex-wrap justify-between gap-2 rounded-lg border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2">
                    <span className="font-medium">{r.vendor.name}</span>
                    <span className="tabular-nums">{formatMoney(r.priceCents)}</span>
                    <span className="text-[11px] text-[var(--color-bv-muted)]">
                      {labelVendorPriceExtractionMethod(r.extractionMethod)} ·{' '}
                      {r.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="flex flex-col gap-5">
          <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-5 shadow-[var(--shadow-bv-card)]">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[var(--color-bv-muted)]">
              Pricing & details
            </h2>
            {canManage ? (
              <ItemDetailPricingForm item={item} machines={machines} />
            ) : (
              <dl className="mt-3 space-y-2 text-[13px]">
                <div>
                  <dt className="text-[var(--color-bv-muted)]">Type</dt>
                  <dd>{kindLabel(item.kind)}</dd>
                </div>
                <div>
                  <dt className="text-[var(--color-bv-muted)]">Unit</dt>
                  <dd>{formatCatalogUnitDisplay(item.catalogUnit, item.customUnitLabel)}</dd>
                </div>
                <div>
                  <dt className="text-[var(--color-bv-muted)]">Internal cost</dt>
                  <dd>{formatMoney(item.internalCostCents)}</dd>
                </div>
                <div>
                  <dt className="text-[var(--color-bv-muted)]">Notes</dt>
                  <dd className="whitespace-pre-wrap">{item.notes ?? '—'}</dd>
                </div>
              </dl>
            )}
          </section>

          <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-5 shadow-[var(--shadow-bv-card)]">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[var(--color-bv-muted)]">
              Preferred vendor
            </h2>
            {item.kind !== EstimateLineKind.MATERIAL ? (
              <p className="mt-3 text-[12px] text-[var(--color-bv-muted)]">
                Vendor preference applies to MATERIAL catalog items (vendor pricing intelligence).
              </p>
            ) : canManage ? (
              <form action={setShopMaterialPreferredVendorAction} className="mt-3 flex flex-col gap-2">
                <input type="hidden" name="id" value={item.id} />
                <select
                  name="preferredVendorId"
                  defaultValue={item.preferredVendorId ?? ''}
                  className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[13px]"
                >
                  <option value="">None</option>
                  {vendors.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[13px] font-medium hover:bg-[var(--color-bv-surface)]"
                >
                  Update preference
                </button>
              </form>
            ) : (
              <p className="mt-3 text-[13px]">{item.preferredVendor?.name ?? '—'}</p>
            )}
          </section>

          {canManage ? (
            <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-5 shadow-[var(--shadow-bv-card)]">
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[var(--color-bv-muted)]">
                Status
              </h2>
              <form action={setShopMaterialActiveAction} className="mt-3 flex flex-col gap-2">
                <input type="hidden" name="id" value={item.id} />
                <input type="hidden" name="isActive" value={(!item.isActive).toString()} />
                <button
                  type="submit"
                  className={`rounded-[8px] px-3 py-2 text-[13px] font-medium ${
                    item.isActive
                      ? 'border border-slate-300 bg-slate-50 text-slate-800'
                      : 'border border-emerald-300 bg-emerald-50 text-emerald-900'
                  }`}
                >
                  {item.isActive ? 'Deactivate item' : 'Reactivate item'}
                </button>
              </form>
            </section>
          ) : null}

          <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-5 shadow-[var(--shadow-bv-card)]">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[var(--color-bv-muted)]">
              Aliases ({item.aliases.length})
            </h2>
            <p className="mt-1 text-[12px] leading-snug text-[var(--color-bv-muted)]">
              Tenant-wide normalized aliases participate in estimate catalog lookup (deterministic exact match).
            </p>
            <ul className="mt-3 space-y-2">
              {item.aliases.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 font-mono text-[12px]"
                >
                  <span>{a.aliasNormalized}</span>
                  {canManage ? (
                    <form action={removeShopMaterialAliasAction}>
                      <input type="hidden" name="aliasId" value={a.id} />
                      <button
                        type="submit"
                        className="text-[11px] font-semibold uppercase tracking-wide text-red-700 hover:underline"
                      >
                        Remove
                      </button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
            {canManage ? (
              <div className="mt-4 border-t border-[var(--color-bv-border)] pt-4">
                <ShopAliasForm shopMaterialItemId={item.id} />
              </div>
            ) : null}
          </section>

          {canManage && item.kind === EstimateLineKind.MATERIAL ? (
            <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-5 shadow-[var(--shadow-bv-card)]">
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[var(--color-bv-muted)]">
                Manual vendor price
              </h2>
              <div className="mt-3">
                <ManualVendorPriceForm
                  shopMaterialItemId={item.id}
                  vendors={vendors}
                  catalogUnitHint={formatCatalogUnitDisplay(item.catalogUnit, item.customUnitLabel)}
                />
              </div>
            </section>
          ) : null}

          <section className="rounded-[var(--radius-bv)] border border-dashed border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-4 py-3 text-[12px] text-[var(--color-bv-muted)]">
            Use this item from an open estimate: focus a grid row, search under <strong className="text-[var(--color-bv-text)]">Catalog items</strong>, then click{' '}
            <strong className="text-[var(--color-bv-text)]">Apply</strong> — description, line kind, qty, and unit cost fill only on that click (no typing hooks). MATERIAL rows still show vendor intelligence + optional{' '}
            <strong className="text-[var(--color-bv-text)]">Use this cost</strong> for OCR/email-derived observations.
          </section>
        </aside>
      </div>
    </>
  );
}
