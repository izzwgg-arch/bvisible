import type { CatalogLookupMatchKind } from './catalog-intel-types';

export type MaterialResolutionPath =
  | 'unresolved'
  | 'managed_item'
  | 'managed_item_alias'
  | 'vendor_alias'
  | 'vendor_catalog_exact'
  | 'vendor_sku'
  | 'prefix_alias'
  | 'prefix_name';

export type MaterialMatchIntel = {
  path: MaterialResolutionPath;
  /** Product-facing confidence (not a score). */
  confidenceLabel: 'High' | 'Medium' | 'Needs review';
  matchReason: string;
  needsConfirmation: boolean;
  normalizedLabel: string;
  canonicalKey: string;
};

export function catalogMatchKindToResolutionPath(
  kind: CatalogLookupMatchKind,
): MaterialResolutionPath {
  switch (kind) {
    case 'shop_item_name':
      return 'managed_item';
    case 'shop_item_alias':
      return 'managed_item_alias';
    case 'exact_alias':
      return 'vendor_alias';
    case 'exact_name':
      return 'vendor_catalog_exact';
    case 'vendor_sku':
      return 'vendor_sku';
    case 'prefix_alias':
      return 'prefix_alias';
    default:
      return 'unresolved';
  }
}

export function buildMaterialMatchIntel(args: {
  matchKind: CatalogLookupMatchKind;
  normalizedLabel: string;
  canonicalKey: string;
}): MaterialMatchIntel {
  const path = catalogMatchKindToResolutionPath(args.matchKind);
  switch (path) {
    case 'managed_item':
      return {
        path,
        confidenceLabel: 'High',
        matchReason: 'Exact managed catalog item name',
        needsConfirmation: false,
        normalizedLabel: args.normalizedLabel,
        canonicalKey: args.canonicalKey,
      };
    case 'managed_item_alias':
      return {
        path,
        confidenceLabel: 'High',
        matchReason: 'Managed item alias (normalized exact)',
        needsConfirmation: false,
        normalizedLabel: args.normalizedLabel,
        canonicalKey: args.canonicalKey,
      };
    case 'vendor_alias':
      return {
        path,
        confidenceLabel: 'High',
        matchReason: 'Vendor catalog alias (normalized exact)',
        needsConfirmation: false,
        normalizedLabel: args.normalizedLabel,
        canonicalKey: args.canonicalKey,
      };
    case 'vendor_catalog_exact':
      return {
        path,
        confidenceLabel: 'High',
        matchReason: 'Vendor catalog item (normalized exact name)',
        needsConfirmation: false,
        normalizedLabel: args.normalizedLabel,
        canonicalKey: args.canonicalKey,
      };
    case 'vendor_sku':
      return {
        path,
        confidenceLabel: 'High',
        matchReason: 'Vendor SKU exact match',
        needsConfirmation: false,
        normalizedLabel: args.normalizedLabel,
        canonicalKey: args.canonicalKey,
      };
    case 'prefix_alias':
      return {
        path,
        confidenceLabel: 'Medium',
        matchReason: 'Prefix alias candidate — confirm before trusting price',
        needsConfirmation: true,
        normalizedLabel: args.normalizedLabel,
        canonicalKey: args.canonicalKey,
      };
    case 'prefix_name':
      return {
        path,
        confidenceLabel: 'Medium',
        matchReason: 'Prefix catalog name — confirm material match',
        needsConfirmation: true,
        normalizedLabel: args.normalizedLabel,
        canonicalKey: args.canonicalKey,
      };
    default:
      return {
        path: 'unresolved',
        confidenceLabel: 'Needs review',
        matchReason: 'No deterministic catalog match — add alias or pick from Items',
        needsConfirmation: true,
        normalizedLabel: args.normalizedLabel,
        canonicalKey: args.canonicalKey,
      };
  }
}
