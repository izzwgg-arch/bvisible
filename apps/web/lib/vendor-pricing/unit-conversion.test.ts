import { describe, expect, it } from 'vitest';
import { parseVendorUnitToken, proposeUnitConversion } from './unit-conversion';

describe('parseVendorUnitToken', () => {
  it('parses common vendor unit strings', () => {
    expect(parseVendorUnitToken('sq ft')).toBe('SQ_FT');
    expect(parseVendorUnitToken('SHEET')).toBe('SHEET');
    expect(parseVendorUnitToken('linear ft')).toBe('LINEAR_FT');
    expect(parseVendorUnitToken('roll')).toBe('ROLL');
  });
});

describe('proposeUnitConversion', () => {
  it('converts 4x8 sheet to sq ft with confirmation', () => {
    const p = proposeUnitConversion({
      vendorUnit: 'SHEET',
      estimateCatalogUnit: 'SQ_FT',
      priceCents: 3200,
      materialLabelNormalized: 'COROPLAST 4X8 WHITE',
    });
    expect(p).not.toBeNull();
    expect(p!.convertedPriceCents).toBe(100);
    expect(p!.needsConfirmation).toBe(true);
    expect(p!.guidanceLabel).toMatch(/sheet/i);
  });

  it('does not convert sheet to sq ft without known sheet size', () => {
    const p = proposeUnitConversion({
      vendorUnit: 'SHEET',
      estimateCatalogUnit: 'SQ_FT',
      priceCents: 3200,
      materialLabelNormalized: 'ACM WHITE',
    });
    expect(p!.convertedPriceCents).toBeNull();
    expect(p!.needsConfirmation).toBe(true);
  });

  it('never auto-converts roll to linear ft', () => {
    const p = proposeUnitConversion({
      vendorUnit: 'ROLL',
      estimateCatalogUnit: 'LINEAR_FT',
      priceCents: 5000,
    });
    expect(p!.convertedPriceCents).toBeNull();
    expect(p!.certain).toBe(false);
    expect(p!.guidanceLabel).toMatch(/roll/i);
  });

  it('returns same price when units match', () => {
    const p = proposeUnitConversion({
      vendorUnit: 'EACH',
      estimateCatalogUnit: 'EACH',
      priceCents: 999,
    });
    expect(p!.convertedPriceCents).toBe(999);
    expect(p!.needsConfirmation).toBe(false);
  });
});
