'use client';

import { useActionState } from 'react';
import { EstimateLineKind, ShopCatalogUnit } from '@bvisible/db';
import { FormError } from '@/components/auth/form-error';
import { kindLabel } from '@/lib/estimate/format';
import { createShopMaterialItemAction, type ShopMaterialActionState } from '../actions';

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

export function CreateShopMaterialItemForm({
  machines,
}: {
  machines: ReadonlyArray<{ id: string; name: string; ratePerHourCents: number }>;
}) {
  const initial: ShopMaterialActionState = { error: null };
  const [state, action, pending] = useActionState(createShopMaterialItemAction, initial);

  return (
    <form action={action} className="flex flex-col gap-4">
      <FormError message={state.error} />
      <label className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-medium text-[var(--color-bv-muted)]">Item name</span>
        <input
          name="name"
          required
          maxLength={400}
          placeholder="e.g. ACM 4X8 WHITE"
          className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[14.5px] text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)]"
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-medium text-[var(--color-bv-muted)]">Line type</span>
          <select
            name="kind"
            required
            defaultValue={EstimateLineKind.MATERIAL}
            className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[13px]"
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {kindLabel(k)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-medium text-[var(--color-bv-muted)]">Unit</span>
          <select
            name="catalogUnit"
            required
            defaultValue={ShopCatalogUnit.EACH}
            className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[13px]"
          >
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {u.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          <span className="text-[11px] leading-snug text-[var(--color-bv-muted)]">
            SHEET / SQ FT / ROLL pair with the estimate <strong className="text-[var(--color-bv-text)]">Pricing helper</strong> for yardage. LABOR / INSTALL default to hourly-style lines ($50 / $150 in the editor).
          </span>
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-medium text-[var(--color-bv-muted)]">
          Custom unit label (when unit = CUSTOM)
        </span>
        <input
          name="customUnitLabel"
          maxLength={40}
          placeholder="Only when needed"
          className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[14.5px] outline-none focus:border-[var(--color-bv-accent)]"
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-medium text-[var(--color-bv-muted)]">
          Default machine (MACHINE rows only)
        </span>
        <select
          name="machineId"
          className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[13px]"
        >
          <option value="">— optional —</option>
          {machines.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-medium text-[var(--color-bv-muted)]">
            Internal unit cost (USD)
          </span>
          <input
            name="internalCostUsd"
            required
            placeholder="0.00"
            inputMode="decimal"
            className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[14.5px] outline-none focus:border-[var(--color-bv-accent)]"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-medium text-[var(--color-bv-muted)]">
            Markup % (quoting guidance)
          </span>
          <input
            name="markupPercent"
            defaultValue="200"
            placeholder="200"
            inputMode="decimal"
            className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[14.5px] outline-none focus:border-[var(--color-bv-accent)]"
          />
          <span className="text-[11px] leading-snug text-[var(--color-bv-muted)]">
            Percent added above unit cost for catalog sell hints. Use <strong className="text-[var(--color-bv-text)]">200</strong> for a ×3 sell hint vs cost (same spirit as the estimate&apos;s default ×3 multiplier). Use <strong className="text-[var(--color-bv-text)]">30</strong> for roughly ×1.3.
          </span>
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-medium text-[var(--color-bv-muted)]">
            Default sell (USD override, optional)
          </span>
          <input
            name="defaultSellUsd"
            placeholder="Leave blank to derive from cost + markup"
            inputMode="decimal"
            className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[14.5px] outline-none focus:border-[var(--color-bv-accent)]"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-medium text-[var(--color-bv-muted)]">
            Default quantity
          </span>
          <input
            name="defaultQty"
            defaultValue="1"
            placeholder="1"
            inputMode="decimal"
            className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[14.5px] outline-none focus:border-[var(--color-bv-accent)]"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-medium text-[var(--color-bv-muted)]">Notes (optional)</span>
        <textarea
          name="notes"
          rows={3}
          maxLength={2000}
          className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[14.5px] outline-none focus:border-[var(--color-bv-accent)]"
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="rounded-[8px] bg-[var(--color-bv-accent)] px-4 py-2.5 text-[13.5px] font-medium text-[var(--color-bv-accent-foreground)] shadow-sm disabled:opacity-60"
      >
        {pending ? 'Creating…' : 'Create item'}
      </button>
    </form>
  );
}
