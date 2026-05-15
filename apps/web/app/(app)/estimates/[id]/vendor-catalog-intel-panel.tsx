'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { EstimateLineKind } from '@bvisible/db';
import { formatMoney } from '@/lib/estimate/format';
import { lookupVendorCatalogForEstimateAction } from '@/lib/estimate/vendor-catalog-intel-action';
import type { VendorCatalogLookupResult } from '@/lib/vendor-pricing/catalog-intel-types';
import type { DraftLine } from './editor';

const DEBOUNCE_MS = 320;

function fmtTs(iso: string | null): string {
  if (!iso) return '—';
  return iso.slice(0, 16).replace('T', ' ');
}

function matchKindLabel(k: VendorCatalogLookupResult['matchKind']): string {
  switch (k) {
    case 'exact_name':
      return 'Exact catalog';
    case 'exact_alias':
      return 'Alias match';
    case 'prefix':
      return 'Prefix match';
    case 'shop_item_name':
      return 'Shop item';
    case 'shop_item_alias':
      return 'Item alias';
    default:
      return '';
  }
}

function trendShort(t: VendorCatalogLookupResult['trendKind']): string {
  switch (t) {
    case 'up_vs_avg':
      return 'Above 90d avg';
    case 'down_vs_avg':
      return 'Below 90d avg';
    case 'up_vs_prev':
      return 'Up vs prior receipt';
    case 'stable':
      return 'Stable vs avg';
    default:
      return '';
  }
}

function managedViaLabel(v: NonNullable<VendorCatalogLookupResult['managedItem']>['matchVia']) {
  switch (v) {
    case 'shop_name':
      return 'Matched item name';
    case 'shop_alias':
      return 'Matched item alias';
    case 'linked_catalog':
      return 'Linked vendor catalog';
    default:
      return '';
  }
}

