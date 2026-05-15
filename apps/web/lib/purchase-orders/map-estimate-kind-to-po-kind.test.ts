import { describe, expect, it } from 'vitest';
import { EstimateLineKind, POLineKind } from '@bvisible/db';

import { mapEstimateKindToPoKind } from '@/lib/purchase-orders/map-estimate-kind-to-po-kind';

describe('mapEstimateKindToPoKind', () => {
  const pairs: Array<[EstimateLineKind, POLineKind]> = [
    [EstimateLineKind.MATERIAL, POLineKind.MATERIAL],
    [EstimateLineKind.MACHINE, POLineKind.MACHINE],
    [EstimateLineKind.LABOR, POLineKind.LABOR],
    [EstimateLineKind.DESIGN, POLineKind.DESIGN],
    [EstimateLineKind.INSTALL, POLineKind.INSTALL],
    [EstimateLineKind.MISC, POLineKind.MISC],
  ];

  it.each(pairs)('%s → %s', (ek, pk) => {
    expect(mapEstimateKindToPoKind(ek)).toBe(pk);
  });
});
