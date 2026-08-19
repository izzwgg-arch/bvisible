// Local-dev / smoke helper: seeds a small standard-sign catalog so the Bid
// Estimator smoke spec can exercise automatic matching, quantity
// conversion, and office questions WITHOUT touching the live Google Sheet
// (whose "Standard Signs" tab is owner-managed).
//
// Rows are source = APP (the Sheet sync never overwrites or deactivates
// them). Safe to re-run: upserts by (tenantId, signKey).
//
//   pnpm --filter @bvisible/web exec tsx smoke/fixtures/seed-bid-standard-signs.ts

import { PrismaClient, StandardSignSource } from '@prisma/client';

const prisma = new PrismaClient();

const SIGNS = [
  { signKey: 'residential-unit-id', name: 'Residential Unit ID Sign', category: 'Interior ADA', qbItem: 'SALES', customerDescription: 'Residential Unit ID Signs — 6 × 8-inch, 1/8-inch white acrylic with raised characters and Grade 2 Braille; VHB mounting included.', widthMilli: 6000, heightMilli: 8000, material: 'acrylic', tactile: true, braille: true, pricingMethod: 'PER_SIGN', pricingUnit: 'SIGN', rateKey: '60', rateCents: 6000, aliases: ['Apartment Entry Signage', 'Unit Number Sign', 'Residential Unit ID'] },
  { signKey: 'reserved-ev-charging', name: 'Reserved EV Charging Sign', category: 'Site & Parking', qbItem: 'SALES', customerDescription: 'Reserved EV Charging Signs — 12 × 18-inch HIP reflective aluminum parking signs.', widthMilli: 12000, heightMilli: 18000, material: 'aluminum', pricingMethod: 'PER_SIGN', pricingUnit: 'SIGN', rateKey: '50', rateCents: 5000, aliases: ['EV Charging Sign', 'EV Sign'] },
  { signKey: 'utility-boh-id', name: 'Utility & Back-of-House ID Sign', category: 'Interior ADA', qbItem: 'SALES', customerDescription: 'Utility and back-of-house identification signs — tactile acrylic with raised text and Grade 2 Braille.', material: 'acrylic', tactile: true, braille: true, pricingMethod: 'PER_SIGN', pricingUnit: 'SIGN', rateKey: '50', rateCents: 5000, aliases: ['Utility and Back of House ID Sign', 'BOH ID Sign'] },
  { signKey: 'tactile-exit', name: 'Tactile EXIT Sign', category: 'Interior ADA', qbItem: 'SALES', customerDescription: 'Tactile EXIT Signs — raised EXIT text and Grade 2 Braille.', tactile: true, braille: true, pricingMethod: 'PER_SIGN', pricingUnit: 'SIGN', rateKey: '50', rateCents: 5000, aliases: [] },
  { signKey: 'stairwell-id-12x18', name: 'Stairwell ID Sign 12x18', category: 'Interior ADA', qbItem: 'SALES', customerDescription: 'Stairwell interior ADA identification signs — 12 × 18-inch, multi-line raised text and Grade 2 Braille.', widthMilli: 12000, heightMilli: 18000, tactile: true, braille: true, pricingMethod: 'PER_SIGN', pricingUnit: 'SIGN', rateKey: '65', rateCents: 6500, aliases: [] },
  { signKey: 'stairwell-id-8x10', name: 'Stairwell ID Sign 8x10', category: 'Interior ADA', qbItem: 'SALES', customerDescription: 'Stairwell identification signs — 8 × 10-inch, raised text and Grade 2 Braille.', widthMilli: 8000, heightMilli: 10000, tactile: true, braille: true, pricingMethod: 'PER_SIGN', pricingUnit: 'SIGN', rateKey: '45', rateCents: 4500, aliases: [] },
  { signKey: 'exterior-pvc-letters', name: 'Building ID', category: 'Exterior Lettering', qbItem: 'THREE_D_LETTERING', customerDescription: 'Exterior building dimensional PVC lettering — {wording}, painted and stud mounted.', material: 'PVC', illumination: 'none', pricingMethod: 'PER_CHARACTER', pricingUnit: 'CHARACTER', rateKey: '50', rateCents: 5000, aliases: ['Exterior 3D PVC Letters', 'Building ID Letters'] },
  { signKey: 'halo-lit-address', name: 'Building Address', category: 'Exterior Lettering', qbItem: 'CHANNEL_LETTERS', customerDescription: 'Illuminated exterior building address lettering — {wording}, approximately 18 inches high, reverse halo-lit; final electrical connection excluded.', illumination: 'halo', pricingMethod: 'PER_CHARACTER', pricingUnit: 'CHARACTER', rateKey: '225', rateCents: 22500, aliases: ['Halo-Lit Address Characters', 'Illuminated Address'] },
] as const;

async function main() {
  const email = process.env.DEV_LOGIN_EMAIL ?? 'admin@bvisible.local';
  const user = await prisma.user.findFirst({ where: { email }, select: { tenantId: true } });
  const tenant = user?.tenantId ? await prisma.tenant.findUnique({ where: { id: user.tenantId } }) : await prisma.tenant.findFirst({ orderBy: { createdAt: 'asc' } });
  if (!tenant) throw new Error('No tenant found to seed.');
  for (const s of SIGNS) {
    const nameNormalized = s.name.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9/.\-\s]/g, ' ').replace(/\s+/g, ' ').trim();
    await prisma.standardSign.upsert({
      where: { tenantId_signKey: { tenantId: tenant.id, signKey: s.signKey } },
      create: {
        tenantId: tenant.id,
        signKey: s.signKey,
        source: StandardSignSource.APP,
        active: true,
        category: s.category,
        name: s.name,
        nameNormalized,
        qbItem: s.qbItem,
        customerDescription: s.customerDescription,
        widthMilli: 'widthMilli' in s ? s.widthMilli : null,
        heightMilli: 'heightMilli' in s ? s.heightMilli : null,
        unit: 'in',
        material: 'material' in s ? s.material : null,
        tactile: 'tactile' in s ? s.tactile : null,
        braille: 'braille' in s ? s.braille : null,
        illumination: 'illumination' in s ? s.illumination : null,
        pricingMethod: s.pricingMethod,
        pricingUnit: s.pricingUnit,
        rateKey: s.rateKey,
        rateCents: s.rateCents,
        aliases: [...s.aliases],
        formulaVersion: 'seed-v1',
        notes: 'Seeded for local smoke testing (smoke/fixtures/seed-bid-standard-signs.ts).',
      },
      update: { active: true, rateCents: s.rateCents, rateKey: s.rateKey, aliases: [...s.aliases], customerDescription: s.customerDescription, qbItem: s.qbItem },
    });
  }
  console.log(`Seeded ${SIGNS.length} standard signs for tenant ${tenant.slug} (${tenant.id}).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
