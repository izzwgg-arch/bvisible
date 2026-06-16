'use client';

import { useMemo, useState } from 'react';
import { EstimateLineKind } from '@bvisible/db';
import {
  buildLinePatchFromCatalogSelection,
  catalogPickerCostBasisCents,
  catalogPickerSellHintCents,
  type EstimateCatalogPickerRow,
} from '@/lib/shop-material/apply-catalog-to-estimate-line';
import { formatMoney, formatQty, kindLabel } from '@/lib/estimate/format';
import { FinalizedReadOnlyChip } from '@/components/estimate/finalized-read-only-chip';
import { SectionCard, SectionHeading, IconCatalog } from '@/components/estimate/estimate-surface';
import type { Action, DraftLine } from './editor';

export function CatalogItemPicker({
  catalog,
  machines,
  activeLineId,
  lines,
  readOnly = false,
  embedded = false,
  dispatch,
}: {
  catalog: ReadonlyArray<EstimateCatalogPickerRow>;
  machines: ReadonlyArray<{ id: string; name: string; ratePerHourCents: number }>;
  activeLineId: string | null;
  lines: ReadonlyArray<DraftLine>;
  readOnly?: boolean;
  embedded?: boolean;
  dispatch: React.Dispatch<Action>;
}) {
  const [q, setQ] = useState('');

  const machinesById = useMemo(
    () => new Map(machines.map((m) => [m.id, { ratePerHourCents: m.ratePerHourCents }])),
    [machines],
  );

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return catalog;
    return catalog.filter(
      (row) =>
        row.name.toLowerCase().includes(n) || row.nameNormalized.toLowerCase().includes(n),
    );
  }, [catalog, q]);

  const activeLine = activeLineId ? lines.find((l) => l.id === activeLineId) : null;

  function applyRow(row: EstimateCatalogPickerRow) {
    if (readOnly || !activeLineId) return;

    const patch = buildLinePatchFromCatalogSelection({ row, machinesById });

    if (patch.kind === EstimateLineKind.MACHINE && patch.machineId) {
      const m = machinesById.get(patch.machineId);
      dispatch({
        type: 'set-line',
        id: activeLineId,
        patch: {
          description: patch.description,
          kind: patch.kind,
          qtyMilli: patch.qtyMilli,
          machineId: patch.machineId,
        },
      });
      if (m) {
        dispatch({
          type: 'pick-machine',
          id: activeLineId,
          machineId: patch.machineId,
          ratePerHourCents: m.ratePerHourCents,
        });
      } else {
        dispatch({
          type: 'set-line',
          id: activeLineId,
          patch: { unitCostCents: patch.unitCostCents },
        });
      }
      return;
    }

    dispatch({ type: 'set-line', id: activeLineId, patch: patch });
  }

  if (readOnly) {
    if (embedded) {
      return (
        <p className="px-5 py-5 text-[12.5px] leading-relaxed text-slate-500">
          Catalog Apply is disabled while this estimate is finalized. Unfinalize from the totals
          panel to edit lines.
        </p>
      );
    }
    return (
      <SectionCard className="p-5">
        <SectionHeading
          icon={<IconCatalog />}
          title="Catalog"
          tone="emerald"
          badge={<FinalizedReadOnlyChip />}
          subtitle="Catalog Apply is disabled while this estimate is finalized. Unfinalize from the totals panel to edit lines."
        />
      </SectionCard>
    );
  }

  const targetRowNumber = activeLineId
    ? lines.findIndex((l) => l.id === activeLineId) + 1
    : null;

  const body = (
    <>
      <div
        className={`flex items-center gap-2 rounded-[12px] border px-3 py-2 text-[12px] ${
          activeLine
            ? 'border-emerald-200 bg-emerald-50/70 text-emerald-800'
            : 'border-slate-200 bg-slate-50 text-slate-500'
        }`}
      >
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${
            activeLine ? 'bg-emerald-500' : 'bg-slate-300'
          }`}
        />
        {activeLine ? (
          <span className="min-w-0 truncate">
            Applying to <strong className="font-semibold">row {targetRowNumber}</strong> ·{' '}
            {kindLabel(activeLine.kind)} · {activeLine.description.slice(0, 48) || '(blank)'}
            {(activeLine.description.length ?? 0) > 48 ? '…' : ''}
          </span>
        ) : (
          <span>Click any cell on a line first to choose where results land.</span>
        )}
      </div>

      <div>
        <div className="relative">
          <span
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
          </span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search catalog by name…"
            aria-label="Search catalog"
            className="w-full rounded-[10px] border border-slate-200 bg-slate-50/70 py-2.5 pl-9 pr-3 text-[13px] outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white focus:ring-4 focus:ring-emerald-500/10"
          />
        </div>

        <div className="mt-3 max-h-[320px] overflow-auto rounded-[12px] border border-slate-200">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 z-10 bg-slate-50/95 text-left text-[10px] font-semibold uppercase tracking-[0.06em] text-slate-400 backdrop-blur">
              <tr>
                <th className="px-3 py-2.5">Item</th>
                <th className="px-3 py-2.5">Type</th>
                <th className="px-3 py-2.5 text-right" title="Internal or vendor unit cost written when you Apply">
                  Unit cost
                </th>
                <th className="px-3 py-2.5 text-right" title="Catalog guidance only; estimate sell uses line totals × estimate multiplier">
                  Sell hint
                </th>
                <th className="px-3 py-2.5 text-right">Qty</th>
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-slate-400">
                    No catalog rows match.
                  </td>
                </tr>
              ) : (
                filtered.slice(0, 80).map((row) => {
                  const basisCents = catalogPickerCostBasisCents({ row, machinesById });
                  const sellHint = catalogPickerSellHintCents({ row, machinesById });
                  const showVendorHints =
                    row.kind === EstimateLineKind.MATERIAL &&
                    (row.catalogCheapestVendorCostCents !== null ||
                      (row.preferredVendorId && row.catalogPreferredVendorName));
                  return (
                    <tr
                      key={row.id}
                      className="border-t border-slate-100 transition-colors hover:bg-emerald-50/30"
                    >
                      <td className="px-3 py-2.5 align-top">
                        <div className="font-semibold text-slate-800">{row.name}</div>
                      </td>
                      <td className="px-3 py-2.5 align-top text-slate-500">{kindLabel(row.kind)}</td>
                      <td className="px-3 py-2.5 align-top text-right tabular-nums text-slate-700">
                        <div className="font-medium">{formatMoney(basisCents)}</div>
                        {showVendorHints ? (
                          <div className="mt-1 space-y-0.5 text-[10px] font-normal leading-snug text-slate-400">
                            {row.catalogCheapestVendorCostCents !== null && row.catalogCheapestVendorName ? (
                              <div title="Lowest latest linked vendor unit cost (informational; Apply still uses the column above)">
                                Cheapest: {row.catalogCheapestVendorName} · {formatMoney(row.catalogCheapestVendorCostCents)}
                              </div>
                            ) : null}
                            {row.preferredVendorId && row.catalogPreferredVendorName ? (
                              <div title="Preferred supplier on the item record">
                                Preferred: {row.catalogPreferredVendorName}
                                {row.catalogPreferredVendorCostCents !== null
                                  ? ` · ${formatMoney(row.catalogPreferredVendorCostCents)}`
                                  : ' · no linked vendor price'}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 align-top text-right tabular-nums font-medium text-emerald-700">
                        {formatMoney(sellHint)}
                        {row.defaultSellPriceCents !== null && row.defaultSellPriceCents !== undefined ? (
                          <div className="mt-1 text-[10px] font-normal text-slate-400">
                            Catalog sell override (not markup × cost)
                          </div>
                        ) : row.markupPercentMilli !== 0 ? (
                          <div className="mt-1 text-[10px] font-normal text-slate-400">
                            Markup on unit cost: {(row.markupPercentMilli / 1000).toLocaleString(undefined, {
                              maximumFractionDigits: 3,
                            })}
                            %
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 align-top text-right tabular-nums text-slate-600">
                        {formatQty(row.defaultQtyMilli)}
                      </td>
                      <td className="px-3 py-2.5 align-top text-right">
                        <button
                          type="button"
                          disabled={!activeLineId}
                          onClick={() => applyRow(row)}
                          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                        >
                          Apply
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );

  if (embedded) {
    return <div className="flex flex-col gap-3 px-5 pb-5 pt-4">{body}</div>;
  }

  return (
    <SectionCard className="p-5">
      <SectionHeading
        icon={<IconCatalog />}
        title="Catalog"
        tone="emerald"
        subtitle="Search saved items and apply pricing to a line. Unit cost is internal; sell hint is guidance only."
      />
      <div className="mt-4 flex flex-col gap-3">{body}</div>
    </SectionCard>
  );
}
