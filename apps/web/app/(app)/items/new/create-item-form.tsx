'use client';

import { useActionState, useState } from 'react';
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
  const [selectedMachineId, setSelectedMachineId] = useState('');
  const isNewMachine = selectedMachineId === '__new__';

  return (
    <form action={action} className="grid gap-5">
      <FormError message={state.error} />
      <label className="flex flex-col gap-2">
        <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500">Item name</span>
        <input
          name="name"
          required
          maxLength={400}
          placeholder="e.g. ACM 4X8 WHITE"
          className="h-12 rounded-[14px] border border-slate-200 bg-slate-50/80 px-4 text-[14.5px] text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-blue-300 focus:bg-white focus:shadow-[0_0_0_4px_rgba(47,90,243,0.10)]"
        />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-2">
          <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500">Line type</span>
          <select
            name="kind"
            required
            defaultValue={EstimateLineKind.MATERIAL}
            className="h-12 rounded-[14px] border border-slate-200 bg-slate-50/80 px-4 text-[13.5px] font-medium text-slate-900 outline-none transition-all focus:border-blue-300 focus:bg-white focus:shadow-[0_0_0_4px_rgba(47,90,243,0.10)]"
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {kindLabel(k)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-2">
          <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500">Unit</span>
          <select
            name="catalogUnit"
            required
            defaultValue={ShopCatalogUnit.EACH}
            className="h-12 rounded-[14px] border border-slate-200 bg-slate-50/80 px-4 text-[13.5px] font-medium text-slate-900 outline-none transition-all focus:border-blue-300 focus:bg-white focus:shadow-[0_0_0_4px_rgba(47,90,243,0.10)]"
          >
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {u.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          <p className="rounded-[14px] border border-blue-100 bg-blue-50/70 px-4 py-3 text-[12px] leading-relaxed text-blue-900">
            SQ FT / SHEET / ROLL match how you buy material; the estimate <strong className="text-[var(--color-bv-text)]">Pricing helper</strong> can fill sq ft, sheet count, roll usage, or banner totals on a line when you apply.
          </p>
        </label>
      </div>

      <label className="flex flex-col gap-2">
        <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          Custom unit label (when unit = CUSTOM)
        </span>
        <input
          name="customUnitLabel"
          maxLength={40}
          placeholder="Only when needed"
          className="h-12 rounded-[14px] border border-slate-200 bg-slate-50/80 px-4 text-[14.5px] outline-none transition-all placeholder:text-slate-400 focus:border-blue-300 focus:bg-white focus:shadow-[0_0_0_4px_rgba(47,90,243,0.10)]"
        />
      </label>

      <div className="flex flex-col gap-2">
        <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          Default machine (MACHINE rows only)
        </span>
        <select
          name="machineId"
          value={selectedMachineId}
          onChange={(e) => setSelectedMachineId(e.target.value)}
          className="h-12 rounded-[14px] border border-slate-200 bg-slate-50/80 px-4 text-[13.5px] font-medium text-slate-900 outline-none transition-all focus:border-blue-300 focus:bg-white focus:shadow-[0_0_0_4px_rgba(47,90,243,0.10)]"
        >
          <option value="">— optional —</option>
          {machines.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
          <option value="__new__">➕ Create new machine…</option>
        </select>
        {isNewMachine && (
          <div className="grid gap-3 rounded-[14px] border border-blue-100 bg-blue-50/60 p-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-blue-700">Machine name</span>
              <input
                name="machineName"
                required
                maxLength={120}
                placeholder="e.g. Roland 64 Printer"
                className="h-10 rounded-[10px] border border-blue-200 bg-white px-3 text-[13.5px] outline-none focus:border-blue-400 focus:shadow-[0_0_0_3px_rgba(47,90,243,0.10)]"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-blue-700">Hourly rate (USD)</span>
              <input
                name="machineRateUsd"
                defaultValue="0.00"
                inputMode="decimal"
                placeholder="0.00"
                className="h-10 rounded-[10px] border border-blue-200 bg-white px-3 text-[13.5px] outline-none focus:border-blue-400 focus:shadow-[0_0_0_3px_rgba(47,90,243,0.10)]"
              />
            </label>
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-2">
          <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Internal unit cost (USD)
          </span>
          <input
            name="internalCostUsd"
            required
            placeholder="0.00"
            inputMode="decimal"
            className="h-12 rounded-[14px] border border-slate-200 bg-slate-50/80 px-4 text-[14.5px] outline-none transition-all placeholder:text-slate-400 focus:border-blue-300 focus:bg-white focus:shadow-[0_0_0_4px_rgba(47,90,243,0.10)]"
          />
        </label>
        <label className="flex flex-col gap-2">
          <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Markup % (quoting guidance)
          </span>
          <input
            name="markupPercent"
            defaultValue="200"
            placeholder="200"
            inputMode="decimal"
            className="h-12 rounded-[14px] border border-slate-200 bg-slate-50/80 px-4 text-[14.5px] outline-none transition-all placeholder:text-slate-400 focus:border-blue-300 focus:bg-white focus:shadow-[0_0_0_4px_rgba(47,90,243,0.10)]"
          />
          <p className="text-[12px] leading-snug text-slate-500">
            Default <strong className="text-[var(--color-bv-text)]">200</strong> = 200% above cost (catalog sell hint ≈ 3× cost). Use <strong className="text-[var(--color-bv-text)]">0</strong> for no markup.
          </p>
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-2">
          <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Default sell (USD override, optional)
          </span>
          <input
            name="defaultSellUsd"
            placeholder="Leave blank to derive from cost + markup"
            inputMode="decimal"
            className="h-12 rounded-[14px] border border-slate-200 bg-slate-50/80 px-4 text-[14.5px] outline-none transition-all placeholder:text-slate-400 focus:border-blue-300 focus:bg-white focus:shadow-[0_0_0_4px_rgba(47,90,243,0.10)]"
          />
        </label>
        <label className="flex flex-col gap-2">
          <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Default quantity
          </span>
          <input
            name="defaultQty"
            defaultValue="1"
            placeholder="1"
            inputMode="decimal"
            className="h-12 rounded-[14px] border border-slate-200 bg-slate-50/80 px-4 text-[14.5px] outline-none transition-all placeholder:text-slate-400 focus:border-blue-300 focus:bg-white focus:shadow-[0_0_0_4px_rgba(47,90,243,0.10)]"
          />
        </label>
      </div>

      <label className="flex flex-col gap-2">
        <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500">Notes (optional)</span>
        <textarea
          name="notes"
          rows={4}
          maxLength={2000}
          placeholder="Internal estimator guidance, usage constraints, or sourcing context."
          className="rounded-[14px] border border-slate-200 bg-slate-50/80 px-4 py-3 text-[14.5px] outline-none transition-all placeholder:text-slate-400 focus:border-blue-300 focus:bg-white focus:shadow-[0_0_0_4px_rgba(47,90,243,0.10)]"
        />
      </label>

      <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-5">
        <p className="text-[12.5px] text-slate-500">New items become available for estimating once saved.</p>
        <button
          type="submit"
          disabled={pending}
          className="rounded-[12px] bg-[var(--color-bv-accent)] px-4 py-2.5 text-[13.5px] font-semibold text-[var(--color-bv-accent-foreground)] shadow-[0_16px_34px_rgba(47,90,243,0.24)] transition-all hover:-translate-y-0.5 hover:opacity-95 disabled:opacity-60"
        >
          {pending ? 'Creating…' : 'Create item'}
        </button>
      </div>
    </form>
  );
}
