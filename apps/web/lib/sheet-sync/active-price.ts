// Active price resolution: app override ?? live Sheet price.
// Overrides are keyed by the normalized sheet item key and stay active
// until the operator resets the item to follow the Sheet again.

import { prisma, SheetOverrideItemType } from '@bvisible/db';

export interface OverrideMap {
  materials: Map<string, number>;
  machines: Map<string, number>;
}

export async function loadOverrides(tenantId: string): Promise<OverrideMap> {
  const rows = await prisma.sheetPriceOverride.findMany({
    where: { tenantId },
    select: { itemType: true, itemKey: true, priceCents: true },
  });
  const materials = new Map<string, number>();
  const machines = new Map<string, number>();
  for (const row of rows) {
    if (row.itemType === SheetOverrideItemType.MATERIAL) {
      materials.set(row.itemKey, row.priceCents);
    } else {
      machines.set(row.itemKey, row.priceCents);
    }
  }
  return { materials, machines };
}

export function activeMaterialPrice(
  overrides: OverrideMap,
  key: string,
  sheetPriceCents: number
): { priceCents: number; source: 'SHEET' | 'OVERRIDE' } {
  const override = overrides.materials.get(key);
  return override != null
    ? { priceCents: override, source: 'OVERRIDE' }
    : { priceCents: sheetPriceCents, source: 'SHEET' };
}

export function activeMachineRate(
  overrides: OverrideMap,
  key: string,
  sheetRateCents: number
): { priceCents: number; source: 'SHEET' | 'OVERRIDE' } {
  const override = overrides.machines.get(key);
  return override != null
    ? { priceCents: override, source: 'OVERRIDE' }
    : { priceCents: sheetRateCents, source: 'SHEET' };
}
