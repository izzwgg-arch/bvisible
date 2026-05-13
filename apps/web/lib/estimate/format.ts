// UI-facing formatters / parsers for money + qty cells. The actual
// implementation lives in @bvisible/pricing — re-exported here so the
// editor only has to import from one place and we can later swap the
// presentation rules without touching dozens of files.
//
// Display also lives here for kind-specific formatting (e.g. machine
// rate per hour, install hours).

export {
  formatMoney,
  parseMoney,
  formatQty,
  parseQty,
} from '@bvisible/pricing';

import { EstimateLineKind } from '@bvisible/db';

export function kindLabel(kind: EstimateLineKind): string {
  switch (kind) {
    case EstimateLineKind.MATERIAL:
      return 'Material';
    case EstimateLineKind.MACHINE:
      return 'Machine';
    case EstimateLineKind.LABOR:
      return 'Labor';
    case EstimateLineKind.DESIGN:
      return 'Design';
    case EstimateLineKind.INSTALL:
      return 'Install';
    case EstimateLineKind.MISC:
      return 'Misc';
  }
}

// Hint text for the qty column header — depends on which kinds are in
// the grid. For mixed grids we just say "Qty / hrs" so the header is
// still meaningful for a 30-line job that has materials + labor + install.
export function qtyHint(kind: EstimateLineKind): string {
  switch (kind) {
    case EstimateLineKind.MATERIAL:
    case EstimateLineKind.MISC:
      return 'qty';
    case EstimateLineKind.MACHINE:
    case EstimateLineKind.LABOR:
      return 'hours';
    case EstimateLineKind.INSTALL:
      return 'installer-hours';
    case EstimateLineKind.DESIGN:
      return 'flat';
  }
}
