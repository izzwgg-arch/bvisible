'use client';

import { useMemo, useState } from 'react';
import { EstimateLineKind } from '@bvisible/db';
import {
  buildLinePatchFromCatalogSelection,
  catalogPickerCostBasisCents,
  catalogPickerSellHintCents,
  type EstimateCatalogPickerRow,
} from '@/lib/shop-material/apply-catalog-to-estimate-line';
import { formatMoney, kindLabel } from '@/lib/estimate/format';
import { FinalizedReadOnlyChip } from '@/components/estimate/finalized-read-only-chip';
import { SectionCard, SectionHeading, IconCatalog } from '@/components/estimate/estimate-surface';
import type { Action, DraftLine } from './editor';

type CatalogFilter = 'all' | EstimateLineKind;

const FILTERS: ReadonlyArray<{ id: CatalogFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: EstimateLineKind.MATERIAL, label: 'Material' },
  { id: EstimateLineKind.LABOR, label: 'Labor' },
  { id: EstimateLineKind.INSTALL, label: 'Install' },
  { id: EstimateLineKind.MACHINE, label: 'Machine' },
  { id: EstimateLineKind.MISC, label: 'Misc' },
];

export function CatalogItemPicker({
  catalog,
  machines,
  activeLineId,
  lines,
  readOnly = false,
  embedded = false,
  onApplied,
  dispatch,
}: {
  catalog: ReadonlyArray<EstimateCatalogPickerRow>;
  machines: ReadonlyArray<{ id: string; name: string; ratePerHourCents: number }>;
  activeLineId: string | null;
  lines: ReadonlyArray<DraftLine>;
  readOnly?: boolean;
  embedded?: boolean;
  onApplied?: () => void;
  dispatch: React.Dispatch<Action>;
}) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<CatalogFilter>('all');

  const machinesById = useMemo(
    () => new Map(machines.map((m) => [m.id, { ratePerHourCents: m.ratePerHourCents }])),
    [machines],
  );

  const filtered = useMemo(() => {
    const n = q.trim().toLowerCase();
    return catalog.filter((row) => {
      const matchesFilter = filter === 'all' || row.kind === filter;
      const matchesSearch =
        !n || row.name.toLowerCase().includes(n) || row.nameNormalized.toLowerCase().includes(n);
      return matchesFilter && matchesSearch;
    });
  }, [catalog, filter, q]);

  const favoriteRows = filtered.slice(0, 3);
  const allRows = filtered.slice(3, 24);

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
        dispatch({ type: 'set-line', id: activeLineId, patch: { unitCostCents: patch.unitCostCents } });
      }
      onApplied?.();
      return;
    }

    dispatch({ type: 'set-line', id: activeLineId, patch });
    onApplied?.();
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

  const body = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 space-y-3">
        <div className="relative">
          <span aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
          </span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search catalog by name..."
            aria-label="Search catalog"
            className="h-11 w-full rounded-[12px] border border-slate-200 bg-white pl-9 pr-3 text-[12.5px] shadow-sm outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((item) => {
            const active = filter === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setFilter(item.id)}
                className={`rounded-full px-3 py-1.5 text-[10.5px] font-bold transition ${
                  active
                    ? 'bg-[#4f46e5] text-white shadow-sm shadow-indigo-200'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
        {filtered.length === 0 ? (
          <div className="rounded-[14px] border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-[12px] text-slate-400">
            No catalog rows match.
          </div>
        ) : (
          <div className="space-y-5">
            <CatalogSection title="Favorites" rows={favoriteRows} activeLineId={activeLineId} machinesById={machinesById} onApply={applyRow} favorite />
            <CatalogSection title="All items" rows={allRows} activeLineId={activeLineId} machinesById={machinesById} onApply={applyRow} />
            <button
              type="button"
              className="w-full rounded-[10px] border border-slate-200 bg-white px-4 py-2.5 text-[11px] font-bold text-slate-700 shadow-sm hover:bg-slate-50"
            >
              View all catalog
            </button>
          </div>
        )}
      </div>
    </div>
  );

  if (embedded) {
    return <div className="flex max-h-[690px] min-h-[520px] flex-col px-5 pb-5 pt-4">{body}</div>;
  }

  return (
    <SectionCard className="p-5">
      <SectionHeading
        icon={<IconCatalog />}
        title="Catalog"
        tone="emerald"
        subtitle="Search saved items and apply pricing to a line. Unit cost is internal; sell hint is guidance only."
      />
      <div className="mt-4 flex max-h-[690px] min-h-[520px] flex-col">{body}</div>
    </SectionCard>
  );
}

function CatalogSection({
  title,
  rows,
  activeLineId,
  machinesById,
  onApply,
  favorite = false,
}: {
  title: string;
  rows: ReadonlyArray<EstimateCatalogPickerRow>;
  activeLineId: string | null;
  machinesById: ReadonlyMap<string, { ratePerHourCents: number }>;
  onApply: (row: EstimateCatalogPickerRow) => void;
  favorite?: boolean;
}) {
  if (rows.length === 0) return null;

  return (
    <section>
      <h3 className="mb-2 flex items-center gap-1.5 text-[11px] font-black text-slate-900">
        {favorite ? <span className="text-amber-400">?</span> : null}
        {title}
      </h3>
      <div className="space-y-3">
        {rows.map((row, index) => (
          <CatalogCard
            key={row.id}
            row={row}
            index={index}
            activeLineId={activeLineId}
            machinesById={machinesById}
            onApply={onApply}
            favorite={favorite}
          />
        ))}
      </div>
    </section>
  );
}

function CatalogCard({
  row,
  index,
  activeLineId,
  machinesById,
  onApply,
  favorite,
}: {
  row: EstimateCatalogPickerRow;
  index: number;
  activeLineId: string | null;
  machinesById: ReadonlyMap<string, { ratePerHourCents: number }>;
  onApply: (row: EstimateCatalogPickerRow) => void;
  favorite: boolean;
}) {
  const basisCents = catalogPickerCostBasisCents({ row, machinesById });
  const sellHint = catalogPickerSellHintCents({ row, machinesById });
  const marginPct = sellHint > 0 ? ((sellHint - basisCents) / sellHint) * 100 : null;
  const vendor = row.catalogPreferredVendorName ?? row.catalogCheapestVendorName ?? 'Cheapest';

  return (
    <article className="overflow-hidden rounded-[13px] border border-slate-200 bg-white shadow-sm">
      <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-3 p-3">
        <CatalogThumb name={row.name} index={index} />
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h4 className="line-clamp-2 text-[12px] font-black leading-snug text-slate-950">{row.name}</h4>
              <p className="mt-1 text-[10px] font-semibold text-slate-400">{kindLabel(row.kind)}</p>
            </div>
            <span className={`text-[15px] ${favorite ? 'text-amber-400' : 'text-slate-300'}`}>?</span>
          </div>
          <div className="mt-3 flex items-end justify-between gap-2">
            <div>
              <p className="text-[10px] font-semibold text-slate-400">Sell hint</p>
              <p className="text-[12px] font-black text-slate-950">{formatMoney(sellHint)} / {unitLabel(row)}</p>
            </div>
            <p className="text-[12px] font-black text-slate-950">{formatMoney(basisCents)} / {unitLabel(row)}</p>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 border-t border-slate-100 px-3 py-2 text-[10px]">
        <Metric label="Sell hint" value={formatMoney(sellHint)} />
        <Metric label="Margin" value={marginPct == null ? '-' : `${marginPct.toFixed(1)}%`} valueClass="text-emerald-600" />
        <Metric label="Vendor" value={vendor} />
      </div>
      <div className="px-3 pb-3">
        <button
          type="button"
          disabled={!activeLineId}
          onClick={() => onApply(row)}
          className="w-full rounded-[8px] bg-[#4f46e5] px-3 py-2.5 text-[11.5px] font-black text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
        >
          + Add to estimate
        </button>
      </div>
    </article>
  );
}

function Metric({ label, value, valueClass = 'text-slate-700' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div>
      <p className="font-semibold text-slate-400">{label}</p>
      <p className={`mt-0.5 truncate font-black ${valueClass}`}>{value}</p>
    </div>
  );
}

function CatalogThumb({ name, index }: { name: string; index: number }) {
  const palette = [
    'from-slate-900 via-slate-600 to-slate-300',
    'from-zinc-900 via-zinc-500 to-zinc-200',
    'from-amber-400 via-slate-900 to-yellow-200',
    'from-slate-200 via-white to-slate-400',
    'from-emerald-300 via-orange-300 to-violet-400',
  ];
  return (
    <div className={`relative h-[74px] overflow-hidden rounded-[10px] bg-gradient-to-br ${palette[index % palette.length]}`} title={name}>
      <div className="absolute inset-x-3 top-4 h-3 rotate-[-18deg] rounded-full bg-white/35" />
      <div className="absolute inset-x-4 bottom-4 h-4 rotate-[-18deg] rounded-full bg-black/20" />
    </div>
  );
}

function unitLabel(row: EstimateCatalogPickerRow): string {
  if (row.customUnitLabel) return row.customUnitLabel;
  switch (row.catalogUnit) {
    case 'SQ_FT':
      return 'sq ft';
    case 'HOUR':
      return 'hr';
    case 'EACH':
    default:
      return 'ea';
  }
}
