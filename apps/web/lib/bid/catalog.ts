// Loads the live inputs the bid pricing engine needs: the standard-sign
// catalog (DB rows synced from the Sheet + app-promoted signs, plus the
// Sheet ALIASES tab) and the rate sources (Sheet snapshot with app
// overrides, and the company operating rates). Read-only.

import { prisma } from '@bvisible/db';
import { loadOverrides } from '@/lib/sheet-sync/active-price';
import { getSheetSnapshot } from '@/lib/sheet-sync/sync';
import type { SheetSyncSnapshot } from '@/lib/sheet-sync/types';
import type { CatalogSign, StandardSignCatalog } from './match-standard-sign';
import type { RateSources } from './price-line';
import { loadBidOperatingRates } from './rates';

export interface BidPricingContext {
  catalog: StandardSignCatalog;
  sources: RateSources;
  snapshot: SheetSyncSnapshot;
}

export async function loadStandardSignCatalog(tenantId: string, snapshot?: SheetSyncSnapshot): Promise<StandardSignCatalog> {
  const [rows, snap] = await Promise.all([
    prisma.standardSign.findMany({ where: { tenantId }, orderBy: [{ name: 'asc' }] }),
    snapshot ? Promise.resolve(snapshot) : getSheetSnapshot(tenantId),
  ]);
  const signs: CatalogSign[] = rows.map((r) => ({
    id: r.id,
    signKey: r.signKey,
    name: r.name,
    nameNormalized: r.nameNormalized,
    aliases: r.aliases,
    category: r.category,
    qbItem: r.qbItem,
    customerDescription: r.customerDescription,
    widthMilli: r.widthMilli,
    heightMilli: r.heightMilli,
    material: r.material,
    tactile: r.tactile,
    braille: r.braille,
    illumination: r.illumination,
    pricingMethod: r.pricingMethod,
    pricingUnit: r.pricingUnit,
    rateKey: r.rateKey,
    rateCents: r.rateCents,
    minimumChargeCents: r.minimumChargeCents,
    wastePercentMilli: r.wastePercentMilli,
    active: r.active,
  }));
  return { signs, sheetAliases: snap.data.aliases ?? [] };
}

export async function loadBidPricingContext(tenantId: string): Promise<BidPricingContext> {
  const snapshot = await getSheetSnapshot(tenantId);
  const [catalog, overrides, rates] = await Promise.all([
    loadStandardSignCatalog(tenantId, snapshot),
    loadOverrides(tenantId),
    loadBidOperatingRates(tenantId),
  ]);
  return {
    catalog,
    snapshot,
    sources: {
      sheet: { materials: snapshot.data.materials, sqftRates: snapshot.data.sqftRates, fetchedAt: snapshot.data.fetchedAt },
      overrides,
      rates,
      sheetSyncedAt: snapshot.syncedAt,
    },
  };
}
