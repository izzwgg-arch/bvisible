import type { EstimateLineKind } from '@bvisible/db';
import { POLineKind } from '@bvisible/db';

/** EstimateLineKind and POLineKind stay aligned 1:1; tests lock this mapping. */
export function mapEstimateKindToPoKind(kind: EstimateLineKind): POLineKind {
  switch (kind) {
    case 'MATERIAL':
      return POLineKind.MATERIAL;
    case 'MACHINE':
      return POLineKind.MACHINE;
    case 'LABOR':
      return POLineKind.LABOR;
    case 'DESIGN':
      return POLineKind.DESIGN;
    case 'INSTALL':
      return POLineKind.INSTALL;
    case 'MISC':
      return POLineKind.MISC;
    default:
      return POLineKind.MISC;
  }
}
