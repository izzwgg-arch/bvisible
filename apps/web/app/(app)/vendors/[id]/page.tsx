import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  prisma,
  SpendAlertStatus,
  VendorPriceExtractionMethod,
} from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { formatVendorItemDisplayName } from '@/lib/vendor-pricing/normalize';
import { VendorEditForm } from './vendor-edit-form';

export const metadata = { title: 'Vendor profile' };
export const dynamic = 'force-dynamic';

function fmtMoney(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

export default async function VendorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireTenantId();
  const { id } = await params;

  const vendor = await prisma.vendor.findFirst({
    where: { id, tenantId: me.tenantId, deletedAt: null },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      emails: true,
      phones: true,
      notes: true,
    },
  });
  if (!vendor) notFound();

  // Merge legacy single fields into arrays for backward compat
  const emails =
    vendor.emails.length > 0
      ? vendor.emails
      : vendor.email
        ? [vendor.email]
        : [];
  const phones =
    vendor.phones.length > 0
      ? vendor.phones
      : vendor.phone
        ? [vendor.phone]
        : [];

  const [history, openSpendAlerts, catalogItems] = await Promise.all([
    prisma.vendorPriceHistory.findMany({
      where: { tenantId: me.tenantId, vendorId: id },
      orderBy: { createdAt: 'desc' },
      take: 250,
      select: {
        id: true,
        itemNameRaw: true,
        itemNameNormalized: true,
        priceCents: true,
        unit: true,
        quantityMilli: true,
        confidence: true,
        extractionMethod: true,
        createdAt: true,
        sourceEmailId: true,
        vendorCatalogItemId: true,
        sourceEmail: {
          select: {
            subject: true,
            matchedPurchaseOrderId: true,
          },
        },
        sourcePoAttachment: {
          select: { purchaseOrderId: true },
        },
        ocrLineItem: {
          select: { ocrDocumentId: true },
        },
      },
    }),
    prisma.spendAlert.count({
      where: {
        tenantId: me.tenantId,
        vendorId: id,
        status: SpendAlertStatus.OPEN,
      },
    }),
    // All catalog items linked to this vendor, with latest price each
    prisma.vendorCatalogItem.findMany({
      where: { tenantId: me.tenantId, vendorId: id },
      orderBy: { nameNormalized: 'asc' },
      select: {
        id: true,
        nameNormalized: true,
        vendorSku: true,
        shopMaterialItem: {
          select: {
            id: true,
            name: true,
            catalogUnit: true,
            customUnitLabel: true,
          },
        },
        priceHistory: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: {
            priceCents: true,
            unit: true,
            createdAt: true,
            extractionMethod: true,
          },
        },
      },
    }),
  ]);

  // Price change detection
  const lowerThanPrior = new Set<string>();
  const byCatalog = new Map<string, typeof history>();
  for (const row of history) {
    const list = byCatalog.get(row.vendorCatalogItemId) ?? [];
    list.push(row);
    byCatalog.set(row.vendorCatalogItemId, list);
  }
  for (const [, rows] of byCatalog) {
    const sorted = [...rows].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
    );
    for (let i = 0; i < sorted.length - 1; i++) {
      const newer = sorted[i]!;
      const older = sorted[i + 1]!;
      if (newer.priceCents < older.priceCents) {
        lowerThanPrior.add(newer.id);
      }
    }
  }

  const vendorInitials = vendor.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <>
      <PageHeader
        title={vendor.name}
        subtitle="Vendor profile, contact details, item price list, and price observation history."
        actions={
          <Link
            href="/vendors"
            className="inline-flex items-center justify-center rounded-[12px] border border-slate-200 bg-white/90 px-4 py-2.5 text-[13.5px] font-semibold text-slate-700 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:bg-white"
          >
            All vendors
          </Link>
        }
      />

      {/* ── Contact / Edit section ── */}
      <section className="mb-5 overflow-hidden rounded-[22px] border border-white/80 bg-white/90 shadow-[0_22px_70px_rgba(15,23,42,0.10)] backdrop-blur-xl">
        <div className="flex items-center gap-4 border-b border-slate-100 px-5 py-4">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-[16px] bg-violet-50 text-[15px] font-bold text-violet-700 ring-1 ring-violet-100">
            {vendorInitials}
          </div>
          <div>
            <h2 className="text-[15px] font-semibold text-slate-950">Contact details</h2>
            <p className="text-[12px] text-slate-400">Edit vendor name, emails, phones, and notes.</p>
          </div>
        </div>
        <div className="p-5">
          <VendorEditForm
            vendorId={vendor.id}
            initialName={vendor.name}
            initialEmails={emails}
            initialPhones={phones}
            initialNotes={vendor.notes}
          />
        </div>
      </section>

      {/* ── Items price list section ── */}
      <section className="mb-5 overflow-hidden rounded-[22px] border border-white/80 bg-white/90 shadow-[0_22px_70px_rgba(15,23,42,0.10)] backdrop-blur-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold text-slate-950">Item price list</h2>
            <p className="mt-0.5 text-[12px] text-slate-500">
              All catalog items tagged to this vendor, with the latest observed price.
            </p>
          </div>
          {catalogItems.length > 0 && (
            <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-violet-700">
              {catalogItems.length} item{catalogItems.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                <th className="px-5 py-3">Item name</th>
                <th className="px-5 py-3">Vendor item</th>
                <th className="px-5 py-3">SKU</th>
                <th className="px-5 py-3">Latest price</th>
                <th className="px-5 py-3">Unit</th>
                <th className="px-5 py-3">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {catalogItems.map((ci) => {
                const latest = ci.priceHistory[0];
                return (
                  <tr
                    key={ci.id}
                    className="border-b border-slate-50 last:border-b-0 hover:bg-slate-50/60"
                  >
                    <td className="max-w-[220px] px-5 py-3">
                      {ci.shopMaterialItem ? (
                        <Link
                          href={`/items/${ci.shopMaterialItem.id}`}
                          className="truncate font-semibold text-[var(--color-bv-accent)] hover:underline underline-offset-2 block"
                        >
                          {ci.shopMaterialItem.name}
                        </Link>
                      ) : (
                        <span className="truncate text-slate-400 italic text-[12px] block">
                          Not linked to catalog
                        </span>
                      )}
                    </td>
                    <td className="max-w-[220px] px-5 py-3">
                      <span className="truncate text-[13px] font-medium text-slate-800 block">
                        {formatVendorItemDisplayName(ci.nameNormalized)}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-[12px] text-slate-500">
                      {ci.vendorSku ?? '—'}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3">
                      {latest ? (
                        <span className="font-semibold tabular-nums text-slate-900">
                          {fmtMoney(latest.priceCents)}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-[12px] text-slate-500">
                      {latest?.unit ??
                        (ci.shopMaterialItem?.customUnitLabel ||
                          ci.shopMaterialItem?.catalogUnit) ??
                        '—'}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-[11px] text-slate-400 tabular-nums">
                      {latest
                        ? latest.createdAt.toISOString().slice(0, 10)
                        : '—'}
                    </td>
                  </tr>
                );
              })}
              {catalogItems.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-[13px] text-slate-400">
                    No items linked to this vendor yet. Items appear here when matched vendor emails or
                    approved receipt OCR rows are processed.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Pricing intelligence stats ── */}
      <section className="mb-5 overflow-hidden rounded-[22px] border border-white/80 bg-white/90 shadow-[0_22px_70px_rgba(15,23,42,0.10)] backdrop-blur-xl">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-[15px] font-semibold text-slate-950">Pricing intelligence</h2>
        </div>
        <div className="p-5">
          <dl className="grid gap-2 text-[13px]">
            <div className="flex items-center justify-between gap-3 rounded-[12px] bg-slate-50 px-4 py-3">
              <dt className="text-slate-500">Open spend alerts</dt>
              <dd className="font-semibold tabular-nums text-slate-900">{openSpendAlerts}</dd>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-[12px] bg-slate-50 px-4 py-3">
              <dt className="text-slate-500">PO reconciliation queue</dt>
              <dd>
                <Link
                  href="/admin/reconciliation"
                  className="text-[13px] font-semibold text-[var(--color-bv-accent)] hover:underline underline-offset-2"
                >
                  Open queue →
                </Link>
              </dd>
            </div>
          </dl>
        </div>
      </section>

      {/* ── Price history table ── */}
      <section className="overflow-hidden rounded-[22px] border border-white/80 bg-white/90 shadow-[0_22px_70px_rgba(15,23,42,0.10)] backdrop-blur-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold text-slate-950">Price history</h2>
            <p className="mt-0.5 text-[12px] text-slate-500">
              Newest first · {history.length} row{history.length === 1 ? '' : 's'}
            </p>
          </div>
          {history.length > 0 && (
            <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-violet-700">
              {history.length} observations
            </span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                <th className="px-5 py-3">When</th>
                <th className="px-5 py-3">Item</th>
                <th className="px-5 py-3">Price</th>
                <th className="px-5 py-3">Source</th>
                <th className="px-5 py-3">Confidence</th>
                <th className="px-5 py-3">Email / PO</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr
                  key={h.id}
                  className="border-b border-slate-50 last:border-b-0 hover:bg-slate-50/60"
                >
                  <td className="whitespace-nowrap px-5 py-3 text-slate-500 tabular-nums">
                    {h.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
                  </td>
                  <td className="max-w-[240px] px-5 py-3">
                    <div className="truncate text-[13px] font-medium text-slate-800">
                      {formatVendorItemDisplayName(h.itemNameRaw || h.itemNameNormalized)}
                    </div>
                    {h.itemNameRaw &&
                    h.itemNameRaw.trim().toLowerCase() !==
                      h.itemNameNormalized.trim().toLowerCase() ? (
                      <div className="truncate text-[11px] text-slate-400">
                        As received: {h.itemNameRaw}
                      </div>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3">
                    <span className="font-semibold tabular-nums text-slate-900">
                      {fmtMoney(h.priceCents)}
                    </span>
                    {h.unit ? (
                      <span className="text-[11px] text-slate-400"> / {h.unit}</span>
                    ) : null}
                    {lowerThanPrior.has(h.id) ? (
                      <span className="ml-2 inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                        Lower vs prior
                      </span>
                    ) : null}
                  </td>
                  <td className="px-5 py-3 text-[11px] capitalize text-slate-500">
                    {h.extractionMethod.replace(/_/g, ' ')}
                  </td>
                  <td className="px-5 py-3 text-[11px] capitalize text-slate-500">
                    {h.confidence.toLowerCase()}
                  </td>
                  <td className="max-w-[200px] px-5 py-3">
                    <div className="truncate text-[11px] text-slate-500">
                      {h.sourceEmail?.subject ??
                        (h.ocrLineItem ? 'Receipt OCR (approved)' : '—')}
                    </div>
                    {h.sourceEmail?.matchedPurchaseOrderId ? (
                      <Link
                        href={`/purchase-orders/${h.sourceEmail.matchedPurchaseOrderId}`}
                        className="text-[11px] font-medium text-[var(--color-bv-accent)] hover:underline underline-offset-2"
                      >
                        Open PO
                      </Link>
                    ) : h.sourcePoAttachment?.purchaseOrderId ? (
                      <Link
                        href={`/purchase-orders/${h.sourcePoAttachment.purchaseOrderId}`}
                        className="text-[11px] font-medium text-[var(--color-bv-accent)] hover:underline underline-offset-2"
                      >
                        Open PO
                      </Link>
                    ) : h.ocrLineItem ? (
                      <Link
                        href={`/admin/ocr-review/${h.ocrLineItem.ocrDocumentId}`}
                        className="text-[11px] font-medium text-[var(--color-bv-accent)] hover:underline underline-offset-2"
                      >
                        OCR record
                      </Link>
                    ) : (
                      <span className="text-[11px] text-slate-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {history.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-[13px] text-slate-400">
                    No extracted prices yet. Observations appear when matched vendor emails contain
                    line-like patterns, or when receipt OCR rows are approved.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
