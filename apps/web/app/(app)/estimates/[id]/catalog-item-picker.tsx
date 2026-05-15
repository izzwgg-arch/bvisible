'use client';

import { useMemo, useState } from 'react';
import { EstimateLineKind } from '@bvisible/db';
import {
  buildLinePatchFromCatalogSelection,
  type EstimateCatalogPickerRow,
} from '@/lib/shop-material/apply-catalog-to-estimate-line';
import { sellPriceFromCostAndMarkup } from '@/lib/shop-material/markup';
import { formatMoney, formatQty, kindLabel } from '@/lib/estimate/format';
import type { Action, DraftLine } from './editor';

export function CatalogItemPicker({
  catalog,
  machines,
  activeLineId,
  lines,
  dispatch,
}: {
  catalog: ReadonlyArray<EstimateCatalogPickerRow>;
  machines: ReadonlyArray<{ id: string; name: string; ratePerHourCents: number }>;
  activeLineId: string | null;
  lines: ReadonlyArray<DraftLine>;
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
    if (!activeLineId) return;

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

  return (
    <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-4 shadow-[var(--shadow-bv-card)]">
      <h2 className="text-[13px] font-semibold tracking-tight text-[var(--color-bv-text)]">
        Catalog items
      </h2>
      <p className="mt-1 text-[12px] leading-snug text-[var(--color-bv-muted)]">
        Focus a line in the grid, search the catalog, then click <strong className="text-[var(--color-bv-text)]">Apply</strong> — nothing changes until you do (typing in cells is unaffected).
      </p>

      <div className="mt-3 space-y-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-bv-muted)]">
            Search
          </span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by name…"
            className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-bv-accent)]"
          />
        </label>

        <div className="rounded-[8px] border border-dashed border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[12px] text-[var(--color-bv-muted)]">
          {activeLine ? (
            <>
              Active row:{' '}
              <span className="font-medium text-[var(--color-bv-text)]">
                {kindLabel(activeLine.kind)}
              </span>{' '}
              · {activeLine.description.slice(0, 56)}
              {activeLine.description.length > 56 ? '…' : ''}
            </>
          ) : (
            <>Focus any cell on a line to choose a target row.</>
          )}
        </div>

        <div className="max-h-[280px] overflow-auto rounded-[8px] border border-[var(--color-bv-border)]">
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-[var(--color-bv-surface)] text-left text-[10px] uppercase tracking-wide text-[var(--color-bv-muted)]">
              <tr>
                <th className="px-2 py-2 font-medium">Item</th>
                <th className="px-2 py-2 font-medium">Type</th>
                <th className="px-2 py-2 font-medium text-right">Basis</th>
                <th className="px-2 py-2 font-medium text-right">Sell hint</th>
                <th className="px-2 py-2 font-medium text-right">Qty</th>
                <th className="px-2 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-[var(--color-bv-muted)]">
                    No catalog rows match.
                  </td>
                </tr>
              ) : (
                filtered.slice(0, 80).map((row) => {
                  const basisCents =
                    row.kind === EstimateLineKind.MATERIAL
                      ? (row.suggestedVendorCostCents ?? row.internalCostCents)
                      : buildLinePatchFromCatalogSelection({ row, machinesById }).unitCostCents;
                  const sellHint =
                    row.defaultSellPriceCents ??
                    sellPriceFromCostAndMarkup(basisCents, row.markupPercentMilli);
                  return (
                    <tr key={row.id} className="border-t border-[var(--color-bv-border)]">
                      <td className="px-2 py-2 align-top">
                        <div className="font-medium text-[var(--color-bv-text)]">{row.name}</div>
                      </td>
                      <td className="px-2 py-2 align-top text-[var(--color-bv-muted)]">
                        {kindLabel(row.kind)}
                      </td>
                      <td className="px-2 py-2 align-top text-right tabular-nums">
                        {formatMoney(basisCents)}
                      </td>
                      <td className="px-2 py-2 align-top text-right tabular-nums text-emerald-900">
                        {formatMoney(sellHint)}
                      </td>
                      <td className="px-2 py-2 align-top text-right tabular-nums">
                        {formatQty(row.defaultQtyMilli)}
                      </td>
                      <td className="px-2 py-2 align-top text-right">
                        <button
                          type="button"
                          disabled={!activeLineId}
                          onClick={() => applyRow(row)}
                          className="rounded-[6px] bg-[var(--color-bv-accent)] px-2 py-1 text-[11px] font-semibold text-[var(--color-bv-accent-foreground)] disabled:cursor-not-allowed disabled:opacity-40"
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
    </section>
  );
}
