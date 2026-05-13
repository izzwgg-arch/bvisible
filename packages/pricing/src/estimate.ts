// Centralized estimate calculation. This is the single source of truth
// for how subtotals + final sell price are computed (R-EST-01). The
// editor calls this on every keystroke; the server calls it once
// inside the save transaction so cached totals match what the user saw
// on screen.
//
// Inputs / outputs are integer-only. Every formula is documented in
// docs/ai-context/ESTIMATE_ENGINE.md.

import { computeLineCostCents } from './line';
import { roundCents } from './money';
import type {
  BreakdownByKind,
  EstimateInput,
  EstimateOutput,
  LineKind,
} from './types';

const EMPTY_BREAKDOWN: BreakdownByKind = {
  materialsCents: 0,
  machinesCents: 0,
  laborCents: 0,
  designCents: 0,
  installCents: 0,
  miscCents: 0,
};

function bucketKey(kind: LineKind): keyof BreakdownByKind {
  switch (kind) {
    case 'MATERIAL':
      return 'materialsCents';
    case 'MACHINE':
      return 'machinesCents';
    case 'LABOR':
      return 'laborCents';
    case 'DESIGN':
      return 'designCents';
    case 'INSTALL':
      return 'installCents';
    case 'MISC':
      return 'miscCents';
  }
}

export function computeEstimate(input: EstimateInput): EstimateOutput {
  const breakdown: BreakdownByKind = { ...EMPTY_BREAKDOWN };
  const lineCosts: Record<string, number> = {};

  for (const line of input.lines) {
    const cost = computeLineCostCents({
      qtyMilli: line.qtyMilli,
      unitCostCents: line.unitCostCents,
    });
    lineCosts[line.id] = cost;
    const key = bucketKey(line.kind);
    breakdown[key] = breakdown[key] + cost;
  }

  // The flat design fee is added on top of any DESIGN-kind line
  // items, not in lieu of them. This lets estimators add itemized
  // design rows for big jobs while keeping the standard $150 minimum
  // baked in. Set designFlatCents to 0 to waive.
  const designFlat = Math.max(0, Math.trunc(input.designFlatCents));
  breakdown.designCents = breakdown.designCents + designFlat;

  const subtotalCostCents =
    breakdown.materialsCents +
    breakdown.machinesCents +
    breakdown.laborCents +
    breakdown.designCents +
    breakdown.installCents +
    breakdown.miscCents;

  // multiplier_milli / 1000 is the actual sell multiplier
  // (default 3000 → 3.000×). Rounded to the nearest cent.
  const multiplierMilli = Math.max(0, Math.trunc(input.multiplierMilli));
  const finalPriceCents = roundCents((subtotalCostCents * multiplierMilli) / 1000);

  return { lineCosts, breakdown, subtotalCostCents, finalPriceCents };
}
