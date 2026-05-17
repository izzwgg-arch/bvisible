import type { ShopCatalogUnit } from '@bvisible/db';

/** Parsed vendor unit token from OCR / price rows (not ShopCatalogUnit). */
export type ParsedVendorUnit =
  | 'EACH'
  | 'SHEET'
  | 'SQ_FT'
  | 'LINEAR_FT'
  | 'ROLL'
  | 'PAIR'
  | 'SET'
  | 'CUSTOM'
  | 'UNKNOWN';

export type UnitConversionProposal = {
  fromUnit: ParsedVendorUnit;
  toUnit: ShopCatalogUnit;
  /** Unit price in fromUnit basis (cents). */
  priceCents: number;
  /** Converted cents per toUnit when certain; null when operator must act. */
  convertedPriceCents: number | null;
  /** Fixed scale ×1000 (e.g. 32000 = 32.000 sq ft per sheet). */
  factorMilli: number | null;
  certain: boolean;
  guidanceLabel: string;
  needsConfirmation: boolean;
};

const SHEET_4X8_SQFT_MILLI = 32 * 1000;

export function parseVendorUnitToken(raw: string | null | undefined): ParsedVendorUnit {
  if (!raw?.trim()) return 'UNKNOWN';
  const t = raw.replace(/\s+/g, ' ').trim().toUpperCase();
  if (/^(EA|EACH|PCS?|PC|UNIT|UOM)$/.test(t)) return 'EACH';
  if (/^SHEETS?$/.test(t)) return 'SHEET';
  if (/^(SQ\s*FT|SQFT|SF|SQUARE\s*FT)$/.test(t)) return 'SQ_FT';
  if (/^(LF|LINEAR\s*FT|LINEAR\s*FEET|LN\s*FT)$/.test(t)) return 'LINEAR_FT';
  if (/^ROLLS?$/.test(t)) return 'ROLL';
  if (/^PAIRS?$/.test(t)) return 'PAIR';
  if (/^SETS?$/.test(t)) return 'SET';
  return 'CUSTOM';
}

export function labelParsedVendorUnit(u: ParsedVendorUnit): string {
  switch (u) {
    case 'EACH':
      return 'Each';
    case 'SHEET':
      return 'Sheet';
    case 'SQ_FT':
      return 'Sq ft';
    case 'LINEAR_FT':
      return 'Linear ft';
    case 'ROLL':
      return 'Roll';
    case 'PAIR':
      return 'Pair';
    case 'SET':
      return 'Set';
    case 'CUSTOM':
      return 'Custom unit';
    default:
      return 'Unknown unit';
  }
}

function shopUnitToParsed(u: ShopCatalogUnit): ParsedVendorUnit {
  switch (u) {
    case 'EACH':
      return 'EACH';
    case 'SHEET':
      return 'SHEET';
    case 'SQ_FT':
      return 'SQ_FT';
    case 'LINEAR_FT':
      return 'LINEAR_FT';
    case 'ROLL':
      return 'ROLL';
    case 'HOUR':
    case 'CUSTOM':
      return 'CUSTOM';
    default:
      return 'UNKNOWN';
  }
}

/**
 * Propose a deterministic unit conversion for estimator guidance.
 * Never returns certain=true unless the rule is explicit in code.
 */
export function proposeUnitConversion(args: {
  vendorUnit: ParsedVendorUnit;
  estimateCatalogUnit: ShopCatalogUnit;
  priceCents: number;
  /** Normalized material label — used only for whitelisted sheet rules (e.g. 4X8). */
  materialLabelNormalized?: string;
}): UnitConversionProposal | null {
  const from = args.vendorUnit;
  const toParsed = shopUnitToParsed(args.estimateCatalogUnit);
  if (from === 'UNKNOWN' || toParsed === 'UNKNOWN') return null;
  if (from === toParsed) {
    return {
      fromUnit: from,
      toUnit: args.estimateCatalogUnit,
      priceCents: args.priceCents,
      convertedPriceCents: args.priceCents,
      factorMilli: 1000,
      certain: true,
      guidanceLabel: `Quoted by ${labelParsedVendorUnit(from)} (same as estimate unit)`,
      needsConfirmation: false,
    };
  }

  if (from === 'SHEET' && toParsed === 'SQ_FT') {
    const label = args.materialLabelNormalized ?? '';
    const is48 = /\b4X8\b/.test(label) || /\b48X96\b/.test(label);
    if (!is48) {
      return {
        fromUnit: from,
        toUnit: args.estimateCatalogUnit,
        priceCents: args.priceCents,
        convertedPriceCents: null,
        factorMilli: null,
        certain: false,
        guidanceLabel: 'Quoted by sheet — sheet→sq ft conversion needs a known sheet size (e.g. 4×8)',
        needsConfirmation: true,
      };
    }
    const perSqFt = Math.round((args.priceCents * 1000) / SHEET_4X8_SQFT_MILLI);
    return {
      fromUnit: from,
      toUnit: args.estimateCatalogUnit,
      priceCents: args.priceCents,
      convertedPriceCents: perSqFt,
      factorMilli: SHEET_4X8_SQFT_MILLI,
      certain: true,
      guidanceLabel: 'Quoted by sheet — converted using 4×8 = 32 sq ft rule',
      needsConfirmation: true,
    };
  }

  if (from === 'SQ_FT' && toParsed === 'SHEET') {
    const label = args.materialLabelNormalized ?? '';
    const is48 = /\b4X8\b/.test(label) || /\b48X96\b/.test(label);
    if (!is48) {
      return {
        fromUnit: from,
        toUnit: args.estimateCatalogUnit,
        priceCents: args.priceCents,
        convertedPriceCents: null,
        factorMilli: null,
        certain: false,
        guidanceLabel: 'Quoted by sq ft — sheet conversion needs a known sheet size',
        needsConfirmation: true,
      };
    }
    const perSheet = Math.round((args.priceCents * SHEET_4X8_SQFT_MILLI) / 1000);
    return {
      fromUnit: from,
      toUnit: args.estimateCatalogUnit,
      priceCents: args.priceCents,
      convertedPriceCents: perSheet,
      factorMilli: SHEET_4X8_SQFT_MILLI,
      certain: true,
      guidanceLabel: 'Quoted by sq ft — converted to per-sheet using 4×8 = 32 sq ft rule',
      needsConfirmation: true,
    };
  }

  if (from === 'ROLL' && toParsed === 'LINEAR_FT') {
    return {
      fromUnit: from,
      toUnit: args.estimateCatalogUnit,
      priceCents: args.priceCents,
      convertedPriceCents: null,
      factorMilli: null,
      certain: false,
      guidanceLabel: 'Quoted by roll — roll length is not known; convert manually',
      needsConfirmation: true,
    };
  }

  return {
    fromUnit: from,
    toUnit: args.estimateCatalogUnit,
    priceCents: args.priceCents,
    convertedPriceCents: null,
    factorMilli: null,
    certain: false,
    guidanceLabel: `Quoted by ${labelParsedVendorUnit(from)} — estimate uses ${labelParsedVendorUnit(toParsed)}; convert manually`,
    needsConfirmation: true,
  };
}
