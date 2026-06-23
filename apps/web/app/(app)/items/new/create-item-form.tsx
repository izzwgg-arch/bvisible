'use client';

import { useActionState, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { EstimateLineKind, ShopCatalogUnit } from '@bvisible/db';
import { SelectControl } from '@/components/app/select-control';
import { FormError } from '@/components/auth/form-error';
import { kindLabel } from '@/lib/estimate/format';
import {
  addMachineAction,
  addShopItemCategoryAction,
  createShopMaterialItemAction,
  type AddCategoryState,
  type AddMachineState,
  type ShopMaterialActionState,
} from '../actions';
import {
  CatalogItemPricingTools,
  type CatalogPricingToolChange,
  type CatalogPricingToolValues,
} from '../catalog-item-pricing-tools';

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

const ADD_MACHINE_INITIAL: AddMachineState = { error: null };
const ADD_CATEGORY_INITIAL: AddCategoryState = { error: null };

function categoryLabel(category: string) {
  return KINDS.includes(category as EstimateLineKind)
    ? kindLabel(category as EstimateLineKind)
    : category;
}

export function CreateShopMaterialItemForm({
  machines: initialMachines,
  savedCategories,
}: {
  machines: ReadonlyArray<{ id: string; name: string; ratePerHourCents: number }>;
  savedCategories: ReadonlyArray<string>;
}) {
  const router = useRouter();
  const initial: ShopMaterialActionState = { error: null };
  const [state, action, pending] = useActionState(createShopMaterialItemAction, initial);

  const [machines, setMachines] = useState(Array.from(initialMachines));
  const [categories, setCategories] = useState(() => [
    ...KINDS,
    ...savedCategories.filter((c) => !KINDS.includes(c as EstimateLineKind)),
  ]);
  const [selectedCategory, setSelectedCategory] = useState<string>(EstimateLineKind.MATERIAL);
  const [selectedMachineId, setSelectedMachineId] = useState('');
  const [showMachineForm, setShowMachineForm] = useState(false);
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newMachineName, setNewMachineName] = useState('');
  const [newMachineRateUsd, setNewMachineRateUsd] = useState('0.00');
  const [pricingValues, setPricingValues] = useState<CatalogPricingToolValues>({
    internalCostUsd: '0.00',
    markupPercent: '200',
    defaultSellUsd: '',
    defaultQty: '1',
    catalogUnit: ShopCatalogUnit.EACH,
    pricing: {
      pricingMethod: '',
      pricingEngine: 'MANUAL',
      pricingInputsJson: '',
      pricingOutputJson: '',
      formulaVersion: 'catalog-pricing-v1',
      selectedVendorId: '',
      selectedVendorMode: 'INTERNAL',
      calculatedCostCents: '',
      calculatedSellCents: '',
      pricingNotes: '',
    },
  });
  const isMachineCategory = selectedCategory === EstimateLineKind.MACHINE;

  function patchPricingValues(patch: CatalogPricingToolChange) {
    setPricingValues((current) => ({
      ...current,
      ...patch,
      pricing: patch.pricing ? { ...current.pricing, ...patch.pricing } : current.pricing,
    }));
  }

  const [machineState, machineFormAction, machinePending] = useActionState(
    addMachineAction,
    ADD_MACHINE_INITIAL,
  );
  const [categoryState, categoryFormAction, categoryPending] = useActionState(
    addShopItemCategoryAction,
    ADD_CATEGORY_INITIAL,
  );

  useEffect(() => {
    if (state.redirectTo) router.push(state.redirectTo);
  }, [state.redirectTo, router]);

  useEffect(() => {
    if (!machineState.machineId || !machineState.machineName) return;
    setMachines((prev) =>
      prev.some((m) => m.id === machineState.machineId)
        ? prev
        : [...prev, { id: machineState.machineId!, name: machineState.machineName!, ratePerHourCents: 0 }],
    );
    setSelectedMachineId(machineState.machineId);
    setNewMachineName('');
    setNewMachineRateUsd('0.00');
    setShowMachineForm(false);
  }, [machineState.machineId, machineState.machineName]);

  useEffect(() => {
    if (!categoryState.category) return;
    setCategories((prev) =>
      prev.includes(categoryState.category!) ? prev : [...prev, categoryState.category!],
    );
    setSelectedCategory(categoryState.category);
    setNewCategoryName('');
    setShowMachineForm(false);
    setShowCategoryForm(false);
  }, [categoryState.category]);

  return (
    <div className="grid gap-5">
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
          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-2">
              <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500">Category</span>
              <SelectControl
                name="categories"
                required
                value={selectedCategory}
                onChange={(e) => {
                  setSelectedCategory(e.target.value);
                  setShowCategoryForm(false);
                }}
                className="h-12 rounded-[14px] border border-slate-200 bg-slate-50/80 px-4 text-[13.5px] font-medium text-slate-900 outline-none transition-all focus:border-blue-300 focus:bg-white focus:shadow-[0_0_0_4px_rgba(47,90,243,0.10)]"
              >
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {categoryLabel(category)}
                  </option>
                ))}
              </SelectControl>
            </label>
            <button
              type="button"
              onClick={() => {
                setShowCategoryForm(true);
                setShowMachineForm(false);
              }}
              className="flex w-fit items-center gap-1.5 rounded-[10px] border border-dashed border-violet-300 bg-violet-50 px-3 py-1.5 text-[12.5px] font-semibold text-violet-700 transition hover:bg-violet-100"
            >
              + Add custom category
            </button>

            {showCategoryForm ? (
              <div className="grid gap-3 rounded-[14px] border border-violet-100 bg-violet-50/70 p-4 sm:grid-cols-[1fr_auto]">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-violet-700">
                    Custom category
                  </span>
                  <input
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    required
                    maxLength={80}
                    autoFocus
                    placeholder="e.g. Apparel, Vehicles, Channel Letters"
                    className="h-10 rounded-[10px] border border-violet-200 bg-white px-3 text-[13.5px] outline-none focus:border-violet-400 focus:shadow-[0_0_0_3px_rgba(124,58,237,0.10)]"
                  />
                  {categoryState.error ? (
                    <span className="text-[12px] text-rose-600">{categoryState.error}</span>
                  ) : categoryState.category ? (
                    <span className="text-[12px] font-medium text-emerald-700">
                      Saved: {categoryState.category}
                    </span>
                  ) : null}
                </label>
                <div className="flex items-end gap-2">
                  <button
                    type="button"
                    disabled={categoryPending || !newCategoryName.trim()}
                    onClick={() => {
                      const fd = new FormData();
                      fd.set('categoryName', newCategoryName.trim());
                      categoryFormAction(fd);
                    }}
                    className="h-10 rounded-[10px] bg-violet-600 px-4 text-[13px] font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
                  >
                    {categoryPending ? 'Saving...' : 'Save category'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowCategoryForm(false);
                      setNewCategoryName('');
                    }}
                    className="h-10 px-2 text-[12.5px] font-medium text-slate-500 hover:underline"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        <label className="flex flex-col gap-2">
          <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500">Unit</span>
          <SelectControl
            name="catalogUnit"
            required
            value={pricingValues.catalogUnit}
            onChange={(e) =>
              patchPricingValues({ catalogUnit: e.target.value as ShopCatalogUnit })
            }
            className="h-12 rounded-[14px] border border-slate-200 bg-slate-50/80 px-4 text-[13.5px] font-medium text-slate-900 outline-none transition-all focus:border-blue-300 focus:bg-white focus:shadow-[0_0_0_4px_rgba(47,90,243,0.10)]"
          >
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {u.replace(/_/g, ' ')}
              </option>
            ))}
          </SelectControl>
          <p className="rounded-[14px] border border-blue-100 bg-blue-50/70 px-4 py-3 text-[12px] leading-relaxed text-blue-900">
            SQ FT / SHEET / ROLL match how you buy material; use the pricing tools below to save those defaults into the catalog item.
          </p>
        </label>
        </div>

        <input type="hidden" name="customUnitLabel" value="" />

        <div className="flex flex-col gap-2">
          <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Default machine
          </span>
          <SelectControl
            name="machineId"
            value={selectedMachineId}
            onChange={(e) => {
              if (e.target.value === '__new__') {
                setShowMachineForm(true);
                setShowCategoryForm(false);
                setSelectedMachineId('');
                return;
              }
              setSelectedMachineId(e.target.value);
              setShowMachineForm(false);
            }}
            className="h-12 rounded-[14px] border border-slate-200 bg-slate-50/80 px-4 text-[13.5px] font-medium text-slate-900 outline-none transition-all focus:border-blue-300 focus:bg-white focus:shadow-[0_0_0_4px_rgba(47,90,243,0.10)]"
          >
            <option value="">— optional —</option>
            {machines.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </SelectControl>
          <button
            type="button"
            onClick={() => {
              setShowMachineForm(true);
              setShowCategoryForm(false);
              setSelectedMachineId('');
            }}
            className="flex w-fit items-center gap-1.5 rounded-[10px] border border-dashed border-blue-300 bg-blue-50 px-3 py-1.5 text-[12.5px] font-semibold text-blue-700 transition hover:bg-blue-100"
          >
            + Add new machine
          </button>

          {showMachineForm ? (
            <div className="grid gap-3 rounded-[14px] border border-blue-100 bg-blue-50/60 p-4 sm:grid-cols-[1fr_1fr_auto]">
              <label className="flex flex-col gap-1.5">
                <span className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-blue-700">
                  Machine name
                </span>
                <input
                  value={newMachineName}
                  onChange={(e) => setNewMachineName(e.target.value)}
                  required
                  maxLength={120}
                  autoFocus
                  placeholder="e.g. Roland 64 Printer"
                  className="h-10 rounded-[10px] border border-blue-200 bg-white px-3 text-[13.5px] outline-none focus:border-blue-400 focus:shadow-[0_0_0_3px_rgba(47,90,243,0.10)]"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-[11.5px] font-semibold uppercase tracking-[0.12em] text-blue-700">
                  Hourly rate (USD)
                </span>
                <input
                  value={newMachineRateUsd}
                  onChange={(e) => setNewMachineRateUsd(e.target.value)}
                  inputMode="decimal"
                  placeholder="0.00"
                  className="h-10 rounded-[10px] border border-blue-200 bg-white px-3 text-[13.5px] outline-none focus:border-blue-400 focus:shadow-[0_0_0_3px_rgba(47,90,243,0.10)]"
                />
                {machineState.error ? (
                  <span className="text-[12px] text-rose-600">{machineState.error}</span>
                ) : machineState.machineName ? (
                  <span className="text-[12px] font-medium text-emerald-700">
                    Saved: {machineState.machineName}
                  </span>
                ) : null}
              </label>
              <div className="flex items-end gap-2">
                <button
                  type="button"
                  disabled={machinePending || !newMachineName.trim()}
                  onClick={() => {
                    const fd = new FormData();
                    fd.set('machineName', newMachineName.trim());
                    fd.set('machineRateUsd', newMachineRateUsd.trim() || '0.00');
                    machineFormAction(fd);
                  }}
                  className="h-10 rounded-[10px] bg-blue-600 px-4 text-[13px] font-semibold text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {machinePending ? 'Saving...' : 'Save machine'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowMachineForm(false);
                    setNewMachineName('');
                    setNewMachineRateUsd('0.00');
                  }}
                  className="h-10 px-2 text-[12.5px] font-medium text-slate-500 hover:underline"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-2">
          <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Internal unit cost (USD)
          </span>
          <input
            name="internalCostUsd"
            required
            value={pricingValues.internalCostUsd}
            onChange={(e) => patchPricingValues({ internalCostUsd: e.target.value })}
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
            value={pricingValues.markupPercent}
            onChange={(e) => patchPricingValues({ markupPercent: e.target.value })}
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
            value={pricingValues.defaultSellUsd}
            onChange={(e) => patchPricingValues({ defaultSellUsd: e.target.value })}
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
            value={pricingValues.defaultQty}
            onChange={(e) => patchPricingValues({ defaultQty: e.target.value })}
            placeholder="1"
            inputMode="decimal"
            className="h-12 rounded-[14px] border border-slate-200 bg-slate-50/80 px-4 text-[14.5px] outline-none transition-all placeholder:text-slate-400 focus:border-blue-300 focus:bg-white focus:shadow-[0_0_0_4px_rgba(47,90,243,0.10)]"
          />
        </label>
      </div>

      <CatalogItemPricingTools values={pricingValues} onChange={patchPricingValues} />

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
    </div>
  );
}
