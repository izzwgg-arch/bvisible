'use client';

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

      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-bv-muted)]">
          Default machine (MACHINE only)
        </span>
        <select
          name="machineId"
          defaultValue={item.machineId ?? ''}
          className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[13px]"
        >
          <option value="">— none —</option>
          {machines.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>

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
