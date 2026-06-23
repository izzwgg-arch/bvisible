'use client';

import { useActionState, useMemo, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { EstimateLineKind, ShopCatalogUnit } from '@bvisible/db';
import { formatMoney } from '@bvisible/pricing';
import { FormError } from '@/components/auth/form-error';
import { SelectControl } from '@/components/app/select-control';
import { kindLabel } from '@/lib/estimate/format';
import { calculateComponentTotals, calculateBundleTotals, type BundleVendorSnapshotRow } from '@/lib/shop-material/bundles';
import { createBundleAction, updateBundleAction, type BundleActionState } from './actions';

export type BundleSourceRow = {
  id: string;
  name: string;
  nameNormalized: string;
  kind: EstimateLineKind;
  categories: string[];
  catalogUnit: ShopCatalogUnit;
  customUnitLabel: string | null;
  internalCostCents: number;
  markupPercentMilli: number;
  defaultSellPriceCents: number | null;
  defaultQtyMilli: number;
  preferredVendorId: string | null;
  cheapestVendorId: string | null;
  selectedVendorId: string | null;
  pricingMethod: string | null;
  pricingInputsJson: unknown;
  vendorSnapshot: BundleVendorSnapshotRow[];
};

export type BundleInitial = {
  id: string;
  name: string;
  categories: string[];
  catalogUnit: ShopCatalogUnit;
  defaultQty: string;
  markupPercent: string;
  defaultSellUsd: string;
  customerDescription: string;
  notes: string;
  isActive: boolean;
  components: BundleComponentDraft[];
};

type BundleComponentDraft = {
  componentCatalogItemId: string | null;
  componentName: string;
  componentType: EstimateLineKind;
  categories: string[];
  quantity: string;
  unit: ShopCatalogUnit;
  customUnitLabel: string | null;
  internalUnitCostCents: number;
  markupPercentMilli: number;
  defaultSellCents: number | null;
  preferredVendorId: string | null;
  cheapestVendorId: string | null;
  selectedVendorId: string | null;
  vendorSnapshot: BundleVendorSnapshotRow[];
  pricingMethod: string | null;
  pricingInputsJson: unknown;
  notes: string | null;
};

const KINDS = [
  EstimateLineKind.MATERIAL,
  EstimateLineKind.LABOR,
  EstimateLineKind.MACHINE,
  EstimateLineKind.DESIGN,
  EstimateLineKind.INSTALL,
  EstimateLineKind.MISC,
];

const UNITS = [
  ShopCatalogUnit.EACH,
  ShopCatalogUnit.SHEET,
  ShopCatalogUnit.SQ_FT,
  ShopCatalogUnit.HOUR,
  ShopCatalogUnit.LINEAR_FT,
  ShopCatalogUnit.ROLL,
  ShopCatalogUnit.CUSTOM,
];

function centsToUsd(cents: number | null): string {
  if (cents === null) return '';
  return (cents / 100).toFixed(2);
}

function usdToCents(raw: string): number | null {
  const value = Number(raw.replace(/[$,\s]/g, ''));
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : null;
}

function qtyFromMilli(qtyMilli: number): string {
  return (qtyMilli / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function markupInputFromMilli(markupPercentMilli: number): string {
  return (markupPercentMilli / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function markupMilliFromInput(raw: string): number {
  const value = Number(raw.replace(/,/g, ''));
  return Number.isFinite(value) && value >= 0 ? Math.round(value * 1000) : 0;
}

function componentFromSource(source: BundleSourceRow): BundleComponentDraft {
  const preferred = source.vendorSnapshot.find((row) => row.isPreferred);
  const cheapest = source.vendorSnapshot.find((row) => row.isCheapest);
  const vendorCost = preferred?.latestPriceCents ?? cheapest?.latestPriceCents ?? null;
  const internalUnitCostCents = source.kind === EstimateLineKind.MATERIAL
    ? vendorCost ?? source.internalCostCents
    : source.internalCostCents;
  return {
    componentCatalogItemId: source.id,
    componentName: source.name,
    componentType: source.kind,
    categories: source.categories.length > 0 ? source.categories : [source.kind],
    quantity: qtyFromMilli(source.defaultQtyMilli),
    unit: source.catalogUnit,
    customUnitLabel: source.customUnitLabel,
    internalUnitCostCents,
    markupPercentMilli: source.markupPercentMilli,
    defaultSellCents: source.defaultSellPriceCents,
    preferredVendorId: source.preferredVendorId,
    cheapestVendorId: source.cheapestVendorId,
    selectedVendorId: source.selectedVendorId ?? source.preferredVendorId ?? source.cheapestVendorId,
    vendorSnapshot: source.vendorSnapshot,
    pricingMethod: source.pricingMethod,
    pricingInputsJson: source.pricingInputsJson,
    notes: null,
  };
}

function customComponent(): BundleComponentDraft {
  return {
    componentCatalogItemId: null,
    componentName: 'Custom component',
    componentType: EstimateLineKind.MATERIAL,
    categories: [EstimateLineKind.MATERIAL],
    quantity: '1',
    unit: ShopCatalogUnit.EACH,
    customUnitLabel: null,
    internalUnitCostCents: 0,
    markupPercentMilli: 200000,
    defaultSellCents: null,
    preferredVendorId: null,
    cheapestVendorId: null,
    selectedVendorId: null,
    vendorSnapshot: [],
    pricingMethod: null,
    pricingInputsJson: null,
    notes: null,
  };
}

export function BundleForm({
  mode,
  sources,
  savedCategories,
  initial,
}: {
  mode: 'create' | 'edit';
  sources: ReadonlyArray<BundleSourceRow>;
  savedCategories: ReadonlyArray<string>;
  initial?: BundleInitial;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    mode === 'edit' ? updateBundleAction : createBundleAction,
    { error: null } as BundleActionState,
  );
  const [components, setComponents] = useState<BundleComponentDraft[]>(
    () => initial?.components ?? [],
  );
  const [sourceQuery, setSourceQuery] = useState('');
  const [sourceId, setSourceId] = useState(sources[0]?.id ?? '');
  const [defaultSellUsd, setDefaultSellUsd] = useState(initial?.defaultSellUsd ?? '');
  const [markupPercent, setMarkupPercent] = useState(initial?.markupPercent ?? '0');
  const [categories] = useState(() => [
    ...KINDS,
    ...savedCategories.filter((category) => !KINDS.includes(category as EstimateLineKind)),
  ]);

  useEffect(() => {
    if (state.redirectTo) router.push(state.redirectTo);
  }, [router, state.redirectTo]);

  const filteredSources = useMemo(() => {
    const needle = sourceQuery.trim().toLowerCase();
    if (!needle) return sources.slice(0, 40);
    return sources
      .filter((source) => source.name.toLowerCase().includes(needle) || source.nameNormalized.toLowerCase().includes(needle))
      .slice(0, 40);
  }, [sourceQuery, sources]);

  const normalizedComponents = useMemo(() => {
    return components.map((component) => {
      const quantityMilli = Math.max(0, Math.round((Number(component.quantity.replace(/,/g, '')) || 0) * 1000));
      const totals = calculateComponentTotals({
        quantityMilli,
        internalUnitCostCents: component.internalUnitCostCents,
        markupPercentMilli: component.markupPercentMilli,
        defaultSellCents: component.defaultSellCents,
      });
      return { component, quantityMilli, ...totals };
    });
  }, [components]);

  const defaultSellOverrideCents = defaultSellUsd.trim() ? usdToCents(defaultSellUsd) : null;
  const bundleTotals = calculateBundleTotals({
    components: normalizedComponents.map((row) => ({
      totalCostCents: row.totalCostCents,
      totalSellCents: row.totalSellCents,
    })),
    overallMarkupPercentMilli: markupMilliFromInput(markupPercent),
    defaultSellOverrideCents,
  });

  function patchComponent(index: number, patch: Partial<BundleComponentDraft>) {
    setComponents((current) =>
      current.map((component, i) => (i === index ? { ...component, ...patch } : component)),
    );
  }

  function moveComponent(index: number, direction: -1 | 1) {
    setComponents((current) => {
      const next = current.slice();
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      const [row] = next.splice(index, 1);
      if (!row) return current;
      next.splice(target, 0, row);
      return next;
    });
  }

  function addSource() {
    const source = sources.find((row) => row.id === sourceId) ?? filteredSources[0];
    if (!source) return;
    setComponents((current) => [...current, componentFromSource(source)]);
  }

  const componentsJson = JSON.stringify(
    components.map((component) => ({
      ...component,
      categories: component.categories.length > 0 ? component.categories : [component.componentType],
    })),
  );

  return (
    <form action={action} className="grid gap-5">
      <FormError message={state.error} />
      {initial ? <input type="hidden" name="id" value={initial.id} /> : null}
      <input type="hidden" name="componentsJson" value={componentsJson} />

      <section className="grid gap-4 rounded-[20px] border border-white/80 bg-white/90 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="flex flex-col gap-2">
            <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500">Bundle name</span>
            <input name="name" required maxLength={400} defaultValue={initial?.name ?? ''} className="h-12 rounded-[14px] border border-slate-200 bg-slate-50/80 px-4 text-[14.5px] outline-none focus:border-blue-300 focus:bg-white" />
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500">Category</span>
            <SelectControl name="categories" required defaultValue={initial?.categories[0] ?? EstimateLineKind.MATERIAL}>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {KINDS.includes(category as EstimateLineKind) ? kindLabel(category as EstimateLineKind) : category}
                </option>
              ))}
            </SelectControl>
          </label>
        </div>

        <label className="flex flex-col gap-2">
          <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500">Customer-facing description</span>
          <textarea name="customerDescription" rows={3} maxLength={2000} defaultValue={initial?.customerDescription ?? ''} placeholder="What the customer sees on estimates and previews." className="rounded-[14px] border border-slate-200 bg-slate-50/80 px-4 py-3 text-[14.5px] outline-none focus:border-blue-300 focus:bg-white" />
        </label>

        <div className="grid gap-4 md:grid-cols-4">
          <label className="flex flex-col gap-2">
            <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500">Unit</span>
            <SelectControl name="catalogUnit" defaultValue={initial?.catalogUnit ?? ShopCatalogUnit.EACH}>
              {UNITS.map((unit) => <option key={unit} value={unit}>{unit.replace(/_/g, ' ')}</option>)}
            </SelectControl>
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500">Default quantity</span>
            <input name="defaultQty" defaultValue={initial?.defaultQty ?? '1'} inputMode="decimal" className="h-11 rounded-[14px] border border-slate-200 bg-slate-50/80 px-4 text-[14px]" />
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500">Overall markup %</span>
            <input name="markupPercent" value={markupPercent} onChange={(e) => setMarkupPercent(e.currentTarget.value)} inputMode="decimal" className="h-11 rounded-[14px] border border-slate-200 bg-slate-50/80 px-4 text-[14px]" />
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500">Sell override</span>
            <input name="defaultSellUsd" value={defaultSellUsd} onChange={(e) => setDefaultSellUsd(e.currentTarget.value)} placeholder={centsToUsd(bundleTotals.derivedSellCents)} inputMode="decimal" className="h-11 rounded-[14px] border border-slate-200 bg-slate-50/80 px-4 text-[14px]" />
          </label>
        </div>

        <div className="grid gap-4 md:grid-cols-[1fr_auto]">
          <label className="flex items-center gap-2 text-[13px] font-semibold text-slate-700">
            <input type="checkbox" name="isActive" value="true" defaultChecked={initial?.isActive ?? true} />
            Active in catalog and estimate picker
          </label>
          <div className="rounded-[16px] border border-blue-100 bg-blue-50 px-4 py-3 text-[13px] text-blue-950">
            Cost <strong>{formatMoney(bundleTotals.totalCostCents)}</strong> · Sell <strong>{formatMoney(bundleTotals.totalSellCents)}</strong>
          </div>
        </div>

        <label className="flex flex-col gap-2">
          <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500">Internal notes</span>
          <textarea name="notes" rows={3} maxLength={2000} defaultValue={initial?.notes ?? ''} className="rounded-[14px] border border-slate-200 bg-slate-50/80 px-4 py-3 text-[14.5px] outline-none focus:border-blue-300 focus:bg-white" />
        </label>
      </section>

      <section className="grid gap-4 rounded-[20px] border border-white/80 bg-white/90 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-[16px] font-semibold text-slate-950">Components</h2>
            <p className="mt-1 text-[12.5px] text-slate-500">Add existing catalog items as snapshots or custom one-off components.</p>
          </div>
          <button type="button" onClick={() => setComponents((current) => [...current, customComponent()])} className="rounded-[12px] border border-slate-200 bg-white px-4 py-2 text-[13px] font-semibold text-slate-700">
            Add custom component
          </button>
        </div>

        <div className="grid gap-3 rounded-[16px] border border-slate-100 bg-slate-50/70 p-4 md:grid-cols-[1fr_1fr_auto]">
          <input value={sourceQuery} onChange={(e) => setSourceQuery(e.currentTarget.value)} placeholder="Search existing catalog items..." className="h-11 rounded-[12px] border border-slate-200 bg-white px-3 text-[13px]" />
          <SelectControl value={sourceId} onChange={(e) => setSourceId(e.currentTarget.value)} searchable searchPlaceholder="Search catalog items..." className="h-11 rounded-[12px] border border-slate-200 bg-white px-3 text-[13px]">
            {filteredSources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name} · {kindLabel(source.kind)}
              </option>
            ))}
          </SelectControl>
          <button type="button" onClick={addSource} className="rounded-[12px] bg-[var(--color-bv-accent)] px-4 py-2 text-[13px] font-semibold text-white">
            Add selected item
          </button>
        </div>

        {components.length === 0 ? (
          <div className="rounded-[16px] border border-dashed border-slate-200 px-4 py-8 text-center text-[13px] text-slate-500">
            Add at least two components to save a bundle.
          </div>
        ) : (
          <div className="grid gap-3">
            {normalizedComponents.map(({ component, totalCostCents, totalSellCents }, index) => (
              <ComponentEditor
                key={`${component.componentCatalogItemId ?? 'custom'}-${index}`}
                component={component}
                index={index}
                totalCostCents={totalCostCents}
                totalSellCents={totalSellCents}
                onPatch={(patch) => patchComponent(index, patch)}
                onMove={(direction) => moveComponent(index, direction)}
                onRemove={() => setComponents((current) => current.filter((_, i) => i !== index))}
              />
            ))}
          </div>
        )}
      </section>

      <div className="flex items-center justify-end gap-3">
        <button type="submit" disabled={pending || components.length < 2} className="rounded-[12px] bg-[var(--color-bv-accent)] px-5 py-2.5 text-[13.5px] font-semibold text-white shadow-[0_16px_34px_rgba(47,90,243,0.24)] disabled:opacity-60">
          {pending ? 'Saving...' : mode === 'edit' ? 'Save bundle' : 'Create bundle'}
        </button>
      </div>
    </form>
  );
}

