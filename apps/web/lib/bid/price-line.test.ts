import { describe, expect, it } from 'vitest';
import { applyMinimumCharge, computeBillableQty, priceBidLine, resolveSignRate, type RateSources } from './price-line';
import { matchStandardSign, type CatalogSign, type StandardSignCatalog } from './match-standard-sign';
import { normalizeSignText } from './text-extract';
import { DEFAULT_BID_OPERATING_RATES } from './rates';

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
    sign({ signKey: 'unit-id', name: 'Residential Unit ID Sign', widthMilli: 6000, heightMilli: 8000, material: 'acrylic', tactile: true, braille: true, customerDescription: 'Residential Unit ID Signs — 6 × 8-inch, 1/8-inch white acrylic with raised characters and Grade 2 Braille; VHB mounting included.' }),
    sign({ signKey: 'pvc-letters', name: 'Exterior 3D PVC Letters', pricingMethod: 'PER_CHARACTER', pricingUnit: 'CHARACTER', qbItem: 'THREE_D_LETTERING', rateKey: '$50.00', rateCents: 5000, illumination: 'none' }),
    sign({ signKey: 'halo-address', name: 'Halo-Lit Address Characters', pricingMethod: 'PER_CHARACTER', pricingUnit: 'CHARACTER', qbItem: 'CHANNEL_LETTERS', rateKey: '225', rateCents: 22500, illumination: 'halo' }),
    sign({ signKey: 'wall-panel', name: 'Printed Wall Panel', pricingMethod: 'PER_SQFT', pricingUnit: 'SQ_FT', rateKey: 'wall-panel-sqft', rateCents: null }),
    sign({ signKey: 'coroplast-yard', name: 'Coroplast Yard Sign', rateKey: 'Coroplast 4mm', rateCents: null }),
    sign({ signKey: 'small-plaque', name: 'Small Plaque', rateKey: '10', rateCents: 1000, minimumChargeCents: 4500 }),
    sign({ signKey: 'no-rate', name: 'Mystery Sign', rateKey: null, rateCents: null }),
    sign({ signKey: 'stair-a', name: 'Stairwell ID Sign 12x18', widthMilli: 12000, heightMilli: 18000, rateKey: '65', rateCents: 6500 }),
    sign({ signKey: 'stair-b', name: 'Stairwell ID Sign 8x10', widthMilli: 8000, heightMilli: 10000, rateKey: '45', rateCents: 4500 }),
  ],
  sheetAliases: [],
};

const sources: RateSources = {
  sheet: {
    materials: [{ key: 'coroplast 4mm', name: 'Coroplast 4mm', category: 'Substrate', priceCents: 1200, vendor: 'Grimco', vendorPrices: [], productUrl: '', vendorSku: '', unpriced: false }],
    sqftRates: [{ id: 'wall-panel-sqft', name: 'Printed Wall Panel', category: 'Sq ft', unit: 'sq ft', materialKeyword: '', pricePerSqFtCents: 1800, wastePercent: 0, defaultMachine: '', shopMinutesPerSqFt: 0, notes: '' }],
    fetchedAt: '2026-08-18T00:00:00.000Z',
  },
  overrides: { materials: new Map([['coroplast 4mm', 1000]]), machines: new Map() },
  rates: { ...DEFAULT_BID_OPERATING_RATES, defaultMarkupPercentMilli: 200000 },
  sheetSyncedAt: new Date('2026-08-18T00:00:00.000Z'),
};

function price(name: string, description: string | null, qty: number, extra: Partial<Parameters<typeof priceBidLine>[0]['candidate']> = {}) {
  const match = matchStandardSign({ name, description }, catalog);
  return priceBidLine({
    candidate: { name, description, qty, unit: 'EA', costCents: null, priceCents: null, priceConflict: false, sectionHeading: null, ...extra },
    match,
    sources,
    sourceRef: 'Estimating Sheet row 8',
  });
}

