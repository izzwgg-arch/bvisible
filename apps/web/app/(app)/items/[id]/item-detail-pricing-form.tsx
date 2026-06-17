'use client';

import { useState } from 'react';
import { EstimateLineKind, ShopCatalogUnit } from '@bvisible/db';
import { formatQty } from '@/lib/estimate/format';
import { kindLabel } from '@/lib/estimate/format';
import { updateShopMaterialItemAttributesAction } from '../actions';

const KINDS: EstimateLineKind[] = [
  EstimateLineKind.MATERIAL,
  EstimateLineKind.LABOR,
  EstimateLineKind.MACHINE,
  EstimateLineKind.DESIGN,
  EstimateLineKind.INSTALL,
  EstimateLineKind.MISC,
];

const UNITS: ShopCatalogUnit[] = [
  ShopCatalogUnit.EACH,
  ShopCatalogUnit.SHEET,
  ShopCatalogUnit.SQ_FT,
  ShopCatalogUnit.HOUR,
  ShopCatalogUnit.LINEAR_FT,
  ShopCatalogUnit.ROLL,
  ShopCatalogUnit.CUSTOM,
];

export function ItemDetailPricingForm({
  item,
  machines,
}: {
  item: {
    id: string;
    kind: EstimateLineKind;
    catalogUnit: ShopCatalogUnit;
    customUnitLabel: string | null;
    internalCostCents: number;
    markupPercentMilli: number;
    defaultSellPriceCents: number | null;
    defaultQtyMilli: number;
    machineId: string | null;
    notes: string | null;
  };
  machines: ReadonlyArray<{ id: string; name: string }>;
}) {
  const internalUsd = (item.internalCostCents / 100).toFixed(2);
  const markupPct =
    item.markupPercentMilli % 1000 === 0
      ? String(item.markupPercentMilli / 1000)
      : (item.markupPercentMilli / 1000).toFixed(3).replace(/\.?0+$/, '');
  const sellUsd =
    item.defaultSellPriceCents != null ? (item.defaultSellPriceCents / 100).toFixed(2) : '';

  const [selectedMachineId, setSelectedMachineId] = useState(item.machineId ?? '');
  const isNewMachine = selectedMachineId === '__new__';

  return (
    <form action={updateShopMaterialItemAttributesAction} className="mt-3 flex flex-col gap-3">
      <input type="hidden" name="id" value={item.id} />

      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-bv-muted)]">
          Line type
        </span>
        <select
          name="kind"
          defaultValue={item.kind}
          className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[13px]"
        >
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {kindLabel(k)}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-bv-muted)]">
          Unit
        </span>
        <select
          name="catalogUnit"
          defaultValue={item.catalogUnit}
          className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[13px]"
        >
          {UNITS.map((u) => (
            <option key={u} value={u}>
              {u.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-bv-muted)]">
          Custom unit label
        </span>
        <input
          name="customUnitLabel"
          defaultValue={item.customUnitLabel ?? ''}
          maxLength={40}
          className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[13px]"
        />
      </label>

      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-bv-muted)]">
          Default machine (MACHINE only)
        </span>
        <select
          name="machineId"
          value={selectedMachineId}
          onChange={(e) => setSelectedMachineId(e.target.value)}
          className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[13px]"
        >
          <option value="">— none —</option>
          {machines.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
          <option value="__new__">➕ Create new machine…</option>
        </select>
        {isNewMachine && (
          <div className="mt-2 grid gap-2 rounded-[10px] border border-blue-100 bg-blue-50/60 p-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] font-semibold uppercase tracking-wide text-blue-700">Machine name</span>
              <input
                name="machineName"
                required
                maxLength={120}
                placeholder="e.g. Roland 64 Printer"
                className="rounded-[7px] border border-blue-200 bg-white px-2.5 py-1.5 text-[13px] outline-none focus:border-blue-400"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10.5px] font-semibold uppercase tracking-wide text-blue-700">Hourly rate (USD)</span>
              <input
                name="machineRateUsd"
                defaultValue="0.00"
                inputMode="decimal"
                placeholder="0.00"
                className="rounded-[7px] border border-blue-200 bg-white px-2.5 py-1.5 text-[13px] outline-none focus:border-blue-400"
              />
            </label>
          </div>
        )}
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-bv-muted)]">
          Internal unit cost (USD)
        </span>
        <input
          name="internalCostUsd"
          required
          defaultValue={internalUsd}
          inputMode="decimal"
          className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[13px]"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-bv-muted)]">
          Markup %
        </span>
        <input
          name="markupPercent"
          defaultValue={markupPct}
          placeholder="200"
          inputMode="decimal"
          className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[13px]"
        />
        <p className="text-[11px] leading-snug text-[var(--color-bv-muted)]">
          Percent above internal cost for catalog sell hints (200 ≈ triple sell vs cost). Use 0 for none. Estimate totals still use the line grid × estimate multiplier.
        </p>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-bv-muted)]">
          Default sell override (USD, optional)
        </span>
        <input
          name="defaultSellUsd"
          defaultValue={sellUsd}
          placeholder="Blank = cost + markup"
          inputMode="decimal"
          className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[13px]"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-bv-muted)]">
          Default qty ({formatQty(item.defaultQtyMilli)} today)
        </span>
        <input
          name="defaultQty"
          required
          defaultValue={formatQty(item.defaultQtyMilli)}
          inputMode="decimal"
          className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[13px]"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-bv-muted)]">
          Notes
        </span>
        <textarea
          name="notes"
          defaultValue={item.notes ?? ''}
          rows={3}
          maxLength={2000}
          className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[13px]"
        />
      </label>

      <button
        type="submit"
        className="rounded-[8px] bg-[var(--color-bv-accent)] px-3 py-2 text-[13px] font-medium text-[var(--color-bv-accent-foreground)]"
      >
        Save pricing & details
      </button>
    </form>
  );
}
