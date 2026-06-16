'use client';

import { useMemo } from 'react';
import { EstimateLineKind } from '@bvisible/db';
import { CellInput, NumericCell } from '@/components/grid/cell-input';
import { FinalizedReadOnlyChip } from '@/components/estimate/finalized-read-only-chip';
import {
  formatMoney,
  formatQty,
  parseMoney,
  parseQty,
  kindLabel,
} from '@/lib/estimate/format';
import { makeGridKeyHandler } from '@/lib/keyboard/grid-nav';
import { SectionCard, SectionHeading, IconRows } from '@/components/estimate/estimate-surface';
import type { DraftLine } from './editor';
import type { Action } from './editor';

const GRID_NAME = 'estimate-lines';

const KIND_OPTIONS: ReadonlyArray<EstimateLineKind> = [
  EstimateLineKind.MATERIAL,
  EstimateLineKind.MACHINE,
  EstimateLineKind.LABOR,
  EstimateLineKind.DESIGN,
  EstimateLineKind.INSTALL,
  EstimateLineKind.MISC,
];

const QUICK_ADD_OPTIONS: ReadonlyArray<EstimateLineKind> = [
  EstimateLineKind.MATERIAL,
  EstimateLineKind.LABOR,
  EstimateLineKind.MACHINE,
  EstimateLineKind.INSTALL,
  EstimateLineKind.MISC,
];

const KIND_TONE: Record<EstimateLineKind, string> = {
  MATERIAL: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  MACHINE: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  LABOR: 'bg-blue-50 text-blue-700 ring-blue-200',
  DESIGN: 'bg-violet-50 text-violet-700 ring-violet-200',
  INSTALL: 'bg-orange-50 text-orange-700 ring-orange-200',
  MISC: 'bg-slate-100 text-slate-600 ring-slate-200',
};

const KIND_UNIT: Record<EstimateLineKind, string> = {
  MATERIAL: 'Each',
  MACHINE: 'Each',
  LABOR: 'Hours',
  DESIGN: 'Each',
  INSTALL: 'Hours',
  MISC: 'Each',
};

interface LineGridProps {
  lines: ReadonlyArray<DraftLine>;
  machines: ReadonlyArray<{ id: string; name: string; ratePerHourCents: number }>;
  lineCosts: Record<string, number>;
  multiplierMilli: number;
  readOnly?: boolean;
  /** MATERIAL rows report id; other kinds pass null so the intel rail resets. */
  onVendorIntelLineFocus?: (lineId: string | null) => void;
  /** Any focused line — drives catalog Apply target without touching vendor OCR intel rules. */
  onAnyLineFocus?: (lineId: string) => void;
  dispatch: React.Dispatch<Action>;
}

