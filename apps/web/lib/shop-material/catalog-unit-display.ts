import type { ShopCatalogUnit } from '@bvisible/db';
import { labelShopCatalogUnit } from '@/lib/shop-material/unit-labels';

export function formatCatalogUnitDisplay(
  unit: ShopCatalogUnit,
  customLabel: string | null | undefined,
): string {
  if (unit === 'CUSTOM' && customLabel?.trim()) return customLabel.trim();
  return labelShopCatalogUnit(unit);
}