function ComponentEditor({
  component,
  index,
  totalCostCents,
  totalSellCents,
  onPatch,
  onMove,
  onRemove,
}: {
  component: BundleComponentDraft;
  index: number;
  totalCostCents: number;
  totalSellCents: number;
  onPatch: (patch: Partial<BundleComponentDraft>) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  const selectedVendorOptions = component.vendorSnapshot;
  return (
    <article className="rounded-[16px] border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Component {index + 1}</p>
          {component.componentCatalogItemId ? <p className="mt-1 text-[11px] text-slate-500">Snapshot from catalog item. Edits here do not mutate the source.</p> : null}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => onMove(-1)} className="rounded-lg border border-slate-200 px-2 py-1 text-[12px]">Up</button>
          <button type="button" onClick={() => onMove(1)} className="rounded-lg border border-slate-200 px-2 py-1 text-[12px]">Down</button>
          <button type="button" onClick={onRemove} className="rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-[12px] font-semibold text-rose-700">Remove</button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <label className="flex flex-col gap-1.5 md:col-span-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Name</span>
          <input value={component.componentName} onChange={(e) => onPatch({ componentName: e.currentTarget.value })} className="h-10 rounded-[10px] border border-slate-200 px-3 text-[13px]" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Type</span>
          <SelectControl value={component.componentType} onChange={(e) => onPatch({ componentType: e.currentTarget.value as EstimateLineKind, categories: [e.currentTarget.value] })} className="h-10 rounded-[10px] border border-slate-200 px-3 text-[13px]">
            {KINDS.map((kind) => <option key={kind} value={kind}>{kindLabel(kind)}</option>)}
          </SelectControl>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Unit</span>
          <SelectControl value={component.unit} onChange={(e) => onPatch({ unit: e.currentTarget.value as ShopCatalogUnit })} className="h-10 rounded-[10px] border border-slate-200 px-3 text-[13px]">
            {UNITS.map((unit) => <option key={unit} value={unit}>{unit.replace(/_/g, ' ')}</option>)}
          </SelectControl>
        </label>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-5">
        <MoneyField label="Internal unit cost" cents={component.internalUnitCostCents} onChange={(cents) => onPatch({ internalUnitCostCents: cents ?? 0 })} />
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Qty</span>
          <input value={component.quantity} onChange={(e) => onPatch({ quantity: e.currentTarget.value })} inputMode="decimal" className="h-10 rounded-[10px] border border-slate-200 px-3 text-[13px]" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Markup %</span>
          <input value={markupInputFromMilli(component.markupPercentMilli)} onChange={(e) => onPatch({ markupPercentMilli: markupMilliFromInput(e.currentTarget.value) })} inputMode="decimal" className="h-10 rounded-[10px] border border-slate-200 px-3 text-[13px]" />
        </label>
        <MoneyField label="Sell override" cents={component.defaultSellCents} onChange={(cents) => onPatch({ defaultSellCents: cents })} />
        <div className="rounded-[12px] border border-slate-100 bg-slate-50 px-3 py-2 text-[12px]">
          <p>Cost <strong>{formatMoney(totalCostCents)}</strong></p>
          <p>Sell <strong>{formatMoney(totalSellCents)}</strong></p>
        </div>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr]">
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Selected vendor</span>
          <SelectControl value={component.selectedVendorId ?? ''} onChange={(e) => onPatch({ selectedVendorId: e.currentTarget.value || null })} searchable searchPlaceholder="Search vendors..." className="h-10 rounded-[10px] border border-slate-200 px-3 text-[13px]">
            <option value="">None</option>
            {selectedVendorOptions.map((vendor) => (
              <option key={vendor.vendorId} value={vendor.vendorId}>
                {vendor.vendorName}{vendor.latestPriceCents !== null ? ` · ${formatMoney(vendor.latestPriceCents)}` : ''}
              </option>
            ))}
          </SelectControl>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">Notes</span>
          <input value={component.notes ?? ''} onChange={(e) => onPatch({ notes: e.currentTarget.value || null })} className="h-10 rounded-[10px] border border-slate-200 px-3 text-[13px]" />
        </label>
      </div>

      {component.vendorSnapshot.length > 0 ? (
        <div className="mt-3 rounded-[12px] border border-emerald-100 bg-emerald-50/50 px-3 py-2 text-[12px] text-emerald-950">
          Vendor snapshot: {component.vendorSnapshot.map((row) => `${row.vendorName}${row.latestPriceCents !== null ? ` ${formatMoney(row.latestPriceCents)}` : ''}${row.isPreferred ? ' preferred' : row.isCheapest ? ' cheapest' : ''}`).join(' · ')}
        </div>
      ) : null}
    </article>
  );
}

function MoneyField({
  label,
  cents,
  onChange,
}: {
  label: string;
  cents: number | null;
  onChange: (cents: number | null) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</span>
      <input
        value={centsToUsd(cents)}
        onChange={(e) => onChange(e.currentTarget.value.trim() ? usdToCents(e.currentTarget.value) : null)}
        inputMode="decimal"
        className="h-10 rounded-[10px] border border-slate-200 px-3 text-[13px]"
      />
    </label>
  );
}
