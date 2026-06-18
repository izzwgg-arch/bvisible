'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { EstimateLineKind } from '@bvisible/db';
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
import { FinalizedReadOnlyChip } from '@/components/estimate/finalized-read-only-chip';
import { SectionCard, SectionHeading, IconCalculator } from '@/components/estimate/estimate-surface';
import type { Action, DraftLine } from './editor';

type HelperMode = 'sqft' | 'sheet' | 'roll' | 'banner' | 'custom';

const MODE_LABELS: Record<HelperMode, string> = {
  sqft: 'Square footage',
  sheet: 'Sheet goods',
  roll: 'Roll material',
  banner: 'Banner',
  custom: 'Custom',
};

function num(raw: string): number {
  const n = Number(String(raw).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function intStr(raw: string): number {
  return Math.max(0, Math.trunc(num(raw)));
}

type CustomFormula = 'flat' | 'quantity' | 'area' | 'area-plus-count' | 'tiered-area';

interface CustomPricingRule {
  id: string;
  name: string;
  lineKind: EstimateLineKind;
  formula: CustomFormula;
  unitLabel: string;
  countLabel: string;
  descriptionPrefix: string;
  flatCostCents: number;
  rateCents: number;
  countRateCents: number;
  minimumCents: number;
  wastePercent: number;
  markupPercent: number;
  roundTo: number;
  tierLimit: number;
  tier2RateCents: number;
  defaultQtyMilli: number;
}

interface CustomRuleDraft {
  name: string;
  lineKind: EstimateLineKind;
  formula: CustomFormula;
  unitLabel: string;
  countLabel: string;
  descriptionPrefix: string;
  flatCostUsd: string;
  rateUsd: string;
  countRateUsd: string;
  minimumUsd: string;
  wastePercent: string;
  markupPercent: string;
  roundTo: string;
  tierLimit: string;
  tier2RateUsd: string;
  defaultQty: string;
}

const CUSTOM_RULE_STORAGE_KEY = 'bvisible-estimate-custom-pricing-rules-v1';

const EMPTY_CUSTOM_DRAFT: CustomRuleDraft = {
  name: '',
  lineKind: EstimateLineKind.MATERIAL,
  formula: 'area-plus-count',
  unitLabel: 'sq ft',
  countLabel: 'Add-on count',
  descriptionPrefix: '',
  flatCostUsd: '',
  rateUsd: '',
  countRateUsd: '',
  minimumUsd: '',
  wastePercent: '',
  markupPercent: '',
  roundTo: '',
  tierLimit: '200',
  tier2RateUsd: '',
  defaultQty: '1',
};

function localId(): string {
  return `custom-${Math.random().toString(36).slice(2, 10)}`;
}

function centsFromMoneyField(raw: string): number {
  const parsed = parseMoney(raw);
  return parsed === null || parsed < 0 ? 0 : parsed;
}

function isCustomPricingRule(value: unknown): value is CustomPricingRule {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<CustomPricingRule>;
  return (
    typeof row.id === 'string' &&
    typeof row.name === 'string' &&
    typeof row.unitLabel === 'string' &&
    typeof row.countLabel === 'string' &&
    typeof row.descriptionPrefix === 'string' &&
    typeof row.flatCostCents === 'number' &&
    typeof row.rateCents === 'number' &&
    typeof row.countRateCents === 'number' &&
    typeof row.minimumCents === 'number' &&
    typeof row.wastePercent === 'number' &&
    typeof row.markupPercent === 'number' &&
    typeof row.roundTo === 'number' &&
    typeof row.tierLimit === 'number' &&
    typeof row.tier2RateCents === 'number' &&
    typeof row.defaultQtyMilli === 'number' &&
    Object.values(EstimateLineKind).includes(row.lineKind as EstimateLineKind) &&
    ['flat', 'quantity', 'area', 'area-plus-count', 'tiered-area'].includes(row.formula ?? '')
  );
}

function customRuleFromDraft(draft: CustomRuleDraft): CustomPricingRule | null {
  const name = draft.name.trim();
  if (!name) return null;
  return {
    id: localId(),
    name,
    lineKind: draft.lineKind,
    formula: draft.formula,
    unitLabel: draft.unitLabel.trim() || 'unit',
    countLabel: draft.countLabel.trim() || 'Add-on count',
    descriptionPrefix: draft.descriptionPrefix.trim(),
    flatCostCents: centsFromMoneyField(draft.flatCostUsd),
    rateCents: centsFromMoneyField(draft.rateUsd),
    countRateCents: centsFromMoneyField(draft.countRateUsd),
    minimumCents: centsFromMoneyField(draft.minimumUsd),
    wastePercent: Math.max(0, num(draft.wastePercent)),
    markupPercent: Math.max(0, num(draft.markupPercent)),
    roundTo: Math.max(0, num(draft.roundTo)),
    tierLimit: Math.max(0, num(draft.tierLimit)),
    tier2RateCents: centsFromMoneyField(draft.tier2RateUsd),
    defaultQtyMilli: qtyToMilli(Math.max(1, num(draft.defaultQty))),
  };
}

function customRuleLabel(formula: CustomFormula): string {
  switch (formula) {
    case 'flat':
      return 'Flat price';
    case 'quantity':
      return 'Quantity x rate';
    case 'area':
      return 'Area / units x rate';
    case 'area-plus-count':
      return 'Area + add-ons';
    case 'tiered-area':
      return 'Tiered area';
  }
}

function computeCustomRuleCost({
  rule,
  qty,
  count,
}: {
  rule: CustomPricingRule;
  qty: number;
  count: number;
}) {
  const baseQty = Math.max(0, qty);
  const addOnCount = Math.max(0, count);
  const withWaste = baseQty * (1 + rule.wastePercent / 100);
  const billableQty =
    rule.roundTo > 0 ? Math.ceil(withWaste / rule.roundTo) * rule.roundTo : withWaste;

  let subtotal = rule.flatCostCents;
  if (rule.formula === 'quantity' || rule.formula === 'area') {
    subtotal += Math.round(billableQty * rule.rateCents);
  } else if (rule.formula === 'area-plus-count') {
    subtotal += Math.round(billableQty * rule.rateCents);
    subtotal += Math.round(addOnCount * rule.countRateCents);
  } else if (rule.formula === 'tiered-area') {
    const firstTierQty = Math.min(billableQty, rule.tierLimit);
    const secondTierQty = Math.max(0, billableQty - rule.tierLimit);
    subtotal += Math.round(firstTierQty * rule.rateCents);
    subtotal += Math.round(secondTierQty * rule.tier2RateCents);
    subtotal += Math.round(addOnCount * rule.countRateCents);
  }

  const markedUp = Math.round(subtotal * (1 + rule.markupPercent / 100));
  const totalCents = Math.max(markedUp, rule.minimumCents);
  return {
    billableQty,
    addOnCount,
    subtotalCents: subtotal,
    totalCents,
    minimumApplied: rule.minimumCents > 0 && totalCents === rule.minimumCents && markedUp < rule.minimumCents,
  };
}

const fieldClassName =
  'w-full rounded-[10px] border border-slate-200 bg-slate-50/70 px-3 py-2 text-[13px] text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-violet-500 focus:bg-white focus:ring-4 focus:ring-violet-500/10 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
        {label}
      </span>
      {children}
    </label>
  );
}

function MoneyInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      inputMode="decimal"
      placeholder={placeholder}
      className={fieldClassName}
    />
  );
}

export function PricingHelperPanel({
  activeLineId,
  lines,
  readOnly = false,
  embedded = false,
  dispatch,
}: {
  activeLineId: string | null;
  lines: ReadonlyArray<DraftLine>;
  readOnly?: boolean;
  embedded?: boolean;
  dispatch: React.Dispatch<Action>;
}) {
  const [mode, setMode] = useState<HelperMode>('sqft');

  const [sqW, setSqW] = useState('48');
  const [sqH, setSqH] = useState('96');
  const [sqPieces, setSqPieces] = useState('1');
  const [sqftCostUsd, setSqftCostUsd] = useState('');

  const [sheetTotalSqft, setSheetTotalSqft] = useState('32');
  const [sheetSize, setSheetSize] = useState<'48' | '510'>('48');
  const [sheetCostUsd, setSheetCostUsd] = useState('');

  const [rollW, setRollW] = useState('54');
  const [rollLenFt, setRollLenFt] = useState('150');
  const [rollUsed, setRollUsed] = useState('400');
  const [rollMin, setRollMin] = useState('');
  const [rollCostSqftUsd, setRollCostSqftUsd] = useState('');

  const [banSqft, setBanSqft] = useState('48');
  const [banGrommets, setBanGrommets] = useState('8');

  const [customRules, setCustomRules] = useState<CustomPricingRule[]>([]);
  const [selectedCustomRuleId, setSelectedCustomRuleId] = useState<string>('');
  const [customDraft, setCustomDraft] = useState<CustomRuleDraft>(EMPTY_CUSTOM_DRAFT);
  const [customQty, setCustomQty] = useState('1');
  const [customCount, setCustomCount] = useState('0');
  const [showCustomBuilder, setShowCustomBuilder] = useState(false);

  const activeLine = useMemo(
    () => (activeLineId ? lines.find((l) => l.id === activeLineId) ?? null : null),
    [activeLineId, lines],
  );

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(CUSTOM_RULE_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const valid = parsed.filter(isCustomPricingRule);
      setCustomRules(valid);
      setSelectedCustomRuleId(valid[0]?.id ?? '');
    } catch {
      setCustomRules([]);
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(CUSTOM_RULE_STORAGE_KEY, JSON.stringify(customRules));
    } catch {
      // Local rules are convenience-only; estimates still work if browser storage is unavailable.
    }
  }, [customRules]);

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

  const rollNominal = useMemo(
    () => computeRollNominalSqft(num(rollW), num(rollLenFt)),
    [rollW, rollLenFt],
  );
  const rollUsedSq = num(rollUsed);
  const rollMinSq = rollMin.trim() === '' ? null : num(rollMin);
  const rollBillable = useMemo(
    () => rollEffectiveBillableSqft(rollUsedSq, rollMinSq),
    [rollUsedSq, rollMinSq],
  );
  const rollFrac = useMemo(() => rollUsedFraction(rollBillable, rollNominal), [rollBillable, rollNominal]);

  const banSq = num(banSqft);
  const banG = intStr(banGrommets);
  const banner = useMemo(() => bannerPrice({ sqft: banSq, grommets: banG }), [banSq, banG]);
  const selectedCustomRule = useMemo(
    () => customRules.find((rule) => rule.id === selectedCustomRuleId) ?? null,
    [customRules, selectedCustomRuleId],
  );
  const customPreview = selectedCustomRule
    ? computeCustomRuleCost({
        rule: selectedCustomRule,
        qty: num(customQty),
        count: num(customCount),
      })
    : null;

  const sheetLabel = sheetSize === '48' ? '4×8 ft (32 sq ft)' : '5×10 ft (50 sq ft)';

  function optionalUnitCostCents(usdField: string, fallback: number): number {
    const parsed = parseMoney(usdField);
    if (parsed === null || parsed < 0) return fallback;
    if (usdField.trim() === '' || parsed === 0) return fallback;
    return parsed;
  }

  function applySqft() {
    if (!activeLineId || !activeLine) return;
    const pieces = Math.max(1, intStr(sqPieces));
    const each = computeSqft(num(sqW), num(sqH));
    const total = computeTotalSqftFromPieces(each, pieces);
    const w = Math.round(num(sqW));
    const h = Math.round(num(sqH));
    const desc = `Flat material (${w}×${h} in × ${pieces} pc, ${total.toLocaleString(undefined, { maximumFractionDigits: 4 })} sq ft total)`;
    dispatch({
      type: 'set-line',
      id: activeLineId,
      patch: {
        kind: EstimateLineKind.MATERIAL,
        description: desc,
        qtyMilli: qtyToMilli(total),
        unitCostCents: optionalUnitCostCents(sqftCostUsd, activeLine.unitCostCents),
        machineId: null,
      },
    });
  }

  function applySheet() {
    if (!activeLineId || !activeLine) return;
    const n = sheetsNeeded;
    if (n <= 0) return;
    const desc = `Sheet stock (${sheetLabel}, ${n} sheet${n === 1 ? '' : 's'} for ${sheetTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })} sq ft job)`;
    dispatch({
      type: 'set-line',
      id: activeLineId,
      patch: {
        kind: EstimateLineKind.MATERIAL,
        description: desc,
        qtyMilli: qtyToMilli(n),
        unitCostCents: optionalUnitCostCents(sheetCostUsd, activeLine.unitCostCents),
        machineId: null,
      },
    });
  }

  function applyRoll() {
    if (!activeLineId || !activeLine) return;
    const bill = rollBillable;
    if (bill <= 0) return;
    const w = Math.round(num(rollW));
    const lf = num(rollLenFt);
    const desc = `Roll material (${w}" × ${lf}′ roll, ${bill.toLocaleString(undefined, { maximumFractionDigits: 4 })} sq ft billed)`;
    const perSqft = parseMoney(rollCostSqftUsd);
    const unit =
      rollCostSqftUsd.trim() !== '' && perSqft !== null && perSqft > 0
        ? perSqft
        : activeLine.unitCostCents;
    dispatch({
      type: 'set-line',
      id: activeLineId,
      patch: {
        kind: EstimateLineKind.MATERIAL,
        description: desc,
        qtyMilli: qtyToMilli(bill),
        unitCostCents: unit,
        machineId: null,
      },
    });
  }

  function applyBanner() {
    if (!activeLineId) return;
    const b = bannerPrice({ sqft: banSq, grommets: banG });
    const desc = `Banner (${banSq.toLocaleString(undefined, { maximumFractionDigits: 2 })} sq ft, ${banG} grommets)`;
    dispatch({
      type: 'set-line',
      id: activeLineId,
      patch: {
        kind: EstimateLineKind.MATERIAL,
        description: desc,
        qtyMilli: 1000,
        unitCostCents: b.cents,
        machineId: null,
      },
    });
  }

  function saveCustomRule() {
    const rule = customRuleFromDraft(customDraft);
    if (!rule) return;
    setCustomRules((current) => [rule, ...current]);
    setSelectedCustomRuleId(rule.id);
    setCustomQty((rule.defaultQtyMilli / 1000).toString());
    setCustomCount('0');
    setCustomDraft(EMPTY_CUSTOM_DRAFT);
    setShowCustomBuilder(false);
  }

  function deleteCustomRule(ruleId: string) {
    setCustomRules((current) => current.filter((rule) => rule.id !== ruleId));
    if (selectedCustomRuleId === ruleId) {
      const next = customRules.find((rule) => rule.id !== ruleId);
      setSelectedCustomRuleId(next?.id ?? '');
    }
  }

  function applyCustomRule() {
    if (!activeLineId || !selectedCustomRule || !customPreview) return;
    const lineQty = selectedCustomRule.formula === 'flat' ? 1 : Math.max(customPreview.billableQty, 1);
    const unitCostCents =
      selectedCustomRule.formula === 'flat'
        ? customPreview.totalCents
        : Math.round(customPreview.totalCents / lineQty);
    const prefix = selectedCustomRule.descriptionPrefix || selectedCustomRule.name;
    const descParts = [
      `${prefix} (${customPreview.billableQty.toLocaleString(undefined, {
        maximumFractionDigits: 4,
      })} ${selectedCustomRule.unitLabel}`,
    ];
    if (
      selectedCustomRule.formula === 'area-plus-count' ||
      selectedCustomRule.formula === 'tiered-area'
    ) {
      descParts.push(
        `${customPreview.addOnCount.toLocaleString(undefined, {
          maximumFractionDigits: 2,
        })} ${selectedCustomRule.countLabel.toLowerCase()}`,
      );
    }
    const description = `${descParts.join(', ')})`;

    dispatch({
      type: 'set-line',
      id: activeLineId,
      patch: {
        kind: selectedCustomRule.lineKind,
        description,
        qtyMilli: qtyToMilli(lineQty),
        unitCostCents,
        machineId: null,
      },
    });
  }

  const rollPerSqftCents = parseMoney(rollCostSqftUsd);
  const rollLineCostPreview =
    rollPerSqftCents !== null && rollPerSqftCents > 0 && rollCostSqftUsd.trim() !== ''
      ? rollMaterialLineCostCents(rollPerSqftCents, rollBillable)
      : null;

  const canApply = Boolean(activeLineId && activeLine && !readOnly);

  if (readOnly) {
    if (embedded) {
      return (
        <p className="px-5 py-5 text-[12.5px] leading-relaxed text-slate-500">
          Pricing helper Apply is disabled while this estimate is finalized.
        </p>
      );
    }
    return (
      <SectionCard className="p-5">
        <SectionHeading
          icon={<IconCalculator />}
          title="Pricing helper"
          tone="violet"
          badge={<FinalizedReadOnlyChip />}
          subtitle="Pricing helper Apply is disabled while this estimate is finalized."
        />
      </SectionCard>
    );
  }

  const body = (
    <>
      <div className="inline-flex flex-wrap gap-1 rounded-[12px] border border-slate-200 bg-slate-50 p-1">
        {(Object.keys(MODE_LABELS) as HelperMode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`rounded-[9px] px-3 py-1.5 text-[12px] font-semibold transition ${
              mode === m
                ? 'bg-white text-violet-700 shadow-sm ring-1 ring-violet-200'
                : 'text-slate-500 hover:text-slate-800'
            }`}
          >
            {MODE_LABELS[m]}
          </button>
        ))}
      </div>

      <div className="rounded-[14px] border border-slate-200 bg-slate-50/60 p-4">
        <div
          className={`mb-3 flex items-center gap-2 rounded-[10px] border px-3 py-2 text-[12px] ${
            activeLineId
              ? 'border-violet-200 bg-violet-50/70 text-violet-800'
              : 'border-slate-200 bg-white text-slate-500'
          }`}
        >
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${
              activeLineId ? 'bg-violet-500' : 'bg-slate-300'
            }`}
          />
          {!activeLineId ? (
            <span>Focus a line in the grid to choose where results land.</span>
          ) : (
            <span className="min-w-0 truncate">
              Target:{' '}
              <strong className="font-semibold">
                {activeLine?.description?.slice(0, 48) || '(blank)'}
                {(activeLine?.description?.length ?? 0) > 48 ? '…' : ''}
              </strong>
            </span>
          )}
        </div>

        {mode === 'sqft' ? (
          <div className="mt-3 space-y-3">
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                  Width (in)
                </span>
                <input
                  value={sqW}
                  onChange={(e) => setSqW(e.target.value)}
                  inputMode="decimal"
                  className="w-full rounded-[10px] border border-slate-200 bg-slate-50/70 px-3 py-2 text-[13px] text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-violet-500 focus:bg-white focus:ring-4 focus:ring-violet-500/10"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                  Height (in)
                </span>
                <input
                  value={sqH}
                  onChange={(e) => setSqH(e.target.value)}
                  inputMode="decimal"
                  className="w-full rounded-[10px] border border-slate-200 bg-slate-50/70 px-3 py-2 text-[13px] text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-violet-500 focus:bg-white focus:ring-4 focus:ring-violet-500/10"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                  Pieces (count)
                </span>
                <input
                  value={sqPieces}
                  onChange={(e) => setSqPieces(e.target.value)}
                  inputMode="numeric"
                  className="w-full rounded-[10px] border border-slate-200 bg-slate-50/70 px-3 py-2 text-[13px] text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-violet-500 focus:bg-white focus:ring-4 focus:ring-violet-500/10"
                />
              </label>
            </div>
            <p className="text-[12px] leading-relaxed text-slate-500">
              Each piece ≈ <strong className="text-slate-700">{sqftEach.toLocaleString(undefined, { maximumFractionDigits: 4 })}</strong> sq ft
              (width × height ÷ 144). Total ≈{' '}
              <strong className="text-slate-700">{sqftTotal.toLocaleString(undefined, { maximumFractionDigits: 4 })}</strong> sq ft — that becomes
              the line <strong className="text-slate-700">quantity</strong> when you apply (priced per sq ft at your unit cost).
            </p>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                Internal $/sq ft (optional — leave blank to keep line unit cost)
              </span>
              <input
                value={sqftCostUsd}
                onChange={(e) => setSqftCostUsd(e.target.value)}
                placeholder="e.g. 2.50"
                inputMode="decimal"
                className="w-full rounded-[10px] border border-slate-200 bg-slate-50/70 px-3 py-2 text-[13px] text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-violet-500 focus:bg-white focus:ring-4 focus:ring-violet-500/10"
              />
            </label>
            <button
              type="button"
              disabled={!canApply || sqftTotal <= 0}
              onClick={applySqft}
              className="w-full rounded-[10px] bg-violet-600 px-3 py-2.5 text-[12.5px] font-semibold text-white shadow-sm transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
            >
              Apply to focused line
            </button>
          </div>
        ) : null}

        {mode === 'sheet' ? (
          <div className="mt-3 space-y-3">
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                Total sq ft needed (all pieces)
              </span>
              <input
                value={sheetTotalSqft}
                onChange={(e) => setSheetTotalSqft(e.target.value)}
                inputMode="decimal"
                className="w-full rounded-[10px] border border-slate-200 bg-slate-50/70 px-3 py-2 text-[13px] text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-violet-500 focus:bg-white focus:ring-4 focus:ring-violet-500/10"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                Sheet size
              </span>
              <SelectControl
                value={sheetSize}
                onChange={(e) => setSheetSize(e.target.value as '48' | '510')}
                className="w-full rounded-[10px] border border-slate-200 bg-slate-50/70 px-3 py-2 text-[13px] text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-violet-500 focus:bg-white focus:ring-4 focus:ring-violet-500/10"
              >
                <option value="48">4×8 (32 sq ft)</option>
                <option value="510">5×10 (50 sq ft)</option>
              </SelectControl>
            </label>
            <p className="text-[12px] leading-relaxed text-slate-500">
              If the job uses less than <strong className="text-slate-700">75%</strong> of one sheet, we still bill{' '}
              <strong className="text-slate-700">one</strong> full sheet. Otherwise we round{' '}
              <strong className="text-slate-700">up</strong> to whole sheets. Suggested:{' '}
              <strong className="text-slate-700">{sheetsNeeded}</strong> sheet{sheetsNeeded === 1 ? '' : 's'} at {sheetLabel}.
            </p>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                $/sheet internal (optional)
              </span>
              <input
                value={sheetCostUsd}
                onChange={(e) => setSheetCostUsd(e.target.value)}
                placeholder="Leave blank to keep line unit cost"
                inputMode="decimal"
                className="w-full rounded-[10px] border border-slate-200 bg-slate-50/70 px-3 py-2 text-[13px] text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-violet-500 focus:bg-white focus:ring-4 focus:ring-violet-500/10"
              />
            </label>
            <button
              type="button"
              disabled={!canApply || sheetsNeeded <= 0}
              onClick={applySheet}
              className="w-full rounded-[10px] bg-violet-600 px-3 py-2.5 text-[12.5px] font-semibold text-white shadow-sm transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
            >
              Apply to focused line
            </button>
          </div>
        ) : null}

        {mode === 'roll' ? (
          <div className="mt-3 space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                  Roll width (in)
                </span>
                <input
                  value={rollW}
                  onChange={(e) => setRollW(e.target.value)}
                  inputMode="decimal"
                  className="w-full rounded-[10px] border border-slate-200 bg-slate-50/70 px-3 py-2 text-[13px] text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-violet-500 focus:bg-white focus:ring-4 focus:ring-violet-500/10"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                  Roll length (ft)
                </span>
                <input
                  value={rollLenFt}
                  onChange={(e) => setRollLenFt(e.target.value)}
                  inputMode="decimal"
                  className="w-full rounded-[10px] border border-slate-200 bg-slate-50/70 px-3 py-2 text-[13px] text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-violet-500 focus:bg-white focus:ring-4 focus:ring-violet-500/10"
                />
              </label>
            </div>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                Sq ft used on this job
              </span>
              <input
                value={rollUsed}
                onChange={(e) => setRollUsed(e.target.value)}
                inputMode="decimal"
                className="w-full rounded-[10px] border border-slate-200 bg-slate-50/70 px-3 py-2 text-[13px] text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-violet-500 focus:bg-white focus:ring-4 focus:ring-violet-500/10"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                Minimum billable sq ft (optional shop minimum)
              </span>
              <input
                value={rollMin}
                onChange={(e) => setRollMin(e.target.value)}
                placeholder="Leave blank if none"
                inputMode="decimal"
                className="w-full rounded-[10px] border border-slate-200 bg-slate-50/70 px-3 py-2 text-[13px] text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-violet-500 focus:bg-white focus:ring-4 focus:ring-violet-500/10"
              />
            </label>
            <p className="text-[12px] leading-relaxed text-slate-500">
              Nominal roll ≈ <strong className="text-slate-700">{rollNominal.toLocaleString(undefined, { maximumFractionDigits: 4 })}</strong> sq ft
              (width in feet × length in feet). You are billing{' '}
              <strong className="text-slate-700">{rollBillable.toLocaleString(undefined, { maximumFractionDigits: 4 })}</strong> sq ft — about{' '}
              <strong className="text-slate-700">{(rollFrac * 100).toFixed(1)}%</strong> of a full roll.
              {rollLineCostPreview !== null ? (
                <>
                  {' '}
                  At your entered $/sq ft, raw line cost ≈{' '}
                  <strong className="text-slate-700">{formatMoney(rollLineCostPreview)}</strong> (before estimate multiplier).
                </>
              ) : null}
            </p>
            <label className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                Internal $/sq ft (optional)
              </span>
              <input
                value={rollCostSqftUsd}
                onChange={(e) => setRollCostSqftUsd(e.target.value)}
                placeholder="Leave blank to keep line unit cost"
                inputMode="decimal"
                className="w-full rounded-[10px] border border-slate-200 bg-slate-50/70 px-3 py-2 text-[13px] text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-violet-500 focus:bg-white focus:ring-4 focus:ring-violet-500/10"
              />
            </label>
            <button
              type="button"
              disabled={!canApply || rollBillable <= 0}
              onClick={applyRoll}
              className="w-full rounded-[10px] bg-violet-600 px-3 py-2.5 text-[12.5px] font-semibold text-white shadow-sm transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
            >
              Apply to focused line
            </button>
          </div>
        ) : null}

        {mode === 'banner' ? (
          <div className="mt-3 space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                  Banner sq ft
                </span>
                <input
                  value={banSqft}
                  onChange={(e) => setBanSqft(e.target.value)}
                  inputMode="decimal"
                  className="w-full rounded-[10px] border border-slate-200 bg-slate-50/70 px-3 py-2 text-[13px] text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-violet-500 focus:bg-white focus:ring-4 focus:ring-violet-500/10"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
                  Grommets (count)
                </span>
                <input
                  value={banGrommets}
                  onChange={(e) => setBanGrommets(e.target.value)}
                  inputMode="numeric"
                  className="w-full rounded-[10px] border border-slate-200 bg-slate-50/70 px-3 py-2 text-[13px] text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-violet-500 focus:bg-white focus:ring-4 focus:ring-violet-500/10"
                />
              </label>
            </div>
            <p className="text-[12px] leading-relaxed text-slate-500">
              Uses shop banner rule: <strong className="text-slate-700">$4/sq ft</strong> on the first 200 sq ft, then{' '}
              <strong className="text-slate-700">$3/sq ft</strong> beyond, plus{' '}
              <strong className="text-slate-700">$0.50</strong> per grommet, with a{' '}
              <strong className="text-slate-700">$45</strong> minimum on the banner portion. Suggested line raw cost:{' '}
              <strong className="text-slate-700">{formatMoney(banner.cents)}</strong> as one material line (qty 1 × that unit cost — before estimate multiplier).
              {banner.appliedMinimum ? ' Minimum charge applied.' : ''}
            </p>
            <button
              type="button"
              disabled={!canApply || banSq <= 0}
              onClick={applyBanner}
              className="w-full rounded-[10px] bg-violet-600 px-3 py-2.5 text-[12.5px] font-semibold text-white shadow-sm transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
            >
              Apply to focused line
            </button>
          </div>
        ) : null}

        {mode === 'custom' ? (
          <div className="mt-3 space-y-4">
            <div className="rounded-[14px] border border-violet-200 bg-white p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[13px] font-bold text-slate-900">Your custom rules</p>
                  <p className="mt-0.5 text-[12px] leading-relaxed text-slate-500">
                    Build detailed formulas for shop-specific pricing. These save in this browser and do not change the built-in helpers.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCustomBuilder((current) => !current)}
                  className="inline-flex shrink-0 items-center justify-center rounded-[10px] border border-violet-200 bg-violet-50 px-3 py-2 text-[12px] font-bold text-violet-700 transition hover:bg-violet-100"
                >
                  {showCustomBuilder ? 'Hide builder' : '+ Add custom rule'}
                </button>
              </div>

              {customRules.length > 0 ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <SelectControl
                    value={selectedCustomRuleId}
                    onChange={(e) => {
                      const nextId = e.currentTarget.value;
                      const rule = customRules.find((r) => r.id === nextId);
                      setSelectedCustomRuleId(nextId);
                      if (rule) setCustomQty((rule.defaultQtyMilli / 1000).toString());
                    }}
                    className="w-full rounded-[10px] border border-slate-200 bg-slate-50/70 px-3 py-2 text-[13px] text-slate-800 outline-none transition focus:border-violet-500 focus:bg-white focus:ring-4 focus:ring-violet-500/10"
                  >
                    {customRules.map((rule) => (
                      <option key={rule.id} value={rule.id}>
                        {rule.name} - {customRuleLabel(rule.formula)}
                      </option>
                    ))}
                  </SelectControl>
                  {selectedCustomRule ? (
                    <button
                      type="button"
                      onClick={() => deleteCustomRule(selectedCustomRule.id)}
                      className="rounded-[10px] border border-rose-200 bg-white px-3 py-2 text-[12px] font-bold text-rose-600 transition hover:bg-rose-50"
                    >
                      Delete
                    </button>
                  ) : null}
                </div>
              ) : (
                <p className="mt-3 rounded-[12px] border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-[12.5px] text-slate-500">
                  No custom rules yet. Add one for install packages, specialty finishing, rush fees, channel letters, permits, or anything else your shop prices uniquely.
                </p>
              )}
            </div>

            {showCustomBuilder ? (
              <div className="rounded-[14px] border border-slate-200 bg-white p-4 shadow-sm">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Rule name">
                    <input
                      value={customDraft.name}
                      onChange={(e) => setCustomDraft((d) => ({ ...d, name: e.target.value }))}
                      placeholder="e.g. Routed ACM package"
                      className={fieldClassName}
                    />
                  </Field>
                  <Field label="Line type">
                    <SelectControl
                      value={customDraft.lineKind}
                      onChange={(e) =>
                        setCustomDraft((d) => ({
                          ...d,
                          lineKind: e.currentTarget.value as EstimateLineKind,
                        }))
                      }
                      className={fieldClassName}
                    >
                      {Object.values(EstimateLineKind).map((kind) => (
                        <option key={kind} value={kind}>
                          {kind}
                        </option>
                      ))}
                    </SelectControl>
                  </Field>
                  <Field label="Formula">
                    <SelectControl
                      value={customDraft.formula}
                      onChange={(e) =>
                        setCustomDraft((d) => ({
                          ...d,
                          formula: e.currentTarget.value as CustomFormula,
                        }))
                      }
                      className={fieldClassName}
                    >
                      <option value="flat">Flat price only</option>
                      <option value="quantity">Quantity x rate</option>
                      <option value="area">Area / units x rate</option>
                      <option value="area-plus-count">Area + add-on count</option>
                      <option value="tiered-area">Tiered area + add-ons</option>
                    </SelectControl>
                  </Field>
                  <Field label="Description prefix">
                    <input
                      value={customDraft.descriptionPrefix}
                      onChange={(e) =>
                        setCustomDraft((d) => ({ ...d, descriptionPrefix: e.target.value }))
                      }
                      placeholder="Defaults to rule name"
                      className={fieldClassName}
                    />
                  </Field>
                  <Field label="Primary unit label">
                    <input
                      value={customDraft.unitLabel}
                      onChange={(e) => setCustomDraft((d) => ({ ...d, unitLabel: e.target.value }))}
                      placeholder="sq ft, linear ft, each"
                      className={fieldClassName}
                    />
                  </Field>
                  <Field label="Add-on count label">
                    <input
                      value={customDraft.countLabel}
                      onChange={(e) => setCustomDraft((d) => ({ ...d, countLabel: e.target.value }))}
                      placeholder="Grommets, holes, permits"
                      className={fieldClassName}
                    />
                  </Field>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <Field label="Base / setup fee">
                    <MoneyInput
                      value={customDraft.flatCostUsd}
                      onChange={(value) => setCustomDraft((d) => ({ ...d, flatCostUsd: value }))}
                      placeholder="0.00"
                    />
                  </Field>
                  <Field label="Rate per primary unit">
                    <MoneyInput
                      value={customDraft.rateUsd}
                      onChange={(value) => setCustomDraft((d) => ({ ...d, rateUsd: value }))}
                      placeholder="4.00"
                    />
                  </Field>
                  <Field label="Rate per add-on">
                    <MoneyInput
                      value={customDraft.countRateUsd}
                      onChange={(value) => setCustomDraft((d) => ({ ...d, countRateUsd: value }))}
                      placeholder="0.50"
                    />
                  </Field>
                  <Field label="Minimum charge">
                    <MoneyInput
                      value={customDraft.minimumUsd}
                      onChange={(value) => setCustomDraft((d) => ({ ...d, minimumUsd: value }))}
                      placeholder="45.00"
                    />
                  </Field>
                  <Field label="Waste percent">
                    <input
                      value={customDraft.wastePercent}
                      onChange={(e) =>
                        setCustomDraft((d) => ({ ...d, wastePercent: e.target.value }))
                      }
                      inputMode="decimal"
                      placeholder="10"
                      className={fieldClassName}
                    />
                  </Field>
                  <Field label="Markup percent">
                    <input
                      value={customDraft.markupPercent}
                      onChange={(e) =>
                        setCustomDraft((d) => ({ ...d, markupPercent: e.target.value }))
                      }
                      inputMode="decimal"
                      placeholder="0"
                      className={fieldClassName}
                    />
                  </Field>
                  <Field label="Round primary units to">
                    <input
                      value={customDraft.roundTo}
                      onChange={(e) => setCustomDraft((d) => ({ ...d, roundTo: e.target.value }))}
                      inputMode="decimal"
                      placeholder="1, 5, 10"
                      className={fieldClassName}
                    />
                  </Field>
                  <Field label="Tier 1 limit">
                    <input
                      value={customDraft.tierLimit}
                      onChange={(e) =>
                        setCustomDraft((d) => ({ ...d, tierLimit: e.target.value }))
                      }
                      inputMode="decimal"
                      placeholder="200"
                      className={fieldClassName}
                    />
                  </Field>
                  <Field label="Tier 2 rate">
                    <MoneyInput
                      value={customDraft.tier2RateUsd}
                      onChange={(value) => setCustomDraft((d) => ({ ...d, tier2RateUsd: value }))}
                      placeholder="3.00"
                    />
                  </Field>
                  <Field label="Default primary quantity">
                    <input
                      value={customDraft.defaultQty}
                      onChange={(e) =>
                        setCustomDraft((d) => ({ ...d, defaultQty: e.target.value }))
                      }
                      inputMode="decimal"
                      placeholder="1"
                      className={fieldClassName}
                    />
                  </Field>
                </div>

                <div className="mt-4 rounded-[12px] border border-violet-100 bg-violet-50/60 px-3 py-2 text-[12px] leading-relaxed text-violet-900">
                  <strong>Formula order:</strong> base fee + billable units + add-ons, then waste,
                  rounding, markup, and minimum. Tiered rules use Rate per primary unit until the
                  tier limit, then Tier 2 rate after that.
                </div>

                <button
                  type="button"
                  onClick={saveCustomRule}
                  disabled={!customDraft.name.trim()}
                  className="mt-4 w-full rounded-[10px] bg-violet-600 px-3 py-2.5 text-[12.5px] font-semibold text-white shadow-sm transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                >
                  Save custom rule
                </button>
              </div>
            ) : null}

            {selectedCustomRule ? (
              <div className="rounded-[14px] border border-slate-200 bg-slate-50/60 p-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={`Primary quantity (${selectedCustomRule.unitLabel})`}>
                    <input
                      value={customQty}
                      onChange={(e) => setCustomQty(e.target.value)}
                      inputMode="decimal"
                      className={fieldClassName}
                    />
                  </Field>
                  <Field label={selectedCustomRule.countLabel}>
                    <input
                      value={customCount}
                      onChange={(e) => setCustomCount(e.target.value)}
                      inputMode="decimal"
                      disabled={
                        selectedCustomRule.formula !== 'area-plus-count' &&
                        selectedCustomRule.formula !== 'tiered-area'
                      }
                      className={fieldClassName}
                    />
                  </Field>
                </div>

                {customPreview ? (
                  <div className="mt-3 rounded-[12px] border border-white bg-white px-3 py-3 text-[12px] leading-relaxed text-slate-600 shadow-sm">
                    <p>
                      <strong className="text-slate-800">{selectedCustomRule.name}</strong> will
                      bill{' '}
                      <strong className="text-slate-800">
                        {customPreview.billableQty.toLocaleString(undefined, {
                          maximumFractionDigits: 4,
                        })}{' '}
                        {selectedCustomRule.unitLabel}
                      </strong>
                      {selectedCustomRule.formula === 'area-plus-count' ||
                      selectedCustomRule.formula === 'tiered-area'
                        ? ` plus ${customPreview.addOnCount.toLocaleString(undefined, {
                            maximumFractionDigits: 2,
                          })} ${selectedCustomRule.countLabel.toLowerCase()}`
                        : ''}
                      . Raw line cost:{' '}
                      <strong className="text-slate-900">{formatMoney(customPreview.totalCents)}</strong>.
                      {customPreview.minimumApplied ? ' Minimum charge applied.' : ''}
                    </p>
                  </div>
                ) : null}

                <button
                  type="button"
                  disabled={!canApply || !customPreview || customPreview.totalCents <= 0}
                  onClick={applyCustomRule}
                  className="mt-3 w-full rounded-[10px] bg-violet-600 px-3 py-2.5 text-[12.5px] font-semibold text-white shadow-sm transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                >
                  Apply custom rule to focused line
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );

  if (embedded) {
    return <div className="flex flex-col gap-4 px-5 pb-5 pt-4">{body}</div>;
  }

  return (
    <SectionCard className="p-5">
      <SectionHeading
        icon={<IconCalculator />}
        title="Pricing helper"
        tone="violet"
        subtitle="Sq ft, sheets, rolls, or banner — the result applies to the focused grid row when you click Apply."
      />
      <div className="mt-4 flex flex-col gap-4">{body}</div>
    </SectionCard>
  );
}
