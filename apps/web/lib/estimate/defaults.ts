import { EstimateLineKind } from '@bvisible/db';

// Default unit cost (in cents) when the estimator inserts a new line
// of each kind. These match docs/ai-context/ESTIMATE_ENGINE.md so the
// editor doesn't make the user retype the standard rates every time.
//
// MACHINE deliberately defaults to 0 — the user picks a Machine row
// (via machineId) and the editor copies that machine's cents/hour
// into unitCostCents. Without a pick, leave it blank rather than
// silently default to one of the four machines.

const MACHINE_DEFAULT_CENTS = 0;
const SHOP_LABOR_CENTS_PER_HOUR = 5000; // $50/hr
const INSTALL_CENTS_PER_HOUR = 15000; // $150/hr/installer (qty = installer-hours)
const DESIGN_CENTS = 15000; // $150 design line (the per-estimate flat fee is separate)
const MATERIAL_DEFAULT_CENTS = 0;
const MISC_DEFAULT_CENTS = 0;

export function defaultUnitCostCents(kind: EstimateLineKind): number {
  switch (kind) {
    case EstimateLineKind.MACHINE:
      return MACHINE_DEFAULT_CENTS;
    case EstimateLineKind.LABOR:
      return SHOP_LABOR_CENTS_PER_HOUR;
    case EstimateLineKind.INSTALL:
      return INSTALL_CENTS_PER_HOUR;
    case EstimateLineKind.DESIGN:
      return DESIGN_CENTS;
    case EstimateLineKind.MATERIAL:
      return MATERIAL_DEFAULT_CENTS;
    case EstimateLineKind.MISC:
      return MISC_DEFAULT_CENTS;
  }
}

export function defaultDescription(kind: EstimateLineKind): string {
  switch (kind) {
    case EstimateLineKind.MATERIAL:
      return '';
    case EstimateLineKind.MACHINE:
      return '';
    case EstimateLineKind.LABOR:
      return 'Shop labor';
    case EstimateLineKind.INSTALL:
      return 'Install';
    case EstimateLineKind.DESIGN:
      return 'Design';
    case EstimateLineKind.MISC:
      return '';
  }
}
