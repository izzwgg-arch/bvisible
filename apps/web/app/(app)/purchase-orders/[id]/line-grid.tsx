'use client';

import { useMemo } from 'react';
import { POLineKind } from '@bvisible/db';
import { CellInput, NumericCell } from '@/components/grid/cell-input';
import {
  formatMoney,
  formatQty,
  parseMoney,
  parseQty,
} from '@/lib/estimate/format';
import { makeGridKeyHandler } from '@/lib/keyboard/grid-nav';
import type { PoDraftLine, PoEditorAction } from './editor';

const GRID_NAME = 'po-lines';

const KIND_OPTIONS: ReadonlyArray<POLineKind> = [
  POLineKind.MATERIAL,
  POLineKind.MACHINE,
  POLineKind.LABOR,
  POLineKind.DESIGN,
  POLineKind.INSTALL,
  POLineKind.MISC,
];

function poKindLabel(k: POLineKind): string {
  switch (k) {
    case POLineKind.MATERIAL:
      return 'Material';
    case POLineKind.MACHINE:
      return 'Machine';
    case POLineKind.LABOR:
      return 'Labor';
    case POLineKind.DESIGN:
      return 'Design';
    case POLineKind.INSTALL:
      return 'Install';
    case POLineKind.MISC:
      return 'Misc';
  }
}

interface LineGridProps {
  lines: ReadonlyArray<PoDraftLine>;
  lineCosts: Record<string, number>;
  dispatch: React.Dispatch<PoEditorAction>;
}

export function PoLineGrid({ lines, lineCosts, dispatch }: LineGridProps) {
  const onKeyDown = useMemo(
    () =>
      makeGridKeyHandler({
        gridName: GRID_NAME,
        onAppendRow: () => {
          const last = lines[lines.length - 1];
          dispatch({
            type: 'add-line',
            kind: last?.kind ?? POLineKind.MATERIAL,
          });
        },
      }),
    [lines, dispatch]
  );

  return (
    <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] shadow-[var(--shadow-bv-card)]">
      <div className="flex items-center justify-between border-b border-[var(--color-bv-border)] px-5 py-3">
        <h2 className="text-[14.5px] font-semibold tracking-tight text-[var(--color-bv-text)]">
          Line items
        </h2>
        <span className="text-[11.5px] uppercase tracking-wider text-[var(--color-bv-muted)]">
          {lines.length} {lines.length === 1 ? 'row' : 'rows'} · Enter ↓ · Shift+Enter ↑
        </span>
      </div>

      <div onKeyDown={onKeyDown}>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--color-bv-border)] text-left text-[11.5px] uppercase tracking-wider text-[var(--color-bv-muted)]">
                <th className="px-3 py-2 font-medium w-[10%]">Kind</th>
                <th className="px-3 py-2 font-medium w-[42%]">Description</th>
                <th className="px-3 py-2 font-medium w-[10%] text-right">Qty</th>
                <th className="px-3 py-2 font-medium w-[14%] text-right">Unit cost</th>
                <th className="px-3 py-2 font-medium w-[14%] text-right">Cost</th>
                <th className="px-3 py-2 font-medium w-[10%] text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, idx) => {
                const cost = lineCosts[line.id] ?? 0;
                return (
                  <tr
                    key={line.id}
                    className="border-b border-[var(--color-bv-border)] last:border-b-0 hover:bg-[var(--color-bv-bg)]/40"
                  >
                    <td className="px-1 py-0.5 align-middle">
                      <select
                        value={line.kind}
                        onChange={(e) =>
                          dispatch({
                            type: 'set-line',
                            id: line.id,
                            patch: { kind: e.currentTarget.value as POLineKind },
                          })
                        }
                        className="w-full bg-transparent px-2 py-1.5 text-[12.5px] text-[var(--color-bv-text)] outline-none focus:bg-white focus:ring-1 focus:ring-[var(--color-bv-accent)] focus:ring-inset"
                      >
                        {KIND_OPTIONS.map((k) => (
                          <option key={k} value={k}>
                            {poKindLabel(k)}
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
                        ariaLabel={`Row ${idx + 1} description`}
                        cellRow={idx}
                        cellCol="description"
                        cellGrid={GRID_NAME}
                        maxLength={240}
                        placeholder="What you're ordering"
                      />
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
                          onClick={() =>
                            dispatch({ type: 'move-line', id: line.id, dir: -1 })
                          }
                          disabled={idx === 0}
                        />
                        <RowBtn
                          label="Move down"
                          symbol="↓"
                          onClick={() =>
                            dispatch({ type: 'move-line', id: line.id, dir: 1 })
                          }
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
                  <td colSpan={6} className="px-5 py-10 text-center text-[var(--color-bv-muted)]">
                    No lines yet. Add a row below to start.
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
            + {poKindLabel(k)}
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
