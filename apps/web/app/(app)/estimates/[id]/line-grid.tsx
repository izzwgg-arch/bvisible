'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { EstimateLineKind } from '@bvisible/db';
import {
  buildLinePatchFromCatalogSelection,
  catalogPickerCostBasisCents,
  catalogPickerSellHintCents,
  type EstimateCatalogBundleComponent,
  type EstimateCatalogPickerRow,
} from '@/lib/shop-material/apply-catalog-to-estimate-line';
import { NumericCell } from '@/components/grid/cell-input';
import { FinalizedReadOnlyChip } from '@/components/estimate/finalized-read-only-chip';
import { SelectControl } from '@/components/app/select-control';
import { formatMoney, formatQty, parseMoney, parseQty, kindLabel } from '@/lib/estimate/format';
import { SectionCard } from '@/components/estimate/estimate-surface';
import type { DraftLine, EditorBootstrap } from './editor';
import type { Action } from './editor';

const GRID_NAME = 'estimate-lines';

const KIND_TONE: Record<EstimateLineKind, string> = {
  MATERIAL: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  MACHINE: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  LABOR: 'bg-blue-50 text-blue-700 ring-blue-200',
  DESIGN: 'bg-violet-50 text-violet-700 ring-violet-200',
  INSTALL: 'bg-orange-50 text-orange-700 ring-orange-200',
  MISC: 'bg-slate-100 text-slate-600 ring-slate-200',
};

type PickerTab = 'catalog' | 'vehicle';

interface LineGridProps {
  lines: ReadonlyArray<DraftLine>;
  machines: ReadonlyArray<{ id: string; name: string; ratePerHourCents: number }>;
  catalog: ReadonlyArray<EstimateCatalogPickerRow>;
  vehicleLibrary: EditorBootstrap['vehicleLibrary'];
  lineCosts: Record<string, number>;
  multiplierMilli: number;
  readOnly?: boolean;
  embedded?: boolean;
  customer?: { companyName: string; contactName: string | null };
  onAnyLineFocus?: (lineId: string) => void;
  dispatch: React.Dispatch<Action>;
}

type VehiclePickerRow = {
  id: string;
  name: string;
  detail: string;
  qtyMilli: number;
};

type EditableBundleComponent = {
  componentName: string;
  category: string;
  qtyMilli: number;
  unitLabel: string;
  totalCostCents: number;
  totalSellCents: number;
  selectedVendorName: string;
  preferredVendorName: string;
  cheapestVendorName: string;
  vendorPricingText: string;
};

type LineInternalMeta = {
  __estimateLineMetaV1: true;
  bundleComponents?: EditableBundleComponent[];
  measurement?: string;
  taxEnabled?: boolean;
  unitLabelOverride?: string;
  materialVendorOverrides?: Record<string, string>;
  legacyInternalNotes?: string;
};

type BundleOverrideDoc = {
  __estimateBundleOverridesV1: true;
  components: EditableBundleComponent[];
};

const UNIT_OPTIONS = ['Sq ft', 'Each', 'Hrs', 'Sheet', 'Roll', 'Lin ft', 'Custom'];
const MATERIALS_SECTION_STORAGE_KEY = 'estimate-materials-cheapest-vendors-open';