describe('priceBidLine — per sign', () => {
  it('exact match auto-prices from a literal rate, markup-exempt, with a full explanation', () => {
    const p = price('Residential Unit ID Sign', '6" x 8" tactile acrylic with Braille', 103);
    expect(p.priced).toBe(true);
    expect(p.reviewStatus).toBe('AUTO_PRICED');
    expect(p.billableQtyMilli).toBe(103_000);
    expect(p.rateCents).toBe(6000);
    expect(p.totalCents).toBe(618_000);
    expect(p.pricingSource).toBe('STANDARD_SIGN');
    expect(p.snapshot.markupExempt).toBe(true);
    expect(p.snapshot.rateSource).toBe('SIGN_LITERAL');
    expect(p.snapshot.sourceQtyMilli).toBe(103_000);
    expect(p.customerDescription).toMatch(/Grade 2 Braille/);
    expect(p.explanation.map((s) => s.label)).toEqual(['Source', 'Takeoff quantity', 'Standard sign', 'Billable quantity', 'Rate', 'Markup', 'Total']);
    expect(p.questions).toEqual([]);
  });

  it('source price that disagrees with the rule raises a PROJECT_PRICE question with both totals', () => {
    const p = price('Residential Unit ID Sign', '6" x 8" tactile acrylic', 10, { priceCents: 7500 });
    expect(p.reviewStatus).toBe('OFFICE_QUESTION');
    expect(p.priced).toBe(true); // rule rate is applied until the office decides
    const q = p.questions[0]!;
    expect(q.kind).toBe('PROJECT_PRICE');
    expect(q.choices.map((c) => c.key)).toEqual(['rule', 'source', 'custom']);
    expect(q.choices[0]).toMatchObject({ rateCents: 6000, totalCents: 60_000 });
    expect(q.choices[1]).toMatchObject({ rateCents: 7500, totalCents: 75_000 });
  });

  it('applies a minimum charge by raising the rate so qty × rate ≥ minimum', () => {
    expect(applyMinimumCharge(1000, 1000, 4500)).toEqual({ rateCents: 4500, applied: true });
    expect(applyMinimumCharge(3000, 1000, 4500)).toEqual({ rateCents: 1500, applied: true });
    expect(applyMinimumCharge(10_000, 1000, 4500)).toEqual({ rateCents: 1000, applied: false });
    const p = price('Small Plaque', null, 2);
    expect(p.rateCents).toBe(2250);
    expect(p.totalCents).toBe(4500);
    expect(p.snapshot.minimumApplied).toBe(true);
  });
});

describe('priceBidLine — quantity conversions', () => {
  it('per character: one set converts to a character count and keeps the source quantity', () => {
    const p = price('Exterior 3D PVC Letters', 'Building ID reading "AZURA PHASE 1", painted and stud mounted', 1);
    expect(p.billableQtyMilli).toBe(11_000);
    expect(p.snapshot.sourceQtyMilli).toBe(1000);
    expect(p.rateCents).toBe(5000);
    expect(p.totalCents).toBe(55_000);
    expect(p.pricingUnit).toBe('CHARACTER');
    expect(p.qbItem).toBe('THREE_D_LETTERING');
    expect(p.explanation.some((s) => /converted to a character count/.test(s.note ?? ''))).toBe(true);
    expect(p.customerDescription).toContain('AZURA PHASE 1');
  });

  it('per character without wording → SIZE/MISSING_SPEC question, explicitly unpriced', () => {
    const p = price('Exterior 3D PVC Letters', 'painted, stud mounted', 1);
    expect(p.priced).toBe(false);
    expect(p.totalCents).toBe(0);
    expect(p.reviewStatus).toBe('OFFICE_QUESTION');
    expect(p.questions[0]!.kind).toBe('MISSING_SPEC');
  });

  it('per square foot from source size via the Sq Ft Pricing tab (final selling price)', () => {
    const p = price('Printed Wall Panel', '24" x 36" full-color print', 2);
    // 24×36/144 = 6 sq ft × 2 = 12 sq ft
    expect(p.billableQtyMilli).toBe(12_000);
    expect(p.rateCents).toBe(1800);
    expect(p.totalCents).toBe(21_600);
    expect(p.snapshot.rateSource).toBe('SHEET');
    expect(p.snapshot.sheetTab).toBe('Sq Ft Pricing');
    expect(p.snapshot.dimensions).toEqual({ widthIn: 24, heightIn: 36 });
  });

  it('per square foot without any size → SIZE question', () => {
    const p = price('Printed Wall Panel', 'full-color print', 2);
    expect(p.priced).toBe(false);
    expect(p.questions[0]!.kind).toBe('SIZE');
  });

  it('computeBillableQty per sign / per set keeps the takeoff quantity', () => {
    const m = matchStandardSign({ name: 'x', description: null }, { signs: [], sheetAliases: [] }).extracted;
    expect(computeBillableQty('PER_SIGN', 46, m, null, null).qtyMilli).toBe(46_000);
    expect(computeBillableQty('PER_SET', 3, m, null, null).unit).toBe('SET');
  });
});

