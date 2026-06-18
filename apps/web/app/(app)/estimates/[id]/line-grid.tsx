'use client';

import { useMemo } from 'react';
import { EstimateLineKind } from '@bvisible/db';
import { SelectControl } from '@/components/app/select-control';
import { CellInput, NumericCell } from '@/components/grid/cell-input';
import { FinalizedReadOnlyChip } from '@/components/estimate/finalized-read-only-chip';
import { formatMoney, formatQty, parseMoney, parseQty, kindLabel } from '@/lib/estimate/format';
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
  embedded?: boolean;
  customer?: { companyName: string; contactName: string | null };
  onVendorIntelLineFocus?: (lineId: string | null) => void;
  onAnyLineFocus?: (lineId: string) => void;
  dispatch: React.Dispatch<Action>;
}

export function LineGrid({
  lines,
  machines,
  lineCosts,
  multiplierMilli,
  readOnly = false,
  embedded = false,
  customer,
  onVendorIntelLineFocus,
  onAnyLineFocus,
  dispatch,
}: LineGridProps) {
  const machinesById = useMemo(() => new Map(machines.map((m) => [m.id, m])), [machines]);

  const onKeyDown = useMemo(
    () =>
      readOnly
        ? undefined
        : makeGridKeyHandler({
            gridName: GRID_NAME,
            onAppendRow: () => {
              const last = lines[lines.length - 1];
              dispatch({ type: 'add-line', kind: last?.kind ?? EstimateLineKind.MATERIAL });
            },
          }),
    [lines, dispatch, readOnly],
  );

  const content = (
    <div>
      <div className="border-b border-slate-100 px-4 py-3">
        <SectionHeading
          icon={<IconRows />}
          title="Line items"
          subtitle={
            customer ? (
              <span className="font-bold text-slate-700">
                {customer.companyName.replace(/^DEMO\s+/i, '')}
              </span>
            ) : null
          }
          badge={readOnly ? <FinalizedReadOnlyChip /> : null}
          action={
            readOnly ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500">
                {lines.length} {lines.length === 1 ? 'row' : 'rows'} - locked
              </span>
            ) : null
          }
        />
      </div>

      <div onKeyDown={onKeyDown}>
        <div className="overflow-visible">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-slate-100 bg-white text-left text-[9px] font-bold uppercase tracking-[0.11em] text-slate-400">
                <th className="w-[7%] px-3 py-2"><span className="sr-only">Select</span></th>
                <th className="w-[27%] px-2 py-2">Description</th>
                <th className="w-[15%] px-2 py-2">Type</th>
                <th className="w-[8%] px-2 py-2 text-right">Qty</th>
                <th className="w-[10%] px-2 py-2 text-right">Unit</th>
                <th className="w-[11%] px-2 py-2 text-right">Unit cost</th>
                <th className="w-[11%] px-2 py-2 text-right">Sell price</th>
                <th className="w-[8%] whitespace-nowrap px-2 py-2 text-right">Margin %</th>
                {!readOnly ? <th className="w-[3%] px-3 py-2 text-right"><span className="sr-only">Actions</span></th> : null}
              </tr>
            </thead>
            <tbody>
              {lines.map((line, idx) => {
                const cost = lineCosts[line.id] ?? 0;
                const sell = Math.round((cost * multiplierMilli) / 1000);
                const margin = sell > 0 ? Math.round(((sell - cost) / sell) * 1000) / 10 : null;
                const machineName = line.machineId ? machinesById.get(line.machineId)?.name ?? '-' : null;
                const reportIntelFocus = () => onVendorIntelLineFocus?.(line.kind === EstimateLineKind.MATERIAL ? line.id : null);
                const reportLineFocus = () => onAnyLineFocus?.(line.id);
                const reportBoth = () => {
                  reportIntelFocus();
                  reportLineFocus();
                };

                return (
                  <tr key={line.id} className={`group border-b border-slate-100 last:border-b-0 transition-colors ${readOnly ? '' : 'hover:bg-blue-50/40'}`}>
                    <td className="px-3 py-2 align-middle">
                      <div className="flex items-center gap-2 text-slate-300">
                        <span className="grid h-4 w-4 place-items-center rounded-[4px] border border-slate-200 bg-white" />
                      </div>
                    </td>
                    <td className="px-2 py-2 align-middle">
                      {readOnly ? (
                        <span className="block px-1 text-[13px] text-slate-800">{line.description}</span>
                      ) : (
                        <CellInput
                          value={line.description}
                          onChange={(v) => dispatch({ type: 'set-line', id: line.id, patch: { description: v } })}
                          onCellFocus={reportBoth}
                          ariaLabel={`Row ${idx + 1} description`}
                          cellRow={idx}
                          cellCol="description"
                          cellGrid={GRID_NAME}
                          maxLength={240}
                          placeholder="What this line is for"
                        />
                      )}
                      {line.kind === EstimateLineKind.MACHINE && machineName ? <span className="mt-1 block px-1 text-[11px] text-slate-400">{machineName}</span> : null}
                    </td>
                    <td className="px-2 py-2 align-middle">
                      {readOnly ? (
                        <span className={`inline-flex items-center rounded-md px-2 py-1 text-[11px] font-semibold ring-1 ring-inset ${KIND_TONE[line.kind]}`}>{kindLabel(line.kind)}</span>
                      ) : (
                        <SelectControl
                          value={line.kind}
                          onFocus={reportBoth}
                          onChange={(e) => dispatch({ type: 'set-line', id: line.id, patch: { kind: e.currentTarget.value as EstimateLineKind, machineId: e.currentTarget.value === EstimateLineKind.MACHINE ? line.machineId : null } })}
                          className={`min-h-0 w-auto min-w-[104px] rounded-full border-0 px-3 py-1.5 text-[11px] font-black shadow-none ring-1 ring-inset hover:bg-white focus:ring-2 [&>span:first-child]:tracking-[0.01em] [&>span:last-child]:h-5 [&>span:last-child]:w-5 [&>span:last-child]:bg-white/70 ${KIND_TONE[line.kind]}`}
                        >
                          {KIND_OPTIONS.map((k) => <option key={k} value={k} className="bg-white text-slate-700">{kindLabel(k)}</option>)}
                        </SelectControl>
                      )}
                    </td>
                    <td className="px-2 py-2 align-middle text-right tabular-nums text-slate-700">
                      {readOnly ? formatQty(line.qtyMilli) : <NumericCell value={line.qtyMilli} onCommit={(v) => dispatch({ type: 'set-line', id: line.id, patch: { qtyMilli: v } })} onCellFocus={reportBoth} format={formatQty} parse={parseQty} ariaLabel={`Row ${idx + 1} quantity`} cellRow={idx} cellCol="qty" cellGrid={GRID_NAME} />}
                    </td>
                    <td className="px-2 py-2 align-middle text-right text-[11px] text-slate-700">{KIND_UNIT[line.kind]}</td>
                    <td className="px-2 py-2 text-right font-semibold tabular-nums text-slate-900">
                      {readOnly ? formatMoney(cost) : <NumericCell value={cost} onCommit={(v) => { const qty = line.qtyMilli > 0 ? line.qtyMilli : 1000; dispatch({ type: 'set-line', id: line.id, patch: { unitCostCents: Math.round((v * 1000) / qty) } }); }} format={formatMoney} parse={parseMoney} ariaLabel={`Row ${idx + 1} total cost`} cellRow={idx} cellCol="cost" cellGrid={GRID_NAME} onCellFocus={reportBoth} />}
                    </td>
                    <td className="px-2 py-2 text-right font-semibold tabular-nums text-slate-900">{formatMoney(sell)}</td>
                    <td className="px-2 py-2 text-right font-semibold tabular-nums text-emerald-600">{margin == null ? '-' : `${margin.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`}</td>
                    {!readOnly ? (
                      <td className="relative overflow-visible px-3 py-2 text-right">
                        <details className="relative z-[100] inline-block text-left">
                          <summary className="flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-lg text-[15px] font-bold leading-none text-slate-300 transition hover:bg-slate-50 hover:text-slate-500 marker:content-none [&::-webkit-details-marker]:hidden">...</summary>
                          <div className="absolute right-0 top-full z-[9999] mt-1 flex w-32 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-left shadow-lg">
                            <button type="button" onClick={() => dispatch({ type: 'move-line', id: line.id, dir: -1 })} disabled={idx === 0} className="px-3 py-2 text-[12px] font-medium text-slate-600 hover:bg-slate-50 disabled:text-slate-300">Move up</button>
                            <button type="button" onClick={() => dispatch({ type: 'move-line', id: line.id, dir: 1 })} disabled={idx === lines.length - 1} className="px-3 py-2 text-[12px] font-medium text-slate-600 hover:bg-slate-50 disabled:text-slate-300">Move down</button>
                            <button type="button" onClick={() => dispatch({ type: 'remove-line', id: line.id })} className="px-3 py-2 text-[12px] font-medium text-rose-600 hover:bg-rose-50">Remove</button>
                          </div>
                        </details>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
              {lines.length === 0 ? (
                <tr><td colSpan={readOnly ? 8 : 9} className="px-4 py-6"><div className="rounded-[14px] border border-dashed border-blue-200 bg-blue-50/50 px-5 py-5 text-[13px] text-slate-500">{readOnly ? 'This finalized estimate has no lines on record.' : 'Focus the first row or use catalog tools to add estimate lines.'}</div></td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  if (embedded) return <div id="estimate-line-grid" className="px-5 py-5">{content}</div>;
  return <SectionCard id="estimate-line-grid" className="min-h-[350px] overflow-visible">{content}</SectionCard>;
}
