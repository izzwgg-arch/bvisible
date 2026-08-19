import { describe, expect, it } from 'vitest';
import { matchStandardSign, type CatalogSign, type StandardSignCatalog } from './match-standard-sign';
import { extractDimensions, extractWording, extractSignAttributes } from './text-extract';
import { normalizeSignText } from './text-extract';

function sign(partial: Partial<CatalogSign> & Pick<CatalogSign, 'signKey' | 'name'>): CatalogSign {
  return {
    id: `id-${partial.signKey}`,
    nameNormalized: normalizeSignText(partial.name),
    aliases: [],
    category: null,
    qbItem: 'SALES',
    customerDescription: null,
    widthMilli: null,
    heightMilli: null,
    material: null,
    tactile: null,
    braille: null,
    illumination: null,
    pricingMethod: 'PER_SIGN',
    pricingUnit: 'SIGN',
    rateKey: '60',
    rateCents: 6000,
    minimumChargeCents: null,
    active: true,
    ...partial,
  };
}

const catalog: StandardSignCatalog = {
  signs: [
    sign({ signKey: 'unit-id', name: 'Residential Unit ID Sign', widthMilli: 6000, heightMilli: 8000, material: 'acrylic', tactile: true, braille: true, aliases: ['Apartment Entry Signage', 'Unit Number Sign'] }),
    sign({ signKey: 'ev-charging', name: 'Reserved EV Charging Sign', widthMilli: 12000, heightMilli: 18000, material: 'aluminum', rateCents: 5000 }),
    sign({ signKey: 'utility-boh', name: 'Utility & Back-of-House ID Sign', tactile: true, braille: true, rateCents: 5000 }),
    sign({ signKey: 'exit-tactile', name: 'Tactile EXIT Sign', braille: true, rateCents: 5000 }),
    sign({ signKey: 'stair-id-12x18', name: 'Stairwell ID Sign 12x18', widthMilli: 12000, heightMilli: 18000, rateCents: 6500 }),
    sign({ signKey: 'stair-id-8x10', name: 'Stairwell ID Sign 8x10', widthMilli: 8000, heightMilli: 10000, rateCents: 4500 }),
    sign({ signKey: 'pvc-letters', name: 'Exterior 3D PVC Letters', pricingMethod: 'PER_CHARACTER', pricingUnit: 'CHARACTER', qbItem: 'THREE_D_LETTERING', rateCents: 5000, illumination: 'none' }),
    sign({ signKey: 'halo-address', name: 'Halo-Lit Address Characters', pricingMethod: 'PER_CHARACTER', pricingUnit: 'CHARACTER', qbItem: 'CHANNEL_LETTERS', rateCents: 22500, illumination: 'halo' }),
    sign({ signKey: 'sqft-panel', name: 'Printed Wall Panel', pricingMethod: 'PER_SQFT', pricingUnit: 'SQ_FT', rateKey: 'Sq Ft Pricing Item', rateCents: null }),
    sign({ signKey: 'inactive-old', name: 'Old Sign', active: false }),
  ],
  sheetAliases: [{ alias: 'ev sign', canonical: 'Reserved EV Charging Sign' }],
};

