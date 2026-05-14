import { describe, expect, it } from 'vitest';
import { normalizeVendorItemName } from './normalize';

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
});
