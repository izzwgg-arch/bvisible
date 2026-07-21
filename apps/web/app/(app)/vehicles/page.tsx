import { prisma } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { getSheetSnapshot } from '@/lib/sheet-sync/sync';
import { WrapPricingBrowser, type WrapRow } from './wrap-pricing-browser';

export const metadata = { title: 'Vehicle Wrap Pricing' };
export const dynamic = 'force-dynamic';

/// Loose key for matching a DB wrap variant to its Sheet row: the Sheet
/// stores "Chevrolet city express - No" style combined names.
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/// Bare brand-logo files that were (incorrectly) set as some models'
/// primary photo — never show these as the hero image; the card shows
/// the logo in its own badge and the silhouette placeholder instead.
const LOGO_FILES = new Set([
  'chevrolet.jpg', 'chrysler.png', 'dodge.png', 'ford.png', 'gmc.png',
  'honda.png', 'kenworth.png', 'kia.jpg', 'mercedes.png', 'nissan.jpg',
  'tesla.png', 'toyota.png',
]);

function heroPhoto(url: string | null | undefined): string | null {
  if (!url) return null;
  const base = url.split('/').pop()?.toLowerCase() ?? '';
  return LOGO_FILES.has(base) ? null : url;
}

/// Rows without a real vehicle photo fall back to the shipped roof-wrap
/// illustration for their variant (same pictures the owner's reference
/// app uses), then to the generic silhouette.
const ROOF_WRAP_ILLUSTRATION: Record<string, string> = {
  full: '/vehicle-library/roof_wrap_full.jpg',
  no: '/vehicle-library/roof_wrap_none.jpg',
  'top front': '/vehicle-library/roof_wrap_top_front.jpg',
};

export default async function VehicleWrapPricingPage() {
  const me = await requireTenantId();

  const [snapshot, dbRows] = await Promise.all([
    getSheetSnapshot(me.tenantId),
    prisma.vehicleWrapPricing.findMany({
      where: { tenantId: me.tenantId, isActive: true },
      orderBy: [{ sortOrder: 'asc' }],
      select: {
        id: true,
        productName: true,
        variant: true,
        wheelbase: true,
        height: true,
        roofWrapOption: true,
        extraVersion1: true,
        extraOption1: true,
        extraOption2: true,
        sku: true,
        squareFootage: true,
        ratePerSf: true,
        charge: true,
        pricingRule: true,
        exportNote: true,
        model: {
          select: {
            name: true,
            make: { select: { name: true } },
            photos: { where: { isPrimary: true }, take: 1, select: { url: true } },
          },
        },
        trim: { select: { photos: { where: { isPrimary: true }, take: 1, select: { url: true } } } },
      },
    }),
  ]);

  // LIVE Sheet price overlay — the Sheet is the source of truth for wrap
  // prices (same rule as everywhere else). Matched by normalized
  // "product - variant" name; unmatched rows keep their stored price.
  const sheetByKey = new Map<string, { priceCents: number; sqft: number; rule: string }>();
  for (const w of snapshot.data.vehicleWraps) {
    const rule = w.notes.match(/Pricing reason:\s*([^;]+)/i)?.[1]?.trim() ?? '';
    sheetByKey.set(norm(w.name), { priceCents: w.priceCents, sqft: w.billableAreaSqFt, rule });
  }

  let sheetMatched = 0;
  const rows: WrapRow[] = dbRows.map((r) => {
    const productName = r.productName ?? `${r.model.make.name} ${r.model.name}`;
    const keyA = norm(`${productName} ${r.variant ?? ''}`);
    const keyB = norm(productName);
    const sheet = sheetByKey.get(keyA) ?? sheetByKey.get(keyB);
    if (sheet) sheetMatched += 1;
    const chargeCents =
      sheet?.priceCents ?? (r.charge != null ? Math.round(Number(r.charge) * 100) : null);
    return {
      id: r.id,
      productName,
      make: r.model.make.name,
      model: r.model.name,
      variant: r.variant ?? '',
      wheelbase: r.wheelbase ?? '',
      height: r.height ?? '',
      roofWrapOption: r.roofWrapOption ?? '',
      extraVersion1: r.extraVersion1 ?? '',
      extraOption1: r.extraOption1 ?? '',
      extraOption2: r.extraOption2 ?? '',
      sku: r.sku ?? (r.squareFootage != null ? `${r.squareFootage}SF` : ''),
      squareFootage: sheet?.sqft || r.squareFootage,
      ratePerSf: r.ratePerSf != null ? Number(r.ratePerSf) : null,
      chargeCents: chargeCents != null && chargeCents > 0 ? chargeCents : null,
      pricingRule: sheet?.rule || (r.pricingRule ?? ''),
      exportNote: r.exportNote ?? '',
      photoUrl:
        heroPhoto(r.trim?.photos[0]?.url) ??
        heroPhoto(r.model.photos[0]?.url) ??
        ROOF_WRAP_ILLUSTRATION[(r.roofWrapOption ?? '').toLowerCase()] ??
        null,
    };
  });

  const sheetOk = snapshot.status === 'OK';

  return (
    <>
      <PageHeader
        title="Vehicle Wrap Pricing"
        subtitle="Choose make, model, roof wrap options, and extras to find the matching price fast."
      />
      <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-4 py-1.5 text-[12px] text-[var(--color-bv-muted)] shadow-[var(--shadow-bv-card)]">
        <span className={`h-2 w-2 rounded-full ${sheetOk ? 'bg-emerald-500' : 'bg-amber-500'}`} />
        {sheetOk
          ? `Live Sheet · ${rows.length} wrap options · ${sheetMatched} prices synced from the Sheet`
          : 'Pricing Sheet unavailable — showing stored prices.'}
      </div>
      <WrapPricingBrowser rows={rows} />
    </>
  );
}
