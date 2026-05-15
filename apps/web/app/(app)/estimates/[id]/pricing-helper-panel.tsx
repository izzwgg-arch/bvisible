'use client';

import { useMemo, useState } from 'react';
import { EstimateLineKind } from '@bvisible/db';
import {
  bannerPrice,
  billableSqftRollMinimum,
  computePieceAndTotalSqftFromInches,
  computeRollSqft,
  qtyToMilli,
  rollUsedFraction,
  sheetsNeededForCoverage,
  STANDARD_SHEET_SQ_FT,
} from '@bvisible/pricing';
import { formatMoney, kindLabel, parseMoney } from '@/lib/estimate/format';
import type { Action, DraftLine } from './editor';

type Tool = 'sqft' | 'sheet' | 'roll' | 'banner';

export function PricingHelperPanel({
  activeLineId,
  lines,
  dispatch,
}: {
  activeLineId: string | null;
  lines: ReadonlyArray<DraftLine>;
  dispatch: React.Dispatch<Action>;
}) {
  const [open, setOpen] = useState(false);
  const [tool, setTool] = useState<Tool>('sqft');

  const activeLine = activeLineId ? lines.find((l) => l.id === activeLineId) : null;

  const [sqW, setSqW] = useState('');
  const [sqH, setSqH] = useState('');
  const [sqQty, setSqQty] = useState('1');
  const [sqLabel, setSqLabel] = useState('');
  const [sqCostSqft, setSqCostSqft] = useState('');

  const [sheetTotalSqft, setSheetTotalSqft] = useState('');
  const [sheetPreset, setSheetPreset] = useState<string>('32');
  const [sheetCostEach, setSheetCostEach] = useState('');

  const [rollW, setRollW] = useState('54');
  const [rollLenFt, setRollLenFt] = useState('150');
  const [rollUsed, setRollUsed] = useState('');
  const [rollMinPct, setRollMinPct] = useState('0');
  const [rollCostSqft, setRollCostSqft] = useState('');

  const [banSqft, setBanSqft] = useState('');
  const [banGrom, setBanGrom] = useState('0');
  const [banLabel, setBanLabel] = useState('Banner');

  const sheetSqftNum = sheetPreset === '50' ? STANDARD_SHEET_SQ_FT.SHEET_5X10 : STANDARD_SHEET_SQ_FT.SHEET_4X8;

  const sqftPreview = useMemo(() => {
    const w = Number(sqW);
    const h = Number(sqH);
    const q = Number(sqQty);
    if (!Number.isFinite(w) || !Number.isFinite(h) || !Number.isFinite(q) || q < 1) return null;
    return computePieceAndTotalSqftFromInches(w, h, q);
  }, [sqW, sqH, sqQty]);

  const sheetPreview = useMemo(() => {
    const t = Number(sheetTotalSqft);
    if (!Number.isFinite(t) || t <= 0) return null;
    const sheets = sheetsNeededForCoverage(t, sheetSqftNum);
    const threshold = 0.75 * sheetSqftNum;
    const rule =
      t < threshold
        ? `Under ${(threshold).toFixed(1)} sq ft (75% of one sheet) — bill one full sheet.`
        : `Divide ${t.toFixed(2)} sq ft by ${sheetSqftNum} sq ft and round up — ${sheets} sheet(s).`;
    return { sheets, rule, totalSqft: t };
  }, [sheetTotalSqft, sheetSqftNum]);

  const rollPreview = useMemo(() => {
    const w = Number(rollW);
    const lf = Number(rollLenFt);
    const used = Number(rollUsed);
    const mp = Number(rollMinPct);
    if (!Number.isFinite(w) || !Number.isFinite(lf) || w <= 0 || lf <= 0) return null;
    if (!Number.isFinite(used) || used <= 0) return null;
    const rollSq = computeRollSqft(w, lf);
    const frac = rollUsedFraction(used, rollSq);
    const minFrac = Number.isFinite(mp) ? Math.min(100, Math.max(0, mp)) / 100 : 0;
    const billSq = billableSqftRollMinimum({
      usedSqft: used,
      rollSqft: rollSq,
      minimumBillFraction: minFrac,
    });
    return { rollSq, frac, billSq };
  }, [rollW, rollLenFt, rollUsed, rollMinPct]);

  const bannerPreview = useMemo(() => {
    const s = Number(banSqft);
    const g = Number(banGrom);
    if (!Number.isFinite(s) || s <= 0) return null;
    if (!Number.isFinite(g) || g < 0 || !Number.isInteger(g)) return null;
    return bannerPrice({ sqft: s, grommets: g });
  }, [banSqft, banGrom]);

  function applySqft() {
    if (!activeLineId || !sqftPreview) return;
    const cost = sqCostSqft.trim() === '' ? null : parseMoney(sqCostSqft);
    const label = sqLabel.trim();
    const desc =
      (label ? `${label} · ` : '') + `${sqftPreview.totalSqft.toFixed(2)} sq ft (${sqftPreview.pieceSqft.toFixed(2)} ea × ${Math.floor(Number(sqQty) || 1)})`;
    const patch: Partial<DraftLine> = {
      kind: EstimateLineKind.MATERIAL,
      qtyMilli: qtyToMilli(sqftPreview.totalSqft),
      description: desc,
    };
    if (cost !== null && cost >= 0) {
      patch.unitCostCents = cost;
    }
    dispatch({
      type: 'set-line',
      id: activeLineId,
      patch,
    });
  }

  function applySheet() {
    if (!activeLineId || !sheetPreview) return;
    const cost = parseMoney(sheetCostEach);
    if (cost === null || cost < 0) return;
    const desc = `Sheet stock (${sheetSqftNum} sq ft) · ${sheetPreview.sheets} sheet(s) for ${sheetPreview.totalSqft.toFixed(2)} sq ft`;
    dispatch({
      type: 'set-line',
      id: activeLineId,
      patch: {
        kind: EstimateLineKind.MATERIAL,
        qtyMilli: qtyToMilli(sheetPreview.sheets),
        unitCostCents: cost,
        description: desc,
      },
    });
  }

  function applyRoll() {
    if (!activeLineId || !rollPreview) return;
    const costSq = parseMoney(rollCostSqft);
    if (costSq === null || costSq < 0) return;
    const desc = `Roll vinyl · ${rollPreview.billSq.toFixed(2)} billable sq ft (${(rollPreview.frac * 100).toFixed(1)}% of ${rollPreview.rollSq.toFixed(2)} sq ft roll)`;
    dispatch({
      type: 'set-line',
      id: activeLineId,
      patch: {
        kind: EstimateLineKind.MATERIAL,
        qtyMilli: qtyToMilli(rollPreview.billSq),
        unitCostCents: costSq,
        description: desc,
      },
    });
  }

  function applyBanner() {
    if (!activeLineId || !bannerPreview) return;
    const label = banLabel.trim() || 'Banner';
    const s = Number(banSqft);
    const g = Math.max(0, Math.trunc(Number(banGrom) || 0));
    const desc = `${label} (${s} sq ft${g ? `, ${g} grommets` : ''})`;
    dispatch({
      type: 'set-line',
      id: activeLineId,
      patch: {
        kind: EstimateLineKind.MATERIAL,
        qtyMilli: 1000,
        unitCostCents: bannerPreview.cents,
        description: desc,
      },
    });
  }

  return (
    <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-4 shadow-[var(--shadow-bv-card)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
        aria-expanded={open}
      >
        <div>
          <h2 className="text-[13px] font-semibold tracking-tight text-[var(--color-bv-text)]">
            Pricing helper
          </h2>
          <p className="mt-0.5 text-[11.5px] leading-snug text-[var(--color-bv-muted)]">
            Yardage and banner math — nothing writes to the grid until you click Apply on a focused row.
          </p>
        </div>
        <span className="text-[11px] font-medium text-[var(--color-bv-accent)]">{open ? 'Hide' : 'Show'}</span>
      </button>

      {open ? (
        <div className="mt-4 space-y-4 border-t border-[var(--color-bv-border)] pt-4">
          {!activeLine ? (
            <p className="rounded-[8px] border border-dashed border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-3 text-[12px] text-[var(--color-bv-muted)]">
              Focus any cell on a line in the grid below. Apply updates that row only — your keyboard shortcuts stay the same.
            </p>
          ) : (
            <p className="text-[11.5px] text-[var(--color-bv-muted)]">
              Active row:{' '}
              <span className="font-medium text-[var(--color-bv-text)]">{kindLabel(activeLine.kind)}</span>{' '}
              · {activeLine.description.slice(0, 52)}
              {activeLine.description.length > 52 ? '…' : ''}
            </p>
          )}

          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-bv-muted)]">
              Calculator
            </span>
            <select
              value={tool}
              onChange={(e) => setTool(e.target.value as Tool)}
              className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-bv-accent)]"
            >
              <option value="sqft">Square footage</option>
              <option value="sheet">Sheet goods</option>
              <option value="roll">Roll material</option>
              <option value="banner">Banner</option>
            </select>
          </label>

          {tool === 'sqft' ? (
            <div className="space-y-3 rounded-[8px] bg-[var(--color-bv-bg)] p-3 text-[12px]">
              <p className="text-[11.5px] leading-snug text-[var(--color-bv-muted)]">
                Sq ft per piece = width × height ÷ 144. Total = sq ft each × number of identical pieces.
              </p>
              <div className="grid gap-2 sm:grid-cols-3">
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase text-[var(--color-bv-muted)]">Width (in)</span>
                  <input
                    value={sqW}
                    onChange={(e) => setSqW(e.target.value)}
                    inputMode="decimal"
                    className="rounded-[8px] border border-[var(--color-bv-border)] bg-white px-2 py-1.5 tabular-nums"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase text-[var(--color-bv-muted)]">Height (in)</span>
                  <input
                    value={sqH}
                    onChange={(e) => setSqH(e.target.value)}
                    inputMode="decimal"
                    className="rounded-[8px] border border-[var(--color-bv-border)] bg-white px-2 py-1.5 tabular-nums"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase text-[var(--color-bv-muted)]">Qty pieces</span>
                  <input
                    value={sqQty}
                    onChange={(e) => setSqQty(e.target.value)}
                    inputMode="numeric"
                    className="rounded-[8px] border border-[var(--color-bv-border)] bg-white px-2 py-1.5 tabular-nums"
                  />
                </label>
              </div>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase text-[var(--color-bv-muted)]">
                  Label (optional)
                </span>
                <input
                  value={sqLabel}
                  onChange={(e) => setSqLabel(e.target.value)}
                  placeholder="e.g. ACM faces"
                  className="rounded-[8px] border border-[var(--color-bv-border)] bg-white px-2 py-1.5"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase text-[var(--color-bv-muted)]">
                  Cost per sq ft (USD, optional)
                </span>
                <input
                  value={sqCostSqft}
                  onChange={(e) => setSqCostSqft(e.target.value)}
                  placeholder="Leave blank to keep row unit cost"
                  inputMode="decimal"
                  className="rounded-[8px] border border-[var(--color-bv-border)] bg-white px-2 py-1.5"
                />
              </label>
              {sqftPreview ? (
                <div className="rounded-[6px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-2 text-[11.5px] leading-snug text-[var(--color-bv-text)]">
                  <div className="font-medium text-[var(--color-bv-text)]">Preview</div>
                  <div className="mt-1 text-[var(--color-bv-muted)]">
                    Each piece ≈ <strong className="text-[var(--color-bv-text)]">{sqftPreview.pieceSqft.toFixed(2)}</strong> sq ft · Total{' '}
                    <strong className="text-[var(--color-bv-text)]">{sqftPreview.totalSqft.toFixed(2)}</strong> sq ft
                  </div>
                  <div className="mt-1 text-[var(--color-bv-muted)]">
                    Suggested line qty = total sq ft. Apply sets Material quantity; add your unit cost if entered above.
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-rose-700">Enter positive width, height, and quantity.</p>
              )}
              <button
                type="button"
                disabled={!activeLineId || !sqftPreview}
                onClick={applySqft}
                className="w-full rounded-[8px] bg-[var(--color-bv-accent)] px-3 py-2 text-[12px] font-semibold text-[var(--color-bv-accent-foreground)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Apply to focused row
              </button>
            </div>
          ) : null}

          {tool === 'sheet' ? (
            <div className="space-y-3 rounded-[8px] bg-[var(--color-bv-bg)] p-3 text-[12px]">
              <p className="text-[11.5px] leading-snug text-[var(--color-bv-muted)]">
                Standard sheets: 4×8 = 32 sq ft · 5×10 = 50 sq ft. Under 75% of one sheet still bills a full sheet;
                otherwise round up to whole sheets.
              </p>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase text-[var(--color-bv-muted)]">Total sq ft needed</span>
                <input
                  value={sheetTotalSqft}
                  onChange={(e) => setSheetTotalSqft(e.target.value)}
                  inputMode="decimal"
                  className="rounded-[8px] border border-[var(--color-bv-border)] bg-white px-2 py-1.5"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase text-[var(--color-bv-muted)]">Sheet size</span>
                <select
                  value={sheetPreset}
                  onChange={(e) => setSheetPreset(e.target.value)}
                  className="rounded-[8px] border border-[var(--color-bv-border)] bg-white px-2 py-1.5 text-[13px]"
                >
                  <option value="32">4 × 8 (32 sq ft)</option>
                  <option value="50">5 × 10 (50 sq ft)</option>
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase text-[var(--color-bv-muted)]">
                  Cost per sheet (USD)
                </span>
                <input
                  value={sheetCostEach}
                  onChange={(e) => setSheetCostEach(e.target.value)}
                  inputMode="decimal"
                  placeholder="Required to fill unit cost"
                  className="rounded-[8px] border border-[var(--color-bv-border)] bg-white px-2 py-1.5"
                />
              </label>
              {sheetPreview ? (
                <div className="rounded-[6px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-2 text-[11.5px] leading-snug">
                  <div className="font-medium">Preview</div>
                  <p className="mt-1 text-[var(--color-bv-muted)]">{sheetPreview.rule}</p>
                  <p className="mt-1 text-[var(--color-bv-text)]">
                    Sheets needed: <strong>{sheetPreview.sheets}</strong>
                  </p>
                </div>
              ) : (
                <p className="text-[11px] text-rose-700">Enter total sq ft greater than zero.</p>
              )}
              <button
                type="button"
                disabled={!activeLineId || !sheetPreview || sheetCostEach.trim() === '' || parseMoney(sheetCostEach) === null}
                onClick={applySheet}
                className="w-full rounded-[8px] bg-[var(--color-bv-accent)] px-3 py-2 text-[12px] font-semibold text-[var(--color-bv-accent-foreground)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Apply to focused row
              </button>
            </div>
          ) : null}

          {tool === 'roll' ? (
            <div className="space-y-3 rounded-[8px] bg-[var(--color-bv-bg)] p-3 text-[12px]">
              <p className="text-[11.5px] leading-snug text-[var(--color-bv-muted)]">
                Roll coverage = width (in) × roll length (ft) ÷ 12. Optionally bill at least a minimum fraction of the roll.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase text-[var(--color-bv-muted)]">Roll width (in)</span>
                  <input
                    value={rollW}
                    onChange={(e) => setRollW(e.target.value)}
                    inputMode="decimal"
                    className="rounded-[8px] border border-[var(--color-bv-border)] bg-white px-2 py-1.5"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase text-[var(--color-bv-muted)]">Roll length (ft)</span>
                  <input
                    value={rollLenFt}
                    onChange={(e) => setRollLenFt(e.target.value)}
                    inputMode="decimal"
                    className="rounded-[8px] border border-[var(--color-bv-border)] bg-white px-2 py-1.5"
                  />
                </label>
              </div>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase text-[var(--color-bv-muted)]">Used sq ft on job</span>
                <input
                  value={rollUsed}
                  onChange={(e) => setRollUsed(e.target.value)}
                  inputMode="decimal"
                  className="rounded-[8px] border border-[var(--color-bv-border)] bg-white px-2 py-1.5"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase text-[var(--color-bv-muted)]">
                  Minimum bill % of roll (0–100)
                </span>
                <input
                  value={rollMinPct}
                  onChange={(e) => setRollMinPct(e.target.value)}
                  inputMode="decimal"
                  placeholder="0"
                  className="rounded-[8px] border border-[var(--color-bv-border)] bg-white px-2 py-1.5"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase text-[var(--color-bv-muted)]">
                  Cost per sq ft (USD)
                </span>
                <input
                  value={rollCostSqft}
                  onChange={(e) => setRollCostSqft(e.target.value)}
                  inputMode="decimal"
                  className="rounded-[8px] border border-[var(--color-bv-border)] bg-white px-2 py-1.5"
                />
              </label>
              {rollPreview ? (
                <div className="rounded-[6px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-2 text-[11.5px] leading-snug">
                  <div className="font-medium">Preview</div>
                  <p className="mt-1 text-[var(--color-bv-muted)]">
                    Roll holds <strong>{rollPreview.rollSq.toFixed(2)}</strong> sq ft · Used{' '}
                    <strong>{(rollPreview.frac * 100).toFixed(1)}%</strong>
                  </p>
                  <p className="mt-1 text-[var(--color-bv-text)]">
                    Billable sq ft: <strong>{rollPreview.billSq.toFixed(2)}</strong>
                  </p>
                </div>
              ) : (
                <p className="text-[11px] text-rose-700">Enter roll dimensions and positive used sq ft.</p>
              )}
              <button
                type="button"
                disabled={!activeLineId || !rollPreview || rollCostSqft.trim() === '' || parseMoney(rollCostSqft) === null}
                onClick={applyRoll}
                className="w-full rounded-[8px] bg-[var(--color-bv-accent)] px-3 py-2 text-[12px] font-semibold text-[var(--color-bv-accent-foreground)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Apply to focused row
              </button>
            </div>
          ) : null}

          {tool === 'banner' ? (
            <div className="space-y-3 rounded-[8px] bg-[var(--color-bv-bg)] p-3 text-[12px]">
              <p className="text-[11.5px] leading-snug text-[var(--color-bv-muted)]">
                $4/sq ft to 200 sq ft, then $3/sq ft above. Minimum <strong>$45</strong> applies to print area only; grommets add after.
              </p>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase text-[var(--color-bv-muted)]">Description label</span>
                <input
                  value={banLabel}
                  onChange={(e) => setBanLabel(e.target.value)}
                  className="rounded-[8px] border border-[var(--color-bv-border)] bg-white px-2 py-1.5"
                />
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase text-[var(--color-bv-muted)]">Print sq ft</span>
                  <input
                    value={banSqft}
                    onChange={(e) => setBanSqft(e.target.value)}
                    inputMode="decimal"
                    className="rounded-[8px] border border-[var(--color-bv-border)] bg-white px-2 py-1.5"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] font-semibold uppercase text-[var(--color-bv-muted)]">Grommets</span>
                  <input
                    value={banGrom}
                    onChange={(e) => setBanGrom(e.target.value)}
                    inputMode="numeric"
                    className="rounded-[8px] border border-[var(--color-bv-border)] bg-white px-2 py-1.5"
                  />
                </label>
              </div>
              {bannerPreview ? (
                <div className="rounded-[6px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-2 text-[11.5px] leading-snug">
                  <div className="font-medium">Preview</div>
                  <p className="mt-1 text-[var(--color-bv-muted)]">
                    {bannerPreview.appliedMinimum
                      ? 'Print area uses the $45 shop minimum before grommets. '
                      : ''}
                    Grommet add-on ${(bannerPreview.grommetCents / 100).toFixed(2)}.
                  </p>
                  <p className="mt-1 text-[var(--color-bv-text)]">
                    Line cost basis: <strong>{formatMoney(bannerPreview.cents)}</strong> as qty 1 × unit cost
                  </p>
                </div>
              ) : (
                <p className="text-[11px] text-rose-700">Enter positive sq ft and whole grommet count.</p>
              )}
              <button
                type="button"
                disabled={!activeLineId || !bannerPreview}
                onClick={applyBanner}
                className="w-full rounded-[8px] bg-[var(--color-bv-accent)] px-3 py-2 text-[12px] font-semibold text-[var(--color-bv-accent-foreground)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Apply to focused row
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