describe('resolveSignRate — rate ladder', () => {
  it('literal → SIGN_LITERAL; sqft id → SHEET final price; material key → cost × markup with app override', () => {
    expect(resolveSignRate(catalog.signs[0]!, sources)).toMatchObject({ rateCents: 6000, rateSource: 'SIGN_LITERAL' });
    expect(resolveSignRate(catalog.signs[3]!, sources)).toMatchObject({ rateCents: 1800, rateSource: 'SHEET', sheetTab: 'Sq Ft Pricing' });
    const mat = resolveSignRate(catalog.signs[4]!, sources);
    expect(mat).toMatchObject({ rateCents: 3000, rateSource: 'OVERRIDE', sheetTab: 'Meterial price', markedUp: true }); // $10 override × 3.00
    expect(resolveSignRate(catalog.signs[6]!, sources)).toMatchObject({ rateCents: null, rateSource: 'NONE' });
  });

  it('marked-up material rates are never auto-priced silently', () => {
    const p = price('Coroplast Yard Sign', null, 4);
    expect(p.priced).toBe(true);
    expect(p.reviewStatus).toBe('NEEDS_REVIEW');
    expect(p.rateCents).toBe(3000);
  });

  it('a sign with no rate → RATE question', () => {
    const p = price('Mystery Sign', null, 1);
    expect(p.priced).toBe(false);
    expect(p.questions[0]!.kind).toBe('RATE');
  });
});

describe('priceBidLine — no standard sign', () => {
  it('ambiguous → STANDARD_SIGN question listing alternatives with rates', () => {
    const p = price('Stairwell ID Sign', 'multi-line raised text', 12);
    expect(p.priced).toBe(false);
    expect(p.questions[0]!.kind).toBe('STANDARD_SIGN');
    const keys = p.questions[0]!.choices.map((c) => c.key);
    expect(keys).toContain('sign:stair-a');
    expect(keys).toContain('sign:stair-b');
    expect(keys[keys.length - 1]).toBe('custom');
    const a = p.questions[0]!.choices.find((c) => c.key === 'sign:stair-a')!;
    expect(a.totalCents).toBe(12 * 6500);
  });

  it('explicit takeoff selling price → priced from source, yellow (needs review)', () => {
    const p = price('Monument Sign', 'masonry base', 1, { priceCents: 450_000 });
    expect(p.priced).toBe(true);
    expect(p.pricingSource).toBe('SOURCE_PRICE');
    expect(p.reviewStatus).toBe('NEEDS_REVIEW');
    expect(p.totalCents).toBe(450_000);
  });

  it('takeoff cost only → marked up with the company default, yellow', () => {
    const p = price('Monument Sign', 'masonry base', 1, { costCents: 100_000 });
    expect(p.rateCents).toBe(300_000);
    expect(p.reviewStatus).toBe('NEEDS_REVIEW');
  });

  it('nothing to go on → blue question, explicitly unpriced (never $0 silently)', () => {
    const p = price('Monument Sign', 'masonry base', 1);
    expect(p.priced).toBe(false);
    expect(p.pricingSource).toBe('UNPRICED');
    expect(p.reviewStatus).toBe('OFFICE_QUESTION');
    expect(p.questions[0]!.choices.map((c) => c.key)).toEqual(expect.arrayContaining(['custom', 'exclude']));
  });
});
