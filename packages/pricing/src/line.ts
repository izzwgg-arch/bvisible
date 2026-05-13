// Per-line cost: qty (in milli-units) × unit cost (in cents) → cents.
// Division by 1000 is the only point where integer math meets a
// rational scale; the result is rounded to the nearest cent so two
// users typing the same numbers always see the same total.

import { roundCents } from './money';

export interface LineCostInput {
  qtyMilli: number;
  unitCostCents: number;
}

export function computeLineCostCents(input: LineCostInput): number {
  const q = Number.isFinite(input.qtyMilli) ? input.qtyMilli : 0;
  const u = Number.isFinite(input.unitCostCents) ? input.unitCostCents : 0;
  return roundCents((q * u) / 1000);
}
