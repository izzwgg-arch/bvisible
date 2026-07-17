// Material measurement entry — lets an estimator type what they actually
// use (a quantity, a percentage of a full sheet/roll, square feet, or
// linear feet) and converts it into an estimate line automatically.
// The user never computes the portion of the full material by hand.
//
// Full sheet/roll dimensions are guessed from the material name when
// possible ("4x8", `54" x 150'`, "48in x 96in", …) and are always
// user-overridable in the UI.

export type MeasurementMode = 'QTY' | 'PERCENT' | 'SQFT' | 'LINFT';

export const MEASUREMENT_MODE_LABELS: Record<MeasurementMode, string> = {
  QTY: 'Quantity',
  PERCENT: '% of sheet/roll',
  SQFT: 'Square feet',
  LINFT: 'Linear feet',
};

export interface MaterialSizeGuess {
  /// Area of ONE full sheet/roll in sq ft (null when unknown).
  fullSqft: number | null;
  /// Roll length in feet (null for sheets / unknown) — enables linear ft.
  fullLengthFt: number | null;
  /// Human label, e.g. "4′ × 8′ sheet (32 sq ft)".
  sizeLabel: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/// Best-effort parse of full sheet/roll dimensions out of a catalog name.
/// Conservative: only explicit unit markers or classic bare sheet sizes
/// (both numbers ≤ 12 → feet, e.g. "4x8", "5x10") are trusted. A width
/// in inches with a length in feet/yards is treated as a roll.
export function guessMaterialSize(name: string): MaterialSizeGuess {
  const none: MaterialSizeGuess = { fullSqft: null, fullLengthFt: null, sizeLabel: null };
  const text = name.toLowerCase();

  const dim = /(\d+(?:\.\d+)?)\s*("|″|in\b|inch(?:es)?\b|'|′|ft\b|foot\b|feet\b|yd\b|yard(?:s)?\b)?\s*[x×]\s*(\d+(?:\.\d+)?)\s*("|″|in\b|inch(?:es)?\b|'|′|ft\b|foot\b|feet\b|yd\b|yard(?:s)?\b)?/i.exec(
    text
  );
  if (!dim) return none;

  const a = Number(dim[1]);
  const b = Number(dim[3]);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return none;

  const unitOf = (raw: string | undefined): 'in' | 'ft' | 'yd' | null => {
    if (!raw) return null;
    if (/^("|″|in|inch|inches)/.test(raw)) return 'in';
    if (/^('|′|ft|foot|feet)/.test(raw)) return 'ft';
    if (/^(yd|yard|yards)/.test(raw)) return 'yd';
    return null;
  };
  const ua = unitOf(dim[2]);
  const ub = unitOf(dim[4]);

  const toFt = (v: number, u: 'in' | 'ft' | 'yd') => (u === 'in' ? v / 12 : u === 'yd' ? v * 3 : v);

  // Both units explicit → trust them.
  if (ua && ub) {
    const wFt = toFt(a, ua);
    const lFt = toFt(b, ub);
    const isRoll = ua === 'in' && (ub === 'ft' || ub === 'yd');
    return {
      fullSqft: round2(wFt * lFt),
      fullLengthFt: isRoll ? round2(lFt) : null,
      sizeLabel: isRoll
        ? `${a}″ × ${round2(lFt)}′ roll (${round2(wFt * lFt)} sq ft)`
        : `${round2(wFt)}′ × ${round2(lFt)}′ (${round2(wFt * lFt)} sq ft)`,
    };
  }

  // One unit explicit → assume the other matches it.
  if (ua || ub) {
    const u = (ua ?? ub) as 'in' | 'ft' | 'yd';
    const wFt = toFt(a, ua ?? u);
    const lFt = toFt(b, ub ?? u);
    return {
      fullSqft: round2(wFt * lFt),
      fullLengthFt: null,
      sizeLabel: `${round2(wFt)}′ × ${round2(lFt)}′ (${round2(wFt * lFt)} sq ft)`,
    };
  }

  // Bare "4x8" / "5x10" style: classic sheet sizes in feet.
  if (a <= 12 && b <= 12) {
    return {
      fullSqft: round2(a * b),
      fullLengthFt: null,
      sizeLabel: `${a}′ × ${b}′ sheet (${round2(a * b)} sq ft)`,
    };
  }

  // Bare "54x150" style: plausible roll = width in inches × length in feet.
  if (a > 12 && a <= 120 && b >= 25) {
    const wFt = a / 12;
    return {
      fullSqft: round2(wFt * b),
      fullLengthFt: b,
      sizeLabel: `${a}″ × ${b}′ roll (${round2(wFt * b)} sq ft)`,
    };
  }

  return none;
}

export interface MeasurementInput {
  mode: MeasurementMode;
  /// Entered measurement: a count, a percent (0–100+), sq ft, or lin ft.
  value: number;
  /// Cost of ONE full sheet/roll in cents.
  fullUnitPriceCents: number;
  /// Area of one full sheet/roll (required for SQFT mode).
  fullSqft?: number | null;
  /// Roll length in feet (required for LINFT mode).
  fullLengthFt?: number | null;
}

export interface MeasurementResult {
  ok: boolean;
  error: string | null;
  /// Line quantity (interpretation depends on unitLabel).
  qty: number;
  qtyMilli: number;
  /// Per-`unitLabel` cost in cents for the line.
  unitCostCents: number;
  unitLabel: 'unit' | 'sq ft' | 'lin ft';
  /// Portion of ONE full sheet/roll consumed (1 = a whole one). Null when
  /// it can't be derived (plain quantity of unknown-size material is 1:1).
  usedFraction: number | null;
  /// Material cost for the line, computed exactly like the pricing engine
  /// will (qtyMilli × unitCostCents / 1000).
  costCents: number;
  /// Human description of the calculation, for line descriptions/labels.
  detail: string;
}

const fail = (error: string): MeasurementResult => ({
  ok: false,
  error,
  qty: 0,
  qtyMilli: 0,
  unitCostCents: 0,
  unitLabel: 'unit',
  usedFraction: null,
  costCents: 0,
  detail: '',
});

function engineCost(qtyMilli: number, unitCostCents: number): number {
  return Math.round((qtyMilli * unitCostCents) / 1000);
}

const pct = (fraction: number) => {
  const p = fraction * 100;
  return p >= 10 ? p.toFixed(0) : p >= 1 ? p.toFixed(1) : p.toFixed(2);
};

/// Convert an entered measurement into line qty / unit cost, calculating
/// the portion of the full material automatically.
export function computeMeasurement(input: MeasurementInput): MeasurementResult {
  const price = Math.max(0, Math.round(input.fullUnitPriceCents));
  const value = Number.isFinite(input.value) ? input.value : 0;
  if (value <= 0) return fail('Enter a measurement greater than zero.');

  if (input.mode === 'QTY') {
    const qtyMilli = Math.max(1, Math.round(value * 1000));
    return {
      ok: true,
      error: null,
      qty: value,
      qtyMilli,
      unitCostCents: price,
      unitLabel: 'unit',
      usedFraction: value,
      costCents: engineCost(qtyMilli, price),
      detail: `${value} × full unit`,
    };
  }

  if (input.mode === 'PERCENT') {
    const fraction = value / 100;
    const qtyMilli = Math.max(1, Math.round(fraction * 1000));
    return {
      ok: true,
      error: null,
      qty: fraction,
      qtyMilli,
      unitCostCents: price,
      unitLabel: 'unit',
      usedFraction: fraction,
      costCents: engineCost(qtyMilli, price),
      detail: `${value}% of one full sheet/roll`,
    };
  }

  // SQFT / LINFT need the size of one full sheet/roll.
  const denominator =
    input.mode === 'SQFT'
      ? (input.fullSqft ?? 0)
      : (input.fullLengthFt ?? 0);
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return fail(
      input.mode === 'SQFT'
        ? 'Enter the full sheet/roll size in sq ft so the portion can be calculated.'
        : 'Enter the full roll length in feet so the portion can be calculated.'
    );
  }

  const fraction = value / denominator;
  const exactCostCents = fraction * price;
  const perUnitCents = Math.round(exactCostCents / value); // = price / denominator

  const unitLabel = input.mode === 'SQFT' ? 'sq ft' : 'lin ft';
  const unitWord = input.mode === 'SQFT' ? 'sq ft' : 'lin ft';
  const fullWord = input.mode === 'SQFT' ? `${denominator} sq ft` : `${denominator} lin ft`;

  if (perUnitCents >= 1) {
    // Preferred: qty = the measured amount, unit cost = per sq ft / lin ft.
    const qtyMilli = Math.max(1, Math.round(value * 1000));
    return {
      ok: true,
      error: null,
      qty: value,
      qtyMilli,
      unitCostCents: perUnitCents,
      unitLabel,
      usedFraction: fraction,
      costCents: engineCost(qtyMilli, perUnitCents),
      detail: `${value} ${unitWord} = ${pct(fraction)}% of one full sheet/roll (${fullWord})`,
    };
  }

  // Sub-cent per-unit cost — fall back to a fraction of the full unit so
  // the price doesn't collapse to $0.
  const qtyMilli = Math.max(1, Math.round(fraction * 1000));
  return {
    ok: true,
    error: null,
    qty: fraction,
    qtyMilli,
    unitCostCents: price,
    unitLabel: 'unit',
    usedFraction: fraction,
    costCents: engineCost(qtyMilli, price),
    detail: `${value} ${unitWord} = ${pct(fraction)}% of one full sheet/roll (${fullWord})`,
  };
}
