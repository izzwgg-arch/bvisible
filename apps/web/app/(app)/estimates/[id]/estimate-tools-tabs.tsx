'use client';

import { useMemo, useState } from 'react';
import { EstimateLineKind } from '@bvisible/db';

import {
  SectionCard,
  IconBadge,
  IconCatalog,
} from '@/components/estimate/estimate-surface';
import { SelectControl } from '@/components/app/select-control';
import type { EstimateCatalogPickerRow } from '@/lib/shop-material/apply-catalog-to-estimate-line';
import { CatalogItemPicker } from './catalog-item-picker';
import { VendorCatalogIntelPanel } from './vendor-catalog-intel-panel';
import type { Action, DraftLine } from './editor';

type ToolTab = 'catalog' | 'vehicle' | 'offer' | 'vendor' | 'intel' | 'change';

const TABS: ReadonlyArray<{
  id: ToolTab;
  label: string;
  hint: string;
}> = [
  { id: 'catalog', label: 'Catalog', hint: 'Apply saved items' },
  { id: 'vehicle', label: 'Vehicle', hint: 'Vehicle wrap calculator' },
  { id: 'offer', label: 'Offer', hint: 'Quote package and customer offer' },
  { id: 'vendor', label: 'Vendor', hint: 'Supplier planning' },
  { id: 'intel', label: 'Intel', hint: 'Cheapest / preferred' },
  { id: 'change', label: 'Change', hint: 'Revision notes and change requests' },
];

function IconChart() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 3v18h18" />
      <path d="m7 14 3-3 3 2 4-5" />
    </svg>
  );
}

function ToolTabIcon({ tab }: { tab: ToolTab }) {
  if (tab === 'catalog') {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M5 4h10a2 2 0 0 1 2 2v14l-6-3-6 3V6a2 2 0 0 1 2-2Z" />
        <path d="M19 5v13" />
      </svg>
    );
  }
  if (tab === 'vehicle') {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 13h2l2-4h8l2 4h2v4H4z" />
        <circle cx="8" cy="17" r="1.5" />
        <circle cx="16" cy="17" r="1.5" />
      </svg>
    );
  }
  if (tab === 'offer') {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M5 5h14v14H5z" />
        <path d="M8 9h8M8 13h5" />
      </svg>
    );
  }
  if (tab === 'vendor') {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 10h16l-2-5H6z" />
        <path d="M6 10v9M18 10v9M4 19h16" />
      </svg>
    );
  }
  if (tab === 'intel') {
    return (
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M12 3v3M12 18v3M4.6 7.6l2.1 2.1M17.3 17.3l2.1 2.1M3 12h3M18 12h3" />
        <circle cx="12" cy="12" r="4" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M6 4v16M6 6h11l-2 4 2 4H6" />
    </svg>
  );
}

