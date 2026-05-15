/**
 * Customer-facing quote rows: proportional allocation of final sell price to
 * lines using cached line costs — costs are never exposed in the output shape.
 */

export interface LineCostRef {
  readonly id: string;
  readonly computedCostCents: number;
}

export interface CustomerQuoteLine {
  readonly id: string;
  readonly description: string;
  readonly qtyLabel: string;
  readonly kindLabel: string;
  readonly lineSellCents: number;
}

/** Allocate finalPriceCents across lines by computedCostCents / subtotal. */
export function allocateLineSellCents(
  lines: ReadonlyArray<LineCostRef>,
  subtotalCostCents: number,
  finalPriceCents: number
): Map<string, number> {
  const out = new Map<string, number>();
  const n = lines.length;
  if (n === 0) return out;

  const sub = Math.max(0, Math.trunc(subtotalCostCents));
  const finalTotal = Math.max(0, Math.trunc(finalPriceCents));

  if (sub <= 0) {
    const base = Math.floor(finalTotal / n);
    let remainder = finalTotal - base * n;
    for (let i = 0; i < n; i++) {
      const line = lines[i]!;
      let v = base;
      if (remainder > 0) {
        v += 1;
        remainder -= 1;
      }
      out.set(line.id, v);
    }
    return out;
  }

  const weights = lines.map((l) => Math.max(0, Math.trunc(l.computedCostCents)));
  const wSum = weights.reduce((a, b) => a + b, 0);
  if (wSum <= 0) {
    const base = Math.floor(finalTotal / n);
    let remainder = finalTotal - base * n;
    for (let i = 0; i < n; i++) {
      const line = lines[i]!;
      let v = base;
      if (remainder > 0) {
        v += 1;
        remainder -= 1;
      }
      out.set(line.id, v);
    }
    return out;
  }

  const raw = weights.map((w) => Math.round((finalTotal * w) / wSum));
  const drift = finalTotal - raw.reduce((a, b) => a + b, 0);
  const lastIdx = n - 1;
  raw[lastIdx] = (raw[lastIdx] ?? 0) + drift;
  for (let i = 0; i < n; i++) {
    const line = lines[i]!;
    out.set(line.id, raw[i] ?? 0);
  }
  return out;
}
