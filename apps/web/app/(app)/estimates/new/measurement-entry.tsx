'use client';

// Shared measurement controls for adding materials by quantity, percent
// of a full sheet/roll, square feet, or linear feet. The portion of the
// full material (and its cost) is calculated automatically — the user
// never works out the percentage by hand. Used by the recommendations
// panel and the Custom Build workspace in the guided estimate flow.

import { formatMoney } from '@bvisible/pricing';
import {
  computeMeasurement,
  guessMaterialSize,
  MEASUREMENT_MODE_LABELS,
  type MeasurementMode,
  type MeasurementResult,
} from '@/lib/estimate/measurement';

export interface MeasurementState {
  mode: MeasurementMode;
  /// Entered measurement as typed (count, %, sq ft, or lin ft).
  value: string;
  /// Size of ONE full sheet/roll — prefilled from the material name when
  /// parseable, always editable.
  fullSqft: string;
  fullLengthFt: string;
  /// Human label of the auto-detected size ("4′ × 8′ sheet (32 sq ft)").
  sizeLabel: string | null;
}

export function defaultMeasurementState(materialName: string): MeasurementState {
  const guess = guessMaterialSize(materialName);
  return {
    mode: 'QTY',
    value: '1',
    fullSqft: guess.fullSqft != null ? String(guess.fullSqft) : '',
    fullLengthFt: guess.fullLengthFt != null ? String(guess.fullLengthFt) : '',
    sizeLabel: guess.sizeLabel,
  };
}

export function measurementResult(
  state: MeasurementState,
  fullUnitPriceCents: number
): MeasurementResult {
  return computeMeasurement({
    mode: state.mode,
    value: Number(state.value) || 0,
    fullUnitPriceCents,
    fullSqft: Number(state.fullSqft) || null,
    fullLengthFt: Number(state.fullLengthFt) || null,
  });
}

/// Line description including the entered measurement so the calculation
/// stays visible on the saved estimate.
export function measurementDescription(
  materialName: string,
  state: MeasurementState,
  result: MeasurementResult
): string {
  if (state.mode === 'QTY') return materialName;
  return `${materialName} — ${result.detail}`;
}

const selectCls =
  'rounded-[9px] border border-[var(--color-bv-border)] bg-white px-2 py-1.5 text-[12px] text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)]';
const numCls =
  'w-20 rounded-[9px] border border-[var(--color-bv-border)] bg-white px-2 py-1.5 text-right text-[12px] text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)]';

export function MeasurementControls({
  state,
  onChange,
  fullUnitPriceCents,
  markupPercent,
}: {
  state: MeasurementState;
  onChange: (next: MeasurementState) => void;
  /// Cost of one full sheet/roll in cents.
  fullUnitPriceCents: number;
  /// When given, the selling price (cost + markup) is shown too.
  markupPercent?: number | null;
}) {
  const result = measurementResult(state, fullUnitPriceCents);
  const sellCents =
    result.ok && markupPercent != null
      ? Math.round(result.costCents * (1 + (Number(markupPercent) || 0) / 100))
      : null;

  const valueUnit =
    state.mode === 'PERCENT' ? '%' : state.mode === 'SQFT' ? 'sq ft' : state.mode === 'LINFT' ? 'lin ft' : '×';

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className={selectCls}
          value={state.mode}
          aria-label="Measurement type"
          onChange={(e) => onChange({ ...state, mode: e.target.value as MeasurementMode })}
        >
          {(Object.keys(MEASUREMENT_MODE_LABELS) as MeasurementMode[]).map((m) => (
            <option key={m} value={m}>
              {MEASUREMENT_MODE_LABELS[m]}
            </option>
          ))}
        </select>
        <span className="flex items-center gap-1">
          <input
            className={numCls}
            type="number"
            min={0}
            step="any"
            value={state.value}
            aria-label="Measurement value"
            onChange={(e) => onChange({ ...state, value: e.target.value })}
          />
          <span className="text-[10px] font-bold uppercase text-[var(--color-bv-muted)]">{valueUnit}</span>
        </span>
        {state.mode === 'SQFT' ? (
          <label className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold uppercase text-[var(--color-bv-muted)]">
              Full sheet/roll
            </span>
            <input
              className={numCls}
              type="number"
              min={0}
              step="any"
              value={state.fullSqft}
              aria-label="Full sheet or roll size in square feet"
              onChange={(e) => onChange({ ...state, fullSqft: e.target.value })}
            />
            <span className="text-[10px] font-bold uppercase text-[var(--color-bv-muted)]">sq ft</span>
          </label>
        ) : null}
        {state.mode === 'LINFT' ? (
          <label className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold uppercase text-[var(--color-bv-muted)]">
              Full roll length
            </span>
            <input
              className={numCls}
              type="number"
              min={0}
              step="any"
              value={state.fullLengthFt}
              aria-label="Full roll length in feet"
              onChange={(e) => onChange({ ...state, fullLengthFt: e.target.value })}
            />
            <span className="text-[10px] font-bold uppercase text-[var(--color-bv-muted)]">ft</span>
          </label>
        ) : null}
      </div>
      <div className="mt-1.5 text-[11px] leading-snug">
        {result.ok ? (
          <span className="text-[var(--color-bv-muted)]">
            {state.mode === 'QTY' ? `${state.value || 0} × full unit` : result.detail}
            {' · '}
            <span className="font-bold text-[var(--color-bv-text)]">
              cost {formatMoney(result.costCents)}
            </span>
            {sellCents != null ? (
              <>
                {' · '}
                <span className="font-bold text-[var(--color-bv-accent)]">
                  sells for {formatMoney(sellCents)}
                </span>
              </>
            ) : null}
          </span>
        ) : (
          <span className="text-amber-700">{result.error}</span>
        )}
        {state.sizeLabel && (state.mode === 'SQFT' || state.mode === 'LINFT') ? (
          <span className="text-[var(--color-bv-muted)]"> · detected size: {state.sizeLabel}</span>
        ) : null}
      </div>
    </div>
  );
}
