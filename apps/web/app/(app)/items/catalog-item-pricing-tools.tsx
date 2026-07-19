'use client';

import { useMemo, useState } from 'react';
import { ShopCatalogUnit } from '@bvisible/db';
import {
  bannerPrice,
  computeRollNominalSqft,
  computeSqft,
  computeTotalSqftFromPieces,
  qtyToMilli,
  rollEffectiveBillableSqft,
  rollMaterialLineCostCents,
  rollUsedFraction,
  sheetsNeededForCoverage,
  STANDARD_SHEET_SQ_FT,
} from '@bvisible/pricing';
import { SelectControl } from '@/components/app/select-control';
import { formatMoney, parseMoney } from '@/lib/estimate/format';
import { parseMarkupPercentToMilli, sellPriceFromCostAndMarkup } from '@/lib/shop-material/markup';
import {
  buildCatalogPricingOutputSnapshot,
  normalizePricingEngine,
  normalizeVendorCostSourceMode,
  pricingEngineLabel,
  pricingMethodForEngine,
  PRICING_FORMULA_VERSION,
  type PricingEngine,
  type VendorCostSourceMode,
} from '@/lib/shop-material/pricing-engine';

type PricingMethod = PricingEngine | 'CUSTOM';
type PricingTab = PricingMethod | 'VENDORS';
type CustomFormula = 'flat' | 'quantity' | 'area' | 'area-plus-count' | 'tiered-area';

type CatalogPricingState = {
  pricingMethod: string;
  pricingEngine: string;
  pricingInputsJson: string;
  pricingOutputJson: string;
  formulaVersion: string;
  selectedVendorId: string;
  selectedVendorMode: string;
  calculatedCostCents: string;
  calculatedSellCents: string;
  pricingNotes: string;
};

export type CatalogPricingToolValues = {
  internalCostUsd: string;
  markupPercent: string;
  defaultSellUsd: string;
  defaultQty: string;
  catalogUnit: ShopCatalogUnit;
  pricing: CatalogPricingState;
};

export type CatalogPricingToolChange = Partial<
  Pick<CatalogPricingToolValues, 'internalCostUsd' | 'markupPercent' | 'defaultSellUsd' | 'defaultQty' | 'catalogUnit'>
> & {
  pricing?: Partial<CatalogPricingState>;
};

const METHOD_LABELS: Record<PricingMethod, string> = {
  MANUAL: 'Manual',
  SQ_FT: 'Square Footage',
  SHEET_GOODS: 'Sheet Goods',
  ROLL_MATERIAL: 'Roll Material',
  BANNER: 'Banner',
  LABOR: 'Labor',
  INSTALL: 'Install',
  MACHINE: 'Machine',
  COST_PLUS: 'Cost Plus',
  CHANNEL_LETTERS: 'Channel Letters',
  BUNDLE: 'Bundle',
  CUSTOM: 'Custom',
};

const TAB_LABELS: Record<PricingTab, string> = {
  ...METHOD_LABELS,
  VENDORS: 'Vendors',
};

export type CatalogVendorDraftRow = {
  id: string;
  vendorId: string;
  newVendorName: string;
  vendorSku: string;
  unitCostUsd: string;
  unit: string;
  leadTimeDays: string;
  notes: string;
  preferred: boolean;
  active: boolean;
};

export type CatalogVendorDisplayRow = {
  id: string;
  vendorId: string;
  vendorName: string;
  priceCents: number;
  vendorSku: string | null;
  unit: string | null;
  leadTimeDays: number | null;
  notes: string | null;
  updatedAt: string;
  isPreferred: boolean;
  isCheapest: boolean;
};

const fieldClassName =
  'h-8 w-full rounded-[4px] border border-[#dfe3ea] bg-white px-2.5 text-[10.5px] text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-[#2563eb] focus:ring-2 focus:ring-blue-500/10';

function num(raw: string): number {
  const n = Number(String(raw).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function intStr(raw: string): number {
  return Math.max(0, Math.trunc(num(raw)));
}

function moneyString(cents: number): string {
  return (Math.max(0, cents) / 100).toFixed(2);
}

function qtyString(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/\.?0+$/, '');
}

function centsFromMoney(raw: string): number {
  const parsed = parseMoney(raw);
  return parsed === null || parsed < 0 ? 0 : parsed;
}

const CHANNEL_LETTER_LIGHTING = {
  BACKLIT: { label: 'Backlit', multiplier: 1 },
  FRONT_NO_ACRYLIC: { label: 'Front lit, no acrylic', multiplier: 1.25 },
  FRONT_ACRYLIC: { label: 'Front lit acrylic', multiplier: 1.35 },
  FRONT_BACK: { label: 'Front + back lit', multiplier: 1.55 },
} as const;

const CHANNEL_LETTER_CONSTRUCTION = {
  FLAT_THIN: { label: 'Flat / thin', multiplier: 1 },
  SEMI_CHANNEL: { label: 'Semi-channel', multiplier: 1.15 },
  FULL_CHANNEL: { label: 'Full channel', multiplier: 1.3 },
  DIVIDED_SECTIONS: { label: 'Divided sections', multiplier: 1.1 },
} as const;

const CHANNEL_LETTER_SHIPPING = {
  STANDARD: { label: 'Standard', percent: 38 },
  SMALL_ORDER: { label: 'Small order', percent: 45 },
} as const;

function sellCentsForUnit(unitCostCents: number, sellOverrideUsd: string, markupPercent: string): number {
  const override = parseMoney(sellOverrideUsd);
  if (sellOverrideUsd.trim() !== '' && override !== null && override >= 0) return override;
  const markup = parseMarkupPercentToMilli(markupPercent) ?? 0;
  return sellPriceFromCostAndMarkup(unitCostCents, markup);
}

function totalFromUnit(unitCostCents: number, qty: number): number {
  return Math.round(Math.max(0, unitCostCents) * Math.max(0, qty));
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[9px] font-semibold text-slate-600">
        {label}
      </span>
      {children}
    </label>
  );
}

