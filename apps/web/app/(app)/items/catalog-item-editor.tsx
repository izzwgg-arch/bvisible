'use client';

import Link from 'next/link';
import { useActionState, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { EstimateLineKind, ShopCatalogUnit } from '@bvisible/db';
import { SelectControl } from '@/components/app/select-control';
import { FormError } from '@/components/auth/form-error';
import { formatMoney, formatQty, kindLabel, parseMoney } from '@/lib/estimate/format';
import { sellPriceFromCostAndMarkup } from '@/lib/shop-material/markup';
import {
  normalizePricingEngine,
  normalizeVendorCostSourceMode,
  pricingEngineLabel,
  PRICING_FORMULA_VERSION,
  type VendorCostSourceMode,
} from '@/lib/shop-material/pricing-engine';
import {
  createShopMaterialItemAction,
  updateShopMaterialItemEditorAction,
  type ShopMaterialActionState,
} from './actions';
import {
  CatalogItemPricingTools,
  type CatalogPricingToolChange,
  type CatalogPricingToolValues,
  type CatalogVendorDisplayRow,
  type CatalogVendorDraftRow,
} from './catalog-item-pricing-tools';

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

type EditorItem = {
  id: string;
  name: string;
  itemCode: string | null;
  kind: EstimateLineKind;
  categories: string[];
  catalogUnit: ShopCatalogUnit;
  customUnitLabel: string | null;
  internalCostCents: number;
  markupPercentMilli: number;
  defaultSellPriceCents: number | null;
  defaultQtyMilli: number;
  pricingMethod: string | null;
  pricingEngine: string;
  pricingInputsJson: unknown;
  pricingOutputJson: unknown;
  formulaVersion: string | null;
  calculatedCostCents: number | null;
  calculatedSellCents: number | null;
  pricingNotes: string | null;
  machineId: string | null;
  customerDescription: string | null;
  notes: string | null;
  isActive: boolean;
  preferredVendorId: string | null;
  selectedVendorId: string | null;
  selectedVendorMode: string;
  createdAt?: Date;
  updatedAt?: Date;
};

function categoryLabel(category: string) {
  return KINDS.includes(category as EstimateLineKind)
    ? kindLabel(category as EstimateLineKind)
    : category;
}

function moneyString(cents: number | null | undefined) {
  return cents == null ? '' : (cents / 100).toFixed(2);
}

function markupString(markupPercentMilli: number) {
  return markupPercentMilli % 1000 === 0
    ? String(markupPercentMilli / 1000)
    : (markupPercentMilli / 1000).toFixed(3).replace(/\.?0+$/, '');
}

function parseCost(raw: string) {
  const parsed = parseMoney(raw);
  return parsed == null || parsed < 0 ? 0 : parsed;
}

export function CatalogItemEditor({
  mode,
  item,
  machines,
  savedCategories,
  vendors,
  vendorRows,
}: {
  mode: 'create' | 'edit';
  item?: EditorItem;
  machines: ReadonlyArray<{ id: string; name: string; ratePerHourCents: number }>;
  savedCategories: ReadonlyArray<string>;
  vendors: ReadonlyArray<{ id: string; name: string }>;
  vendorRows: CatalogVendorDisplayRow[];
}) {
  const router = useRouter();
  const initialActionState: ShopMaterialActionState = { error: null };
  const [createState, createAction] = useActionState(createShopMaterialItemAction, initialActionState);
  const [updateState, updateAction] = useActionState(updateShopMaterialItemEditorAction, initialActionState);

  const [name, setName] = useState(item?.name ?? '');
  const [itemCode, setItemCode] = useState(item?.itemCode ?? '');
  const [customerDescription, setCustomerDescription] = useState(item?.customerDescription ?? '');
  const [internalNotes, setInternalNotes] = useState(item?.notes ?? '');
  const [selectedCategory, setSelectedCategory] = useState(
    item?.categories[0] ?? item?.kind ?? EstimateLineKind.MATERIAL,
  );
  const [selectedMachineId, setSelectedMachineId] = useState(item?.machineId ?? '');
  const [isActive, setIsActive] = useState(item?.isActive ?? true);
  const [preferredVendorId, setPreferredVendorId] = useState<string | null>(item?.preferredVendorId ?? null);
  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(item?.selectedVendorId ?? null);
  const [selectedVendorMode, setSelectedVendorMode] = useState<VendorCostSourceMode>(
    normalizeVendorCostSourceMode(item?.selectedVendorMode),
  );
  const [vendorDraftRows, setVendorDraftRows] = useState<CatalogVendorDraftRow[]>([]);
  const [openVendorsTabSignal, setOpenVendorsTabSignal] = useState(0);
  const [pricingValues, setPricingValues] = useState<CatalogPricingToolValues>({
    internalCostUsd: moneyString(item?.internalCostCents ?? 0) || '0.00',
    markupPercent: markupString(item?.markupPercentMilli ?? 200000),
    defaultSellUsd: moneyString(item?.defaultSellPriceCents),
    defaultQty: item ? formatQty(item.defaultQtyMilli) : '1',
    catalogUnit: item?.catalogUnit ?? ShopCatalogUnit.EACH,
    pricing: {
      pricingMethod: item?.pricingMethod ?? '',
      pricingEngine: item?.pricingEngine ?? normalizePricingEngine(item?.pricingMethod),
      pricingInputsJson: item?.pricingInputsJson ? JSON.stringify(item.pricingInputsJson) : '',
      pricingOutputJson: item?.pricingOutputJson ? JSON.stringify(item.pricingOutputJson) : '',
      formulaVersion: item?.formulaVersion ?? PRICING_FORMULA_VERSION,
      selectedVendorId: item?.selectedVendorId ?? '',
      selectedVendorMode: normalizeVendorCostSourceMode(item?.selectedVendorMode),
      calculatedCostCents: item?.calculatedCostCents != null ? String(item.calculatedCostCents) : '',
      calculatedSellCents: item?.calculatedSellCents != null ? String(item.calculatedSellCents) : '',
      pricingNotes: item?.pricingNotes ?? '',
    },
  });

  const categoryOptions = useMemo(
    () => [...KINDS, ...savedCategories.filter((category) => !KINDS.includes(category as EstimateLineKind))],
    [savedCategories],
  );

  function patchPricingValues(patch: CatalogPricingToolChange) {
    setPricingValues((current) => ({
      ...current,
      ...patch,
      pricing: patch.pricing ? { ...current.pricing, ...patch.pricing } : current.pricing,
    }));
  }

  function handleSelectedVendorIdChange(vendorId: string | null) {
    setSelectedVendorId(vendorId);
    patchPricingValues({ pricing: { selectedVendorId: vendorId ?? '' } });
  }

  function handleSelectedVendorModeChange(mode: VendorCostSourceMode) {
    setSelectedVendorMode(mode);
    patchPricingValues({ pricing: { selectedVendorMode: mode } });
  }

  useEffect(() => {
    if (createState.redirectTo) router.push(createState.redirectTo);
  }, [createState.redirectTo, router]);

  const internalCostCents = parseCost(pricingValues.internalCostUsd);
  const defaultSellOverrideCents = pricingValues.defaultSellUsd.trim()
    ? parseCost(pricingValues.defaultSellUsd)
    : null;
  const markupMilli = Math.round((Number(pricingValues.markupPercent || '0') || 0) * 1000);
  const sellHintCents = defaultSellOverrideCents ?? sellPriceFromCostAndMarkup(internalCostCents, markupMilli);
  const marginPct = sellHintCents > 0 ? ((sellHintCents - internalCostCents) / sellHintCents) * 100 : null;
  const allVendorRows = [...vendorRows, ...vendorDraftRows.map((row) => ({
    id: row.id,
    vendorId: row.vendorId,
    vendorName: row.vendorId === '__new__' ? row.newVendorName || 'New vendor' : vendors.find((v) => v.id === row.vendorId)?.name ?? 'Selected vendor',
    priceCents: parseCost(row.unitCostUsd),
    vendorSku: row.vendorSku || null,
    unit: row.unit || null,
    leadTimeDays: parseInt(row.leadTimeDays, 10) || null,
    notes: row.notes || null,
    updatedAt: 'Unsaved',
    isPreferred: row.preferred,
    isCheapest: false,
  }))];
  const cheapestVendor = allVendorRows.filter((row) => row.priceCents >= 0).sort((a, b) => a.priceCents - b.priceCents)[0] ?? null;
  const preferredVendor = allVendorRows.find((row) => row.vendorId === preferredVendorId || row.isPreferred) ?? null;

  // "+ Add Vendor" (Vendor Pricing table) adds a new editable draft row and
  // scrolls to the Vendor pricing editor above, where the operator fills in
  // vendor + unit cost. Rows save with the item — as many as they like.
  function addVendorDraftRow() {
    setVendorDraftRows((rows) => [
      ...rows,
      {
        id: `draft-${Date.now()}-${rows.length}`,
        vendorId: '',
        newVendorName: '',
        vendorSku: '',
        unitCostUsd: '',
        unit: pricingValues.catalogUnit.replace(/_/g, ' '),
        leadTimeDays: '',
        notes: '',
        preferred: false,
        active: true,
      },
    ]);
    // Jump the Pricing Engine to the Vendors tab (where the editable rows
    // live) and scroll it into view so the new row is right there.
    setOpenVendorsTabSignal((n) => n + 1);
    if (typeof document !== 'undefined') {
      setTimeout(() => {
        document
          .getElementById('vendor-pricing-editor')
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 80);
    }
  }
  const pricingOutputText = formatJsonPreview(pricingValues.pricing.pricingOutputJson);
  const pricingInputs = parseJsonRecord(pricingValues.pricing.pricingInputsJson);
  const pricingPreviewRows = previewRowsForEngine(pricingValues.pricing.pricingEngine, pricingInputs, {
    internalCostCents,
    sellHintCents,
    marginPct,
  });

  const formAction = mode === 'create' ? createAction : updateAction;
  const actionError = mode === 'create' ? createState.error : updateState.error;

  return (
    <form action={formAction} className="w-full min-w-0 text-[#111827]">
      {item ? <input type="hidden" name="id" value={item.id} /> : null}
      <input type="hidden" name="categories" value={selectedCategory} />
      <input type="hidden" name="customUnitLabel" value={item?.customUnitLabel ?? ''} />
      <input type="hidden" name="isActive" value={String(isActive)} />
      <input type="hidden" name="preferredVendorId" value={preferredVendorId ?? ''} />
      <input type="hidden" name="vendorDraftRowsJson" value={JSON.stringify(vendorDraftRows)} />

      <div className="mb-4 flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-[#e6e9ef] bg-[#f7f8fb] pb-3">
        <div className="min-w-0 flex-1">
          <div className="mb-3 flex items-center gap-2 text-[11px] font-medium text-slate-500">
            <Link href="/items" className="hover:text-blue-700">Catalog</Link>
            <span className="text-slate-300">›</span>
            <span className="font-semibold text-slate-800">{mode === 'create' ? 'Create Item' : 'Edit Item'}</span>
          </div>
          <h1 className="text-[22px] font-bold tracking-[-0.02em] text-slate-950">
            {mode === 'create' ? 'Create Catalog Item' : name || 'Edit Catalog Item'}
          </h1>
          <p className="mt-1 text-[11px] text-slate-500">Build a catalog item with costs, markup, units, and vendor pricing.</p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-3">
          <span className="flex items-center gap-1.5 text-[10px] font-semibold text-emerald-600">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Auto-saved<br className="hidden sm:block" /> 2m ago
          </span>
          <Link href="/items" className="rounded-[4px] border border-[#dfe3ea] bg-white px-4 py-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">
            Cancel
          </Link>
          <button type="submit" className="rounded-[4px] bg-[#2563eb] px-4 py-2 text-[11px] font-semibold text-white hover:bg-blue-700">
            Save Item
          </button>
        </div>
      </div>

      <FormError message={actionError} />

      <div className="grid min-w-0 items-start gap-4 min-[1500px]:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0 space-y-4">
          <section className={panelClass}>
            <h2 className={sectionTitleClass}>Item Details</h2>
            <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.75fr)_minmax(0,0.75fr)]">
              <Field label="Item name" required>
                <input name="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={400} className={inputClass} />
              </Field>
              <Field label="SKU (optional)">
                <input name="itemCode" value={itemCode} onChange={(e) => setItemCode(e.target.value)} placeholder="ACM-4X8-WHT" className={inputClass} />
              </Field>
              <Field label="Category" required>
                <SelectControl value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)} className={inputClass}>
                  {categoryOptions.map((category) => (
                    <option key={category} value={category}>{categoryLabel(category)}</option>
                  ))}
                </SelectControl>
              </Field>
            </div>

            <div className="mt-3 grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.7fr)]">
              <Field label="Customer-facing description">
                <textarea name="customerDescription" value={customerDescription} onChange={(e) => setCustomerDescription(e.target.value)} rows={4} maxLength={2000} className={textareaClass} />
              </Field>
              <Field label="Internal notes">
                <textarea name="notes" value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} rows={4} maxLength={2000} className={textareaClass} />
              </Field>
              <div className="grid gap-3">
                <Field label="Unit" required>
                  <SelectControl name="catalogUnit" value={pricingValues.catalogUnit} onChange={(e) => patchPricingValues({ catalogUnit: e.target.value as ShopCatalogUnit })} className={inputClass}>
                    {UNITS.map((unit) => <option key={unit} value={unit}>{unit.replace(/_/g, ' ')}</option>)}
                  </SelectControl>
                </Field>
                <Field label="Default quantity" required>
                  <input name="defaultQty" value={pricingValues.defaultQty} onChange={(e) => patchPricingValues({ defaultQty: e.target.value })} className={inputClass} />
                </Field>
              </div>
            </div>

            <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2 min-[1500px]:grid-cols-4">
              <Field label="Default machine">
                <SelectControl name="machineId" value={selectedMachineId} onChange={(e) => setSelectedMachineId(e.target.value)} className={inputClass}>
                  <option value="">None</option>
                  {machines.map((machine) => <option key={machine.id} value={machine.id}>{machine.name}</option>)}
                </SelectControl>
              </Field>
              <Field label="Internal cost">
                <input name="internalCostUsd" value={pricingValues.internalCostUsd} onChange={(e) => patchPricingValues({ internalCostUsd: e.target.value })} inputMode="decimal" className={inputClass} />
              </Field>
              <Field label="Markup %">
                <input name="markupPercent" value={pricingValues.markupPercent} onChange={(e) => patchPricingValues({ markupPercent: e.target.value })} inputMode="decimal" className={inputClass} />
              </Field>
              <Field label="Default sell override">
                <input name="defaultSellUsd" value={pricingValues.defaultSellUsd} onChange={(e) => patchPricingValues({ defaultSellUsd: e.target.value })} inputMode="decimal" placeholder="Blank = markup" className={inputClass} />
              </Field>
            </div>
          </section>

          <section className={panelClass}>
            <h2 className={sectionTitleClass}>Pricing Engine</h2>
            <CatalogItemPricingTools
              values={pricingValues}
              onChange={patchPricingValues}
              vendors={vendors}
              vendorRows={vendorRows}
              vendorDraftRows={vendorDraftRows}
              onVendorDraftRowsChange={setVendorDraftRows}
              preferredVendorId={preferredVendorId}
              onPreferredVendorIdChange={setPreferredVendorId}
              selectedVendorId={selectedVendorId}
              onSelectedVendorIdChange={handleSelectedVendorIdChange}
              selectedVendorMode={selectedVendorMode}
              onSelectedVendorModeChange={handleSelectedVendorModeChange}
              machines={machines}
              selectedMachineId={selectedMachineId}
              onSelectedMachineIdChange={(machineId) => setSelectedMachineId(machineId ?? '')}
              catalogUnitLabel={pricingValues.catalogUnit.replace(/_/g, ' ')}
              openVendorsTabSignal={openVendorsTabSignal}
            />
          </section>

          <section className={panelClass}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <h2 className={sectionTitleClass}>Vendor Pricing</h2>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-semibold text-slate-600">Cost Source</span>
                <SelectControl
                  value={selectedVendorMode}
                  onChange={(e) => handleSelectedVendorModeChange(e.target.value as VendorCostSourceMode)}
                  className="h-8 rounded-[4px] border border-[#dfe3ea] bg-white px-2 text-[10px] font-medium text-slate-700"
                >
                  <option value="INTERNAL">Internal cost</option>
                  <option value="CHEAPEST">Cheapest Vendor</option>
                  <option value="PREFERRED">Preferred Vendor</option>
                  <option value="MANUAL">Selected Vendor</option>
                </SelectControl>
              </div>
            </div>
            <div className="overflow-x-auto rounded-[5px] border border-[#e6e9ef]">
              <table className="w-full min-w-[760px] text-left text-[10.5px]">
                <thead className="bg-[#fafbfc] text-[9px] font-bold uppercase tracking-[0.04em] text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Vendor</th>
                    <th className="px-3 py-2">Vendor SKU</th>
                    <th className="px-3 py-2 text-right">Unit Cost</th>
                    <th className="px-3 py-2">Unit</th>
                    <th className="px-3 py-2">Lead Time</th>
                    <th className="px-3 py-2 text-center">Preferred</th>
                    <th className="px-3 py-2 text-center">Cheapest</th>
                    <th className="px-3 py-2">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#eef0f4] bg-white">
                  {allVendorRows.length > 0 ? allVendorRows.map((row) => (
                    <tr key={row.id}>
                      <td className="px-3 py-2 font-semibold text-slate-900">{row.vendorName}</td>
                      <td className="px-3 py-2 font-mono text-[10px] text-slate-600">{row.vendorSku ?? '—'}</td>
                      <td className="px-3 py-2 text-right font-semibold text-slate-900">{formatMoney(row.priceCents)}</td>
                      <td className="px-3 py-2 text-slate-600">{row.unit ?? pricingValues.catalogUnit.replace(/_/g, ' ')}</td>
                      <td className="px-3 py-2 text-slate-600">{row.leadTimeDays != null ? `${row.leadTimeDays} days` : '—'}</td>
                      <td className="px-3 py-2 text-center"><RadioDot active={row.vendorId === preferredVendorId || row.isPreferred} /></td>
                      <td className="px-3 py-2 text-center"><StarDot active={cheapestVendor?.id === row.id || row.isCheapest} /></td>
                      <td className="px-3 py-2 text-slate-600">{row.notes ?? '—'}</td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={8} className="px-3 py-5 text-center text-[11px] text-slate-400">No vendor prices yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <button
              type="button"
              onClick={addVendorDraftRow}
              className="mt-2 text-[10.5px] font-semibold text-[#2563eb] hover:underline"
            >
              + Add Vendor
            </button>
          </section>

          <section className={panelClass}>
            <h2 className={sectionTitleClass}>Internal Guidance</h2>
            <textarea value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} rows={3} maxLength={2000} className={textareaClass} placeholder="Add internal guidance, usage instructions, or sourcing notes..." />
          </section>
        </div>

        <aside className="min-w-0 space-y-4 min-[1500px]:sticky min-[1500px]:top-4">
          <SummaryCard title="Item Summary">
            <div className="mb-3 flex gap-3">
              <div className="h-11 w-11 rounded-[4px] bg-[#eef0f4]" />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate text-[12px] font-bold text-slate-950">{name || 'Untitled catalog item'}</p>
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[8.5px] font-bold text-emerald-600">Active</span>
                </div>
                <p className="mt-0.5 text-[10px] text-slate-500">{categoryLabel(selectedCategory)}</p>
                <p className="text-[10px] text-slate-500">{pricingValues.catalogUnit.replace(/_/g, ' ')}</p>
              </div>
            </div>
            <SummaryRows rows={[
              ['SKU', itemCode || '—'],
              ['Category', categoryLabel(selectedCategory)],
              ['Unit', pricingValues.catalogUnit.replace(/_/g, ' ')],
              ['Default Quantity', pricingValues.defaultQty || '1'],
              ['Pricing Engine', pricingEngineLabel(pricingValues.pricing.pricingEngine || pricingValues.pricing.pricingMethod)],
              ['Cost Source', formatSource(selectedVendorMode)],
              ['Preferred Vendor', preferredVendor?.vendorName ?? '—'],
              ['Cheapest Vendor', cheapestVendor?.vendorName ?? '—'],
              ['Markup', `${pricingValues.markupPercent || '0'}%`],
            ]} />
          </SummaryCard>

          <SummaryCard title="Pricing Preview">
            <SummaryRows rows={pricingPreviewRows} />
          </SummaryCard>

          <SummaryCard title="Pricing Output Snapshot">
            <pre className="max-h-[260px] overflow-auto whitespace-pre-wrap rounded-[4px] border border-[#e6e9ef] bg-[#f8fafc] p-3 font-mono text-[9.5px] leading-relaxed text-slate-700">
              {pricingOutputText}
            </pre>
            <p className="mt-2 text-[9.5px] text-slate-400">
              {pricingValues.pricing.pricingOutputJson ? 'Last calculated just now' : 'Apply pricing to generate a snapshot'}
            </p>
          </SummaryCard>

          <SummaryCard title="Status">
            <label className="flex items-center justify-between gap-3 text-[11px] font-semibold text-slate-700">
              Active
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
            </label>
          </SummaryCard>
        </aside>
      </div>
    </form>
  );
}

