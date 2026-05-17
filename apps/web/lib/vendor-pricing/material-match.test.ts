import { describe, expect, it } from 'vitest';
import { buildMaterialMatchIntel, catalogMatchKindToResolutionPath } from './material-match';

describe('buildMaterialMatchIntel', () => {
  it('marks prefix matches as needs confirmation', () => {
    const m = buildMaterialMatchIntel({
      matchKind: 'prefix_alias',
      normalizedLabel: 'BAN',
      canonicalKey: 'BAN',
    });
    expect(m.path).toBe('prefix_alias');
    expect(m.confidenceLabel).toBe('Medium');
    expect(m.needsConfirmation).toBe(true);
    expect(m.matchReason).toMatch(/confirm/i);
  });

  it('marks unresolved when match kind is none', () => {
    const m = buildMaterialMatchIntel({
      matchKind: 'none',
      normalizedLabel: 'UNKNOWN WIDGET',
      canonicalKey: 'UNKNOWN WIDGET',
    });
    expect(m.path).toBe('unresolved');
    expect(m.confidenceLabel).toBe('Needs review');
    expect(m.needsConfirmation).toBe(true);
  });

  it('maps vendor SKU to high-confidence path', () => {
    expect(catalogMatchKindToResolutionPath('vendor_sku')).toBe('vendor_sku');
    const m = buildMaterialMatchIntel({
      matchKind: 'vendor_sku',
      normalizedLabel: 'SKU123',
      canonicalKey: 'SKU123',
    });
    expect(m.confidenceLabel).toBe('High');
    expect(m.needsConfirmation).toBe(false);
  });
});
