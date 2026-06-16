'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { EstimateLineKind } from '@bvisible/db';
import { formatMoney } from '@/lib/estimate/format';
import { lookupVendorCatalogForEstimateAction } from '@/lib/estimate/vendor-catalog-intel-action';
import type {
  ManagedPriceTrendFlags,
  VendorCatalogLookupResult,
} from '@/lib/vendor-pricing/catalog-intel-types';
import type { DraftLine } from './editor';
import { FinalizedReadOnlyChip } from '@/components/estimate/finalized-read-only-chip';

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
    case 'prefix_name':
      return 'Prefix name';
    case 'prefix_alias':
      return 'Prefix alias';
    case 'vendor_sku':
      return 'Vendor SKU';
    case 'shop_item_name':
      return 'Managed item';
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

function managedTrendLines(flags: ManagedPriceTrendFlags | null | undefined): string[] {
  if (!flags) return [];
  const lines: string[] = [];
  if (flags.priceRecentlyIncreasedVsAvg || flags.priceRecentlyIncreasedVsPrev) {
    lines.push('Price increased recently');
  }
  if (flags.highVolatility) {
    lines.push('Price has varied recently');
  }
  return lines;
}

export function VendorCatalogIntelPanel({
  line,
  readOnly = false,
  embedded = false,
  onApplyManagedCost,
}: {
  line: DraftLine | null;
  readOnly?: boolean;
  embedded?: boolean;
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
    const emptyState = (
      <div className="flex flex-col items-center gap-2 text-center">
        <span
          aria-hidden
          className="grid h-11 w-11 place-items-center rounded-2xl bg-gradient-to-br from-emerald-500/10 to-teal-500/10 text-emerald-600 ring-1 ring-inset ring-emerald-500/15"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3v18h18" />
            <path d="m7 14 3-3 3 2 4-5" />
          </svg>
        </span>
        <p className="max-w-xs text-[12.5px] leading-relaxed text-slate-500">
          Focus a <strong className="font-semibold text-slate-700">material</strong> row to see
          cheapest / preferred vendor hints. Apply only when you click a button — nothing auto-fills.
        </p>
      </div>
    );
    if (embedded) {
      return (
        <div className="px-5 py-8" aria-label="Vendor pricing intelligence">
          {emptyState}
        </div>
      );
    }
    return (
      <aside
        className="rounded-[18px] border border-dashed border-slate-200 bg-white/80 px-5 py-8 shadow-sm"
        aria-label="Vendor pricing intelligence"
      >
        {emptyState}
      </aside>
    );
  }

  const trimmedDesc = line.description.trim();
  const queryTooShort = trimmedDesc.length < 2;

  const managed = data?.managedItem ?? null;
  const suggested = managed?.suggestedUnitCostCents ?? null;
  const cheapestCents = managed?.cheapestPriceCents ?? null;
  const showCheapestApply =
    onApplyManagedCost &&
    line &&
    cheapestCents !== null &&
    suggested !== null &&
    cheapestCents < suggested;

  const panelBody = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400">
          Vendor intelligence
        </span>
        {readOnly ? <FinalizedReadOnlyChip /> : null}
        {loading ? (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Updating…
          </span>
        ) : null}
        {managed ? (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 ring-1 ring-inset ring-emerald-200">
            Managed item
          </span>
        ) : null}
        {data?.primaryCatalogItemId && data.latestObservationAt ? (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            OCR receipts
          </span>
        ) : null}
      </div>

      {loading && !data ? (
        <p className="text-[12px] text-slate-400">Loading hints…</p>
      ) : null}

      {queryTooShort && !loading ? (
        <p className="text-[12px] text-slate-400">
          Type at least two characters in the description to scan catalog rows (deterministic normalized matching).
        </p>
      ) : null}

      {managed ? (
        <div className="mb-3 space-y-2 rounded-lg border border-emerald-200/90 bg-emerald-50/40 px-2.5 py-2 text-[12px] text-emerald-950">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-900/90">
                Catalog item
              </p>
              <Link
                href={managed.detailHref as never}
                className="mt-0.5 inline-block text-[13px] font-semibold text-emerald-950 underline-offset-2 hover:underline"
              >
                {managed.displayName}
              </Link>
              <p className="mt-1 text-[11px] text-emerald-900/80">
                {managedViaLabel(managed.matchVia)} · Unit: {managed.catalogUnit}
              </p>
              {data?.materialMatch ? (
                <p className="mt-1 text-[11px] text-emerald-900/85">
                  {data.materialMatch.matchReason} · {data.materialMatch.confidenceLabel}
                </p>
              ) : null}
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-md border border-emerald-200/80 bg-white/55 px-2.5 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-900/85">Cheapest vendor</p>
              <p className="mt-0.5 text-[13px] font-semibold tabular-nums">
                {managed.cheapestVendorName ?? '—'}
                {cheapestCents !== null ? (
                  <span className="ml-1 text-emerald-950">{formatMoney(cheapestCents)}</span>
                ) : null}
              </p>
              {managedTrendLines(managed.cheapestPriceTrend).map((t) => (
                <p key={t} className="mt-1 text-[10.5px] leading-snug text-amber-900/95">
                  {t}
                </p>
              ))}
            </div>
            <div className="rounded-md border border-emerald-200/80 bg-white/55 px-2.5 py-2">
              <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-900/85">Preferred vendor</p>
              <p className="mt-0.5 text-[13px] font-semibold">
                {managed.preferredVendorName ?? <span className="text-emerald-900/75">Not set</span>}
              </p>
              {managed.preferredVendorName ? (
                <p className="mt-0.5 text-[13px] font-semibold tabular-nums text-emerald-950">
                  {managed.preferredLatestPriceCents !== null
                    ? formatMoney(managed.preferredLatestPriceCents)
                    : 'No latest price'}
                </p>
              ) : null}
              {managedTrendLines(managed.preferredPriceTrend).map((t) => (
                <p key={`p-${t}`} className="mt-1 text-[10.5px] leading-snug text-amber-900/95">
                  {t}
                </p>
              ))}
            </div>
          </div>

          {managed.preferredPremiumVsCheapestCents != null &&
          managed.preferredPremiumVsCheapestCents > 0 ? (
            <p className="text-[11px] text-emerald-950/90">
              Preferred premium:{' '}
              <span className="font-semibold tabular-nums">
                {formatMoney(managed.preferredPremiumVsCheapestCents)}
              </span>{' '}
              vs cheapest
            </p>
          ) : null}

          {managed.unitConversionHint ? (
            <p className="text-[11px] leading-snug text-emerald-950/90">
              {managed.unitConversionHint.guidanceLabel}
              {managed.unitConversionHint.convertedPriceCents != null ? (
                <>
                  {' '}
                  →{' '}
                  <span className="font-semibold tabular-nums">
                    {formatMoney(managed.unitConversionHint.convertedPriceCents)}
                  </span>{' '}
                  per {managed.catalogUnit}
                </>
              ) : null}
            </p>
          ) : null}

          {managed.vendorLatestRows.length > 1 ? (
            <div className="overflow-x-auto rounded-md border border-emerald-200/70 bg-white/40">
              <table className="w-full min-w-[320px] text-[11.5px]">
                <thead>
                  <tr className="border-b border-emerald-200/80 text-left text-[10px] font-semibold uppercase tracking-wide text-emerald-900/80">
                    <th className="px-2 py-1.5">Vendor</th>
                    <th className="px-2 py-1.5">Latest</th>
                    <th className="px-2 py-1.5">Updated</th>
                    <th className="px-2 py-1.5">Source</th>
                    <th className="px-2 py-1.5">Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {managed.vendorLatestRows.map((r) => {
                    const isCheap =
                      managed.cheapestVendorId !== null && r.vendorId === managed.cheapestVendorId;
                    const isPref = managed.preferredVendorId === r.vendorId;
                    return (
                      <tr key={r.vendorId} className="border-b border-emerald-100/90 last:border-b-0">
                        <td className="px-2 py-1.5">
                          <span className="font-medium">{r.vendorName}</span>
                          <span className="ml-1 flex flex-wrap gap-1">
                            {isCheap ? (
                              <span className="rounded bg-emerald-800/10 px-1 py-0 text-[9px] font-bold uppercase text-emerald-950">
                                Cheapest
                              </span>
                            ) : null}
                            {isPref ? (
                              <span className="rounded bg-indigo-600/10 px-1 py-0 text-[9px] font-bold uppercase text-indigo-950">
                                Preferred
                              </span>
                            ) : null}
                          </span>
                        </td>
                        <td className="px-2 py-1.5 tabular-nums font-medium">{formatMoney(r.priceCents)}</td>
                        <td className="px-2 py-1.5 tabular-nums text-slate-400">
                          {fmtTs(r.updatedAtIso)}
                        </td>
                        <td className="px-2 py-1.5">{r.sourceLabel}</td>
                        <td className="px-2 py-1.5 text-slate-400">{r.confidenceLabel ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2 border-t border-emerald-200/70 pt-2">
            {suggested !== null ? (
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-900/85">
                  Suggested unit cost
                </p>
                <p className="tabular-nums text-[14px] font-bold">{formatMoney(suggested)}</p>
                <p className="text-[10px] text-emerald-900/75">Preferred latest when set · else cheapest latest</p>
              </div>
            ) : (
              <p className="text-[11px] leading-snug text-emerald-900/80">
                No vendor prices recorded on this item yet — add manual pricing under Items.
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {onApplyManagedCost && line && suggested !== null ? (
              <button
                type="button"
                className="rounded-[8px] bg-emerald-700 px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm hover:bg-emerald-800"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onApplyManagedCost(line.id, suggested)}
              >
                Apply suggested cost
              </button>
            ) : null}
            {showCheapestApply && cheapestCents !== null ? (
              <button
                type="button"
                className="rounded-[8px] border border-emerald-800/30 bg-white px-3 py-1.5 text-[12px] font-semibold text-emerald-950 shadow-sm hover:bg-emerald-50"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onApplyManagedCost!(line!.id, cheapestCents)}
              >
                Apply cheapest vendor cost
              </button>
            ) : null}
            {onApplyManagedCost &&
            line &&
            managed.unitConversionHint?.convertedPriceCents != null &&
            managed.unitConversionHint.needsConfirmation ? (
              <button
                type="button"
                className="rounded-[8px] border border-amber-300/80 bg-amber-50 px-3 py-1.5 text-[12px] font-semibold text-amber-950 hover:bg-amber-100"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() =>
                  onApplyManagedCost(
                    line.id,
                    managed.unitConversionHint!.convertedPriceCents!,
                  )
                }
              >
                Apply converted unit cost
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {!queryTooShort && !loading && data?.materialMatch.path === 'unresolved' && !data.managedItem ? (
        <p className="text-[12px] text-slate-400">
          {data.materialMatch.matchReason} Add an Items alias or pick from the catalog picker — pricing is never applied automatically.
        </p>
      ) : null}

      {data?.primaryCatalogItemId ? (
        <div className="space-y-2 text-[12.5px] leading-snug text-slate-700">
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
            <dt className="text-slate-400">Latest</dt>
            <dd className="font-medium tabular-nums">
              {data.latestPriceCents !== null ? formatMoney(data.latestPriceCents) : '—'}{' '}
              <span className="font-normal text-slate-400">
                @ {fmtTs(data.latestObservationAt)}
              </span>
            </dd>
            <dt className="text-slate-400">90d avg</dt>
            <dd className="tabular-nums">
              {data.avg90PriceCents !== null ? formatMoney(data.avg90PriceCents) : '—'}{' '}
              <span className="text-slate-400">({data.observationCount90d} obs)</span>
            </dd>
            <dt className="text-slate-400">Cheapest</dt>
            <dd>
              {data.cheapestVendorName ?? '—'}
              {data.cheapestPriceCents !== null ? (
                <span className="ml-1 tabular-nums font-medium">{formatMoney(data.cheapestPriceCents)}</span>
              ) : null}
            </dd>
            <dt className="text-slate-400">Vendors (90d)</dt>
            <dd className="tabular-nums">{data.vendorCount90d}</dd>
            <dt className="text-slate-400">Last PO</dt>
            <dd>
              {fmtTs(data.lastPoAt)}
              {data.lastPurchasedVendorName ? (
                <span className="text-slate-400">
                  {' '}
                  · {data.lastPurchasedVendorName}
                </span>
              ) : null}
            </dd>
            <dt className="text-slate-400">Last OCR receipt</dt>
            <dd className="tabular-nums text-slate-400">{fmtTs(data.lastOcrReceiptAt)}</dd>
          </dl>

          {data.priceRecentlyIncreasedVsAvg || data.priceRecentlyIncreasedVsPrev ? (
            <p className="text-[11px] text-amber-900">
              Price increased recently
              {data.priceRecentlyIncreasedVsAvg ? ' (vs 90d avg)' : ''}
              {data.priceRecentlyIncreasedVsPrev ? ' (vs prior)' : ''}
            </p>
          ) : null}
          {data.highVolatility ? (
            <p className="text-[11px] text-amber-900">Price has varied recently (90d)</p>
          ) : null}
          {data.materialMatch.needsConfirmation ? (
            <p className="text-[11px] text-slate-400">
              {data.materialMatch.matchReason}
            </p>
          ) : null}

          {data.primaryCatalogNameNormalized ? (
            <p className="border-t border-slate-100 pt-2 font-mono text-[10px] text-slate-400">
              Catalog key: {data.primaryCatalogNameNormalized}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );

  if (embedded) {
    return (
      <div
        className="flex flex-col gap-3 px-5 pb-5 pt-4"
        aria-label="Vendor pricing intelligence for this material line"
      >
        {panelBody}
      </div>
    );
  }

  return (
    <aside
      className="flex flex-col gap-3 rounded-[18px] border border-slate-200/70 bg-white/95 px-4 py-3.5 shadow-[0_1px_2px_rgba(15,23,41,0.04),0_14px_36px_-18px_rgba(15,23,41,0.18)]"
      aria-label="Vendor pricing intelligence for this material line"
    >
      {panelBody}
    </aside>
  );
}