export function LineGrid({
  lines,
  machines,
  lineCosts,
  multiplierMilli,
  readOnly = false,
  onVendorIntelLineFocus,
  onAnyLineFocus,
  dispatch,
}: LineGridProps) {
  const machinesById = useMemo(
    () => new Map(machines.map((m) => [m.id, m])),
    [machines]
  );

  const onKeyDown = useMemo(
    () =>
      readOnly
        ? undefined
        : makeGridKeyHandler({
            gridName: GRID_NAME,
            onAppendRow: () => {
              const last = lines[lines.length - 1];
              dispatch({
                type: 'add-line',
                kind: last?.kind ?? EstimateLineKind.MATERIAL,
              });
            },
          }),
    [lines, dispatch, readOnly]
  );

  return (
    <SectionCard id="estimate-line-grid" className="overflow-hidden">
      <div className="border-b border-slate-100 px-5 py-4">
        <SectionHeading
          icon={<IconRows />}
          title="Line items"
          badge={readOnly ? <FinalizedReadOnlyChip /> : null}
          action={
            !readOnly ? (
              <>
                <a
                  href="#estimate-tools"
                  className="inline-flex items-center justify-center gap-1.5 rounded-[10px] px-3 py-2 text-[12px] font-bold text-blue-700 transition hover:bg-blue-50"
                >
                  <span aria-hidden>+</span>
                  Add from Catalog
                </a>
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded-[10px] border border-slate-200 bg-white px-3 py-2 text-[12px] font-bold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
                  title="Row actions are available on each line."
                >
                  Actions
                  <span aria-hidden className="ml-1 text-slate-400">⌄</span>
                </button>
              </>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500">
                {lines.length} {lines.length === 1 ? 'row' : 'rows'} · locked
              </span>
            )
          }
        />
      </div>

      <div onKeyDown={onKeyDown}>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/50 text-left text-[10px] font-bold uppercase tracking-[0.11em] text-slate-400">
                <th className="w-[7%] px-4 py-3">
                  <span className="sr-only">Select</span>
                </th>
                <th className="w-[30%] px-3 py-3">Description</th>
                <th className="w-[12%] px-3 py-3">Type</th>
                <th className="w-[8%] px-3 py-3 text-right">Qty</th>
                <th className="w-[10%] px-3 py-3 text-right">Unit</th>
                <th className="w-[11%] px-3 py-3 text-right">Cost</th>
                <th className="w-[11%] px-3 py-3 text-right">Sell</th>
                <th className="w-[8%] px-3 py-3 text-right">Margin</th>
                {!readOnly ? (
                  <th className="w-[3%] px-4 py-3 text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {lines.map((line, idx) => {
                const cost = lineCosts[line.id] ?? 0;
                const sell = Math.round((cost * multiplierMilli) / 1000);
                const margin = sell > 0 ? Math.round(((sell - cost) / sell) * 1000) / 10 : null;
                const machineName = line.machineId
                  ? machinesById.get(line.machineId)?.name ?? '—'
                  : null;
                const reportIntelFocus = () =>
                  onVendorIntelLineFocus?.(
                    line.kind === EstimateLineKind.MATERIAL ? line.id : null,
                  );
                const reportLineFocus = () => onAnyLineFocus?.(line.id);
                const reportBoth = () => {
                  reportIntelFocus();
                  reportLineFocus();
                };
                return (
                  <tr
                    key={line.id}
                    className={`group border-b border-slate-100 last:border-b-0 transition-colors ${
                      readOnly ? '' : 'hover:bg-blue-50/30'
                    }`}
                  >
                    <td className="px-4 py-3 align-middle">
                      <div className="flex items-center gap-2 text-slate-300">
                        {!readOnly ? (
                          <span className="cursor-grab text-[17px] leading-none" aria-hidden>
                            ⋮⋮
                          </span>
                        ) : null}
                        <span className="grid h-4 w-4 place-items-center rounded-[4px] border border-slate-200 bg-white" />
                      </div>
                    </td>
                    <td className="px-3 py-3 align-middle">
                      {readOnly ? (
                        <span className="block px-1 text-[13px] text-slate-800">
                          {line.description}
                        </span>
                      ) : (
                        <CellInput
                          value={line.description}
                          onChange={(v) =>
                            dispatch({
                              type: 'set-line',
                              id: line.id,
                              patch: { description: v },
                            })
                          }
                          onCellFocus={reportBoth}
                          ariaLabel={`Row ${idx + 1} description`}
                          cellRow={idx}
                          cellCol="description"
                          cellGrid={GRID_NAME}
                          maxLength={240}
                          placeholder="What this line is for"
                        />
                      )}
                      {line.kind === EstimateLineKind.MACHINE && machineName ? (
                        <span className="mt-1 block px-1 text-[11px] text-slate-400">{machineName}</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 align-middle">
                      {readOnly ? (
                        <span
                          className={`inline-flex items-center rounded-md px-2 py-1 text-[11px] font-semibold ring-1 ring-inset ${KIND_TONE[line.kind]}`}
                        >
                          {kindLabel(line.kind)}
                        </span>
                      ) : (
                        <select
                          value={line.kind}
                          onFocus={reportBoth}
                          onChange={(e) =>
                            dispatch({
                              type: 'set-line',
                              id: line.id,
                              patch: {
                                kind: e.currentTarget.value as EstimateLineKind,
                                machineId:
                                  e.currentTarget.value === EstimateLineKind.MACHINE
                                    ? line.machineId
                                    : null,
                              },
                            })
                          }
                          className={`max-w-[92px] cursor-pointer appearance-none rounded-md px-2 py-1 text-[11px] font-semibold outline-none ring-1 ring-inset focus:ring-2 focus:ring-blue-500 ${KIND_TONE[line.kind]}`}
                        >
                          {KIND_OPTIONS.map((k) => (
                            <option key={k} value={k} className="bg-white text-slate-700">
                              {kindLabel(k)}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className="px-3 py-3 align-middle text-right tabular-nums text-slate-700">
                      {readOnly ? (
                        formatQty(line.qtyMilli)
                      ) : (
                        <NumericCell
                          value={line.qtyMilli}
                          onCommit={(v) =>
                            dispatch({
                              type: 'set-line',
                              id: line.id,
                              patch: { qtyMilli: v },
                            })
                          }
                          onCellFocus={reportBoth}
                          format={formatQty}
                          parse={parseQty}
                          ariaLabel={`Row ${idx + 1} quantity`}
                          cellRow={idx}
                          cellCol="qty"
                          cellGrid={GRID_NAME}
                        />
                      )}
                    </td>
                    <td className="px-3 py-3 align-middle text-right text-[12.5px] text-slate-700">
                      {KIND_UNIT[line.kind]}
                    </td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums text-slate-900">
                      {readOnly ? (
                        formatMoney(cost)
                      ) : (
                        <NumericCell
                          value={cost}
                          onCommit={(v) => {
                            const qty = line.qtyMilli > 0 ? line.qtyMilli : 1000;
                            dispatch({
                              type: 'set-line',
                              id: line.id,
                              patch: { unitCostCents: Math.round((v * 1000) / qty) },
                            });
                          }}
                          format={formatMoney}
                          parse={parseMoney}
                          ariaLabel={`Row ${idx + 1} total cost`}
                          cellRow={idx}
                          cellCol="cost"
                          cellGrid={GRID_NAME}
                          onCellFocus={reportBoth}
                        />
                      )}
                    </td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums text-slate-900">
                      {formatMoney(sell)}
                    </td>
                    <td className="px-3 py-3 text-right font-semibold tabular-nums text-emerald-600">
                      {margin == null ? '—' : `${margin.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`}
                    </td>
                    {!readOnly ? (
                      <td className="px-4 py-3 text-right">
                        <details className="relative inline-block text-left">
                          <summary className="flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-lg text-[15px] font-bold leading-none text-slate-300 transition hover:bg-slate-50 hover:text-slate-500 marker:content-none [&::-webkit-details-marker]:hidden">
                            ...
                          </summary>
                          <div className="absolute right-0 z-10 mt-1 flex w-32 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-left shadow-lg">
                            <button
                              type="button"
                              onClick={() => dispatch({ type: 'move-line', id: line.id, dir: -1 })}
                              disabled={idx === 0}
                              className="px-3 py-2 text-[12px] font-medium text-slate-600 hover:bg-slate-50 disabled:text-slate-300"
                            >
                              Move up
                            </button>
                            <button
                              type="button"
                              onClick={() => dispatch({ type: 'move-line', id: line.id, dir: 1 })}
                              disabled={idx === lines.length - 1}
                              className="px-3 py-2 text-[12px] font-medium text-slate-600 hover:bg-slate-50 disabled:text-slate-300"
                            >
                              Move down
                            </button>
                            <button
                              type="button"
                              onClick={() => dispatch({ type: 'remove-line', id: line.id })}
                              className="px-3 py-2 text-[12px] font-medium text-rose-600 hover:bg-rose-50"
                            >
                              Remove
                            </button>
                          </div>
                        </details>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={readOnly ? 8 : 9} className="px-4 py-4">
                    <div className="mx-auto flex max-w-3xl flex-col gap-3 rounded-[12px] border border-dashed border-slate-200 bg-white px-4 py-3 text-left sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="min-w-0">
                          <p className="text-[14px] font-semibold tracking-tight text-slate-900">
                            Start building the estimate
                          </p>
                      {readOnly ? (
                        <p className="mt-1 text-[13px] leading-relaxed text-slate-500">
                          This finalized estimate has no lines on record.
                        </p>
                      ) : (
                        <>
                          <p className="mt-1 max-w-md text-[13px] leading-relaxed text-slate-500">
                            Add material, labor, machine time, install, or misc charges.
                          </p>
                        </>
                      )}
                        </div>
                      </div>
                      {!readOnly ? (
                        <div className="flex shrink-0 flex-wrap gap-1.5 sm:justify-end">
                          {KIND_OPTIONS.map((k) => (
                            <button
                              key={k}
                              type="button"
                              onClick={() => dispatch({ type: 'add-line', kind: k })}
                              className="inline-flex items-center justify-center gap-1.5 rounded-[9px] border border-slate-200 bg-white px-2.5 py-1.5 text-[12px] font-semibold text-slate-700 shadow-sm transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                            >
                              <span className="text-[13px] leading-none">+</span>
                              {kindLabel(k)}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {!readOnly && lines.length > 0 ? (
        <div className="grid grid-cols-2 border-t border-slate-100 bg-white sm:grid-cols-5">
          {QUICK_ADD_OPTIONS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => dispatch({ type: 'add-line', kind: k })}
              className="inline-flex items-center justify-center gap-2 border-r border-slate-100 px-3 py-4 text-[12px] font-semibold text-slate-600 transition last:border-r-0 hover:bg-blue-50 hover:text-blue-700"
            >
              <QuickAddIcon kind={k} />
              {kindLabel(k)}
            </button>
          ))}
        </div>
      ) : null}
    </SectionCard>
  );
}

function QuickAddIcon({ kind }: { kind: EstimateLineKind }) {
  const tone =
    kind === EstimateLineKind.MATERIAL
      ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
      : kind === EstimateLineKind.LABOR
        ? 'bg-blue-50 text-blue-700 ring-blue-200'
        : kind === EstimateLineKind.MACHINE
          ? 'bg-indigo-50 text-indigo-700 ring-indigo-200'
          : kind === EstimateLineKind.INSTALL
            ? 'bg-orange-50 text-orange-700 ring-orange-200'
            : 'bg-slate-50 text-slate-600 ring-slate-200';
  const letter =
    kind === EstimateLineKind.MATERIAL
      ? 'M'
      : kind === EstimateLineKind.LABOR
        ? 'L'
        : kind === EstimateLineKind.MACHINE
          ? 'C'
          : kind === EstimateLineKind.INSTALL
            ? 'I'
            : 'X';
  return (
    <span
      aria-hidden
      className={`grid h-5 w-5 place-items-center rounded-md text-[10px] font-bold ring-1 ring-inset ${tone}`}
    >
      {letter}
    </span>
  );
}