export function VendorCatalogIntelPanel({
  line,
  onApplyManagedCost,
}: {
  line: DraftLine | null;
  onApplyManagedCost?: (lineId: string, unitCostCents: number) => void;
}) {
  const [data, setData] = useState<VendorCatalogLookupResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!line || line.kind !== EstimateLineKind.MATERIAL) {
      setData(null);
      setLoading(false);
      return;
    }

    if (line.description.trim().length < 2) {
      setData(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const t = window.setTimeout(() => {
      void (async () => {
        setLoading(true);
        const res = await lookupVendorCatalogForEstimateAction({
          rawDescription: line.description,
          machineId: line.machineId,
        });
        if (cancelled) return;
        setLoading(false);
        if (!res.ok) {
          setData(null);
          return;
        }
        setData(res.data);
      })();
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [line?.id, line?.kind, line?.description, line?.machineId]);

  if (!line || line.kind !== EstimateLineKind.MATERIAL) {
    return (
      <aside
        className="rounded-[var(--radius-bv)] border border-dashed border-[var(--color-bv-border)] bg-[var(--color-bv-surface)]/80 px-4 py-3 text-[12.5px] text-[var(--color-bv-muted)]"
        aria-label="Vendor pricing intelligence"
      >
        Focus a <strong className="text-[var(--color-bv-text)]">material</strong>{' '}
        row (description or qty) to see vendor catalog hints. Nothing here changes your line unless you explicitly apply a suggested unit cost.
      </aside>
    );
  }

  const trimmedDesc = line.description.trim();
  const queryTooShort = trimmedDesc.length < 2;

  const suggested = data?.managedItem?.suggestedUnitCostCents ?? null;

  return (
    <aside
      className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-4 py-3 shadow-[var(--shadow-bv-card)]"
      aria-label="Vendor pricing intelligence for this material line"
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-bv-muted)]">
          Vendor intelligence
        </span>
        {loading ? (
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700">
            Updating…
          </span>
        ) : null}
        {data?.managedItem ? (
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-900">
            Managed item
          </span>
        ) : null}
        {data?.primaryCatalogItemId && data.latestObservationAt ? (
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700">
            OCR receipts
          </span>
        ) : null}
      </div>

      {loading && !data ? (
        <p className="text-[12px] text-[var(--color-bv-muted)]">Loading hints…</p>
      ) : null}

      {queryTooShort && !loading ? (
        <p className="text-[12px] text-[var(--color-bv-muted)]">
          Type at least two characters in the description to scan catalog rows (deterministic normalized matching).
        </p>
      ) : null}

      {data?.managedItem ? (
        <div className="mb-3 rounded-lg border border-emerald-200/90 bg-emerald-50/45 px-3 py-2.5 text-[12.5px] text-emerald-950">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-900/90">
                Catalog item
              </p>
              <Link
                href={data.managedItem.detailHref as never}
                className="mt-0.5 inline-block text-[13px] font-semibold text-emerald-950 underline-offset-2 hover:underline"
              >
                {data.managedItem.displayName}
              </Link>
              <p className="mt-1 text-[11px] text-emerald-900/80">
                {managedViaLabel(data.managedItem.matchVia)}
              </p>
            </div>
            {suggested !== null ? (
              <div className="text-right">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-900/90">
                  Suggested unit cost
                </p>
                <p className="tabular-nums text-[14px] font-bold">{formatMoney(suggested)}</p>
                <p className="text-[10px] text-emerald-900/75">
                  Prefers preferred vendor · else cheapest latest
                </p>
              </div>
            ) : (
              <p className="max-w-[12rem] text-[11px] leading-snug text-emerald-900/80">
                No vendor prices recorded on this item yet — add manual pricing under Items.
              </p>
            )}
          </div>
          {onApplyManagedCost && line && suggested !== null ? (
            <button
              type="button"
              className="mt-2 rounded-[8px] bg-emerald-700 px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm hover:bg-emerald-800"
              onClick={() => onApplyManagedCost(line.id, suggested)}
            >
              Use this cost on the line
            </button>
          ) : null}
        </div>
      ) : null}

      {!queryTooShort && !loading && data && data.matchKind === 'none' && !data.managedItem ? (
        <p className="text-[12px] text-[var(--color-bv-muted)]">
          No catalog row matches this label yet (vendor catalog or managed item). Keep typing — matching stays deterministic on normalized text.
        </p>
      ) : null}

      {data?.primaryCatalogItemId ? (
        <div className="space-y-2 text-[12.5px] leading-snug text-[var(--color-bv-text)]">
          <div className="flex flex-wrap gap-1.5">
            {matchKindLabel(data.matchKind) ? (
              <span className="rounded-md border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-950">
                {matchKindLabel(data.matchKind)}
              </span>
            ) : null}
            {trendShort(data.trendKind) ? (
              <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-800">
                {trendShort(data.trendKind)}
              </span>
            ) : null}
            {data.highVolatility ? (
              <span className="rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-950">
                Volatile (90d)
              </span>
            ) : null}
          </div>

          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
            <dt className="text-[var(--color-bv-muted)]">Latest</dt>
            <dd className="font-medium tabular-nums">
              {data.latestPriceCents !== null ? formatMoney(data.latestPriceCents) : '—'}{' '}
              <span className="font-normal text-[var(--color-bv-muted)]">
                @ {fmtTs(data.latestObservationAt)}
              </span>
            </dd>
            <dt className="text-[var(--color-bv-muted)]">90d avg</dt>
            <dd className="tabular-nums">
              {data.avg90PriceCents !== null ? formatMoney(data.avg90PriceCents) : '—'}{' '}
              <span className="text-[var(--color-bv-muted)]">
                ({data.observationCount90d} obs)
              </span>
            </dd>
            <dt className="text-[var(--color-bv-muted)]">Cheapest</dt>
            <dd>
              {data.cheapestVendorName ?? '—'}
              {data.cheapestPriceCents !== null ? (
                <span className="ml-1 tabular-nums font-medium">
                  {formatMoney(data.cheapestPriceCents)}
                </span>
              ) : null}
            </dd>
            <dt className="text-[var(--color-bv-muted)]">Vendors (90d)</dt>
            <dd className="tabular-nums">{data.vendorCount90d}</dd>
            <dt className="text-[var(--color-bv-muted)]">Last PO</dt>
            <dd>
              {fmtTs(data.lastPoAt)}
              {data.lastPurchasedVendorName ? (
                <span className="text-[var(--color-bv-muted)]">
                  {' '}
                  · {data.lastPurchasedVendorName}
                </span>
              ) : null}
            </dd>
            <dt className="text-[var(--color-bv-muted)]">Last OCR receipt</dt>
            <dd className="tabular-nums text-[var(--color-bv-muted)]">
              {fmtTs(data.lastOcrReceiptAt)}
            </dd>
          </dl>

          {(data.priceRecentlyIncreasedVsAvg || data.priceRecentlyIncreasedVsPrev) ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11.5px] text-amber-950">
              Price recently increased
              {data.priceRecentlyIncreasedVsAvg ? ' vs 90-day average' : ''}
              {data.priceRecentlyIncreasedVsAvg && data.priceRecentlyIncreasedVsPrev ? ' · ' : ''}
              {data.priceRecentlyIncreasedVsPrev ? ' vs prior receipt' : ''}.
            </div>
          ) : null}

          {data.primaryCatalogNameNormalized ? (
            <p className="border-t border-[var(--color-bv-border)] pt-2 font-mono text-[10px] text-[var(--color-bv-muted)]">
              Catalog key: {data.primaryCatalogNameNormalized}
            </p>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
