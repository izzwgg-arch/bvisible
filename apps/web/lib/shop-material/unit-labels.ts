import type { ShopCatalogUnit } from '@bvisible/db';

export function labelShopCatalogUnit(unit: ShopCatalogUnit): string {
  switch (unit) {
    case 'EACH':
      return 'Each';
    case 'SHEET':
      return 'Sheet';
    case 'SQ_FT':
      return 'Sq ft';
    case 'HOUR':
      return 'Hour';
    case 'LINEAR_FT':
      return 'Linear ft';
    case 'ROLL':
      return 'Roll';
    case 'CUSTOM':
      return 'Custom';
    default:
      return unit;
  }
}