describe('matchStandardSign — deterministic ladder', () => {
  it('exact normalized name with agreeing attributes → EXACT', () => {
    const r = matchStandardSign({ name: 'Residential Unit ID Sign', description: '6" x 8" tactile acrylic with Braille' }, catalog);
    expect(r.level).toBe('EXACT');
    expect(r.sign?.signKey).toBe('unit-id');
    expect(r.confidenceMilli).toBe(1000);
    expect(r.conflicts).toEqual([]);
  });

  it('exact sign key in brackets → EXACT', () => {
    const r = matchStandardSign({ name: 'Unit sign [unit-id]', description: null }, catalog);
    expect(r.level).toBe('EXACT');
    expect(r.sign?.signKey).toBe('unit-id');
  });

  it('sign alias and Sheet ALIASES tab both resolve', () => {
    expect(matchStandardSign({ name: 'Apartment Entry Signage', description: 'raised unit number + Braille' }, catalog).sign?.signKey).toBe('unit-id');
    const viaSheet = matchStandardSign({ name: 'EV Sign', description: null }, catalog);
    expect(viaSheet.sign?.signKey).toBe('ev-charging');
    expect(viaSheet.level).toBe('EXACT');
  });

  it('exact name but the source size disagrees → PROBABLE with a conflict', () => {
    const r = matchStandardSign({ name: 'Reserved EV Charging Sign', description: '18" x 24" reflective aluminum' }, catalog);
    expect(r.level).toBe('PROBABLE');
    expect(r.conflicts[0]).toMatch(/differs from the standard/);
    expect(r.sign?.signKey).toBe('ev-charging');
  });

  it('missing size on a per-square-foot sign is price-critical', () => {
    const r = matchStandardSign({ name: 'Printed Wall Panel', description: 'full-color print' }, catalog);
    expect(r.sign?.signKey).toBe('sqft-panel');
    expect(r.missingCritical).toContain('size (priced per square foot)');
    expect(r.level).toBe('PROBABLE');
  });

  it('missing wording on a per-character sign is price-critical', () => {
    const r = matchStandardSign({ name: 'Exterior 3D PVC Letters', description: 'painted, stud mounted' }, catalog);
    expect(r.missingCritical).toContain('sign wording (priced per character)');
    const ok = matchStandardSign({ name: 'Exterior 3D PVC Letters', description: 'reading "AZURA PHASE 1", stud mounted' }, catalog);
    expect(ok.level).toBe('EXACT');
    expect(ok.extracted.wording.characterCount).toBe(11);
  });

  it('two near-identical signs → AMBIGUOUS with alternatives (never guesses)', () => {
    const r = matchStandardSign({ name: 'Stairwell ID Sign', description: 'multi-line raised text and Braille' }, catalog);
    expect(r.level).toBe('AMBIGUOUS');
    expect(r.sign).toBeNull();
    expect(r.alternatives.slice(0, 2).map((a) => a.sign.signKey).sort()).toEqual(['stair-id-12x18', 'stair-id-8x10']);
  });

  it('typo / word-order variants → PROBABLE via fuzzy', () => {
    const r = matchStandardSign({ name: 'Utility and Back of House ID Signs', description: null }, catalog);
    expect(['EXACT', 'PROBABLE']).toContain(r.level);
    expect(r.sign?.signKey).toBe('utility-boh');
  });

  it('non-illuminated source vs halo-lit sign → conflict, not exact', () => {
    const r = matchStandardSign({ name: 'Halo-Lit Address Characters', description: 'non-illuminated flat cut "23 MAIN STREET"' }, catalog);
    expect(r.level).toBe('PROBABLE');
    expect(r.conflicts.some((c) => /non-illuminated/i.test(c))).toBe(true);
  });

  it('nothing similar → NONE, inactive signs are ignored, empty catalog explained', () => {
    const r = matchStandardSign({ name: 'Monument Sign with Masonry Base', description: null }, catalog);
    expect(r.level).toBe('NONE');
    expect(r.sign).toBeNull();
    expect(matchStandardSign({ name: 'Old Sign', description: null }, catalog).level).not.toBe('EXACT');
    const empty = matchStandardSign({ name: 'Anything', description: null }, { signs: [], sheetAliases: [] });
    expect(empty.level).toBe('NONE');
    expect(empty.evidence[0]).toMatch(/No active standard signs/);
  });
});

describe('text extraction', () => {
  it('extracts W × H in inches, feet-inches, and lone heights', () => {
    expect(extractDimensions('6" x 8" tactile')).toMatchObject({ widthIn: 6, heightIn: 8 });
    expect(extractDimensions('12 × 18-inch HIP reflective')).toMatchObject({ widthIn: 12, heightIn: 18 });
    expect(extractDimensions("2'-0\" x 3'-0\" panel")).toMatchObject({ widthIn: 24, heightIn: 36 });
    expect(extractDimensions('approximately 18 inches high, reverse halo-lit')).toMatchObject({ heightOnlyIn: 18 });
    expect(extractDimensions("2' cast-metal numerals")).toMatchObject({ heightOnlyIn: 24 });
    expect(extractDimensions('no size here').widthIn).toBeNull();
  });

  it('extracts sign wording and counts chargeable characters', () => {
    expect(extractWording('Exterior building ID reading “234,” mounted at entrance')).toMatchObject({ text: '234', characterCount: 3 });
    expect(extractWording('Building ID — AZURA PHASE 1')).toMatchObject({ text: 'AZURA PHASE 1', characterCount: 11 });
    expect(extractWording('Illuminated address 23 MAIN STREET, halo-lit')).toMatchObject({ characterCount: 12 });
    expect(extractWording('Tactile EXIT sign with Braille').characterCount).toBe(0);
  });

  it('extracts attributes without inventing them', () => {
    const a = extractSignAttributes('12" x 18" HIP reflective aluminum parking sign, post mounted');
    expect(a).toMatchObject({ material: 'aluminum', reflective: true, mounting: 'post mounted', braille: false, illuminated: false });
    const b = extractSignAttributes('18" reverse halo-lit address characters, LED');
    expect(b).toMatchObject({ illuminated: true, illumination: 'HALO', channelLetters: true });
    const c = extractSignAttributes('Painted PVC dimensional letters, stud mounted');
    expect(c).toMatchObject({ dimensional: true, material: 'PVC', mounting: 'stud mounted', illuminated: false });
  });
});