export function LineGrid({
  lines,
  machines,
  catalog,
  vehicleLibrary,
  lineCosts,
  multiplierMilli,
  readOnly = false,
  embedded = false,
  customer,
  onAnyLineFocus,
  dispatch,
}: LineGridProps) {
  const machinesById = useMemo(
    () => new Map(machines.map((m) => [m.id, { ratePerHourCents: m.ratePerHourCents, name: m.name }])),
    [machines],
  );
  const catalogById = useMemo(() => new Map(catalog.map((row) => [row.id, row])), [catalog]);
  const vehicleRows = useMemo(() => buildVehicleRows(vehicleLibrary), [vehicleLibrary]);
  const [openLineId, setOpenLineId] = useState<string | null>(null);
  const [tab, setTab] = useState<PickerTab>('catalog');
  const [queries, setQueries] = useState<Record<string, string>>({});
  const [highlight, setHighlight] = useState(0);
  const [materialsOpen, setMaterialsOpen] = useState(false);
  const itemRefs = useRef(new Map<string, HTMLInputElement>());
  const focusLastAfterAdd = useRef(false);

  useEffect(() => {
    setMaterialsOpen(window.localStorage.getItem(MATERIALS_SECTION_STORAGE_KEY) === 'true');
  }, []);

  useEffect(() => {
    if (!focusLastAfterAdd.current) return;
    focusLastAfterAdd.current = false;
    const last = lines[lines.length - 1];
    if (!last) return;
    setOpenLineId(last.id);
    setTab('catalog');
    setQueries((prev) => ({ ...prev, [last.id]: '' }));
    window.requestAnimationFrame(() => itemRefs.current.get(last.id)?.focus());
  }, [lines]);

  useEffect(() => {
    if (!openLineId) return;

    function closePickerOnOutsidePointer(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(`[data-picker-line="${openLineId}"], [data-picker-input-line="${openLineId}"]`)) return;
      setOpenLineId(null);
    }

    document.addEventListener('pointerdown', closePickerOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closePickerOnOutsidePointer);
  }, [openLineId]);

  function visibleCatalogRows(lineId: string): EstimateCatalogPickerRow[] {
    const q = (queries[lineId] ?? '').trim().toLowerCase();
    if (!q) return catalog.slice(0, 24);
    return catalog
      .filter((row) => {
        const haystack = [
          row.name,
          row.nameNormalized,
          kindLabel(row.kind),
          row.itemType === 'BUNDLE' ? 'bundle' : 'item',
        ].join(' ').toLowerCase();
        return haystack.includes(q);
      })
      .slice(0, 30);
  }

  function visibleVehicleRows(lineId: string): VehiclePickerRow[] {
    const q = (queries[lineId] ?? '').trim().toLowerCase();
    if (!q) return vehicleRows.slice(0, 24);
    return vehicleRows.filter((row) => `${row.name} ${row.detail}`.toLowerCase().includes(q)).slice(0, 30);
  }

  function focusNextRow(currentId: string) {
    const index = lines.findIndex((line) => line.id === currentId);
    const next = lines[index + 1];
    if (next && isEmptyLine(next)) {
      setOpenLineId(next.id);
      setTab('catalog');
      setQueries((prev) => ({ ...prev, [next.id]: '' }));
      window.requestAnimationFrame(() => itemRefs.current.get(next.id)?.focus());
      return;
    }
    focusLastAfterAdd.current = true;
    dispatch({ type: 'add-line', kind: EstimateLineKind.MATERIAL });
  }

  function applyCatalog(lineId: string, row: EstimateCatalogPickerRow) {
    const patch = buildLinePatchFromCatalogSelection({ row, machinesById });
    setOpenLineId(null);
    setQueries((prev) => ({ ...prev, [lineId]: row.name }));
    if (patch.kind === EstimateLineKind.MACHINE && patch.machineId) {
      const machine = machinesById.get(patch.machineId);
      dispatch({
        type: 'set-line',
        id: lineId,
        patch: {
          description: patch.description,
          kind: patch.kind,
          qtyMilli: patch.qtyMilli,
          machineId: patch.machineId,
          catalogItemId: patch.catalogItemId,
          pricingMethod: patch.pricingMethod,
          pricingEngine: patch.pricingEngine,
          pricingInputsSnapshotJson: patch.pricingInputsSnapshotJson,
          pricingOutputSnapshotJson: patch.pricingOutputSnapshotJson,
          formulaVersion: patch.formulaVersion,
          selectedVendorId: patch.selectedVendorId,
          selectedVendorMode: patch.selectedVendorMode,
          customerDescription: patch.customerDescription,
        },
      });
      dispatch({
        type: 'pick-machine',
        id: lineId,
        machineId: patch.machineId,
        ratePerHourCents: machine?.ratePerHourCents ?? patch.unitCostCents,
      });
    } else {
      dispatch({ type: 'set-line', id: lineId, patch });
    }
    window.requestAnimationFrame(() => focusNextRow(lineId));
  }

  function applyVehicle(lineId: string, row: VehiclePickerRow) {
    setOpenLineId(null);
    setQueries((prev) => ({ ...prev, [lineId]: row.name }));
    dispatch({
      type: 'set-line',
      id: lineId,
      patch: {
        description: row.name,
        kind: EstimateLineKind.MATERIAL,
        qtyMilli: row.qtyMilli,
        unitCostCents: 0,
        machineId: null,
        catalogItemId: null,
        pricingMethod: null,
        pricingEngine: null,
        pricingInputsSnapshotJson: null,
        pricingOutputSnapshotJson: null,
        formulaVersion: null,
        selectedVendorId: null,
        selectedVendorMode: null,
        customerDescription: row.name,
      },
    });
    window.requestAnimationFrame(() => focusNextRow(lineId));
  }

  function handlePickerKeyDown(lineId: string, event: React.KeyboardEvent<HTMLInputElement>) {
    const rowCount = tab === 'catalog' ? visibleCatalogRows(lineId).length : visibleVehicleRows(lineId).length;
    if (event.key === 'Escape') {
      event.preventDefault();
      setOpenLineId(null);
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((current) => (rowCount === 0 ? 0 : Math.min(current + 1, rowCount - 1)));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (tab === 'catalog') {
        const row = visibleCatalogRows(lineId)[highlight];
        if (row) applyCatalog(lineId, row);
      } else {
        const row = visibleVehicleRows(lineId)[highlight];
        if (row) applyVehicle(lineId, row);
      }
    }
  }

  function setMaterialsSectionOpen(next: boolean) {
    setMaterialsOpen(next);
    window.localStorage.setItem(MATERIALS_SECTION_STORAGE_KEY, String(next));
  }

  const materialVendorSummary = useMemo(
    () => buildMaterialVendorSummary({ lines, catalogById }),
    [catalogById, lines],
  );

  const content = (
    <div>
      <div className="flex items-start justify-between gap-3 border-b border-[#eadfd3] bg-gradient-to-r from-[#fff4e8] via-white to-[#eef5f9] px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-[15px] font-black tracking-[-0.01em] text-[#1C4972]">Line Items</h2>
            {readOnly ? <FinalizedReadOnlyChip /> : null}
          </div>
          <p className="mt-1 text-[11px] text-[#6d7480]">
            Type to search catalog items or vehicles. Press Enter to add and move to the next line.
            {customer ? <span className="sr-only"> {customer.companyName}</span> : null}
          </p>
        </div>
      </div>

      <div className="overflow-x-auto overflow-y-visible">
        <table className="w-full min-w-[1040px] text-[12px]">
          <thead>
            <tr className="border-b border-[#eadfd3] bg-gradient-to-r from-[#fff4e8] via-[#fffdfa] to-[#eef5f9] text-left text-[9px] font-black uppercase tracking-[0.11em] text-[#1C4972]/70 shadow-[inset_0_-1px_0_rgba(242,135,68,0.14)]">
              <th className="w-[36px] px-3 py-2">#</th>
              <th className="w-[31%] px-2 py-2">Item</th>
              <th className="w-[90px] px-2 py-2">Category</th>
              <th className="w-[64px] px-2 py-2 text-right">Qty</th>
              <th className="w-[70px] px-2 py-2">Unit</th>
              <th className="w-[96px] px-2 py-2 text-right">Cost</th>
              <th className="w-[96px] px-2 py-2 text-right">Sell</th>
              <th className="w-[78px] px-2 py-2 text-right">Margin</th>
              <th className="w-[78px] px-2 py-2 text-center">Tax</th>
              <th className="w-[96px] px-2 py-2 text-right">Total</th>
              {!readOnly ? <th className="w-[36px] px-3 py-2 text-right" /> : null}
            </tr>
          </thead>
          <tbody>
            {lines.map((line, idx) => {
              const cost = lineCosts[line.id] ?? 0;
              const sell = Math.round((cost * multiplierMilli) / 1000);
              const margin = sell > 0 ? Math.round(((sell - cost) / sell) * 1000) / 10 : null;
              const catalogRow = line.catalogItemId ? catalogById.get(line.catalogItemId) ?? null : null;
              const isBundle = catalogRow?.itemType === 'BUNDLE';
              const lineMeta = parseLineInternalMeta(line.internalNotes);
              const unit = lineMeta?.unitLabelOverride ?? unitLabel(catalogRow, line.kind);
              const isSquareFootLine = unit.toLowerCase().replace(/\s+/g, '_') === 'sq_ft';
              const taxEnabled = lineMeta?.taxEnabled ?? true;
              const reportFocus = () => onAnyLineFocus?.(line.id);
              const updateLineMeta = (patch: Partial<Omit<LineInternalMeta, '__estimateLineMetaV1'>>) => {
                dispatch({
                  type: 'set-line',
                  id: line.id,
                  patch: { internalNotes: serializeLineInternalMeta(line.internalNotes, patch) },
                });
              };

              return (
                <Fragment key={line.id}>
                  <tr className="group border-b border-[#f0e4d8] bg-white/90 transition-colors hover:bg-[#fff0e5]/80">
                    <td className="px-3 py-2 align-middle text-[11px] font-bold tabular-nums text-[#F28744]">
                      {idx + 1}
                    </td>
                    <td className="relative overflow-visible px-2 py-2 align-middle">
                      {readOnly ? (
                        <span className="block px-1 text-[13px] font-semibold text-slate-800">{line.description}</span>
                      ) : (
                        <>
                          <div className="flex items-center gap-2">
                            <input
                              ref={(node) => {
                                if (node) itemRefs.current.set(line.id, node);
                                else itemRefs.current.delete(line.id);
                              }}
                              value={openLineId === line.id ? queries[line.id] ?? line.description : line.description}
                              onFocus={() => {
                                reportFocus();
                                setOpenLineId(line.id);
                                setHighlight(0);
                                setQueries((prev) => ({ ...prev, [line.id]: prev[line.id] ?? line.description }));
                              }}
                              onChange={(event) => {
                                const value = event.currentTarget.value;
                                setOpenLineId(line.id);
                                setHighlight(0);
                                setQueries((prev) => ({ ...prev, [line.id]: value }));
                                dispatch({
                                  type: 'set-line',
                                  id: line.id,
                                  patch: {
                                    description: value,
                                    catalogItemId: null,
                                    pricingMethod: null,
                                    pricingEngine: null,
                                    pricingInputsSnapshotJson: null,
                                    pricingOutputSnapshotJson: null,
                                    formulaVersion: null,
                                    selectedVendorId: null,
                                    selectedVendorMode: null,
                                  },
                                });
                              }}
                              onKeyDown={(event) => handlePickerKeyDown(line.id, event)}
                              placeholder="Type to search items..."
                              aria-label={`Row ${idx + 1} item search`}
                              autoComplete="off"
                              spellCheck={false}
                              data-cell-row={idx}
                              data-cell-col="item"
                              data-cell-grid={GRID_NAME}
                              data-picker-input-line={line.id}
                              className="min-w-0 flex-1 rounded-[6px] border border-transparent bg-white px-2 py-1.5 text-[13px] font-semibold text-[#1C4972] outline-none ring-1 ring-[#eadfd3] transition placeholder:text-slate-400 focus:ring-2 focus:ring-[#F28744]"
                            />
                            {isBundle ? (
                              <span className="shrink-0 rounded-full border border-[#F28744]/25 bg-[#fff0e5] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-[#F28744]">
                                Bundle
                              </span>
                            ) : null}
                          </div>
                          {openLineId === line.id ? (
                            <ItemPickerDropdown
                              lineId={line.id}
                              tab={tab}
                              setTab={(next) => {
                                setTab(next);
                                setHighlight(0);
                              }}
                              catalogRows={visibleCatalogRows(line.id)}
                              vehicleRows={visibleVehicleRows(line.id)}
                              highlight={highlight}
                              machinesById={machinesById}
                              onCatalogPick={(row) => applyCatalog(line.id, row)}
                              onVehiclePick={(row) => applyVehicle(line.id, row)}
                            />
                          ) : null}
                        </>
                      )}
                    </td>
                    <td className="px-2 py-2 align-middle">
                      <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset ${KIND_TONE[line.kind]}`}>
                        {kindLabel(line.kind)}
                      </span>
                    </td>
                    <td className="px-2 py-2 align-middle text-right tabular-nums text-[#1C4972]/80">
                      {readOnly ? formatQty(line.qtyMilli) : (
                        <NumericCell
                          value={line.qtyMilli}
                          onCommit={(v) => dispatch({ type: 'set-line', id: line.id, patch: { qtyMilli: v } })}
                          onCellFocus={reportFocus}
                          format={formatQty}
                          parse={parseQty}
                          ariaLabel={`Row ${idx + 1} quantity`}
                          cellRow={idx}
                          cellCol="qty"
                          cellGrid={GRID_NAME}
                        />
                      )}
                    </td>
                    <td className="px-2 py-2 align-middle text-[11px] font-semibold text-[#1C4972]/75">
                      {readOnly ? (
                        <span>{unit}</span>
                      ) : (
                        <div className="flex min-w-[104px] flex-col gap-1">
                          <SelectControl
                            value={unit}
                            onFocus={reportFocus}
                            onChange={(event) => updateLineMeta({ unitLabelOverride: event.currentTarget.value })}
                            aria-label={`Row ${idx + 1} unit type`}
                            className="h-7 rounded-[5px] border border-[#eadfd3] bg-white px-1.5 text-[11px] font-semibold text-[#1C4972] outline-none focus:border-[#F28744] focus:ring-2 focus:ring-[#F28744]/15"
                          >
                            {UNIT_OPTIONS.map((option) => (
                              <option key={option} value={option}>{option}</option>
                            ))}
                          </SelectControl>
                          {isSquareFootLine ? (
                            <input
                              value={lineMeta?.measurement ?? ''}
                              onFocus={reportFocus}
                              onChange={(event) => {
                                const measurement = event.currentTarget.value;
                                const qtyMilli = parseSqFtMeasurementMilli(measurement);
                                dispatch({
                                  type: 'set-line',
                                  id: line.id,
                                  patch: {
                                    qtyMilli: qtyMilli ?? line.qtyMilli,
                                    internalNotes: serializeLineInternalMeta(line.internalNotes, { measurement }),
                                  },
                                });
                              }}
                              placeholder="4 x 8"
                              aria-label={`Row ${idx + 1} square foot measurement`}
                              className="h-7 rounded-[5px] border border-[#eadfd3] bg-white px-1.5 text-[11px] font-semibold text-[#1C4972] outline-none placeholder:text-slate-300 focus:border-[#F28744] focus:ring-2 focus:ring-[#F28744]/15"
                            />
                          ) : null}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right font-semibold tabular-nums text-[#1C4972]">
                      {readOnly ? formatMoney(cost) : (
                        <NumericCell
                          value={cost}
                          onCommit={(v) => {
                            const qty = line.qtyMilli > 0 ? line.qtyMilli : 1000;
                            dispatch({ type: 'set-line', id: line.id, patch: { unitCostCents: Math.round((v * 1000) / qty) } });
                          }}
                          format={formatMoney}
                          parse={parseMoney}
                          ariaLabel={`Row ${idx + 1} total cost`}
                          cellRow={idx}
                          cellCol="cost"
                          cellGrid={GRID_NAME}
                          onCellFocus={reportFocus}
                        />
                      )}
                    </td>
                    <td className="px-2 py-2 text-right font-semibold tabular-nums text-[#1C4972]">
                      {readOnly ? formatMoney(sell) : (
                        <NumericCell
                          value={sell}
                          onCommit={(v) => {
                            if (multiplierMilli <= 0) return;
                            const qty = line.qtyMilli > 0 ? line.qtyMilli : 1000;
                            const targetCost = Math.round((v * 1000) / multiplierMilli);
                            dispatch({ type: 'set-line', id: line.id, patch: { unitCostCents: Math.round((targetCost * 1000) / qty) } });
                          }}
                          format={formatMoney}
                          parse={parseMoney}
                          ariaLabel={`Row ${idx + 1} total sell`}
                          cellRow={idx}
                          cellCol="sell"
                          cellGrid={GRID_NAME}
                          onCellFocus={reportFocus}
                        />
                      )}
                    </td>
                    <td className="px-2 py-2 text-right font-semibold tabular-nums text-[#159b63]">
                      {margin == null ? '-' : `${margin.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`}
                    </td>
                    <td className="px-2 py-2 text-center text-[11px] font-semibold text-slate-500">
                      {readOnly ? (
                        <span>{taxEnabled ? '8.25%' : '-'}</span>
                      ) : (
                        <label className="inline-flex cursor-pointer items-center gap-1">
                          <input
                            type="checkbox"
                            checked={taxEnabled}
                            onFocus={reportFocus}
                            onChange={(event) => updateLineMeta({ taxEnabled: event.currentTarget.checked })}
                            aria-label={`Row ${idx + 1} taxable`}
                            className="h-3.5 w-3.5 rounded border-[#eadfd3] text-[#F28744] focus:ring-[#F28744]"
                          />
                          <span>{taxEnabled ? '8.25%' : '-'}</span>
                        </label>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right font-black tabular-nums text-[#1C4972]">{formatMoney(sell)}</td>
                    {!readOnly ? (
                      <td className="relative overflow-visible px-3 py-2 text-right">
                        <details className="relative z-[80] inline-block text-left">
                          <summary className="flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-lg text-[15px] font-bold leading-none text-[#F28744]/60 transition hover:bg-[#fff0e5] hover:text-[#F28744] marker:content-none [&::-webkit-details-marker]:hidden">...</summary>
                          <div className="absolute right-0 top-full z-[100] mt-1 flex w-32 flex-col overflow-hidden rounded-xl border border-[#eadfd3] bg-white py-1 text-left shadow-lg">
                            <button type="button" onClick={() => dispatch({ type: 'move-line', id: line.id, dir: -1 })} disabled={idx === 0} className="px-3 py-2 text-[12px] font-medium text-slate-600 hover:bg-slate-50 disabled:text-slate-300">Move up</button>
                            <button type="button" onClick={() => dispatch({ type: 'move-line', id: line.id, dir: 1 })} disabled={idx === lines.length - 1} className="px-3 py-2 text-[12px] font-medium text-slate-600 hover:bg-slate-50 disabled:text-slate-300">Move down</button>
                            <button type="button" onClick={() => dispatch({ type: 'remove-line', id: line.id })} className="px-3 py-2 text-[12px] font-medium text-rose-600 hover:bg-rose-50">Remove</button>
                          </div>
                        </details>
                      </td>
                    ) : null}
                  </tr>
                  {isBundle && catalogRow ? (
                    <tr key={`${line.id}-bundle`} className="border-b border-[#eadfd3] bg-[#fff0e5]/40">
                      <td />
                      <td colSpan={readOnly ? 9 : 10} className="px-2 pb-4 pt-1">
                        <BundleBreakdown
                          row={catalogRow}
                          line={line}
                          readOnly={readOnly}
                          dispatch={dispatch}
                        />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
            {lines.length === 0 ? (
              <tr>
                <td colSpan={readOnly ? 10 : 11} className="px-4 py-6">
                  <div className="rounded-[14px] border border-dashed border-[#F28744]/35 bg-[#fff0e5]/70 px-5 py-5 text-[13px] text-[#6d7480]">
                    {readOnly ? 'This finalized estimate has no lines on record.' : 'Add a line item to start this estimate.'}
                  </div>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <MaterialsCheapestVendorsSection
        open={materialsOpen}
        onOpenChange={setMaterialsSectionOpen}
        summary={materialVendorSummary}
        readOnly={readOnly}
        dispatch={dispatch}
      />
    </div>
  );

  if (embedded) return <div id="estimate-line-grid" className="px-5 py-5">{content}</div>;
  return <SectionCard id="estimate-line-grid" className="min-h-[350px] overflow-visible ring-1 ring-[#F28744]/10">{content}</SectionCard>;
}

function ItemPickerDropdown({
  lineId,
  tab,
  setTab,
  catalogRows,
  vehicleRows,
  highlight,
  machinesById,
  onCatalogPick,
  onVehiclePick,
}: {
  lineId: string;
  tab: PickerTab;
  setTab: (tab: PickerTab) => void;
  catalogRows: ReadonlyArray<EstimateCatalogPickerRow>;
  vehicleRows: ReadonlyArray<VehiclePickerRow>;
  highlight: number;
  machinesById: ReadonlyMap<string, { ratePerHourCents: number; name: string }>;
  onCatalogPick: (row: EstimateCatalogPickerRow) => void;
  onVehiclePick: (row: VehiclePickerRow) => void;
}) {
  return (
    <div className="mt-1 w-[360px] overflow-hidden rounded-[10px] border border-slate-200 bg-white shadow-2xl" data-picker-line={lineId}>
      <div className="flex border-b border-slate-100 bg-slate-50 p-1">
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setTab('catalog')}
          className={`flex-1 rounded-[7px] px-3 py-1.5 text-[11px] font-black ${tab === 'catalog' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'}`}
        >
          Catalog
        </button>
        <button
          type="button"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setTab('vehicle')}
          className={`flex-1 rounded-[7px] px-3 py-1.5 text-[11px] font-black ${tab === 'vehicle' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500'}`}
        >
          Vehicle
        </button>
      </div>
      <div className="max-h-[360px] overflow-y-auto py-1">
        {tab === 'catalog' ? (
          catalogRows.length === 0 ? (
            <EmptyPickerState title="No catalog matches" detail="Try a different item name, category, or bundle." />
          ) : (
            catalogRows.map((row, index) => {
              const cost = catalogPickerCostBasisCents({ row, machinesById });
              const sell = catalogPickerSellHintCents({ row, machinesById });
              return (
                <button
                  key={row.id}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => onCatalogPick(row)}
                  className={`grid w-full grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-2 text-left ${index === highlight ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-black text-slate-900">{row.name}</span>
                    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] font-bold text-slate-400">
                      <span>{kindLabel(row.kind)}</span>
                      {row.itemType === 'BUNDLE' ? (
                        <span className="rounded-full border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-violet-700">
                          Bundle{row.componentCount > 0 ? ` · ${row.componentCount}` : ''}
                        </span>
                      ) : null}
                    </span>
                  </span>
                  <span className="text-right text-[11px] font-bold tabular-nums text-slate-700">
                    <span className="block">{formatMoney(sell)}</span>
                    <span className="block text-slate-400">cost {formatMoney(cost)}</span>
                  </span>
                </button>
              );
            })
          )
        ) : vehicleRows.length === 0 ? (
          <EmptyPickerState title="No vehicle helpers" detail="Vehicle data is optional. Estimates work without vehicle rows." />
        ) : (
          vehicleRows.map((row, index) => (
            <button
              key={row.id}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onVehiclePick(row)}
              className={`w-full px-3 py-2 text-left ${index === highlight ? 'bg-blue-50' : 'hover:bg-slate-50'}`}
            >
              <span className="block truncate text-[12px] font-black text-slate-900">{row.name}</span>
              <span className="mt-1 block truncate text-[10px] font-bold text-slate-400">{row.detail}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function BundleBreakdown({
  row,
  line,
  readOnly,
  dispatch,
}: {
  row: EstimateCatalogPickerRow;
  line: DraftLine;
  readOnly: boolean;
  dispatch: React.Dispatch<Action>;
}) {
  const [open, setOpen] = useState(false);
  const lineMeta = parseLineInternalMeta(line.internalNotes);
  const components = editableBundleComponents(row, lineMeta);

  function commitComponents(nextComponents: EditableBundleComponent[]) {
    const totalCostCents = nextComponents.reduce((sum, component) => sum + component.totalCostCents, 0);
    const qty = line.qtyMilli > 0 ? line.qtyMilli : 1000;
    dispatch({
      type: 'set-line',
      id: line.id,
      patch: {
        internalNotes: serializeLineInternalMeta(line.internalNotes, { bundleComponents: nextComponents }),
        unitCostCents: Math.round((totalCostCents * 1000) / qty),
      },
    });
  }

  function updateComponent(index: number, patch: Partial<EditableBundleComponent>) {
    const next = components.map((component, componentIndex) =>
      componentIndex === index ? { ...component, ...patch } : component,
    );
    commitComponents(next);
  }

  return (
    <div className="rounded-[10px] border border-violet-100 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left"
      >
        <span>
          <span className="text-[11px] font-black text-slate-900">Bundle components</span>
          <span className="ml-2 text-[10px] font-bold text-slate-400">Internal use only</span>
        </span>
        <span className="text-[11px] font-bold text-violet-700">{open ? 'Collapse' : 'Expand'}</span>
      </button>
      {open ? (
        <div className="overflow-x-auto border-t border-violet-100">
          <table className="w-full min-w-[960px] text-[11px]">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-[9px] font-bold uppercase tracking-[0.1em] text-slate-400">
                <th className="px-3 py-2">Component</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2">Unit</th>
                <th className="px-3 py-2 text-right">Cost</th>
                <th className="px-3 py-2 text-right">Sell</th>
                <th className="px-3 py-2 text-right">Markup</th>
                <th className="px-3 py-2">Selected / preferred</th>
                <th className="px-3 py-2">Cheapest / all vendor pricing</th>
              </tr>
            </thead>
            <tbody>
              {components.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-5 text-center text-slate-400">
                    No component rows saved for this bundle.
                  </td>
                </tr>
              ) : (
                components.map((component, index) => {
                  const markup = component.totalCostCents > 0
                    ? ((component.totalSellCents - component.totalCostCents) / component.totalCostCents) * 100
                    : null;
                  return (
                    <tr key={`${component.componentName}-${component.qtyMilli}`} className="border-b border-slate-100 last:border-b-0">
                      <td className="px-3 py-2">
                        <BundleTextInput
                          value={component.componentName}
                          readOnly={readOnly}
                          onCommit={(value) => updateComponent(index, { componentName: value })}
                          ariaLabel={`Bundle component ${index + 1} name`}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <BundleTextInput
                          value={component.category}
                          readOnly={readOnly}
                          onCommit={(value) => updateComponent(index, { category: value })}
                          ariaLabel={`Bundle component ${index + 1} category`}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <BundleNumberInput
                          value={component.qtyMilli}
                          readOnly={readOnly}
                          format={formatQty}
                          parse={parseQty}
                          align="right"
                          onCommit={(value) => updateComponent(index, { qtyMilli: value })}
                          ariaLabel={`Bundle component ${index + 1} quantity`}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <BundleTextInput
                          value={component.unitLabel}
                          readOnly={readOnly}
                          onCommit={(value) => updateComponent(index, { unitLabel: value })}
                          ariaLabel={`Bundle component ${index + 1} unit`}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <BundleNumberInput
                          value={component.totalCostCents}
                          readOnly={readOnly}
                          format={formatMoney}
                          parse={parseMoney}
                          align="right"
                          onCommit={(value) => updateComponent(index, { totalCostCents: value })}
                          ariaLabel={`Bundle component ${index + 1} cost`}
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <BundleNumberInput
                          value={component.totalSellCents}
                          readOnly={readOnly}
                          format={formatMoney}
                          parse={parseMoney}
                          align="right"
                          onCommit={(value) => updateComponent(index, { totalSellCents: value })}
                          ariaLabel={`Bundle component ${index + 1} sell`}
                        />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-600">{markup == null ? '-' : `${markup.toFixed(1)}%`}</td>
                      <td className="px-3 py-2">
                        <BundleTextInput
                          value={component.selectedVendorName}
                          readOnly={readOnly}
                          onCommit={(value) => updateComponent(index, { selectedVendorName: value })}
                          ariaLabel={`Bundle component ${index + 1} selected vendor`}
                        />
                        <BundleTextInput
                          value={component.preferredVendorName}
                          readOnly={readOnly}
                          onCommit={(value) => updateComponent(index, { preferredVendorName: value })}
                          ariaLabel={`Bundle component ${index + 1} preferred vendor`}
                          className="mt-1"
                        />
                      </td>
                      <td className="px-3 py-2 text-slate-500">
                        <span className="block font-semibold text-slate-700">{component.cheapestVendorName || 'In-house'}</span>
                        <span className="block max-w-[240px] truncate text-[10px]">{component.vendorPricingText || 'No vendor pricing'}</span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

type MaterialVendorSource = {
  key: string;
  lineId: string;
  name: string;
  usedIn: string;
  qtyMilli: number;
  unit: string;
  catalogItemId: string | null;
  cheapestVendorName: string | null;
  cheapestCostCents: number | null;
  preferredVendorName: string | null;
  preferredCostCents: number | null;
  selectedVendorName: string | null;
  vendorOptions: string[];
  hasVendorPrices: boolean;
};

type MaterialVendorRow = MaterialVendorSource & {
  sourceCount: number;
  allLineIds: string[];
  allSources: Array<{ lineId: string; internalNotes: string | null }>;
  allUsedIn: string[];
};

type MaterialVendorSummary = {
  rows: MaterialVendorRow[];
  sourceCount: number;
  estimatedPurchasingCostCents: number;
  savingsVsPreferredCents: number | null;
};

function MaterialsCheapestVendorsSection({
  open,
  onOpenChange,
  summary,
  readOnly,
  dispatch,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summary: MaterialVendorSummary;
  readOnly: boolean;
  dispatch: React.Dispatch<Action>;
}) {
  return (
    <section className="border-t border-slate-100 bg-white px-4 py-4">
      <div className="rounded-[10px] border border-slate-200 bg-white shadow-sm">
        <button
          type="button"
          onClick={() => onOpenChange(!open)}
          className="flex w-full items-start justify-between gap-4 px-4 py-3 text-left"
          aria-expanded={open}
        >
          <span>
            <span className="block text-[13px] font-black text-slate-950">Materials &amp; Cheapest Vendors</span>
            <span className="mt-1 block text-[10px] font-semibold text-slate-400">Internal use only</span>
          </span>
          <span className="flex flex-wrap items-center justify-end gap-3 text-[10px] font-bold text-slate-500">
            <span>{summary.sourceCount.toLocaleString()} materials</span>
            <span>Est. purchase cost {formatMoney(summary.estimatedPurchasingCostCents)}</span>
            <span className="text-emerald-600">
              {summary.savingsVsPreferredCents == null
                ? 'Savings unavailable'
                : `Est. savings vs preferred ${formatMoney(summary.savingsVsPreferredCents)}`}
            </span>
            <span className="rounded-[6px] border border-slate-200 bg-slate-50 px-2 py-1 text-slate-700">
              {open ? 'Collapse' : 'Expand'}
            </span>
          </span>
        </button>

        {open ? (
          <div className="overflow-x-auto border-t border-slate-100">
            <table className="w-full min-w-[1040px] text-[11px]">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-left text-[9px] font-bold uppercase tracking-[0.1em] text-slate-400">
                  <th className="px-3 py-2">Material</th>
                  <th className="px-3 py-2">Used In</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2">Unit</th>
                  <th className="px-3 py-2">Cheapest Vendor</th>
                  <th className="px-3 py-2 text-right">Cheapest Cost</th>
                  <th className="px-3 py-2">Preferred Vendor</th>
                  <th className="px-3 py-2 text-right">Preferred Cost</th>
                  <th className="px-3 py-2">Selected Vendor</th>
                  <th className="px-3 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {summary.rows.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-3 py-6 text-center text-slate-400">
                      No material rows found on this estimate.
                    </td>
                  </tr>
                ) : (
                  summary.rows.map((row) => (
                    <tr key={row.key} className="border-b border-slate-100 last:border-b-0">
                      <td className="px-3 py-2 font-bold text-slate-900">{row.name}</td>
                      <td className="px-3 py-2 text-slate-500">
                        <span className="block max-w-[240px] truncate">{row.allUsedIn.join(' · ')}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{formatQty(row.qtyMilli)}</td>
                      <td className="px-3 py-2 text-slate-500">{row.unit}</td>
                      <td className="px-3 py-2 text-slate-700">{row.cheapestVendorName ?? 'No vendor prices'}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-emerald-600">
                        {row.cheapestCostCents == null ? '-' : formatMoney(row.cheapestCostCents)}
                      </td>
                      <td className="px-3 py-2 text-slate-500">{row.preferredVendorName ?? '-'}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                        {row.preferredCostCents == null ? '-' : formatMoney(row.preferredCostCents)}
                      </td>
                      <td className="px-3 py-2">
                        {readOnly ? (
                          <span className="font-semibold text-slate-700">{row.selectedVendorName ?? row.cheapestVendorName ?? 'No vendor prices'}</span>
                        ) : (
                          <SelectControl
                            value={row.selectedVendorName ?? ''}
                            onChange={(event) => {
                              const selectedVendorName = event.currentTarget.value;
                              for (const lineId of row.allLineIds) {
                                const source = row.allSources.find((item) => item.lineId === lineId);
                                dispatch({
                                  type: 'set-line',
                                  id: lineId,
                                  patch: {
                                    internalNotes: serializeLineInternalMeta(source?.internalNotes ?? null, {
                                      materialVendorOverrides: {
                                        ...(parseLineInternalMeta(source?.internalNotes ?? null)?.materialVendorOverrides ?? {}),
                                        [row.key]: selectedVendorName,
                                      },
                                    }),
                                  },
                                });
                              }
                            }}
                            className="h-7 w-full min-w-[120px] rounded-[5px] border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                            aria-label={`Selected vendor for ${row.name}`}
                            data-material-vendor-select={row.key}
                            searchable
                            searchPlaceholder="Search vendors..."
                          >
                            <option value="">Auto cheapest</option>
                            {row.vendorOptions.map((vendor) => (
                              <option key={vendor} value={vendor}>{vendor}</option>
                            ))}
                          </SelectControl>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-500">
                        {!row.hasVendorPrices && row.catalogItemId ? (
                          <Link href={`/items/${row.catalogItemId}` as never} className="font-bold text-blue-600 hover:text-blue-700">
                            Add vendor price
                          </Link>
                        ) : (
                          <span>Internal only</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function buildMaterialVendorSummary({
  lines,
  catalogById,
}: {
  lines: ReadonlyArray<DraftLine>;
  catalogById: ReadonlyMap<string, EstimateCatalogPickerRow>;
}): MaterialVendorSummary {
  const sources: MaterialVendorSource[] = [];

  lines.forEach((line, index) => {
    const lineMeta = parseLineInternalMeta(line.internalNotes);
    const catalogRow = line.catalogItemId ? catalogById.get(line.catalogItemId) ?? null : null;
    const unit = lineMeta?.unitLabelOverride ?? unitLabel(catalogRow, line.kind);

    if (line.kind === EstimateLineKind.MATERIAL && catalogRow?.itemType !== 'BUNDLE') {
      const key = materialKey(catalogRow?.id ?? null, line.description, unit);
      const cheapestCostCents = catalogRow?.catalogCheapestVendorCostCents != null
        ? Math.round((catalogRow.catalogCheapestVendorCostCents * line.qtyMilli) / 1000)
        : null;
      const preferredCostCents = catalogRow?.catalogPreferredVendorCostCents != null
        ? Math.round((catalogRow.catalogPreferredVendorCostCents * line.qtyMilli) / 1000)
        : null;
      const vendorOptions = uniqueStrings([
        lineMeta?.materialVendorOverrides?.[key],
        catalogRow?.catalogCheapestVendorName,
        catalogRow?.catalogPreferredVendorName,
      ]);
      sources.push({
        key,
        lineId: line.id,
        name: line.description,
        usedIn: `Line ${index + 1}`,
        qtyMilli: line.qtyMilli,
        unit,
        catalogItemId: catalogRow?.id ?? null,
        cheapestVendorName: catalogRow?.catalogCheapestVendorName ?? null,
        cheapestCostCents,
        preferredVendorName: catalogRow?.catalogPreferredVendorName ?? null,
        preferredCostCents,
        selectedVendorName: lineMeta?.materialVendorOverrides?.[key] || null,
        vendorOptions,
        hasVendorPrices: vendorOptions.length > 0 && cheapestCostCents !== null,
      });
    }

    if (catalogRow?.itemType === 'BUNDLE') {
      const editableComponents = editableBundleComponents(catalogRow, lineMeta);
      editableComponents.forEach((component, componentIndex) => {
        const catalogComponent = catalogRow.bundleComponents?.[componentIndex] ?? null;
        if (catalogComponent && catalogComponent.componentType !== EstimateLineKind.MATERIAL) return;
        if (!catalogComponent && component.category.toLowerCase() !== 'material') return;

        const componentCatalogId = catalogComponent?.componentCatalogItemId ?? null;
        const key = materialKey(componentCatalogId, component.componentName, component.unitLabel);
        const cheapestVendor = (catalogComponent?.cheapestVendorName ?? component.cheapestVendorName) || null;
        const preferredVendor = (catalogComponent?.preferredVendorName ?? component.preferredVendorName) || null;
        const cheapestCostCents = vendorSnapshotCost(catalogComponent, 'cheapest') ?? (
          cheapestVendor ? component.totalCostCents : null
        );
        const preferredCostCents = vendorSnapshotCost(catalogComponent, 'preferred') ?? (
          preferredVendor ? component.totalCostCents : null
        );
        const vendorOptions = uniqueStrings([
          lineMeta?.materialVendorOverrides?.[key],
          component.selectedVendorName,
          cheapestVendor,
          preferredVendor,
          ...(catalogComponent?.vendorSnapshot.map((vendor) => vendor.vendorName ?? null) ?? []),
        ]);

        sources.push({
          key,
          lineId: line.id,
          name: component.componentName,
          usedIn: `Bundle: ${line.description}`,
          qtyMilli: component.qtyMilli,
          unit: component.unitLabel,
          catalogItemId: componentCatalogId,
          cheapestVendorName: cheapestVendor,
          cheapestCostCents,
          preferredVendorName: preferredVendor,
          preferredCostCents,
          selectedVendorName: lineMeta?.materialVendorOverrides?.[key] || component.selectedVendorName || null,
          vendorOptions,
          hasVendorPrices: vendorOptions.length > 0 && cheapestCostCents !== null,
        });
      });
    }
  });

  const byKey = new Map<string, MaterialVendorRow>();
  for (const source of sources) {
    const existing = byKey.get(source.key);
    if (!existing) {
      byKey.set(source.key, {
        ...source,
        sourceCount: 1,
        allLineIds: [source.lineId],
        allSources: [{ lineId: source.lineId, internalNotes: lines.find((line) => line.id === source.lineId)?.internalNotes ?? null }],
        allUsedIn: [source.usedIn],
      });
      continue;
    }

    existing.sourceCount += 1;
    existing.qtyMilli += source.qtyMilli;
    existing.cheapestCostCents = sumNullable(existing.cheapestCostCents, source.cheapestCostCents);
    existing.preferredCostCents = sumNullable(existing.preferredCostCents, source.preferredCostCents);
    existing.allLineIds = uniqueStrings([...existing.allLineIds, source.lineId]);
    if (!existing.allSources.some((item) => item.lineId === source.lineId)) {
      existing.allSources.push({
        lineId: source.lineId,
        internalNotes: lines.find((line) => line.id === source.lineId)?.internalNotes ?? null,
      });
    }
    existing.allUsedIn = uniqueStrings([...existing.allUsedIn, source.usedIn]);
    existing.vendorOptions = uniqueStrings([...existing.vendorOptions, ...source.vendorOptions]);
    existing.hasVendorPrices = existing.hasVendorPrices || source.hasVendorPrices;
    existing.selectedVendorName = existing.selectedVendorName ?? source.selectedVendorName;
    existing.cheapestVendorName = lowerCostVendor(existing, source, 'cheapest');
    existing.preferredVendorName = existing.preferredVendorName ?? source.preferredVendorName;
  }

  const rows = Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name));
  const estimatedPurchasingCostCents = rows.reduce((sum, row) => sum + (row.cheapestCostCents ?? 0), 0);
  const preferredCostRows = rows.filter((row) => row.preferredCostCents !== null && row.cheapestCostCents !== null);
  const savingsVsPreferredCents = preferredCostRows.length === 0
    ? null
    : preferredCostRows.reduce((sum, row) => sum + Math.max(0, (row.preferredCostCents ?? 0) - (row.cheapestCostCents ?? 0)), 0);

  return {
    rows,
    sourceCount: sources.length,
    estimatedPurchasingCostCents,
    savingsVsPreferredCents,
  };
}

function materialKey(catalogItemId: string | null, name: string, unit: string): string {
  if (catalogItemId) return `catalog:${catalogItemId}`;
  return `custom:${name.trim().toLowerCase()}::${unit.trim().toLowerCase()}`;
}

function uniqueStrings(values: ReadonlyArray<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter((value) => value.length > 0),
    ),
  );
}

function sumNullable(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
}

function vendorSnapshotCost(
  component: EstimateCatalogBundleComponent | null,
  type: 'cheapest' | 'preferred',
): number | null {
  if (!component) return null;
  const match = component.vendorSnapshot.find((vendor) =>
    type === 'cheapest' ? vendor.isCheapest : vendor.isPreferred,
  );
  return typeof match?.latestPriceCents === 'number' ? match.latestPriceCents : null;
}

function lowerCostVendor(
  existing: MaterialVendorRow,
  source: MaterialVendorSource,
  type: 'cheapest',
): string | null {
  void type;
  if (existing.cheapestCostCents === null) return source.cheapestVendorName ?? existing.cheapestVendorName;
  if (source.cheapestCostCents === null) return existing.cheapestVendorName;
  return source.cheapestCostCents < existing.cheapestCostCents
    ? source.cheapestVendorName ?? existing.cheapestVendorName
    : existing.cheapestVendorName;
}

function EmptyPickerState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="px-4 py-8 text-center">
      <p className="text-[12px] font-bold text-slate-700">{title}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{detail}</p>
    </div>
  );
}

function BundleTextInput({
  value,
  readOnly,
  onCommit,
  ariaLabel,
  className = '',
}: {
  value: string;
  readOnly: boolean;
  onCommit: (value: string) => void;
  ariaLabel: string;
  className?: string;
}) {
  if (readOnly) {
    return <span className={`block truncate font-semibold text-slate-700 ${className}`}>{value || '-'}</span>;
  }
  return (
    <input
      value={value}
      onChange={(event) => onCommit(event.currentTarget.value)}
      aria-label={ariaLabel}
      className={`h-7 w-full min-w-[90px] rounded-[5px] border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 ${className}`}
    />
  );
}

function BundleNumberInput({
  value,
  readOnly,
  format,
  parse,
  onCommit,
  ariaLabel,
  align = 'left',
}: {
  value: number;
  readOnly: boolean;
  format: (value: number) => string;
  parse: (input: string) => number | null;
  onCommit: (value: number) => void;
  ariaLabel: string;
  align?: 'left' | 'right';
}) {
  const [raw, setRaw] = useState(() => format(value));
  useEffect(() => {
    setRaw(format(value));
  }, [format, value]);

  if (readOnly) {
    return <span className="tabular-nums text-slate-700">{format(value)}</span>;
  }
  return (
    <input
      value={raw}
      onChange={(event) => setRaw(event.currentTarget.value)}
      onBlur={() => {
        const parsed = parse(raw);
        if (parsed === null) {
          setRaw(format(value));
        } else {
          onCommit(parsed);
          setRaw(format(parsed));
        }
      }}
      aria-label={ariaLabel}
      className={`h-7 w-full min-w-[74px] rounded-[5px] border border-slate-200 bg-white px-2 text-[11px] font-semibold tabular-nums text-slate-700 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 ${align === 'right' ? 'text-right' : ''}`}
    />
  );
}

function editableBundleComponents(row: EstimateCatalogPickerRow, lineMeta: LineInternalMeta | null): EditableBundleComponent[] {
  if (lineMeta?.bundleComponents) return lineMeta.bundleComponents;
  return (row.bundleComponents ?? []).map(componentToEditable);
}

function parseLineInternalMeta(value: string | null): LineInternalMeta | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<LineInternalMeta & BundleOverrideDoc>;
    if (parsed.__estimateLineMetaV1 === true) {
      return {
        __estimateLineMetaV1: true,
        bundleComponents: Array.isArray(parsed.bundleComponents)
          ? parsed.bundleComponents.map(normalizeEditableBundleComponent)
          : undefined,
        measurement: typeof parsed.measurement === 'string' ? parsed.measurement : undefined,
        taxEnabled: typeof parsed.taxEnabled === 'boolean' ? parsed.taxEnabled : undefined,
        unitLabelOverride: typeof parsed.unitLabelOverride === 'string' ? parsed.unitLabelOverride : undefined,
        materialVendorOverrides: isStringRecord(parsed.materialVendorOverrides)
          ? parsed.materialVendorOverrides
          : undefined,
        legacyInternalNotes: typeof parsed.legacyInternalNotes === 'string' ? parsed.legacyInternalNotes : undefined,
      };
    }
    if (parsed.__estimateBundleOverridesV1 === true && Array.isArray(parsed.components)) {
      return {
        __estimateLineMetaV1: true,
        bundleComponents: parsed.components.map(normalizeEditableBundleComponent),
      };
    }
    return null;
  } catch {
    return null;
  }
}

function serializeLineInternalMeta(
  currentValue: string | null,
  patch: Partial<Omit<LineInternalMeta, '__estimateLineMetaV1'>>,
): string {
  const current = parseLineInternalMeta(currentValue);
  const legacyInternalNotes = current?.legacyInternalNotes ?? (
    currentValue && current === null && !currentValue.trim().startsWith('{') ? currentValue : undefined
  );
  return JSON.stringify({
    __estimateLineMetaV1: true,
    ...current,
    legacyInternalNotes,
    ...patch,
  } satisfies LineInternalMeta);
}

function normalizeEditableBundleComponent(component: Partial<EditableBundleComponent>): EditableBundleComponent {
  return {
    componentName: String(component.componentName ?? ''),
    category: String(component.category ?? ''),
    qtyMilli: safeInt(component.qtyMilli),
    unitLabel: String(component.unitLabel ?? ''),
    totalCostCents: safeInt(component.totalCostCents),
    totalSellCents: safeInt(component.totalSellCents),
    selectedVendorName: String(component.selectedVendorName ?? ''),
    preferredVendorName: String(component.preferredVendorName ?? ''),
    cheapestVendorName: String(component.cheapestVendorName ?? ''),
    vendorPricingText: String(component.vendorPricingText ?? ''),
  };
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === 'string')
  );
}

function parseSqFtMeasurementMilli(value: string): number | null {
  const normalized = value
    .toLowerCase()
    .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/g, (match) => {
      const words: Record<string, string> = {
        one: '1',
        two: '2',
        three: '3',
        four: '4',
        five: '5',
        six: '6',
        seven: '7',
        eight: '8',
        nine: '9',
        ten: '10',
        eleven: '11',
        twelve: '12',
      };
      return words[match] ?? match;
    });
  const numbers = normalized.match(/\d+(?:\.\d+)?/g)?.map(Number).filter(Number.isFinite) ?? [];
  if (numbers.length === 0) return null;
  const first = numbers[0];
  if (first === undefined) return null;
  const squareFeet = numbers.length === 1 ? first : first * (numbers[1] ?? 1);
  return squareFeet > 0 ? Math.round(squareFeet * 1000) : null;
}

function parseBundleOverrideDoc(value: string | null): BundleOverrideDoc | null {
  const parsed = parseLineInternalMeta(value);
  if (!parsed?.bundleComponents) return null;
  return {
    __estimateBundleOverridesV1: true,
    components: parsed.bundleComponents,
  };
}

function legacyParseBundleOverrideDoc(value: string | null): BundleOverrideDoc | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<BundleOverrideDoc>;
    if (parsed.__estimateBundleOverridesV1 !== true || !Array.isArray(parsed.components)) {
      return null;
    }
    return {
      __estimateBundleOverridesV1: true,
      components: parsed.components.map(normalizeEditableBundleComponent),
    };
  } catch {
    return null;
  }
}

function componentToEditable(component: EstimateCatalogBundleComponent): EditableBundleComponent {
  return {
    componentName: component.componentName,
    category: component.categories[0] ?? kindLabel(component.componentType),
    qtyMilli: component.quantityMilli,
    unitLabel: component.customUnitLabel ?? component.unit.toLowerCase().replace('_', ' '),
    totalCostCents: component.totalCostCents,
    totalSellCents: component.totalSellCents,
    selectedVendorName: component.selectedVendorName ?? component.preferredVendorName ?? 'In-house',
    preferredVendorName: component.preferredVendorName ?? '',
    cheapestVendorName: component.cheapestVendorName ?? 'In-house',
    vendorPricingText:
      component.vendorSnapshot.length === 0
        ? 'No vendor pricing'
        : component.vendorSnapshot
            .map((vendor) => `${vendor.vendorName ?? 'Vendor'}${vendor.latestPriceCents != null ? ` ${formatMoney(vendor.latestPriceCents)}` : ''}${vendor.isPreferred ? ' preferred' : vendor.isCheapest ? ' cheapest' : ''}`)
            .join(' · '),
  };
}

function safeInt(value: unknown): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Math.max(0, Math.round(numberValue)) : 0;
}

function buildVehicleRows(vehicleLibrary: EditorBootstrap['vehicleLibrary']): VehiclePickerRow[] {
  return vehicleLibrary.flatMap((vehicle) => {
    const vehicleName = [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean).join(' ');
    const areas = [
      { id: 'total', label: 'Total wrap area', value: vehicle.totalApproxWrapSqFt },
      { id: 'side', label: 'Side area', value: vehicle.sideApproxSqFt },
      { id: 'roof', label: 'Roof area', value: vehicle.roofApproxSqFt },
      { id: 'hood', label: 'Hood area', value: vehicle.hoodApproxSqFt },
      { id: 'rear', label: 'Rear area', value: vehicle.rearApproxSqFt },
      { id: 'front', label: 'Front area', value: vehicle.frontApproxSqFt },
    ];
    return areas
      .filter((area) => typeof area.value === 'number' && Number.isFinite(area.value) && area.value > 0)
      .map((area) => ({
        id: `${vehicle.id}-${area.id}`,
        name: `${vehicleName} ${area.label}`,
        detail: `${area.value} sq ft · ${vehicle.bodyStyle ?? vehicle.vehicleType ?? 'Vehicle'}`,
        qtyMilli: Math.round((area.value ?? 0) * 1000),
      }));
  });
}

function isEmptyLine(line: DraftLine): boolean {
  return !line.catalogItemId && line.description.trim().length === 0 && line.unitCostCents === 0;
}

function unitLabel(row: EstimateCatalogPickerRow | null, kind: EstimateLineKind): string {
  if (row?.customUnitLabel) return row.customUnitLabel;
  switch (row?.catalogUnit) {
    case 'SQ_FT':
      return 'Sq ft';
    case 'HOUR':
      return 'Hrs';
    case 'ROLL':
      return 'Roll';
    case 'SHEET':
      return 'Sheet';
    case 'LINEAR_FT':
      return 'Lin ft';
    case 'CUSTOM':
      return 'Custom';
    case 'EACH':
      return 'Each';
    default:
      return kind === EstimateLineKind.LABOR || kind === EstimateLineKind.INSTALL ? 'Hrs' : 'Each';
  }
}