export function CatalogItemPricingTools({
  values,
  onChange,
  vendors = [],
  vendorRows = [],
  vendorDraftRows = [],
  onVendorDraftRowsChange,
  preferredVendorId,
  onPreferredVendorIdChange,
  selectedVendorId,
  onSelectedVendorIdChange,
  selectedVendorMode,
  onSelectedVendorModeChange,
  machines = [],
  selectedMachineId,
  onSelectedMachineIdChange,
  catalogUnitLabel,
}: {
  values: CatalogPricingToolValues;
  onChange: (patch: CatalogPricingToolChange) => void;
  vendors?: ReadonlyArray<{ id: string; name: string }>;
  vendorRows?: CatalogVendorDisplayRow[];
  vendorDraftRows?: CatalogVendorDraftRow[];
  onVendorDraftRowsChange?: (rows: CatalogVendorDraftRow[]) => void;
  preferredVendorId?: string | null;
  onPreferredVendorIdChange?: (vendorId: string | null) => void;
  selectedVendorId?: string | null;
  onSelectedVendorIdChange?: (vendorId: string | null) => void;
  selectedVendorMode?: VendorCostSourceMode;
  onSelectedVendorModeChange?: (mode: VendorCostSourceMode) => void;
  machines?: ReadonlyArray<{ id: string; name: string; ratePerHourCents: number }>;
  selectedMachineId?: string | null;
  onSelectedMachineIdChange?: (machineId: string | null) => void;
  catalogUnitLabel?: string;
}) {
  const initialEngine = normalizePricingEngine(values.pricing.pricingEngine || values.pricing.pricingMethod);
  const [method, setMethod] = useState<PricingTab>(
    initialEngine === 'MANUAL' ? 'SHEET_GOODS' : initialEngine,
  );

  const [sqW, setSqW] = useState('48');
  const [sqH, setSqH] = useState('96');
  const [sqPieces, setSqPieces] = useState('1');
  const [sqftCostUsd, setSqftCostUsd] = useState(values.internalCostUsd);
  const [sqftSellUsd, setSqftSellUsd] = useState(values.defaultSellUsd);

  const [sheetTotalSqft, setSheetTotalSqft] = useState('32');
  const [sheetSize, setSheetSize] = useState<'48' | '510'>('48');
  const [sheetCostUsd, setSheetCostUsd] = useState(values.internalCostUsd);
  const [sheetSellUsd, setSheetSellUsd] = useState(values.defaultSellUsd);

  const [rollW, setRollW] = useState('54');
  const [rollLenFt, setRollLenFt] = useState('150');
  const [rollUsed, setRollUsed] = useState('400');
  const [rollMin, setRollMin] = useState('');
  const [rollCostSqftUsd, setRollCostSqftUsd] = useState(values.internalCostUsd);
  const [rollSellSqftUsd, setRollSellSqftUsd] = useState(values.defaultSellUsd);

  const [banSqft, setBanSqft] = useState('48');
  const [banGrommets, setBanGrommets] = useState('8');
  const [bannerSellUsd, setBannerSellUsd] = useState(values.defaultSellUsd);

  const [laborHours, setLaborHours] = useState('1');
  const [laborRateUsd, setLaborRateUsd] = useState(values.internalCostUsd === '0.00' ? '50.00' : values.internalCostUsd);
  const [laborPeople, setLaborPeople] = useState('1');
  const [laborSellUsd, setLaborSellUsd] = useState(values.defaultSellUsd);

  const [installHours, setInstallHours] = useState('1');
  const [installers, setInstallers] = useState('1');
  const [installRateUsd, setInstallRateUsd] = useState('150.00');
  const [installSellUsd, setInstallSellUsd] = useState(values.defaultSellUsd);

  const [machineId, setMachineId] = useState(selectedMachineId ?? '');
  const [machineHours, setMachineHours] = useState('1');
  const [machineRateUsd, setMachineRateUsd] = useState('0.00');
  const [machineSellUsd, setMachineSellUsd] = useState(values.defaultSellUsd);

  const [costPlusMaterialUsd, setCostPlusMaterialUsd] = useState('0.00');
  const [costPlusMachineUsd, setCostPlusMachineUsd] = useState('0.00');
  const [costPlusLaborUsd, setCostPlusLaborUsd] = useState('0.00');
  const [costPlusDesignUsd, setCostPlusDesignUsd] = useState('0.00');
  const [costPlusInstallUsd, setCostPlusInstallUsd] = useState('0.00');
  const [costPlusMiscUsd, setCostPlusMiscUsd] = useState('0.00');

  const [clSqft, setClSqft] = useState('10');
  const [clBaseUsd, setClBaseUsd] = useState('65.00');
  const [clLighting, setClLighting] = useState<keyof typeof CHANNEL_LETTER_LIGHTING>('BACKLIT');
  const [clConstruction, setClConstruction] = useState<keyof typeof CHANNEL_LETTER_CONSTRUCTION>('FLAT_THIN');
  const [clDepth, setClDepth] = useState('5');
  const [clShipping, setClShipping] = useState<keyof typeof CHANNEL_LETTER_SHIPPING>('STANDARD');

  const [customName, setCustomName] = useState('');
  const [customFormula, setCustomFormula] = useState<CustomFormula>('area-plus-count');
  const [customQty, setCustomQty] = useState('1');
  const [customCount, setCustomCount] = useState('0');
  const [customRateUsd, setCustomRateUsd] = useState(values.internalCostUsd);
  const [customCountRateUsd, setCustomCountRateUsd] = useState('0.00');
  const [customFlatUsd, setCustomFlatUsd] = useState('0.00');
  const [customMinimumUsd, setCustomMinimumUsd] = useState('0.00');
  const [customWastePct, setCustomWastePct] = useState('0');
  const [customRoundTo, setCustomRoundTo] = useState('0');
  const [customTierLimit, setCustomTierLimit] = useState('200');
  const [customTier2RateUsd, setCustomTier2RateUsd] = useState('0.00');
  const [customUnitLabel, setCustomUnitLabel] = useState('unit');

  const sqftEach = useMemo(() => computeSqft(num(sqW), num(sqH)), [sqW, sqH]);
  const sqftTotal = useMemo(
    () => computeTotalSqftFromPieces(sqftEach, intStr(sqPieces)),
    [sqftEach, sqPieces],
  );
  const sheetSqftNominal =
    sheetSize === '48' ? STANDARD_SHEET_SQ_FT.SHEET_4X8 : STANDARD_SHEET_SQ_FT.SHEET_5X10;
  const sheetTotal = num(sheetTotalSqft);
  const sheetsNeeded = useMemo(
    () => sheetsNeededForCoverage(sheetTotal, sheetSqftNominal),
    [sheetTotal, sheetSqftNominal],
  );
  const sheetWidthInches = sheetSize === '48' ? 48 : 60;
  const sheetHeightInches = sheetSize === '48' ? 96 : 120;
  const rawSheetsNeeded = sheetSqftNominal > 0 ? sheetTotal / sheetSqftNominal : 0;
  const sheetUtilization = sheetsNeeded > 0 ? (sheetTotal / (sheetsNeeded * sheetSqftNominal)) * 100 : 0;
  const totalBillableSheetSqft = sheetsNeeded * sheetSqftNominal;
  const rollNominal = useMemo(
    () => computeRollNominalSqft(num(rollW), num(rollLenFt)),
    [rollW, rollLenFt],
  );
  const rollBillable = useMemo(
    () => rollEffectiveBillableSqft(num(rollUsed), rollMin.trim() === '' ? null : num(rollMin)),
    [rollUsed, rollMin],
  );
  const rollFrac = useMemo(() => rollUsedFraction(rollBillable, rollNominal), [rollBillable, rollNominal]);
  const banner = useMemo(
    () => bannerPrice({ sqft: num(banSqft), grommets: intStr(banGrommets) }),
    [banSqft, banGrommets],
  );
  const selectedVendorModeValue = normalizeVendorCostSourceMode(
    selectedVendorMode ?? values.pricing.selectedVendorMode,
  );
  const allVendorRows = useMemo(
    () => [...vendorRows, ...vendorDraftRows.map(draftToDisplayRow)],
    [vendorDraftRows, vendorRows],
  );
  const cheapestVendor = useMemo(
    () => allVendorRows.filter((row) => row.priceCents >= 0).sort((a, b) => a.priceCents - b.priceCents)[0] ?? null,
    [allVendorRows],
  );
  const preferredVendor = useMemo(
    () => allVendorRows.find((row) => row.vendorId === preferredVendorId || row.isPreferred) ?? null,
    [allVendorRows, preferredVendorId],
  );
  const selectedVendor = useMemo(
    () => allVendorRows.find((row) => row.vendorId === selectedVendorId) ?? null,
    [allVendorRows, selectedVendorId],
  );
  const selectedVendorCostCents =
    selectedVendorModeValue === 'CHEAPEST'
      ? cheapestVendor?.priceCents ?? null
      : selectedVendorModeValue === 'PREFERRED'
        ? preferredVendor?.priceCents ?? null
        : selectedVendorModeValue === 'MANUAL'
          ? selectedVendor?.priceCents ?? null
          : null;
  const laborQty = Math.max(0, num(laborHours) * Math.max(1, num(laborPeople)));
  const laborRateCents = centsFromMoney(laborRateUsd);
  const laborCostCents = Math.round(laborQty * laborRateCents);
  const installQty = Math.max(0, num(installHours) * Math.max(1, num(installers)));
  const installRateCents = centsFromMoney(installRateUsd);
  const installCostCents = Math.round(installQty * installRateCents);
  const selectedMachine = machines.find((m) => m.id === machineId) ?? null;
  const resolvedMachineRateCents =
    selectedMachine?.ratePerHourCents ?? centsFromMoney(machineRateUsd);
  const machineCostCents = Math.round(Math.max(0, num(machineHours)) * resolvedMachineRateCents);
  const costPlusCostCents =
    centsFromMoney(costPlusMaterialUsd) +
    centsFromMoney(costPlusMachineUsd) +
    centsFromMoney(costPlusLaborUsd) +
    centsFromMoney(costPlusDesignUsd) +
    centsFromMoney(costPlusInstallUsd) +
    centsFromMoney(costPlusMiscUsd);
  const channelLetterPreview = useMemo(() => {
    const totalSqft = Math.max(0, num(clSqft));
    const basePerSqftCents = centsFromMoney(clBaseUsd);
    const lighting = CHANNEL_LETTER_LIGHTING[clLighting];
    const construction = CHANNEL_LETTER_CONSTRUCTION[clConstruction];
    const depthInches = Math.max(0, num(clDepth));
    const depthMultiplier = depthInches <= 3 ? 1 : depthInches <= 5 ? 1.1 : depthInches <= 8 ? 1.2 : 1.25;
    const shipping = CHANNEL_LETTER_SHIPPING[clShipping];
    const chinaBaseCostCents = Math.round(
      totalSqft * basePerSqftCents * lighting.multiplier * construction.multiplier * depthMultiplier,
    );
    const shippingCents = Math.round(chinaBaseCostCents * (shipping.percent / 100));
    const landedCostCents = chinaBaseCostCents + shippingCents;
    return {
      totalSqft,
      basePerSqftCents,
      lightingType: clLighting,
      lightingLabel: lighting.label,
      lightingMultiplier: lighting.multiplier,
      constructionType: clConstruction,
      constructionLabel: construction.label,
      constructionMultiplier: construction.multiplier,
      depthInches,
      depthMultiplier,
      shippingTier: clShipping,
      shippingLabel: shipping.label,
      shippingPercent: shipping.percent,
      chinaBaseCostCents,
      shippingCents,
      landedCostCents,
    };
  }, [clBaseUsd, clConstruction, clDepth, clLighting, clShipping, clSqft]);
  const customPreview = useMemo(() => {
    const baseQty = Math.max(0, num(customQty));
    const withWaste = baseQty * (1 + Math.max(0, num(customWastePct)) / 100);
    const roundTo = Math.max(0, num(customRoundTo));
    const billableQty = roundTo > 0 ? Math.ceil(withWaste / roundTo) * roundTo : withWaste;
    const flatCents = centsFromMoney(customFlatUsd);
    const rateCents = centsFromMoney(customRateUsd);
    const countRateCents = centsFromMoney(customCountRateUsd);
    const minimumCents = centsFromMoney(customMinimumUsd);
    const tierLimit = Math.max(0, num(customTierLimit));
    const tier2RateCents = centsFromMoney(customTier2RateUsd);
    const count = Math.max(0, num(customCount));
    let subtotal = flatCents;
    if (customFormula === 'quantity' || customFormula === 'area') {
      subtotal += Math.round(billableQty * rateCents);
    } else if (customFormula === 'area-plus-count') {
      subtotal += Math.round(billableQty * rateCents);
      subtotal += Math.round(count * countRateCents);
    } else if (customFormula === 'tiered-area') {
      subtotal += Math.round(Math.min(billableQty, tierLimit) * rateCents);
      subtotal += Math.round(Math.max(0, billableQty - tierLimit) * tier2RateCents);
      subtotal += Math.round(count * countRateCents);
    }
    return {
      billableQty,
      count,
      unitCostCents: customFormula === 'flat' ? Math.max(subtotal, minimumCents) : rateCents,
      totalCostCents: Math.max(subtotal, minimumCents),
      minimumApplied: minimumCents > 0 && subtotal < minimumCents,
    };
  }, [
    customCount,
    customCountRateUsd,
    customFlatUsd,
    customFormula,
    customMinimumUsd,
    customQty,
    customRateUsd,
    customRoundTo,
    customTier2RateUsd,
    customTierLimit,
    customWastePct,
  ]);

  function applyCalculated(args: {
    method: PricingMethod;
    unitCostCents: number;
    sellUnitCents: number;
    qty: number;
    catalogUnit: ShopCatalogUnit;
    inputs: Record<string, unknown>;
    outputDetails?: Record<string, unknown>;
    notes: string;
  }) {
    const calculatedCostCents = totalFromUnit(args.unitCostCents, args.qty);
    const calculatedSellCents = totalFromUnit(args.sellUnitCents, args.qty);
    const engine = args.method === 'CUSTOM' ? 'MANUAL' : args.method;
    const pricingMethod = args.method === 'CUSTOM' ? 'CUSTOM' : pricingMethodForEngine(engine);
    const effectiveSelectedVendorId =
      selectedVendorModeValue === 'CHEAPEST'
        ? cheapestVendor?.vendorId ?? null
        : selectedVendorModeValue === 'PREFERRED'
          ? preferredVendor?.vendorId ?? null
          : selectedVendorModeValue === 'MANUAL'
            ? selectedVendorId ?? null
            : null;
    const output = buildCatalogPricingOutputSnapshot({
      pricingMethod,
      pricingEngine: engine,
      internalUnitCostCents: args.unitCostCents,
      sellHintCents: args.sellUnitCents,
      defaultQuantity: args.qty,
      unit: args.catalogUnit,
      markupPercent: num(values.markupPercent),
      selectedVendorId: effectiveSelectedVendorId,
      selectedVendorMode: selectedVendorModeValue,
      vendorPricingSource: {
        selectedVendorCostCents,
        cheapestVendorCostCents: cheapestVendor?.priceCents ?? null,
        preferredVendorCostCents: preferredVendor?.priceCents ?? null,
      },
      details: args.outputDetails ?? args.inputs,
    });
    onChange({
      catalogUnit: args.catalogUnit,
      internalCostUsd: moneyString(args.unitCostCents),
      defaultSellUsd: args.sellUnitCents > 0 ? moneyString(args.sellUnitCents) : '',
      defaultQty: qtyString(args.qty),
      pricing: {
        pricingMethod: pricingMethod ?? '',
        pricingEngine: engine,
        pricingInputsJson: JSON.stringify(args.inputs),
        pricingOutputJson: JSON.stringify(output),
        formulaVersion: PRICING_FORMULA_VERSION,
        selectedVendorId: effectiveSelectedVendorId ?? '',
        selectedVendorMode: selectedVendorModeValue,
        calculatedCostCents: String(calculatedCostCents),
        calculatedSellCents: String(calculatedSellCents),
        pricingNotes: args.notes,
      },
    });
    onSelectedVendorIdChange?.(effectiveSelectedVendorId);
    onSelectedVendorModeChange?.(selectedVendorModeValue);
  }

  return (
    <div className="space-y-3">
      <div className="hidden flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-violet-700">Pricing tools</p>
          <h3 className="mt-1 text-[18px] font-semibold tracking-[-0.03em] text-slate-950">
            Calculate catalog cost and sell guidance
          </h3>
          <p className="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-slate-500">
            These helpers save a priced catalog item. Estimates still receive an editable snapshot when the item is applied.
          </p>
        </div>
        <div className="rounded-[14px] border border-white/80 bg-white/90 px-4 py-3 text-[12px] shadow-sm">
          <span className="text-slate-500">Saved method: </span>
          <strong className="text-slate-900">
            {pricingEngineLabel(values.pricing.pricingEngine || values.pricing.pricingMethod)}
          </strong>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-[#e6e9ef]">
        {(['SQ_FT', 'SHEET_GOODS', 'ROLL_MATERIAL', 'BANNER', 'LABOR', 'INSTALL', 'MACHINE', 'COST_PLUS', 'CHANNEL_LETTERS', 'VENDORS', 'CUSTOM'] as PricingTab[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMethod(m)}
            className={`border-b-2 px-2.5 py-2 text-[10px] font-semibold transition ${
              method === m
                ? 'border-[#2563eb] text-[#2563eb]'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            {TAB_LABELS[m]}
          </button>
        ))}
      </div>

      <div>
        {method === 'SQ_FT' ? (
          <div className="grid gap-3">
            <div className="grid gap-3 lg:grid-cols-3">
              <Field label="Width (in)"><input value={sqW} onChange={(e) => setSqW(e.target.value)} inputMode="decimal" className={fieldClassName} /></Field>
              <Field label="Height (in)"><input value={sqH} onChange={(e) => setSqH(e.target.value)} inputMode="decimal" className={fieldClassName} /></Field>
              <Field label="Pieces"><input value={sqPieces} onChange={(e) => setSqPieces(e.target.value)} inputMode="numeric" className={fieldClassName} /></Field>
            </div>
            <p className="text-[12.5px] leading-relaxed text-slate-500">
              Each piece is <strong className="text-slate-800">{sqftEach.toLocaleString(undefined, { maximumFractionDigits: 4 })}</strong> sq ft.
              Total default quantity will be <strong className="text-slate-800">{sqftTotal.toLocaleString(undefined, { maximumFractionDigits: 4 })}</strong> sq ft.
            </p>
            <div className="grid gap-3 lg:grid-cols-2">
              <Field label="Internal $/sq ft"><input value={sqftCostUsd} onChange={(e) => setSqftCostUsd(e.target.value)} placeholder="2.50" inputMode="decimal" className={fieldClassName} /></Field>
              <Field label="Sell $/sq ft override"><input value={sqftSellUsd} onChange={(e) => setSqftSellUsd(e.target.value)} placeholder="Blank = markup" inputMode="decimal" className={fieldClassName} /></Field>
            </div>
            <ApplyButton
              disabled={sqftTotal <= 0}
              onClick={() => {
                const unitCostCents = centsFromMoney(sqftCostUsd);
                applyCalculated({
                  method: 'SQ_FT',
                  unitCostCents,
                  sellUnitCents: sellCentsForUnit(unitCostCents, sqftSellUsd, values.markupPercent),
                  qty: sqftTotal,
                  catalogUnit: ShopCatalogUnit.SQ_FT,
                  inputs: { widthInches: num(sqW), heightInches: num(sqH), pieces: intStr(sqPieces), totalSqft: sqftTotal, costPerSqftCents: unitCostCents, calculatedInternalCostCents: Math.round(sqftTotal * unitCostCents), calculatedSellCents: Math.round(sqftTotal * sellCentsForUnit(unitCostCents, sqftSellUsd, values.markupPercent)), sellSource: sqftSellUsd.trim() ? 'OVERRIDE' : 'MARKUP' },
                  notes: `Square footage item: ${sqftTotal.toLocaleString(undefined, { maximumFractionDigits: 4 })} sq ft default quantity.`,
                });
              }}
            />
          </div>
        ) : null}

        {method === 'SHEET_GOODS' ? (
          <div className="grid gap-3">
            <div className="grid gap-3 lg:grid-cols-3">
              <Field label="Sheet Width">
                <div className="flex">
                  <input value={sheetWidthInches} readOnly className={`${fieldClassName} rounded-r-none bg-[#fafbfc]`} />
                  <span className="grid h-8 w-9 place-items-center rounded-r-[4px] border border-l-0 border-[#dfe3ea] bg-[#fafbfc] text-[10px] text-slate-500">in</span>
                </div>
              </Field>
              <Field label="Requested Sq Ft">
                <div className="flex">
                  <input value={sheetTotalSqft} onChange={(e) => setSheetTotalSqft(e.target.value)} inputMode="decimal" className={`${fieldClassName} rounded-r-none`} />
                  <span className="grid h-8 w-10 place-items-center rounded-r-[4px] border border-l-0 border-[#dfe3ea] bg-[#fafbfc] text-[10px] text-slate-500">sq ft</span>
                </div>
              </Field>
              <Field label="Rounding Rule">
                <SelectControl value="75" onChange={() => undefined} className={fieldClassName}>
                  <option value="75">Charge full sheet if under 75% utilized</option>
                </SelectControl>
              </Field>

              <Field label="Sheet Height">
                <div className="flex">
                  <input value={sheetHeightInches} readOnly className={`${fieldClassName} rounded-r-none bg-[#fafbfc]`} />
                  <span className="grid h-8 w-9 place-items-center rounded-r-[4px] border border-l-0 border-[#dfe3ea] bg-[#fafbfc] text-[10px] text-slate-500">in</span>
                </div>
              </Field>
              <Field label="Sheets Needed (Raw)">
                <input value={rawSheetsNeeded.toFixed(2)} readOnly className={`${fieldClassName} bg-[#fafbfc]`} />
              </Field>
              <Field label="Billable Sheets">
                <div className="flex">
                  <input value={sheetsNeeded} readOnly className={`${fieldClassName} rounded-r-none bg-[#fafbfc]`} />
                  <span className="grid h-8 w-14 place-items-center rounded-r-[4px] border border-l-0 border-[#dfe3ea] bg-[#fafbfc] text-[10px] text-slate-500">sheets</span>
                </div>
              </Field>

              <Field label="Sheet Area">
                <div className="flex">
                  <input value={sheetSqftNominal.toFixed(2)} readOnly className={`${fieldClassName} rounded-r-none bg-[#fafbfc]`} />
                  <span className="grid h-8 w-10 place-items-center rounded-r-[4px] border border-l-0 border-[#dfe3ea] bg-[#fafbfc] text-[10px] text-slate-500">sq ft</span>
                </div>
              </Field>
              <Field label="Utilization">
                <input value={`${sheetUtilization.toFixed(1)}%`} readOnly className={`${fieldClassName} bg-[#fafbfc]`} />
              </Field>
              <Field label="Total Billable Sq Ft">
                <div className="flex">
                  <input value={totalBillableSheetSqft.toFixed(2)} readOnly className={`${fieldClassName} rounded-r-none bg-[#fafbfc]`} />
                  <span className="grid h-8 w-10 place-items-center rounded-r-[4px] border border-l-0 border-[#dfe3ea] bg-[#fafbfc] text-[10px] text-slate-500">sq ft</span>
                </div>
              </Field>
            </div>
            <div className="grid items-end gap-3 border-t border-[#eef0f4] pt-3 lg:grid-cols-[1fr_1fr_1fr_1fr_1fr_auto]">
              <MetricPill label="Cost per Sheet" value={formatMoney(centsFromMoney(sheetCostUsd))} tone="green" />
              <MetricPill label="Billable Sheets" value={String(sheetsNeeded)} />
              <MetricPill label="Total Material Cost" value={formatMoney(sheetsNeeded * centsFromMoney(sheetCostUsd))} tone="green" />
              <MetricPill label="Markup" value={`${values.markupPercent || '0'}%`} />
              <MetricPill label="Sell Price (each)" value={formatMoney(sellCentsForUnit(centsFromMoney(sheetCostUsd), sheetSellUsd, values.markupPercent))} />
              <div className="lg:min-w-[180px]">
                <ApplyButton
                  disabled={sheetsNeeded <= 0}
                  onClick={() => {
                    const unitCostCents = centsFromMoney(sheetCostUsd);
                    const sellUnitCents = sellCentsForUnit(unitCostCents, sheetSellUsd, values.markupPercent);
                    applyCalculated({
                      method: 'SHEET_GOODS',
                      unitCostCents,
                      sellUnitCents,
                      qty: sheetsNeeded,
                      catalogUnit: ShopCatalogUnit.SHEET,
                      inputs: {
                        requestedSqft: sheetTotal,
                        sheetWidthInches,
                        sheetHeightInches,
                        sheetSize,
                        sheetSqft: sheetSqftNominal,
                        utilizationThresholdPercent: 75,
                        utilization: sheetUtilization,
                        thresholdRule: 'If requested square footage is below 75% of one sheet, bill one sheet; otherwise ceil(requestedSqft / sheetSqft).',
                        sheetsNeeded,
                        billableSheets: sheetsNeeded,
                        totalBillableSheetSqft,
                        costPerSheetCents: unitCostCents,
                        calculatedInternalCostCents: Math.round(sheetsNeeded * unitCostCents),
                        calculatedSellCents: Math.round(sheetsNeeded * sellUnitCents),
                      },
                      notes: `Sheet goods item: ${sheetsNeeded} sheet${sheetsNeeded === 1 ? '' : 's'} for ${sheetTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })} sq ft.`,
                    });
                  }}
                />
              </div>
            </div>
            <div className="hidden">
              <Field label="Internal $/sheet"><input value={sheetCostUsd} onChange={(e) => setSheetCostUsd(e.target.value)} placeholder="45.00" inputMode="decimal" className={fieldClassName} /></Field>
              <Field label="Sell $/sheet override"><input value={sheetSellUsd} onChange={(e) => setSheetSellUsd(e.target.value)} placeholder="Blank = markup" inputMode="decimal" className={fieldClassName} /></Field>
            </div>
          </div>
        ) : null}

        {method === 'ROLL_MATERIAL' ? (
          <div className="grid gap-3">
            <div className="grid gap-3 lg:grid-cols-4">
              <Field label="Roll width (in)"><input value={rollW} onChange={(e) => setRollW(e.target.value)} inputMode="decimal" className={fieldClassName} /></Field>
              <Field label="Roll length (ft)"><input value={rollLenFt} onChange={(e) => setRollLenFt(e.target.value)} inputMode="decimal" className={fieldClassName} /></Field>
              <Field label="Usage sq ft"><input value={rollUsed} onChange={(e) => setRollUsed(e.target.value)} inputMode="decimal" className={fieldClassName} /></Field>
              <Field label="Minimum billable sq ft"><input value={rollMin} onChange={(e) => setRollMin(e.target.value)} inputMode="decimal" placeholder="optional" className={fieldClassName} /></Field>
            </div>
            <p className="text-[12.5px] leading-relaxed text-slate-500">
              Nominal roll area is <strong className="text-slate-800">{rollNominal.toLocaleString(undefined, { maximumFractionDigits: 4 })}</strong> sq ft.
              Billable usage is <strong className="text-slate-800">{rollBillable.toLocaleString(undefined, { maximumFractionDigits: 4 })}</strong> sq ft
              ({(rollFrac * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}% of one roll).
            </p>
            <div className="grid gap-3 lg:grid-cols-2">
              <Field label="Internal $/sq ft"><input value={rollCostSqftUsd} onChange={(e) => setRollCostSqftUsd(e.target.value)} placeholder="1.20" inputMode="decimal" className={fieldClassName} /></Field>
              <Field label="Sell $/sq ft override"><input value={rollSellSqftUsd} onChange={(e) => setRollSellSqftUsd(e.target.value)} placeholder="Blank = markup" inputMode="decimal" className={fieldClassName} /></Field>
            </div>
            <ApplyButton
              disabled={rollBillable <= 0}
              onClick={() => {
                const unitCostCents = centsFromMoney(rollCostSqftUsd);
                const sellUnitCents = sellCentsForUnit(unitCostCents, rollSellSqftUsd, values.markupPercent);
                applyCalculated({
                  method: 'ROLL_MATERIAL',
                  unitCostCents,
                  sellUnitCents,
                  qty: rollBillable,
                  catalogUnit: ShopCatalogUnit.SQ_FT,
                  inputs: {
                    rollWidthInches: num(rollW),
                    rollLengthFeet: num(rollLenFt),
                    rollNominalSqft: rollNominal,
                    usageSqft: num(rollUsed),
                    minimumBillableSqft: rollMin.trim() === '' ? null : num(rollMin),
                    billableSqft: rollBillable,
                    usedFraction: rollFrac,
                    usedRollPercentage: rollFrac * 100,
                    costBasis: 'PER_SQ_FT',
                    costPerSqftCents: unitCostCents,
                    costPerRollCents: Math.round(rollNominal * unitCostCents),
                    lineCostCents: rollMaterialLineCostCents(unitCostCents, rollBillable),
                    calculatedInternalCostCents: Math.round(rollBillable * unitCostCents),
                    calculatedSellCents: Math.round(rollBillable * sellUnitCents),
                  },
                  notes: `Roll material item: ${rollBillable.toLocaleString(undefined, { maximumFractionDigits: 4 })} sq ft billable default quantity.`,
                });
              }}
            />
          </div>
        ) : null}

        {method === 'BANNER' ? (
          <div className="grid gap-3">
            <div className="grid gap-3 lg:grid-cols-3">
              <Field label="Banner sq ft"><input value={banSqft} onChange={(e) => setBanSqft(e.target.value)} inputMode="decimal" className={fieldClassName} /></Field>
              <Field label="Grommets"><input value={banGrommets} onChange={(e) => setBanGrommets(e.target.value)} inputMode="numeric" className={fieldClassName} /></Field>
              <Field label="Sell override / each"><input value={bannerSellUsd} onChange={(e) => setBannerSellUsd(e.target.value)} placeholder="Blank = markup" inputMode="decimal" className={fieldClassName} /></Field>
            </div>
            <div className="rounded-[12px] border border-slate-100 bg-slate-50/80 px-3 py-2 text-[12.5px] text-slate-600">
              Banner formula result: <strong className="text-slate-900">{formatMoney(banner.cents)}</strong>
              {banner.appliedMinimum ? ' with minimum applied' : ''}. Grommets: {formatMoney(banner.grommetCents)}.
            </div>
            <ApplyButton
              disabled={num(banSqft) <= 0}
              onClick={() => {
                const sellUnitCents = sellCentsForUnit(banner.cents, bannerSellUsd, values.markupPercent);
                applyCalculated({
                  method: 'BANNER',
                  unitCostCents: banner.cents,
                  sellUnitCents,
                  qty: 1,
                  catalogUnit: ShopCatalogUnit.EACH,
                  inputs: {
                    sqft: num(banSqft),
                    rateTier: {
                      baseRateCentsPerSqft: 400,
                      baseThresholdSqft: 200,
                      overageRateCentsPerSqft: 300,
                    },
                    minimumChargeCents: 4500,
                    grommetCount: intStr(banGrommets),
                    grommetRateCents: 50,
                    banner,
                    calculatedInternalCostCents: banner.cents,
                    calculatedSellCents: sellUnitCents,
                  },
                  notes: `Banner item: ${num(banSqft).toLocaleString(undefined, { maximumFractionDigits: 2 })} sq ft, ${intStr(banGrommets)} grommets.`,
                });
              }}
            />
          </div>
        ) : null}

        {method === 'LABOR' ? (
          <div className="grid gap-3">
            <div className="grid gap-3 lg:grid-cols-4">
              <Field label="Hours"><input value={laborHours} onChange={(e) => setLaborHours(e.target.value)} inputMode="decimal" className={fieldClassName} /></Field>
              <Field label="Rate / hour"><input value={laborRateUsd} onChange={(e) => setLaborRateUsd(e.target.value)} inputMode="decimal" className={fieldClassName} /></Field>
              <Field label="People"><input value={laborPeople} onChange={(e) => setLaborPeople(e.target.value)} inputMode="decimal" className={fieldClassName} /></Field>
              <Field label="Sell override / hour"><input value={laborSellUsd} onChange={(e) => setLaborSellUsd(e.target.value)} inputMode="decimal" placeholder="Blank = markup" className={fieldClassName} /></Field>
            </div>
            <p className="text-[12.5px] text-slate-500">Labor cost is {formatMoney(laborCostCents)} across {laborQty.toLocaleString(undefined, { maximumFractionDigits: 4 })} billable person-hours.</p>
            <ApplyButton
              disabled={laborQty <= 0}
              onClick={() => {
                const sellUnitCents = sellCentsForUnit(laborRateCents, laborSellUsd, values.markupPercent);
                applyCalculated({
                  method: 'LABOR',
                  unitCostCents: laborRateCents,
                  sellUnitCents,
                  qty: laborQty,
                  catalogUnit: ShopCatalogUnit.HOUR,
                  inputs: {
                    hours: num(laborHours),
                    people: Math.max(1, num(laborPeople)),
                    billablePersonHours: laborQty,
                    ratePerHourCents: laborRateCents,
                    calculatedInternalCostCents: laborCostCents,
                    calculatedSellCents: Math.round(laborQty * sellUnitCents),
                  },
                  notes: `Labor item: ${laborQty.toLocaleString(undefined, { maximumFractionDigits: 2 })} person-hours.`,
                });
              }}
            />
          </div>
        ) : null}

        {method === 'INSTALL' ? (
          <div className="grid gap-3">
            <div className="grid gap-3 lg:grid-cols-4">
              <Field label="Hours"><input value={installHours} onChange={(e) => setInstallHours(e.target.value)} inputMode="decimal" className={fieldClassName} /></Field>
              <Field label="Installers"><input value={installers} onChange={(e) => setInstallers(e.target.value)} inputMode="decimal" className={fieldClassName} /></Field>
              <Field label="Rate / installer hour"><input value={installRateUsd} onChange={(e) => setInstallRateUsd(e.target.value)} inputMode="decimal" className={fieldClassName} /></Field>
              <Field label="Sell override / hour"><input value={installSellUsd} onChange={(e) => setInstallSellUsd(e.target.value)} inputMode="decimal" placeholder="Blank = markup" className={fieldClassName} /></Field>
            </div>
            <p className="text-[12.5px] text-slate-500">Install cost is {formatMoney(installCostCents)} at the default-able installer-hour model.</p>
            <ApplyButton
              disabled={installQty <= 0}
              onClick={() => {
                const sellUnitCents = sellCentsForUnit(installRateCents, installSellUsd, values.markupPercent);
                applyCalculated({
                  method: 'INSTALL',
                  unitCostCents: installRateCents,
                  sellUnitCents,
                  qty: installQty,
                  catalogUnit: ShopCatalogUnit.HOUR,
                  inputs: {
                    hours: num(installHours),
                    installers: Math.max(1, num(installers)),
                    billableInstallerHours: installQty,
                    ratePerInstallerHourCents: installRateCents,
                    defaultRatePerInstallerHourCents: 15000,
                    calculatedInternalCostCents: installCostCents,
                    calculatedSellCents: Math.round(installQty * sellUnitCents),
                  },
                  notes: `Install item: ${installQty.toLocaleString(undefined, { maximumFractionDigits: 2 })} installer-hours.`,
                });
              }}
            />
          </div>
        ) : null}

        {method === 'MACHINE' ? (
          <div className="grid gap-3">
            <div className="grid gap-3 lg:grid-cols-4">
              <Field label="Machine">
                <SelectControl
                  value={machineId}
                  onChange={(e) => {
                    const next = e.target.value;
                    setMachineId(next);
                    onSelectedMachineIdChange?.(next || null);
                    const machine = machines.find((m) => m.id === next);
                    if (machine) setMachineRateUsd(moneyString(machine.ratePerHourCents));
                  }}
                  className={fieldClassName}
                >
                  <option value="">Select machine</option>
                  {machines.map((machine) => (
                    <option key={machine.id} value={machine.id}>{machine.name} ({formatMoney(machine.ratePerHourCents)}/hr)</option>
                  ))}
                </SelectControl>
              </Field>
              <Field label="Hours"><input value={machineHours} onChange={(e) => setMachineHours(e.target.value)} inputMode="decimal" className={fieldClassName} /></Field>
              <Field label="Rate / hour"><input value={moneyString(resolvedMachineRateCents)} onChange={(e) => setMachineRateUsd(e.target.value)} inputMode="decimal" className={fieldClassName} /></Field>
              <Field label="Sell override / hour"><input value={machineSellUsd} onChange={(e) => setMachineSellUsd(e.target.value)} inputMode="decimal" placeholder="Blank = markup" className={fieldClassName} /></Field>
            </div>
            <p className="text-[12.5px] text-slate-500">Machine cost is {formatMoney(machineCostCents)}. Defaults are seeded per tenant and can be edited in the machine catalog.</p>
            <ApplyButton
              disabled={num(machineHours) <= 0 || resolvedMachineRateCents <= 0}
              onClick={() => {
                const sellUnitCents = sellCentsForUnit(resolvedMachineRateCents, machineSellUsd, values.markupPercent);
                applyCalculated({
                  method: 'MACHINE',
                  unitCostCents: resolvedMachineRateCents,
                  sellUnitCents,
                  qty: Math.max(0, num(machineHours)),
                  catalogUnit: ShopCatalogUnit.HOUR,
                  inputs: {
                    machineId: machineId || null,
                    machineName: selectedMachine?.name ?? null,
                    supportedMachineDefaults: {
                      'Colex Sharp Cut Cutter - CNC': 9078,
                      'Laser cutter': 6877,
                      'Flatbed printer': 3345,
                      'Roll-to-roll printer': 4421,
                    },
                    hours: Math.max(0, num(machineHours)),
                    ratePerHourCents: resolvedMachineRateCents,
                    calculatedMachineCostCents: machineCostCents,
                    calculatedSellCents: Math.round(Math.max(0, num(machineHours)) * sellUnitCents),
                  },
                  notes: `Machine item${selectedMachine ? `: ${selectedMachine.name}` : ''}.`,
                });
              }}
            />
          </div>
        ) : null}

        {method === 'COST_PLUS' ? (
          <div className="grid gap-3">
            <div className="grid gap-3 lg:grid-cols-3">
              <Field label="Material cost"><input value={costPlusMaterialUsd} onChange={(e) => setCostPlusMaterialUsd(e.target.value)} inputMode="decimal" className={fieldClassName} /></Field>
              <Field label="Machine cost"><input value={costPlusMachineUsd} onChange={(e) => setCostPlusMachineUsd(e.target.value)} inputMode="decimal" className={fieldClassName} /></Field>
              <Field label="Labor cost"><input value={costPlusLaborUsd} onChange={(e) => setCostPlusLaborUsd(e.target.value)} inputMode="decimal" className={fieldClassName} /></Field>
              <Field label="Design fee"><input value={costPlusDesignUsd} onChange={(e) => setCostPlusDesignUsd(e.target.value)} inputMode="decimal" className={fieldClassName} /></Field>
              <Field label="Install cost"><input value={costPlusInstallUsd} onChange={(e) => setCostPlusInstallUsd(e.target.value)} inputMode="decimal" className={fieldClassName} /></Field>
              <Field label="Misc cost"><input value={costPlusMiscUsd} onChange={(e) => setCostPlusMiscUsd(e.target.value)} inputMode="decimal" className={fieldClassName} /></Field>
            </div>
            <p className="text-[12.5px] text-slate-500">Cost Plus raw cost is {formatMoney(costPlusCostCents)}. Sell is derived from the catalog markup or override.</p>
            <ApplyButton
              disabled={costPlusCostCents <= 0}
              onClick={() => {
                const sellUnitCents = sellCentsForUnit(costPlusCostCents, values.defaultSellUsd, values.markupPercent);
                applyCalculated({
                  method: 'COST_PLUS',
                  unitCostCents: costPlusCostCents,
                  sellUnitCents,
                  qty: 1,
                  catalogUnit: ShopCatalogUnit.EACH,
                  inputs: {
                    materialCostCents: centsFromMoney(costPlusMaterialUsd),
                    machineCostCents: centsFromMoney(costPlusMachineUsd),
                    laborCostCents: centsFromMoney(costPlusLaborUsd),
                    designFeeCents: centsFromMoney(costPlusDesignUsd),
                    installCostCents: centsFromMoney(costPlusInstallUsd),
                    miscCostCents: centsFromMoney(costPlusMiscUsd),
                    markupPercent: num(values.markupPercent),
                    calculatedInternalCostCents: costPlusCostCents,
                    calculatedSellCents: sellUnitCents,
                  },
                  notes: 'Cost Plus item.',
                });
              }}
            />
          </div>
        ) : null}

        {method === 'CHANNEL_LETTERS' ? (
          <div className="grid gap-3">
            <div className="grid gap-3 lg:grid-cols-3">
              <Field label="Total sq ft"><input value={clSqft} onChange={(e) => setClSqft(e.target.value)} inputMode="decimal" className={fieldClassName} /></Field>
              <Field label="Base $/sq ft"><input value={clBaseUsd} onChange={(e) => setClBaseUsd(e.target.value)} inputMode="decimal" className={fieldClassName} /></Field>
              <Field label="Depth (in)"><input value={clDepth} onChange={(e) => setClDepth(e.target.value)} inputMode="decimal" className={fieldClassName} /></Field>
              <Field label="Lighting type">
                <SelectControl value={clLighting} onChange={(e) => setClLighting(e.target.value as keyof typeof CHANNEL_LETTER_LIGHTING)} className={fieldClassName}>
                  {Object.entries(CHANNEL_LETTER_LIGHTING).map(([key, value]) => <option key={key} value={key}>{value.label} ({value.multiplier}x)</option>)}
                </SelectControl>
              </Field>
              <Field label="Construction type">
                <SelectControl value={clConstruction} onChange={(e) => setClConstruction(e.target.value as keyof typeof CHANNEL_LETTER_CONSTRUCTION)} className={fieldClassName}>
                  {Object.entries(CHANNEL_LETTER_CONSTRUCTION).map(([key, value]) => <option key={key} value={key}>{value.label} ({value.multiplier}x)</option>)}
                </SelectControl>
              </Field>
              <Field label="Shipping tier">
                <SelectControl value={clShipping} onChange={(e) => setClShipping(e.target.value as keyof typeof CHANNEL_LETTER_SHIPPING)} className={fieldClassName}>
                  {Object.entries(CHANNEL_LETTER_SHIPPING).map(([key, value]) => <option key={key} value={key}>{value.label} ({value.percent}%)</option>)}
                </SelectControl>
              </Field>
            </div>
            <div className="rounded-[12px] border border-slate-100 bg-slate-50/80 px-3 py-2 text-[12.5px] text-slate-600">
              China base {formatMoney(channelLetterPreview.chinaBaseCostCents)} + shipping {formatMoney(channelLetterPreview.shippingCents)} = landed cost <strong className="text-slate-900">{formatMoney(channelLetterPreview.landedCostCents)}</strong>.
            </div>
            <ApplyButton
              disabled={channelLetterPreview.landedCostCents <= 0}
              onClick={() => {
                const sellUnitCents = sellCentsForUnit(channelLetterPreview.landedCostCents, '', values.markupPercent);
                applyCalculated({
                  method: 'CHANNEL_LETTERS',
                  unitCostCents: channelLetterPreview.landedCostCents,
                  sellUnitCents,
                  qty: 1,
                  catalogUnit: ShopCatalogUnit.EACH,
                  inputs: {
                    ...channelLetterPreview,
                    formula: 'totalSqFt * basePerSqFt * lightingMultiplier * constructionMultiplier * depthMultiplier; shipping = chinaBaseCost * shippingPercent; landed = chinaBaseCost + shipping; sell = landed * markup',
                    markupPercent: num(values.markupPercent),
                    calculatedInternalCostCents: channelLetterPreview.landedCostCents,
                    calculatedSellCents: sellUnitCents,
                  },
                  notes: 'Channel Letters item.',
                });
              }}
            />
          </div>
        ) : null}

        {method === 'VENDORS' ? (
          <VendorPricingTool
            vendors={vendors}
            vendorRows={vendorRows}
            vendorDraftRows={vendorDraftRows}
            onVendorDraftRowsChange={onVendorDraftRowsChange}
            preferredVendorId={preferredVendorId}
            onPreferredVendorIdChange={onPreferredVendorIdChange}
            selectedVendorId={selectedVendorId}
            onSelectedVendorIdChange={onSelectedVendorIdChange}
            selectedVendorMode={selectedVendorModeValue}
            onSelectedVendorModeChange={onSelectedVendorModeChange}
            catalogUnitLabel={catalogUnitLabel ?? values.catalogUnit.replace(/_/g, ' ')}
          />
        ) : null}

        {method === 'CUSTOM' ? (
          <div className="grid gap-3">
            <div className="grid gap-3 lg:grid-cols-3">
              <Field label="Rule name"><input value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="e.g. Channel letter set" className={fieldClassName} /></Field>
              <Field label="Formula">
                <SelectControl value={customFormula} onChange={(e) => setCustomFormula(e.target.value as CustomFormula)} className={fieldClassName}>
                  <option value="flat">Flat price</option>
                  <option value="quantity">Quantity x rate</option>
                  <option value="area">Area / units x rate</option>
                  <option value="area-plus-count">Area + add-ons</option>
                  <option value="tiered-area">Tiered area</option>
                </SelectControl>
              </Field>
              <Field label="Unit label"><input value={customUnitLabel} onChange={(e) => setCustomUnitLabel(e.target.value)} placeholder="unit" className={fieldClassName} /></Field>
            </div>
            <div className="grid gap-3 lg:grid-cols-4">
              <Field label="Quantity / area"><input value={customQty} onChange={(e) => setCustomQty(e.target.value)} inputMode="decimal" className={fieldClassName} /></Field>
              <Field label="Rate"><input value={customRateUsd} onChange={(e) => setCustomRateUsd(e.target.value)} inputMode="decimal" className={fieldClassName} /></Field>
              <Field label="Add-on count"><input value={customCount} onChange={(e) => setCustomCount(e.target.value)} inputMode="decimal" className={fieldClassName} /></Field>
              <Field label="Add-on rate"><input value={customCountRateUsd} onChange={(e) => setCustomCountRateUsd(e.target.value)} inputMode="decimal" className={fieldClassName} /></Field>
            </div>
            <div className="grid gap-3 lg:grid-cols-5">
              <Field label="Flat cost"><input value={customFlatUsd} onChange={(e) => setCustomFlatUsd(e.target.value)} inputMode="decimal" className={fieldClassName} /></Field>
              <Field label="Minimum"><input value={customMinimumUsd} onChange={(e) => setCustomMinimumUsd(e.target.value)} inputMode="decimal" className={fieldClassName} /></Field>
              <Field label="Waste %"><input value={customWastePct} onChange={(e) => setCustomWastePct(e.target.value)} inputMode="decimal" className={fieldClassName} /></Field>
              <Field label="Round to"><input value={customRoundTo} onChange={(e) => setCustomRoundTo(e.target.value)} inputMode="decimal" className={fieldClassName} /></Field>
              <Field label="Tier limit"><input value={customTierLimit} onChange={(e) => setCustomTierLimit(e.target.value)} inputMode="decimal" className={fieldClassName} /></Field>
            </div>
            {customFormula === 'tiered-area' ? (
              <Field label="Tier 2 rate"><input value={customTier2RateUsd} onChange={(e) => setCustomTier2RateUsd(e.target.value)} inputMode="decimal" className={fieldClassName} /></Field>
            ) : null}
            <div className="rounded-[12px] border border-slate-100 bg-slate-50/80 px-3 py-2 text-[12.5px] text-slate-600">
              Custom preview: <strong className="text-slate-900">{formatMoney(customPreview.totalCostCents)}</strong>
              {customPreview.minimumApplied ? ' with minimum applied' : ''}. Billable quantity: {customPreview.billableQty.toLocaleString(undefined, { maximumFractionDigits: 4 })}.
            </div>
            <ApplyButton
              disabled={customPreview.totalCostCents <= 0}
              onClick={() => {
                const qty = customFormula === 'flat' ? 1 : Math.max(customPreview.billableQty, 1);
                const unitCostCents =
                  customFormula === 'flat'
                    ? customPreview.totalCostCents
                    : Math.round(customPreview.totalCostCents / qty);
                applyCalculated({
                  method: 'CUSTOM',
                  unitCostCents,
                  sellUnitCents: sellCentsForUnit(unitCostCents, '', values.markupPercent),
                  qty,
                  catalogUnit: ShopCatalogUnit.CUSTOM,
                  inputs: { name: customName, formula: customFormula, unitLabel: customUnitLabel, quantity: num(customQty), count: num(customCount), rateCents: centsFromMoney(customRateUsd), countRateCents: centsFromMoney(customCountRateUsd), flatCostCents: centsFromMoney(customFlatUsd), minimumCents: centsFromMoney(customMinimumUsd), wastePercent: num(customWastePct), roundTo: num(customRoundTo), tierLimit: num(customTierLimit), tier2RateCents: centsFromMoney(customTier2RateUsd), preview: customPreview },
                  notes: `Custom pricing item${customName.trim() ? `: ${customName.trim()}` : ''}.`,
                });
              }}
            />
          </div>
        ) : null}
      </div>

      <input type="hidden" name="pricingMethod" value={values.pricing.pricingMethod} />
      <input type="hidden" name="pricingEngine" value={values.pricing.pricingEngine} />
      <input type="hidden" name="pricingInputsJson" value={values.pricing.pricingInputsJson} />
      <input type="hidden" name="pricingOutputJson" value={values.pricing.pricingOutputJson} />
      <input type="hidden" name="formulaVersion" value={values.pricing.formulaVersion} />
      <input type="hidden" name="selectedVendorId" value={values.pricing.selectedVendorId} />
      <input type="hidden" name="selectedVendorMode" value={values.pricing.selectedVendorMode} />
      <input type="hidden" name="calculatedCostCents" value={values.pricing.calculatedCostCents} />
      <input type="hidden" name="calculatedSellCents" value={values.pricing.calculatedSellCents} />
      <input type="hidden" name="pricingNotes" value={values.pricing.pricingNotes} />
    </div>
  );
}

function VendorPricingTool({
  vendors,
  vendorRows,
  vendorDraftRows,
  onVendorDraftRowsChange,
  preferredVendorId,
  onPreferredVendorIdChange,
  selectedVendorId,
  onSelectedVendorIdChange,
  selectedVendorMode,
  onSelectedVendorModeChange,
  catalogUnitLabel,
}: {
  vendors: ReadonlyArray<{ id: string; name: string }>;
  vendorRows: CatalogVendorDisplayRow[];
  vendorDraftRows: CatalogVendorDraftRow[];
  onVendorDraftRowsChange?: (rows: CatalogVendorDraftRow[]) => void;
  preferredVendorId?: string | null;
  onPreferredVendorIdChange?: (vendorId: string | null) => void;
  selectedVendorId?: string | null;
  onSelectedVendorIdChange?: (vendorId: string | null) => void;
  selectedVendorMode: VendorCostSourceMode;
  onSelectedVendorModeChange?: (mode: VendorCostSourceMode) => void;
  catalogUnitLabel: string;
}) {
  const allRows = [...vendorRows, ...vendorDraftRows.map(draftToDisplayRow)];
  const cheapest = allRows
    .filter((row) => row.priceCents >= 0)
    .sort((a, b) => a.priceCents - b.priceCents)[0];
  const preferred = allRows.find((row) => row.vendorId === preferredVendorId || row.isPreferred) ?? null;
  const selected = allRows.find((row) => row.vendorId === selectedVendorId) ?? null;

  function patchDraft(id: string, patch: Partial<CatalogVendorDraftRow>) {
    onVendorDraftRowsChange?.(
      vendorDraftRows.map((row) => {
        if (row.id !== id) return row;
        const next = { ...row, ...patch };
        if (patch.preferred) {
          onPreferredVendorIdChange?.(next.vendorId && next.vendorId !== '__new__' ? next.vendorId : null);
        }
        return next;
      }).map((row) => (patch.preferred && row.id !== id ? { ...row, preferred: false } : row)),
    );
  }

  return (
    <div className="grid gap-4" id="vendor-pricing-editor">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-[14px] font-semibold text-slate-950">Vendor pricing</h4>
          <p className="mt-0.5 text-[12.5px] text-slate-500">
            Vendor rows are saved with the catalog item. They do not replace calculator pricing unless you apply a calculator result.
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            onVendorDraftRowsChange?.([
              ...vendorDraftRows,
              {
                id: `draft-${Date.now()}-${vendorDraftRows.length}`,
                vendorId: '',
                newVendorName: '',
                vendorSku: '',
                unitCostUsd: '',
                unit: catalogUnitLabel,
                leadTimeDays: '',
                notes: '',
                preferred: false,
                active: true,
              },
            ])
          }
          className="rounded-[10px] border border-blue-200 bg-blue-50 px-3 py-2 text-[12.5px] font-semibold text-blue-700 hover:bg-blue-100"
        >
          + Add vendor price row
        </button>
      </div>

      <div className="grid gap-3 rounded-[14px] border border-slate-100 bg-slate-50/70 p-3">
        <div>
          <h5 className="text-[12.5px] font-semibold text-slate-950">Cost source for estimate Apply</h5>
          <p className="mt-0.5 text-[12px] text-slate-500">
            This stores the selected cost source with the catalog item. Estimate lines still receive an editable snapshot.
          </p>
        </div>
        <div className="grid gap-2 lg:grid-cols-4">
          {(['INTERNAL', 'CHEAPEST', 'PREFERRED', 'MANUAL'] as VendorCostSourceMode[]).map((mode) => (
            <label key={mode} className="flex items-center gap-2 rounded-[10px] border border-white bg-white px-3 py-2 text-[12.5px] font-semibold text-slate-700">
              <input
                type="radio"
                name="vendorCostSourceModeChoice"
                checked={selectedVendorMode === mode}
                onChange={() => onSelectedVendorModeChange?.(mode)}
              />
              {mode === 'INTERNAL' ? 'Use internal cost' : mode === 'CHEAPEST' ? 'Use cheapest vendor' : mode === 'PREFERRED' ? 'Use preferred vendor' : 'Use selected vendor'}
            </label>
          ))}
        </div>
        {selectedVendorMode === 'MANUAL' ? (
          <Field label="Selected vendor">
            <SelectControl
              value={selectedVendorId ?? ''}
              onChange={(e) => onSelectedVendorIdChange?.(e.target.value || null)}
              className={fieldClassName}
            >
              <option value="">Select vendor price row</option>
              {allRows.map((row) => (
                <option key={row.id} value={row.vendorId}>{row.vendorName} {formatMoney(row.priceCents)}</option>
              ))}
            </SelectControl>
          </Field>
        ) : null}
        <div className="grid gap-2 lg:grid-cols-3">
          <SummaryPill label="Cheapest vendor" value={cheapest ? `${cheapest.vendorName} ${formatMoney(cheapest.priceCents)}` : 'None'} />
          <SummaryPill label="Preferred vendor" value={preferred ? `${preferred.vendorName} ${formatMoney(preferred.priceCents)}` : 'None'} />
          <SummaryPill label="Selected source" value={selectedVendorMode === 'INTERNAL' ? 'Internal cost' : selectedVendorMode === 'CHEAPEST' ? (cheapest ? `${cheapest.vendorName} ${formatMoney(cheapest.priceCents)}` : 'No cheapest vendor') : selectedVendorMode === 'PREFERRED' ? (preferred ? `${preferred.vendorName} ${formatMoney(preferred.priceCents)}` : 'No preferred vendor') : selected ? `${selected.vendorName} ${formatMoney(selected.priceCents)}` : 'No selected vendor'} />
        </div>
      </div>

      {allRows.length > 0 ? (
        <div className="grid gap-2 rounded-[14px] border border-slate-100 bg-slate-50/70 p-3 text-[12.5px]">
          <div className="grid gap-2 sm:grid-cols-3">
            <SummaryPill label="Vendor rows" value={String(allRows.length)} />
            <SummaryPill label="Cheapest" value={cheapest ? `${cheapest.vendorName} ${formatMoney(cheapest.priceCents)}` : '—'} />
            <SummaryPill
              label="Preferred"
              value={allRows.find((row) => row.vendorId === preferredVendorId || row.isPreferred)?.vendorName ?? 'None'}
            />
          </div>
        </div>
      ) : null}

      {vendorRows.length > 0 ? (
        <div className="overflow-x-auto rounded-[14px] border border-slate-200">
          <table className="w-full min-w-[720px] text-[12.5px]">
            <thead className="bg-slate-50 text-left text-[10.5px] uppercase tracking-[0.14em] text-slate-400">
              <tr>
                <th className="px-3 py-2">Vendor</th>
                <th className="px-3 py-2">Cost</th>
                <th className="px-3 py-2">SKU</th>
                <th className="px-3 py-2">Lead time</th>
                <th className="px-3 py-2">Notes</th>
                <th className="px-3 py-2">Preferred</th>
              </tr>
            </thead>
            <tbody>
              {vendorRows.map((row) => (
                <tr key={row.id} className={`border-t border-slate-100 ${row.isCheapest ? 'bg-emerald-50/60' : 'bg-white'}`}>
                  <td className="px-3 py-2 font-semibold text-slate-900">
                    {row.vendorName}
                    {row.isCheapest ? <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-800">Cheapest</span> : null}
                  </td>
                  <td className="px-3 py-2 tabular-nums">{formatMoney(row.priceCents)}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-500">{row.vendorSku ?? '—'}</td>
                  <td className="px-3 py-2">{row.leadTimeDays != null ? `${row.leadTimeDays} days` : '—'}</td>
                  <td className="px-3 py-2 text-slate-500">{row.notes ?? '—'}</td>
                  <td className="px-3 py-2">
                    <input
                      type="radio"
                      name="preferredVendorChoice"
                      checked={preferredVendorId === row.vendorId || row.isPreferred}
                      onChange={() => onPreferredVendorIdChange?.(row.vendorId)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {vendorDraftRows.map((row, idx) => (
        <div key={row.id} className="grid gap-3 rounded-[14px] border border-blue-100 bg-blue-50/40 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-blue-700">New vendor row {idx + 1}</p>
            <button
              type="button"
              onClick={() => onVendorDraftRowsChange?.(vendorDraftRows.filter((r) => r.id !== row.id))}
              className="text-[12px] font-semibold text-rose-600 hover:underline"
            >
              Remove
            </button>
          </div>
          <div className="grid gap-3 lg:grid-cols-4">
            <Field label="Vendor">
              <SelectControl value={row.vendorId} onChange={(e) => patchDraft(row.id, { vendorId: e.target.value })} className={fieldClassName}>
                <option value="">Select vendor</option>
                <option value="__new__">Create new vendor...</option>
                {vendors.map((vendor) => (
                  <option key={vendor.id} value={vendor.id}>{vendor.name}</option>
                ))}
              </SelectControl>
            </Field>
            {row.vendorId === '__new__' ? (
              <Field label="New vendor name">
                <input value={row.newVendorName} onChange={(e) => patchDraft(row.id, { newVendorName: e.target.value })} className={fieldClassName} />
              </Field>
            ) : null}
            <Field label="Unit cost">
              <input value={row.unitCostUsd} onChange={(e) => patchDraft(row.id, { unitCostUsd: e.target.value })} placeholder="0.00" inputMode="decimal" className={fieldClassName} />
            </Field>
            <Field label="Unit">
              <input value={row.unit} onChange={(e) => patchDraft(row.id, { unit: e.target.value })} className={fieldClassName} />
            </Field>
            <Field label="Vendor SKU">
              <input value={row.vendorSku} onChange={(e) => patchDraft(row.id, { vendorSku: e.target.value })} className={fieldClassName} />
            </Field>
            <Field label="Lead time">
              <input value={row.leadTimeDays} onChange={(e) => patchDraft(row.id, { leadTimeDays: e.target.value })} placeholder="days" inputMode="numeric" className={fieldClassName} />
            </Field>
          </div>
          <Field label="Notes">
            <input value={row.notes} onChange={(e) => patchDraft(row.id, { notes: e.target.value })} className={fieldClassName} />
          </Field>
          <div className="flex flex-wrap gap-4 text-[12.5px] font-medium text-slate-600">
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={row.preferred} onChange={(e) => patchDraft(row.id, { preferred: e.target.checked })} />
              Preferred vendor
            </label>
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={row.active} onChange={(e) => patchDraft(row.id, { active: e.target.checked })} />
              Active vendor price
            </label>
          </div>
        </div>
      ))}
    </div>
  );
}

function draftToDisplayRow(row: CatalogVendorDraftRow): CatalogVendorDisplayRow {
  const vendorName = row.vendorId === '__new__' ? row.newVendorName || 'New vendor' : 'Selected vendor';
  return {
    id: row.id,
    vendorId: row.vendorId,
    vendorName,
    priceCents: centsFromMoney(row.unitCostUsd),
    vendorSku: row.vendorSku || null,
    unit: row.unit || null,
    leadTimeDays: parseInt(row.leadTimeDays, 10) || null,
    notes: row.notes || null,
    updatedAt: 'Unsaved',
    isPreferred: row.preferred,
    isCheapest: false,
  };
}

function SummaryPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[12px] bg-white px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{label}</div>
      <div className="mt-1 truncate font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function MetricPill({ label, value, tone }: { label: string; value: string; tone?: 'green' }) {
  return (
    <div>
      <div className="text-[9px] font-semibold text-slate-500">{label}</div>
      <div className={`mt-1 text-[11px] font-bold ${tone === 'green' ? 'text-emerald-600' : 'text-slate-900'}`}>
        {value}
      </div>
    </div>
  );
}

function ApplyButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="h-8 w-full rounded-[4px] bg-[#6d28d9] px-4 text-[10px] font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
    >
      Apply pricing to catalog item
    </button>
  );
}

function isPricingMethod(value: string): value is PricingMethod {
  return [
    'MANUAL',
    'SQ_FT',
    'SHEET_GOODS',
    'ROLL_MATERIAL',
    'BANNER',
    'LABOR',
    'INSTALL',
    'MACHINE',
    'COST_PLUS',
    'CHANNEL_LETTERS',
    'BUNDLE',
    'CUSTOM',
  ].includes(value);
}
