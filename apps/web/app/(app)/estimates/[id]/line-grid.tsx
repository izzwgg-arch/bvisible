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

const KIND_TONE: Record<EstimateLineKind, string> = {
  MATERIAL: 'bg-blue-50 text-blue-700 ring-blue-200',
  MACHINE: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  LABOR: 'bg-amber-50 text-amber-700 ring-amber-200',
  DESIGN: 'bg-violet-50 text-violet-700 ring-violet-200',
  INSTALL: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  MISC: 'bg-slate-100 text-slate-600 ring-slate-200',
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
          subtitle="The work that makes up this estimate. Costs roll up into your totals automatically."
          badge={readOnly ? <FinalizedReadOnlyChip /> : null}
          action={
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500">
              {lines.length} {lines.length === 1 ? 'row' : 'rows'}
              {readOnly ? (
                <span className="text-slate-400">· locked</span>
              ) : (
                <span className="hidden font-normal text-slate-400 sm:inline">
                  · Enter ↓ · Shift+Enter ↑
                </span>
              )}
            </span>
          }
        />
      </div>

      <div onKeyDown={onKeyDown}>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/60 text-left text-[10.5px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                <th className="w-[8%] px-4 py-2.5">Type</th>
                <th className="w-[30%] px-3 py-2.5">Description</th>
                <th className="w-[13%] px-3 py-2.5">Machine</th>
                <th className="w-[7%] px-3 py-2.5 text-right">Qty</th>
                <th className="w-[10%] px-3 py-2.5 text-right">Unit</th>
                <th className="w-[10%] px-3 py-2.5 text-right">Cost</th>
                <th className="w-[10%] px-3 py-2.5 text-right">Sell</th>
                <th className="w-[8%] px-3 py-2.5 text-right">Margin</th>
                {!readOnly ? (
                  <th className="w-[4%] px-4 py-2.5 text-right">Actions</th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {lines.map((line, idx) => {
                const cost = lineCosts[line.id] ?? 0;
                const sell = Math.round((cost * multiplierMilli) / 1000);
                const margin = sell > 0 ? Math.round(((sell - cost) / sell) * 1000) / 10 : null;
                const isMachine = line.kind === EstimateLineKind.MACHINE;
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
                    <td className="px-4 py-2 align-middle">
                      {readOnly ? (
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide ring-1 ring-inset ${KIND_TONE[line.kind]}`}
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
                          className={`w-full cursor-pointer rounded-md px-2 py-1 text-[11px] font-semibold uppercase tracking-wide outline-none ring-1 ring-inset focus:ring-2 focus:ring-blue-500 ${KIND_TONE[line.kind]}`}
                        >
                          {KIND_OPTIONS.map((k) => (
                            <option key={k} value={k} className="bg-white text-slate-700">
                              {kindLabel(k)}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td className="px-3 py-2 align-middle">
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
                    </td>
                    <td className="px-3 py-2 align-middle">
                      {isMachine ? (
                        readOnly ? (
                          <span className="block px-1 text-[12.5px] text-slate-500">
                            {machineName ?? '—'}
                          </span>
                        ) : (
                          <select
                            value={line.machineId ?? ''}
                            onFocus={reportBoth}
                            onChange={(e) => {
                              const id = e.currentTarget.value || null;
                              const machine = id ? machinesById.get(id) ?? null : null;
                              dispatch({
                                type: 'pick-machine',
                                id: line.id,
                                machineId: id,
                                ratePerHourCents: machine?.ratePerHourCents ?? null,
                              });
                            }}
                            className="w-full rounded-md bg-transparent px-2 py-1.5 text-[12.5px] text-slate-600 outline-none focus:bg-white focus:ring-2 focus:ring-blue-500 focus:ring-inset"
                          >
                            <option value="">— pick —</option>
                            {machines.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name} · {formatMoney(m.ratePerHourCents)}/hr
                              </option>
                            ))}
                          </select>
                        )
                      ) : (
                        <span className="block px-1 py-1.5 text-[12.5px] text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 align-middle text-right tabular-nums text-slate-700">
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
                    <td className="px-3 py-2 align-middle text-right tabular-nums text-slate-700">
                      {readOnly ? (
                        formatMoney(line.unitCostCents)
                      ) : (
                        <NumericCell
                          value={line.unitCostCents}
                          onCommit={(v) =>
                            dispatch({
                              type: 'set-line',
                              id: line.id,
                              patch: { unitCostCents: v },
                            })
                          }
                          format={formatMoney}
                          parse={parseMoney}
                          ariaLabel={`Row ${idx + 1} unit cost`}
                          cellRow={idx}
                          cellCol="unit"
                          cellGrid={GRID_NAME}
                          onCellFocus={reportBoth}
                        />
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">
                      {formatMoney(cost)}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">
                      {formatMoney(sell)}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-emerald-700">
                      {margin == null ? '—' : `${margin.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`}
                    </td>
                    {!readOnly ? (
                      <td className="px-4 py-2 text-right">
                        <div className="inline-flex items-center gap-1 opacity-60 transition-opacity group-hover:opacity-100">
                          <RowBtn
                            label="Move up"
                            symbol="↑"
                            onClick={() => dispatch({ type: 'move-line', id: line.id, dir: -1 })}
                            disabled={idx === 0}
                          />
                          <RowBtn
                            label="Move down"
                            symbol="↓"
                            onClick={() => dispatch({ type: 'move-line', id: line.id, dir: 1 })}
                            disabled={idx === lines.length - 1}
                          />
                          <RowBtn
                            label="Remove row"
                            symbol="×"
                            danger
                            onClick={() => dispatch({ type: 'remove-line', id: line.id })}
                          />
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={readOnly ? 8 : 9} className="px-4 py-4">
                    <div className="mx-auto flex max-w-3xl flex-col gap-4 rounded-[14px] border border-dashed border-slate-200 bg-slate-50/60 px-4 py-4 text-left sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-start gap-3">
                        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white text-blue-600 shadow-sm ring-1 ring-inset ring-blue-100">
                          <IconRows width={19} height={19} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[16px] font-semibold tracking-tight text-slate-900">
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
                        <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
                          {KIND_OPTIONS.map((k) => (
                            <button
                              key={k}
                              type="button"
                              onClick={() => dispatch({ type: 'add-line', kind: k })}
                              className="inline-flex items-center justify-center gap-1.5 rounded-[10px] border border-blue-200 bg-white px-3 py-2 text-[12px] font-semibold text-blue-700 shadow-sm transition hover:border-blue-300 hover:bg-blue-50"
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
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50/50 px-4 py-3">
          <span className="mr-1 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-slate-400">
            Add line
          </span>
          {KIND_OPTIONS.map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => dispatch({ type: 'add-line', kind: k })}
              className="inline-flex items-center justify-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-600 shadow-sm transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
            >
              <span className="text-[13px] leading-none text-blue-500">+</span>
              {kindLabel(k)}
            </button>
          ))}
        </div>
      ) : null}
    </SectionCard>
  );
}

function RowBtn({
  label,
  symbol,
  onClick,
  disabled,
  danger,
}: {
  label: string;
  symbol: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-lg border text-[13px] transition disabled:cursor-not-allowed disabled:opacity-30 ${
        danger
          ? 'border-slate-200 bg-white text-slate-400 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600'
          : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-800'
      }`}
    >
      {symbol}
    </button>
  );
}