export function EstimateToolsTabs({
  catalog,
  machines,
  catalogLineId,
  lines,
  readOnly = false,
  vendorIntelLine,
  onApplyManagedCost,
  onCatalogApply,
  estimateVehicle,
  dispatch,
}: {
  catalog: ReadonlyArray<EstimateCatalogPickerRow>;
  machines: ReadonlyArray<{ id: string; name: string; ratePerHourCents: number }>;
  catalogLineId: string | null;
  lines: ReadonlyArray<DraftLine>;
  readOnly?: boolean;
  vendorIntelLine: DraftLine | null;
  estimateVehicle: {
    year: number | null;
    make: string | null;
    model: string | null;
    trim: string | null;
    bodyStyle: string | null;
    vehicleType: string | null;
    profile: {
      totalApproxWrapSqFt: number | null;
      sideApproxSqFt: number | null;
      roofApproxSqFt: number | null;
      hoodApproxSqFt: number | null;
      rearApproxSqFt: number | null;
      frontApproxSqFt: number | null;
    } | null;
  } | null;
  onApplyManagedCost?: (lineId: string, unitCostCents: number) => void;
  onCatalogApply?: () => void;
  dispatch: React.Dispatch<Action>;
}) {
  const [tab, setTab] = useState<ToolTab | null>('catalog');
  const vendorHintAvailable = vendorIntelLine != null;

  const tone = tab === 'vendor' || tab === 'intel' ? 'emerald' : 'emerald';
  const icon = tab === 'vendor' || tab === 'intel' ? <IconChart /> : <IconCatalog />;
  const activeMeta = tab ? TABS.find((t) => t.id === tab)! : null;

  return (
    <SectionCard id="estimate-tools" className="overflow-hidden">
      <div className="border-b border-slate-100 bg-white px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <IconBadge tone={tone as never}>{icon}</IconBadge>
          <div className="min-w-0">
            <h2 className="text-[13px] font-black uppercase leading-none tracking-[0.16em] text-slate-950">
              Estimating tools
            </h2>
            <p className="mt-1 truncate text-[11px] leading-none text-slate-500">
              {activeMeta?.hint ?? 'Open only when you need catalog, calculators, or vendor pricing.'}
            </p>
          </div>
        </div>

        <div
          role="tablist"
          aria-label="Estimating tools"
          className="mt-3 grid grid-cols-6 gap-1.5"
        >
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab((current) => (current === t.id ? null : t.id))}
                className={`relative inline-flex h-[42px] flex-col items-center justify-center gap-0.5 rounded-[7px] border px-1 text-[10px] font-bold transition ${
                  active
                    ? 'border-indigo-200 bg-indigo-50 text-indigo-700 shadow-sm shadow-indigo-100/70'
                    : 'border-transparent bg-slate-50/80 text-slate-500 hover:bg-slate-100 hover:text-slate-800'
                }`}
              >
                <ToolTabIcon tab={t.id} />
                <span className="leading-none">{t.label}</span>
                {t.id === 'intel' && vendorHintAvailable ? (
                  <span
                    aria-hidden
                    className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-white"
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {tab ? (
        <div role="tabpanel">
          {tab === 'catalog' ? (
            <CatalogItemPicker
              catalog={catalog}
              machines={machines}
              activeLineId={catalogLineId}
              lines={lines}
              readOnly={readOnly}
              embedded
              onApplied={onCatalogApply}
              dispatch={dispatch}
            />
          ) : null}
          {tab === 'vehicle' ? (
            <VehicleEstimatorPanel
              activeLineId={catalogLineId}
              estimateVehicle={estimateVehicle}
              readOnly={readOnly}
              dispatch={dispatch}
            />
          ) : null}
          {tab === 'offer' ? (
            <ToolEmpty
              title="Offer workspace"
              detail="Use preview and send actions above to package the customer-facing offer."
            />
          ) : null}
          {tab === 'vendor' ? (
            <ToolEmpty
              title="Vendor planning"
              detail="Focus a material line, then use Intel to compare preferred and cheapest supplier costs."
            />
          ) : null}
          {tab === 'intel' ? (
            <VendorCatalogIntelPanel
              line={vendorIntelLine}
              readOnly={readOnly}
              embedded
              onApplyManagedCost={onApplyManagedCost}
            />
          ) : null}
          {tab === 'change' ? (
            <ToolEmpty
              title="Change control"
              detail="Track revision notes in estimate details for now. Saved change requests can be added here later."
            />
          ) : null}
        </div>
      ) : null}
    </SectionCard>
  );
}

function ToolEmpty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="px-5 pb-5 pt-4">
      <div className="rounded-[16px] border border-dashed border-slate-200 bg-slate-50/70 px-4 py-4">
        <p className="text-[13px] font-bold text-slate-900">{title}</p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-slate-500">{detail}</p>
      </div>
    </div>
  );
}

