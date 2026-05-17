import { describe, expect, it } from 'vitest';
import {
  canonicalMaterialKey,
  normalizeVendorItemName,
  normalizeVendorSku,
  stripTrailingUnitSuffix,
} from './normalize';

describe('normalizeVendorItemName', () => {
  it('trims leading and trailing whitespace', () => {
    expect(normalizeVendorItemName('  acm white  ')).toBe('ACM WHITE');
  });

  it('uppercases', () => {
    expect(normalizeVendorItemName('pvc sheet')).toBe('PVC SHEET');
  });

  it('collapses internal spaces', () => {
    expect(normalizeVendorItemName('ACM    4x8    WHITE')).toBe('ACM 4X8 WHITE');
  });

  it('normalizes 4 x 8 / 4 X 8 / 4x8 to 4X8', () => {
    expect(normalizeVendorItemName('acm 4 x 8 white')).toBe('ACM 4X8 WHITE');
    expect(normalizeVendorItemName('acm 4 X 8 white')).toBe('ACM 4X8 WHITE');
    expect(normalizeVendorItemName('acm 4x8 white')).toBe('ACM 4X8 WHITE');
  });

  it('preserves meaningful material descriptions', () => {
    expect(normalizeVendorItemName('3M IJ180Cv3')).toBe('3M IJ180CV3');
    expect(normalizeVendorItemName('Aluminum Sheet 4x8 |')).toBe(
      'ALUMINUM SHEET 4X8'
    );
  });

  it('returns empty string for empty input', () => {
    expect(normalizeVendorItemName('')).toBe('');
    expect(normalizeVendorItemName('   \t\r\n  ')).toBe('');
  });

  it('normalizes coroplast vendor label variants', () => {
    expect(normalizeVendorItemName('COROPLAST 4MM WHITE')).toBe('COROPLAST 4MM WHITE');
    expect(normalizeVendorItemName('4MM WHITE CORO')).toBe('4MM WHITE COROPLAST');
    expect(normalizeVendorItemName('Coro-Plast White 4 mm')).toBe(
      'COROPLAST WHITE 4MM',
    );
  });

  it('strips trailing unit suffixes before keying', () => {
    expect(stripTrailingUnitSuffix('ACM WHITE SHEET')).toBe('ACM WHITE');
  });

  it('canonicalMaterialKey clusters token order', () => {
    const a = canonicalMaterialKey('WHITE 4MM COROPLAST');
    const b = canonicalMaterialKey('COROPLAST 4MM WHITE');
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('normalizeVendorSku is alphanumeric exact', () => {
    expect(normalizeVendorSku(' ab-12.3 ')).toBe('AB-12.3');
  });
});
