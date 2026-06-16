'use client';

import { useState } from 'react';

import {
  SectionCard,
  IconBadge,
  IconCatalog,
  IconCalculator,
} from '@/components/estimate/estimate-surface';
import type { EstimateCatalogPickerRow } from '@/lib/shop-material/apply-catalog-to-estimate-line';
import { CatalogItemPicker } from './catalog-item-picker';
import { PricingHelperPanel } from './pricing-helper-panel';
import { VendorCatalogIntelPanel } from './vendor-catalog-intel-panel';
import type { Action, DraftLine } from './editor';

type ToolTab = 'catalog' | 'pricing' | 'vendor';

const TABS: ReadonlyArray<{
  id: ToolTab;
  label: string;
  hint: string;
}> = [
  { id: 'catalog', label: 'Catalog', hint: 'Apply saved items' },
  { id: 'pricing', label: 'Pricing helper', hint: 'Sq ft · sheets · rolls' },
  { id: 'vendor', label: 'Vendor intel', hint: 'Cheapest / preferred' },
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

export function EstimateToolsTabs({
  catalog,
  machines,
  catalogLineId,
  lines,
  readOnly = false,
  vendorIntelLine,
  onApplyManagedCost,
  dispatch,
}: {
  catalog: ReadonlyArray<EstimateCatalogPickerRow>;
  machines: ReadonlyArray<{ id: string; name: string; ratePerHourCents: number }>;
  catalogLineId: string | null;
  lines: ReadonlyArray<DraftLine>;
  readOnly?: boolean;
  vendorIntelLine: DraftLine | null;
  onApplyManagedCost?: (lineId: string, unitCostCents: number) => void;
  dispatch: React.Dispatch<Action>;
}) {
  const [tab, setTab] = useState<ToolTab>('catalog');
  const vendorHintAvailable = vendorIntelLine != null;

  const tone =
    tab === 'pricing' ? 'violet' : tab === 'vendor' ? 'emerald' : 'emerald';
  const icon =
    tab === 'pricing' ? <IconCalculator /> : tab === 'vendor' ? <IconChart /> : <IconCatalog />;
  const activeMeta = TABS.find((t) => t.id === tab)!;

  return (
    <SectionCard className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-slate-100 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <IconBadge tone={tone as never}>{icon}</IconBadge>
          <div className="min-w-0">
            <h2 className="text-[14.5px] font-bold tracking-tight text-slate-950">
              Estimating tools
            </h2>
            <p className="mt-0.5 truncate text-[12.5px] text-slate-500">{activeMeta.hint}</p>
          </div>
        </div>

        <div
          role="tablist"
          aria-label="Estimating tools"
          className="inline-flex shrink-0 gap-1 rounded-[12px] border border-slate-200 bg-slate-50 p-1"
        >
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.id)}
                className={`relative rounded-[9px] px-3 py-1.5 text-[12px] font-bold transition ${
                  active
                    ? 'bg-blue-50 text-blue-700 shadow-sm ring-1 ring-inset ring-blue-200'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {t.label}
                {t.id === 'vendor' && vendorHintAvailable ? (
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

      <div role="tabpanel">
        {tab === 'catalog' ? (
          <CatalogItemPicker
            catalog={catalog}
            machines={machines}
            activeLineId={catalogLineId}
            lines={lines}
            readOnly={readOnly}
            embedded
            dispatch={dispatch}
          />
        ) : null}
        {tab === 'pricing' ? (
          <PricingHelperPanel
            activeLineId={catalogLineId}
            lines={lines}
            readOnly={readOnly}
            embedded
            dispatch={dispatch}
          />
        ) : null}
        {tab === 'vendor' ? (
          <VendorCatalogIntelPanel
            line={vendorIntelLine}
            readOnly={readOnly}
            embedded
            onApplyManagedCost={onApplyManagedCost}
          />
        ) : null}
      </div>
    </SectionCard>
  );
}
