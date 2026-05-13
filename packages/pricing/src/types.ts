// Pure TypeScript types for the pricing engine. No Prisma, no React,
// no I/O. The engine consumes these shapes and returns deterministic
// integer-only output.
//
// Money is integer cents. Quantities are integer "milli-units" (qty *
// 1000). Multipliers are integer "milli-multipliers" (multiplier *
// 1000). All math stays integer until the UI formats for display, so
// repeated recalculation never drifts from floating-point error.

export const LINE_KINDS = [
  'MATERIAL',
  'MACHINE',
  'LABOR',
  'DESIGN',
  'INSTALL',
  'MISC',
] as const;

export type LineKind = (typeof LINE_KINDS)[number];

export interface LineInput {
  // Caller-supplied stable id. The engine echoes it back in `lineCosts`
  // so React can render computed totals next to the right row without
  // owning array indices.
  id: string;
  kind: LineKind;
  qtyMilli: number;
  unitCostCents: number;
}

export interface EstimateInput {
  multiplierMilli: number;
  designFlatCents: number;
  lines: ReadonlyArray<LineInput>;
}

export interface BreakdownByKind {
  materialsCents: number;
  machinesCents: number;
  laborCents: number;
  designCents: number;
  installCents: number;
  miscCents: number;
}

export interface EstimateOutput {
  // Map of LineInput.id → computed line cost in cents. Stable, so the
  // editor can read it by id without depending on array order.
  lineCosts: Record<string, number>;
  breakdown: BreakdownByKind;
  subtotalCostCents: number;
  finalPriceCents: number;
}