function VehicleEstimatorPanel({
  activeLineId,
  estimateVehicle,
  readOnly,
  dispatch,
}: {
  activeLineId: string | null;
  estimateVehicle: {
    year: number | null;
    make: string | null;
    model: string | null;
    trim: string | null;
    bodyStyle: string | null;
    vehicleType: string | null;
    profile: {
      totalApproxWrapSqFt: number | null;
      sideApproxSqFt: number | null;
      roofApproxSqFt: number | null;
      hoodApproxSqFt: number | null;
      rearApproxSqFt: number | null;
      frontApproxSqFt: number | null;
    } | null;
  } | null;
  readOnly: boolean;
  dispatch: React.Dispatch<Action>;
}) {
  const [coverage, setCoverage] = useState('full');
  const [overrideSqFt, setOverrideSqFt] = useState('');
  const profile = estimateVehicle?.profile;
  const estimatedSqFt = useMemo(() => {
    if (!profile) return 0;
    if (coverage === 'custom') return Math.max(0, Number(overrideSqFt) || 0);
    if (coverage === 'partial') return Math.max(0, (profile.sideApproxSqFt ?? 0) + (profile.rearApproxSqFt ?? 0));
    if (coverage === 'sides') return Math.max(0, profile.sideApproxSqFt ?? 0);
    if (coverage === 'hood') return Math.max(0, profile.hoodApproxSqFt ?? 0);
    if (coverage === 'roof') return Math.max(0, profile.roofApproxSqFt ?? 0);
    if (coverage === 'rear') return Math.max(0, profile.rearApproxSqFt ?? 0);
    if (coverage === 'front') return Math.max(0, profile.frontApproxSqFt ?? 0);
    return Math.max(0, profile.totalApproxWrapSqFt ?? 0);
  }, [coverage, overrideSqFt, profile]);

  const vehicleName = estimateVehicle
    ? [estimateVehicle.year, estimateVehicle.make, estimateVehicle.model, estimateVehicle.trim].filter(Boolean).join(' ')
    : 'No vehicle attached';
  const qtyMilli = Math.round(estimatedSqFt * 1000);

  function addLine(kind: DraftLine['kind'], description: string, qty: number, unitCostCents = 0) {
    if (readOnly) return;
    dispatch({
      type: 'add-line',
      kind,
      patch: { description, qtyMilli: Math.round(qty * 1000), unitCostCents, machineId: null, notes: 'Added from vehicle estimating helper.' },
    });
  }

  return (
    <div className="border-b border-slate-100 px-4 py-4">
      <h3 className="text-[11px] font-black uppercase tracking-[0.1em] text-slate-700">
        Vehicle wrap calculator
      </h3>
      <div className="mt-4 grid grid-cols-4 items-end gap-2 rounded-[8px] bg-slate-50 p-3">
        <VehicleShape className="col-span-2 h-14" />
        <VehicleShape className="h-12 scale-x-75" />
        <VehicleShape className="h-10 rotate-90 scale-x-75" />
      </div>
      <p className="mt-3 text-[11px] font-semibold text-slate-600">{vehicleName}</p>
      {!estimateVehicle ? (
        <div className="mt-4 rounded-[14px] border border-dashed border-slate-200 bg-slate-50 px-4 py-4 text-[12px] font-semibold text-slate-500">
          Attach a vehicle from the left rail to enable wrap coverage helpers. Estimates continue to work without one.
        </div>
      ) : null}
      <label className="mt-4 block">
        <span className="text-[10.5px] font-black uppercase tracking-[0.12em] text-slate-400">Coverage</span>
        <SelectControl value={coverage} onChange={(e) => setCoverage(e.currentTarget.value)} className="mt-1 w-full rounded-[8px] border border-slate-200 bg-white px-3 py-2 text-[12px] font-bold text-slate-800">
          <option value="full">Full wrap</option>
          <option value="partial">Partial wrap</option>
          <option value="sides">Sides only</option>
          <option value="hood">Hood only</option>
          <option value="roof">Roof only</option>
          <option value="rear">Rear only</option>
          <option value="front">Front only</option>
          <option value="custom">Custom sq ft</option>
        </SelectControl>
      </label>
      {coverage === 'custom' ? (
        <input
          value={overrideSqFt}
          onChange={(e) => setOverrideSqFt(e.currentTarget.value)}
          placeholder="Custom sq ft"
          type="number"
          step="0.1"
          className="mt-2 w-full rounded-[8px] border border-slate-200 bg-white px-3 py-2 text-[12px] font-bold text-slate-800"
        />
      ) : null}
      <dl className="mt-4 grid gap-2 border-t border-slate-100 pt-3 text-[11px]">
        <ToolMeasure label="Selected coverage" value={`${estimatedSqFt.toFixed(estimatedSqFt % 1 ? 1 : 0)} sq ft`} highlight />
        <ToolMeasure label="Sides" value={formatSqFt(profile?.sideApproxSqFt)} />
        <ToolMeasure label="Roof" value={formatSqFt(profile?.roofApproxSqFt)} />
        <ToolMeasure label="Hood" value={formatSqFt(profile?.hoodApproxSqFt)} />
        <ToolMeasure label="Rear" value={formatSqFt(profile?.rearApproxSqFt)} />
        <ToolMeasure label="Front" value={formatSqFt(profile?.frontApproxSqFt)} />
      </dl>
      <p className="mt-3 rounded-[10px] bg-amber-50 px-3 py-2 text-[11px] font-semibold leading-relaxed text-amber-900">
        Wrap square footage is an estimate and can be edited.
      </p>
      <button
        type="button"
        disabled={readOnly || !activeLineId || qtyMilli <= 0}
        onClick={() => activeLineId ? dispatch({ type: 'set-line', id: activeLineId, patch: { qtyMilli, notes: `Vehicle ${coverage} estimate: ${estimatedSqFt.toFixed(1)} sq ft.` } }) : null}
        className="mt-4 w-full rounded-[7px] bg-[#4f46e5] px-3 py-2.5 text-[12px] font-bold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
      >
        Apply sq ft to focused line
      </button>
      <div className="mt-4 grid gap-2 text-[11px] text-slate-600">
        <button type="button" disabled={readOnly || qtyMilli <= 0} onClick={() => addLine(EstimateLineKind.MATERIAL, `Vehicle wrap vinyl - ${coverage}`, estimatedSqFt)} className="flex items-center justify-between rounded-[7px] bg-slate-100 px-3 py-2.5 font-bold text-slate-700 disabled:opacity-50">
          Add material line <span>{estimatedSqFt.toFixed(1)} sq ft</span>
        </button>
        <button type="button" disabled={readOnly || qtyMilli <= 0} onClick={() => addLine(EstimateLineKind.MATERIAL, `Vehicle laminate - ${coverage}`, estimatedSqFt)} className="flex items-center justify-between rounded-[7px] bg-slate-100 px-3 py-2.5 font-bold text-slate-700 disabled:opacity-50">
          Add laminate line <span>{estimatedSqFt.toFixed(1)} sq ft</span>
        </button>
        <button type="button" disabled={readOnly || qtyMilli <= 0} onClick={() => addLine(EstimateLineKind.INSTALL, `Vehicle install labor - ${coverage}`, Math.max(1, Math.ceil(estimatedSqFt / 45)))} className="flex items-center justify-between rounded-[7px] bg-slate-100 px-3 py-2.5 font-bold text-slate-700 disabled:opacity-50">
          Add install labor line <span>{Math.max(1, Math.ceil(estimatedSqFt / 45))} hrs</span>
        </button>
      </div>
    </div>
  );
}

function formatSqFt(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${value.toFixed(value % 1 ? 1 : 0)} sq ft`
    : 'Missing';
}

function VehicleShape({ className = '' }: { className?: string }) {
  return (
    <div className={`relative ${className}`}>
      <div className="absolute bottom-3 left-1 right-1 h-6 rounded-[8px] bg-emerald-100 ring-1 ring-emerald-300" />
      <div className="absolute bottom-5 left-3 h-5 w-10 rounded-t-[8px] bg-white ring-1 ring-slate-300" />
      <div className="absolute bottom-1 left-4 h-4 w-4 rounded-full bg-slate-700 ring-2 ring-white" />
      <div className="absolute bottom-1 right-4 h-4 w-4 rounded-full bg-slate-700 ring-2 ring-white" />
    </div>
  );
}

function ToolMeasure({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-slate-500">{label}</dt>
      <dd className={`font-bold ${highlight ? 'text-emerald-600' : 'text-slate-700'}`}>{value}</dd>
    </div>
  );
}
