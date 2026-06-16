'use client';

import { useMemo, useState } from 'react';
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
import { formatMoney, parseMoney } from '@/lib/estimate/format';
import { FinalizedReadOnlyChip } from '@/components/estimate/finalized-read-only-chip';
import { SectionCard, SectionHeading, IconCalculator } from '@/components/estimate/estimate-surface';
import type { Action, DraftLine } from './editor';

type HelperMode = 'sqft' | 'sheet' | 'roll' | 'banner';

const MODE_LABELS: Record<HelperMode, string> = {
  sqft: 'Square footage',
  sheet: 'Sheet goods',
  roll: 'Roll material',
  banner: 'Banner',
};

function num(raw: string): number {
  const n = Number(String(raw).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function intStr(raw: string): number {
  return Math.max(0, Math.trunc(num(raw)));
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

  const activeLine = useMemo(
    () => (activeLineId ? lines.find((l) => l.id === activeLineId) ?? null : null),
    [activeLineId, lines],
  );

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
              <select
                value={sheetSize}
                onChange={(e) => setSheetSize(e.target.value as '48' | '510')}
                className="w-full rounded-[10px] border border-slate-200 bg-slate-50/70 px-3 py-2 text-[13px] text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-violet-500 focus:bg-white focus:ring-4 focus:ring-violet-500/10"
              >
                <option value="48">4×8 (32 sq ft)</option>
                <option value="510">5×10 (50 sq ft)</option>
              </select>
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