const panelClass = 'rounded-[4px] border border-[#e6e9ef] bg-white p-4';
const sectionTitleClass = 'mb-3 text-[13px] font-bold text-slate-950';
const inputClass = 'h-9 w-full rounded-[4px] border border-[#dfe3ea] bg-white px-3 text-[11px] text-slate-900 outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-blue-500/10';
const textareaClass = 'w-full rounded-[4px] border border-[#dfe3ea] bg-white px-3 py-2 text-[11px] text-slate-900 outline-none focus:border-[#2563eb] focus:ring-2 focus:ring-blue-500/10';

function Field({ label, required, className, children }: { label: string; required?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <label className={`flex flex-col gap-1.5 ${className ?? ''}`}>
      <span className="text-[10.5px] font-bold uppercase tracking-[0.14em] text-slate-500">{label}{required ? ' *' : ''}</span>
      {children}
    </label>
  );
}

function SummaryCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[4px] border border-[#e6e9ef] bg-white p-4">
      <h3 className="mb-3 text-[12px] font-bold text-slate-950">{title}</h3>
      {children}
    </section>
  );
}

function SummaryRows({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="grid gap-2 text-[10.5px]">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between gap-3">
          <dt className="text-slate-500">{label}</dt>
          <dd className="max-w-[145px] truncate text-right font-semibold text-slate-900">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function RadioDot({ active }: { active: boolean }) {
  return (
    <span className={`inline-grid h-3.5 w-3.5 place-items-center rounded-full border ${active ? 'border-[#7c3aed]' : 'border-slate-300'}`}>
      {active ? <span className="h-1.5 w-1.5 rounded-full bg-[#7c3aed]" /> : null}
    </span>
  );
}

function StarDot({ active }: { active: boolean }) {
  return <span className={active ? 'text-[#111827]' : 'text-slate-300'}>★</span>;
}

function formatSource(mode: VendorCostSourceMode): string {
  switch (mode) {
    case 'CHEAPEST':
      return 'Cheapest Vendor';
    case 'PREFERRED':
      return 'Preferred Vendor';
    case 'MANUAL':
      return 'Selected Vendor';
    case 'INTERNAL':
      return 'Internal';
  }
}

function parseJsonRecord(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function formatJsonPreview(raw: string): string {
  if (!raw.trim()) return '{\n  "pricingOutput": "Apply pricing to item"\n}';
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function moneyFromUnknown(value: unknown): string | null {
  return typeof value === 'number' && Number.isFinite(value) ? formatMoney(value) : null;
}

function numberFromUnknown(value: unknown, suffix = ''): string | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}${suffix}`
    : null;
}

function previewRowsForEngine(
  engine: string,
  inputs: Record<string, unknown>,
  fallback: { internalCostCents: number; sellHintCents: number; marginPct: number | null },
): Array<[string, string]> {
  const normalized = normalizePricingEngine(engine);
  const common: Array<[string, string]> = [
    ['Total Material Cost', formatMoney(fallback.internalCostCents)],
    ['Sell Price', formatMoney(fallback.sellHintCents)],
    ['Margin', fallback.marginPct == null ? '—' : `${fallback.marginPct.toFixed(1)}%`],
  ];
  if (normalized === 'SHEET_GOODS') {
    return [
      ['Requested Sq Ft', numberFromUnknown(inputs.requestedSqft, '') ?? '—'],
      ['Sheet Needed', numberFromUnknown(inputs.sheetsNeeded, '') ?? '—'],
      ['Utilization', numberFromUnknown(inputs.usedRollPercentage ?? inputs.utilization, '%') ?? '—'],
      ['Billable Sheets', numberFromUnknown(inputs.billableSheets, '') ?? '—'],
      ...common,
    ];
  }
  if (normalized === 'ROLL_MATERIAL') {
    return [
      ['Usage Sq Ft', numberFromUnknown(inputs.usageSqft, '') ?? '—'],
      ['Billable Sq Ft', numberFromUnknown(inputs.billableSqft, '') ?? '—'],
      ['Used Roll %', numberFromUnknown(inputs.usedRollPercentage, '%') ?? '—'],
      ...common,
    ];
  }
  if (normalized === 'BANNER') {
    return [
      ['Banner Sq Ft', numberFromUnknown(inputs.sqft, '') ?? '—'],
      ['Grommets', numberFromUnknown(inputs.grommetCount, '') ?? '—'],
      ...common,
    ];
  }
  if (normalized === 'CHANNEL_LETTERS') {
    return [
      ['China Base', moneyFromUnknown(inputs.chinaBaseCostCents) ?? '—'],
      ['Shipping', moneyFromUnknown(inputs.shippingCents) ?? '—'],
      ['Landed Cost', moneyFromUnknown(inputs.landedCostCents) ?? '—'],
      ...common.slice(1),
    ];
  }
  return common;
}
