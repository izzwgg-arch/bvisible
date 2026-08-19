import type { ShopCatalogUnit } from '@bvisible/db';

export const PRICING_FORMULA_VERSION = 'catalog-pricing-v1';

export const PRICING_ENGINES = [
  'MANUAL',
  'SQ_FT',
  'SHEET_GOODS',
  'ROLL_MATERIAL',
  'BANNER',
  'LABOR',
  'INSTALL',
  'MACHINE',
  'COST_PLUS',
  'CHANNEL_LETTERS',
  'BUNDLE',
  'STANDARD_SIGN',
  'BID_RATE',
] as const;

export type PricingEngine = (typeof PRICING_ENGINES)[number];

export const VENDOR_COST_SOURCE_MODES = ['CHEAPEST', 'PREFERRED', 'MANUAL', 'INTERNAL'] as const;

export type VendorCostSourceMode = (typeof VENDOR_COST_SOURCE_MODES)[number];

export type CatalogPricingOutputSnapshot = {
  pricingMethod: string | null;
  pricingEngine: PricingEngine;
  formulaVersion: string;
  internalUnitCostCents: number;
  sellHintCents: number;
  defaultQuantity: number;
  unit: ShopCatalogUnit | string;
  markupPercent: number;
  selectedVendorId?: string | null;
  selectedVendorMode: VendorCostSourceMode;
  vendorPricingSource?: {
    selectedVendorCostCents?: number | null;
    cheapestVendorCostCents?: number | null;
    preferredVendorCostCents?: number | null;
  };
  calculatedAt: string;
  calculatedBy?: string | null;
  details?: Record<string, unknown>;
};

const LEGACY_METHOD_TO_ENGINE: Record<string, PricingEngine> = {
  SQUARE_FOOTAGE: 'SQ_FT',
  SQ_FT: 'SQ_FT',
  SHEET_GOODS: 'SHEET_GOODS',
  ROLL_MATERIAL: 'ROLL_MATERIAL',
  BANNER: 'BANNER',
  LABOR: 'LABOR',
  INSTALL: 'INSTALL',
  MACHINE: 'MACHINE',
  COST_PLUS: 'COST_PLUS',
  CHANNEL_LETTERS: 'CHANNEL_LETTERS',
  BUNDLE: 'BUNDLE',
  STANDARD_SIGN: 'STANDARD_SIGN',
  BID_RATE: 'BID_RATE',
  MANUAL: 'MANUAL',
};

export function normalizePricingEngine(raw: string | null | undefined): PricingEngine {
  const value = String(raw ?? '').trim().toUpperCase();
  return LEGACY_METHOD_TO_ENGINE[value] ?? 'MANUAL';
}

export function normalizeVendorCostSourceMode(raw: string | null | undefined): VendorCostSourceMode {
  const value = String(raw ?? '').trim().toUpperCase();
  return VENDOR_COST_SOURCE_MODES.includes(value as VendorCostSourceMode)
    ? (value as VendorCostSourceMode)
    : 'INTERNAL';
}

export function pricingEngineLabel(engine: string | null | undefined): string {
  switch (normalizePricingEngine(engine)) {
    case 'SQ_FT':
      return 'Square Footage';
    case 'SHEET_GOODS':
      return 'Sheet Goods';
    case 'ROLL_MATERIAL':
      return 'Roll Material';
    case 'BANNER':
      return 'Banner';
    case 'LABOR':
      return 'Labor';
    case 'INSTALL':
      return 'Install';
    case 'MACHINE':
      return 'Machine';
    case 'COST_PLUS':
      return 'Cost Plus';
    case 'CHANNEL_LETTERS':
      return 'Channel Letters';
    case 'BUNDLE':
      return 'Bundle';
    case 'STANDARD_SIGN':
      return 'Standard sign';
    case 'BID_RATE':
      return 'Bid rate';
    case 'MANUAL':
      return 'Manual';
  }
}

export function pricingMethodForEngine(engine: PricingEngine): string | null {
  switch (engine) {
    case 'SQ_FT':
      return 'SQUARE_FOOTAGE';
    case 'MANUAL':
      return null;
    default:
      return engine;
  }
}

export function buildCatalogPricingOutputSnapshot(args: {
  pricingMethod: string | null;
  pricingEngine: PricingEngine;
  internalUnitCostCents: number;
  sellHintCents: number;
  defaultQuantity: number;
  unit: ShopCatalogUnit | string;
  markupPercent: number;
  selectedVendorId?: string | null;
  selectedVendorMode: VendorCostSourceMode;
  vendorPricingSource?: CatalogPricingOutputSnapshot['vendorPricingSource'];
  calculatedAt?: string;
  calculatedBy?: string | null;
  details?: Record<string, unknown>;
}): CatalogPricingOutputSnapshot {
  return {
    pricingMethod: args.pricingMethod,
    pricingEngine: args.pricingEngine,
    formulaVersion: PRICING_FORMULA_VERSION,
    internalUnitCostCents: Math.max(0, Math.trunc(args.internalUnitCostCents)),
    sellHintCents: Math.max(0, Math.trunc(args.sellHintCents)),
    defaultQuantity: Math.max(0, args.defaultQuantity),
    unit: args.unit,
    markupPercent: Math.max(0, args.markupPercent),
    selectedVendorId: args.selectedVendorId ?? null,
    selectedVendorMode: args.selectedVendorMode,
    vendorPricingSource: args.vendorPricingSource,
    calculatedAt: args.calculatedAt ?? new Date().toISOString(),
    calculatedBy: args.calculatedBy ?? null,
    details: args.details,
  };
}
