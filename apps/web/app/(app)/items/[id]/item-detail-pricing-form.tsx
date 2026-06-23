'use client';

import { useActionState, useEffect, useState } from 'react';
import { EstimateLineKind, ShopCatalogUnit } from '@bvisible/db';
import { SelectControl } from '@/components/app/select-control';
import { formatQty } from '@/lib/estimate/format';
import { kindLabel } from '@/lib/estimate/format';
import {
  updateShopMaterialItemAttributesAction,
  addMachineAction,
  addShopItemCategoryAction,
  type AddCategoryState,
  type AddMachineState,
} from '../actions';
import {
  CatalogItemPricingTools,
  type CatalogPricingToolChange,
  type CatalogPricingToolValues,
} from '../catalog-item-pricing-tools';

const ALL_KINDS: EstimateLineKind[] = [
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
  return ALL_KINDS.includes(category as EstimateLineKind)
    ? kindLabel(category as EstimateLineKind)
    : category;
}

export function ItemDetailPricingForm({
  item,
  machines: initialMachines,
  savedCategories,
}: {
  item: {
    id: string;
    kind: EstimateLineKind;
    categories: string[];
    catalogUnit: ShopCatalogUnit;
    customUnitLabel: string | null;
    internalCostCents: number;
    markupPercentMilli: number;
    defaultSellPriceCents: number | null;
    defaultQtyMilli: number;
    pricingMethod: string | null;
    pricingInputsJson: unknown;
    calculatedCostCents: number | null;
    calculatedSellCents: number | null;
    pricingNotes: string | null;
    machineId: string | null;
    notes: string | null;
  };
  machines: ReadonlyArray<{ id: string; name: string }>;
  savedCategories: ReadonlyArray<string>;
}) {
  const internalUsd = (item.internalCostCents / 100).toFixed(2);
  const markupPct =
    item.markupPercentMilli % 1000 === 0
      ? String(item.markupPercentMilli / 1000)
      : (item.markupPercentMilli / 1000).toFixed(3).replace(/\.?0+$/, '');
  const sellUsd =
    item.defaultSellPriceCents != null ? (item.defaultSellPriceCents / 100).toFixed(2) : '';
  const [pricingValues, setPricingValues] = useState<CatalogPricingToolValues>({
    internalCostUsd: internalUsd,
    markupPercent: markupPct,
    defaultSellUsd: sellUsd,
    defaultQty: formatQty(item.defaultQtyMilli),
    catalogUnit: item.catalogUnit,
    pricing: {
      pricingMethod: item.pricingMethod ?? '',
      pricingEngine: 'MANUAL',
      pricingInputsJson: item.pricingInputsJson ? JSON.stringify(item.pricingInputsJson) : '',
      pricingOutputJson: '',
      formulaVersion: 'catalog-pricing-v1',
      selectedVendorId: '',
      selectedVendorMode: 'INTERNAL',
      calculatedCostCents: item.calculatedCostCents != null ? String(item.calculatedCostCents) : '',
      calculatedSellCents: item.calculatedSellCents != null ? String(item.calculatedSellCents) : '',
      pricingNotes: item.pricingNotes ?? '',
    },
  });

  // Seed categories: use item.categories if populated, else fall back to kind
  const seedCategories =
    item.categories.length > 0 ? item.categories : [item.kind];

  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(
    new Set(seedCategories),
  );

  const [categoryOptions, setCategoryOptions] = useState(() => [
    ...ALL_KINDS,
    ...savedCategories.filter((c) => !ALL_KINDS.includes(c as EstimateLineKind)),
  ]);
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [machines, setMachines] = useState(Array.from(initialMachines));
  const [selectedMachineId, setSelectedMachineId] = useState(item.machineId ?? '');
  const [showNewMachine, setShowNewMachine] = useState(false);
  const [newMachineName, setNewMachineName] = useState('');
  const [newMachineRateUsd, setNewMachineRateUsd] = useState('0.00');

  const toggleCategory = (k: string) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(k)) {
        next.delete(k);
      } else {
        next.add(k);
      }
      return next;
    });
  };

  function patchPricingValues(patch: CatalogPricingToolChange) {
    setPricingValues((current) => ({
      ...current,
      ...patch,
      pricing: patch.pricing ? { ...current.pricing, ...patch.pricing } : current.pricing,
    }));
  }

  // Standalone machine save
  const [machineState, machineFormAction, machinePending] = useActionState(
    addMachineAction,
    ADD_MACHINE_INITIAL,
  );
  const [categoryState, categoryFormAction, categoryPending] = useActionState(
    addShopItemCategoryAction,
    ADD_CATEGORY_INITIAL,
  );

  useEffect(() => {
    if (!machineState.machineId || !machineState.machineName) return;
    setMachines((prev) =>
      prev.some((m) => m.id === machineState.machineId)
        ? prev
        : [...prev, { id: machineState.machineId!, name: machineState.machineName! }],
    );
    setSelectedMachineId(machineState.machineId);
    setNewMachineName('');
    setNewMachineRateUsd('0.00');
    setShowNewMachine(false);
  }, [machineState.machineId, machineState.machineName]);

  useEffect(() => {
    if (!categoryState.category) return;
    setCategoryOptions((prev) =>
      prev.includes(categoryState.category!) ? prev : [...prev, categoryState.category!],
    );
    setSelectedCategories((prev) => new Set([...prev, categoryState.category!]));
    setNewCategoryName('');
    setShowNewCategory(false);
  }, [categoryState.category]);

  return (
    <div className="mt-3 flex flex-col gap-4">
      {/* ── Main pricing form ── */}
      <form action={updateShopMaterialItemAttributesAction} className="flex flex-col gap-3">
        <input type="hidden" name="id" value={item.id} />

        {/* Categories (multi-checkbox) */}
        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-bv-muted)]">
            Categories
          </legend>
          <div className="flex flex-wrap gap-2">
            {categoryOptions.map((k) => {
              const checked = selectedCategories.has(k);
              return (
                <label
                  key={k}
                  className={`flex cursor-pointer select-none items-center gap-1.5 rounded-[8px] border px-2.5 py-1.5 text-[12.5px] font-medium transition-colors ${
                    checked
                      ? 'border-blue-300 bg-blue-50 text-blue-900'
                      : 'border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] text-[var(--color-bv-muted)]'
                  }`}
                >
                  <input
                    type="checkbox"
                    name="categories"
                    value={k}
                    checked={checked}
                    onChange={() => toggleCategory(k)}
                    className="sr-only"
                  />
                  {categoryLabel(k)}
                </label>
              );
            })}
            <button
              type="button"
              onClick={() => {
                setShowNewCategory(true);
                setShowNewMachine(false);
              }}
              className="rounded-[8px] border border-dashed border-violet-300 bg-violet-50 px-2.5 py-1.5 text-[12.5px] font-semibold text-violet-700"
            >
              + Add custom
            </button>
          </div>

          {showNewCategory && (
            <div className="mt-2 grid gap-3 rounded-[10px] border border-violet-200 bg-violet-50/60 p-4 sm:grid-cols-[1fr_auto]">
              <label className="flex flex-col gap-1">
                <span className="text-[10.5px] font-semibold uppercase tracking-wide text-violet-700">
                  Custom category
                </span>
                <input
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  required
                  maxLength={80}
                  autoFocus
                  placeholder="e.g. Apparel, Vehicles, Channel Letters"
                  className="rounded-[7px] border border-violet-200 bg-white px-2.5 py-1.5 text-[13px] outline-none focus:border-violet-400"
                />
                {categoryState.error && (
                  <p className="text-[12px] text-rose-600">{categoryState.error}</p>
                )}
                {categoryState.category && !categoryState.error && (
                  <p className="text-[12px] font-medium text-emerald-700">
                    Saved: {categoryState.category}
                  </p>
                )}
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
                  className="rounded-[8px] bg-violet-600 px-3 py-1.5 text-[12.5px] font-semibold text-white transition hover:bg-violet-700 disabled:opacity-60"
                >
                  {categoryPending ? 'Saving…' : 'Save category'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowNewCategory(false);
                    setNewCategoryName('');
                  }}
                  className="text-[12px] text-[var(--color-bv-muted)] hover:underline"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {selectedCategories.size === 0 && (
            <p className="text-[11px] text-rose-600">Select at least one category.</p>
          )}
        </fieldset>

        {/* Unit */}
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-bv-muted)]">
            Unit
          </span>
          <SelectControl
            name="catalogUnit"
            value={pricingValues.catalogUnit}
            onChange={(e) =>
              patchPricingValues({ catalogUnit: e.target.value as ShopCatalogUnit })
            }
            className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[13px]"
          >
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {u.replace(/_/g, ' ')}
              </option>
            ))}
          </SelectControl>
        </label>

        <input type="hidden" name="customUnitLabel" value={item.customUnitLabel ?? ''} />

        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-bv-muted)]">
            Default machine
          </span>
          <SelectControl
            name="machineId"
            value={selectedMachineId}
            onChange={(e) => {
              setSelectedMachineId(e.target.value);
              setShowNewMachine(false);
            }}
            className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[13px]"
          >
            <option value="">— none —</option>
            {machines.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </SelectControl>
          <button
            type="button"
            onClick={() => {
              setShowNewMachine(true);
              setShowNewCategory(false);
              setSelectedMachineId('');
            }}
            className="mt-1 flex w-fit items-center gap-1.5 rounded-[8px] border border-dashed border-blue-300 bg-blue-50 px-2.5 py-1.5 text-[12px] font-semibold text-blue-700"
          >
            + Add new machine
          </button>

          {showNewMachine && (
            <div className="mt-2 flex flex-col gap-3 rounded-[10px] border border-blue-200 bg-blue-50/60 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[10.5px] font-semibold uppercase tracking-wide text-blue-700">
                    Machine name
                  </span>
                  <input
                    value={newMachineName}
                    onChange={(e) => setNewMachineName(e.target.value)}
                    required
                    maxLength={120}
                    autoFocus
                    placeholder="e.g. Roland 64 Printer"
                    className="rounded-[7px] border border-blue-200 bg-white px-2.5 py-1.5 text-[13px] outline-none focus:border-blue-400"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10.5px] font-semibold uppercase tracking-wide text-blue-700">
                    Hourly rate (USD)
                  </span>
                  <input
                    value={newMachineRateUsd}
                    onChange={(e) => setNewMachineRateUsd(e.target.value)}
                    inputMode="decimal"
                    placeholder="0.00"
                    className="rounded-[7px] border border-blue-200 bg-white px-2.5 py-1.5 text-[13px] outline-none focus:border-blue-400"
                  />
                </label>
              </div>
              {machineState.error && (
                <p className="text-[12px] text-rose-600">{machineState.error}</p>
              )}
              {machineState.machineId && !machineState.error && (
                <p className="text-[12px] font-medium text-emerald-700">
                  Saved: {machineState.machineName}
                </p>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={machinePending || !newMachineName.trim()}
                  onClick={() => {
                    const fd = new FormData();
                    fd.set('machineName', newMachineName.trim());
                    fd.set('machineRateUsd', newMachineRateUsd.trim() || '0.00');
                    machineFormAction(fd);
                  }}
                  className="rounded-[8px] bg-blue-600 px-3 py-1.5 text-[12.5px] font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
                >
                  {machinePending ? 'Saving…' : 'Save machine'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowNewMachine(false);
                    setNewMachineName('');
                    setNewMachineRateUsd('0.00');
                  }}
                  className="text-[12px] text-[var(--color-bv-muted)] hover:underline"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </label>

        {/* Internal cost */}
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-bv-muted)]">
            Internal unit cost (USD)
          </span>
          <input
            name="internalCostUsd"
            required
            value={pricingValues.internalCostUsd}
            onChange={(e) => patchPricingValues({ internalCostUsd: e.target.value })}
            inputMode="decimal"
            className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[13px]"
          />
        </label>

        {/* Markup */}
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-bv-muted)]">
            Markup %
          </span>
          <input
            name="markupPercent"
            value={pricingValues.markupPercent}
            onChange={(e) => patchPricingValues({ markupPercent: e.target.value })}
            placeholder="200"
            inputMode="decimal"
            className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[13px]"
          />
          <p className="text-[11px] leading-snug text-[var(--color-bv-muted)]">
            Percent above internal cost for catalog sell hints (200 ≈ triple sell vs cost). Use 0 for none.
          </p>
        </label>

        {/* Default sell override */}
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-bv-muted)]">
            Default sell override (USD, optional)
          </span>
          <input
            name="defaultSellUsd"
            value={pricingValues.defaultSellUsd}
            onChange={(e) => patchPricingValues({ defaultSellUsd: e.target.value })}
            placeholder="Blank = cost + markup"
            inputMode="decimal"
            className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[13px]"
          />
        </label>

        {/* Default qty */}
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-bv-muted)]">
            Default qty ({formatQty(item.defaultQtyMilli)} today)
          </span>
          <input
            name="defaultQty"
            required
            value={pricingValues.defaultQty}
            onChange={(e) => patchPricingValues({ defaultQty: e.target.value })}
            inputMode="decimal"
            className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[13px]"
          />
        </label>

        <CatalogItemPricingTools values={pricingValues} onChange={patchPricingValues} />

        {/* Notes */}
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
          disabled={selectedCategories.size === 0}
          className="rounded-[8px] bg-[var(--color-bv-accent)] px-3 py-2 text-[13px] font-medium text-[var(--color-bv-accent-foreground)] disabled:opacity-50"
        >
          Save pricing & details
        </button>
      </form>
    </div>
  );
}
