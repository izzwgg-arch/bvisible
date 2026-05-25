'use client';

import { useMemo } from 'react';
import { EstimateLineKind } from '@bvisible/db';
import { CellInput, NumericCell } from '@/components/grid/cell-input';
import {
  formatMoney,
  formatQty,
  parseMoney,
  parseQty,
  kindLabel,
} from '@/lib/estimate/format';
import { makeGridKeyHandler } from '@/lib/keyboard/grid-nav';
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

interface LineGridProps {
  lines: ReadonlyArray<DraftLine>;
  machines: ReadonlyArray<{ id: string; name: string; ratePerHourCents: number }>;
  lineCosts: Record<string, number>;
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
      makeGridKeyHandler({
        gridName: GRID_NAME,
        onAppendRow: () => {
          // When the user presses Enter on the last row, append a row
          // of the same kind as the row they were on. The grid-nav
          // helper will focus into the new row on the next frame.
          const last = lines[lines.length - 1];
          dispatch({
            type: 'add-line',
            kind: last?.kind ?? EstimateLineKind.MATERIAL,
          });
        },
      }),
    [lines, dispatch]
  );

  return (
    <section
      id="estimate-line-grid"
      className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] shadow-[var(--shadow-bv-card)]"
    >
      <div className="flex items-center justify-between border-b border-[var(--color-bv-border)] px-5 py-3">
        <h2 className="text-[14.5px] font-semibold tracking-tight text-[var(--color-bv-text)]">
          Line items
        </h2>
        <span className="text-[11.5px] uppercase tracking-wider text-[var(--color-bv-muted)]">
          {lines.length} {lines.length === 1 ? 'row' : 'rows'} · Enter ↓ · Shift+Enter ↑
        </span>
      </div>

      {/*
        The keyboard handler lives on the table-wrapping div so a single
        listener serves every cell. Cells opt in by setting data-cell-row
        / data-cell-col / data-cell-grid="estimate-lines".
      */}
      <div onKeyDown={onKeyDown}>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--color-bv-border)] text-left text-[11.5px] uppercase tracking-wider text-[var(--color-bv-muted)]">
                <th className="px-3 py-2 font-medium w-[7%]">Kind</th>
                <th className="px-3 py-2 font-medium w-[33%]">Description</th>
                <th className="px-3 py-2 font-medium w-[14%]">Machine</th>
                <th className="px-3 py-2 font-medium w-[8%] text-right">Qty</th>
                <th className="px-3 py-2 font-medium w-[12%] text-right">Unit</th>
                <th className="px-3 py-2 font-medium w-[14%] text-right">Cost</th>
                <th className="px-3 py-2 font-medium w-[12%] text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, idx) => {
                const cost = lineCosts[line.id] ?? 0;
                const isMachine = line.kind === EstimateLineKind.MACHINE;
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
                    className="border-b border-[var(--color-bv-border)] last:border-b-0 hover:bg-[var(--color-bv-bg)]/40"
                  >
                    <td className="px-1 py-0.5 align-middle">
                      <select
                        value={line.kind}
                        onFocus={reportBoth}
                        onChange={(e) =>
                          dispatch({
                            type: 'set-line',
                            id: line.id,
                            patch: {
                              kind: e.currentTarget.value as EstimateLineKind,
                              // Switching kind clears the machine ref
                              // because it was a MACHINE-only field.
                              machineId:
                                e.currentTarget.value === EstimateLineKind.MACHINE
                                  ? line.machineId
                                  : null,
                            },
                          })
                        }
                        className="w-full bg-transparent px-2 py-1.5 text-[12.5px] text-[var(--color-bv-text)] outline-none focus:bg-white focus:ring-1 focus:ring-[var(--color-bv-accent)] focus:ring-inset"
                      >
                        {KIND_OPTIONS.map((k) => (
                          <option key={k} value={k}>
                            {kindLabel(k)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-1 py-0.5 align-middle">
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
                    </td>
                    <td className="px-1 py-0.5 align-middle">
                      {isMachine ? (
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
                          className="w-full bg-transparent px-2 py-1.5 text-[12.5px] text-[var(--color-bv-muted)] outline-none focus:bg-white focus:ring-1 focus:ring-[var(--color-bv-accent)] focus:ring-inset"
                        >
                          <option value="">— pick —</option>
                          {machines.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name} · {formatMoney(m.ratePerHourCents)}/hr
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="block px-2 py-1.5 text-[12.5px] text-[var(--color-bv-muted)]">
                          —
                        </span>
                      )}
                    </td>
                    <td className="px-1 py-0.5 align-middle">
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
                    </td>
                    <td className="px-1 py-0.5 align-middle">
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
                    </td>
                    <td className="px-3 py-1.5 text-right font-medium tabular-nums text-[var(--color-bv-text)]">
                      {formatMoney(cost)}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <div className="inline-flex items-center gap-1">
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
                          onClick={() => dispatch({ type: 'remove-line', id: line.id })}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-8">
                    <div className="mx-auto max-w-md rounded-[10px] border border-dashed border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-4 py-4 text-center">
                      <p className="text-[13px] font-medium text-[var(--color-bv-text)]">No line items yet</p>
                      <p className="mt-1 text-[12px] leading-snug text-[var(--color-bv-muted)]">
                        Click <strong className="text-[var(--color-bv-text)]">+ Material</strong> below, focus the row, then use <strong className="text-[var(--color-bv-text)]">Catalog items</strong> or <strong className="text-[var(--color-bv-text)]">Pricing helper</strong>.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-bv-border)] px-3 py-3">
        <span className="text-[11.5px] uppercase tracking-wider text-[var(--color-bv-muted)] mr-2">
          Add row
        </span>
        {KIND_OPTIONS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => dispatch({ type: 'add-line', kind: k })}
            className="inline-flex items-center justify-center rounded-[6px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-2.5 py-1 text-[12px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
          >
            + {kindLabel(k)}
          </button>
        ))}
      </div>
    </section>
  );
}

function RowBtn({
  label,
  symbol,
  onClick,
  disabled,
}: {
  label: string;
  symbol: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-6 w-6 items-center justify-center rounded-md border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] text-[12px] text-[var(--color-bv-muted)] hover:bg-[var(--color-bv-bg)] hover:text-[var(--color-bv-text)] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {symbol}
    </button>
  );
}
