// Live operating rates for the Bid Estimator (design $/hr, install crew
// $/hr and $/day, hours per install day, sales tax) — read from
// tenant_operating_rates, never hardcoded in a step. The Prisma defaults
// are the seed for a company that has never saved rates; admins edit them
// on Pricing backend → Operating rates.

import { prisma, type PrismaClient } from '@bvisible/db';

export interface BidOperatingRates {
  designHourlyCents: number;
  installCrewHourlyCents: number;
  installCrewDailyCents: number;
  installDayHours: number;
  installPerPersonHourCents: number;
  shopLaborCentsPerHour: number;
  defaultMarkupPercentMilli: number;
  /** Percent × 1000 (8125 = 8.125 %). 0 = no sales tax line. */
  salesTaxPercentMilli: number;
  /** True when the row exists (rates were saved by an admin at least once). */
  configured: boolean;
}

/** Mirrors the Prisma column defaults — used only when no row exists yet. */
export const DEFAULT_BID_OPERATING_RATES: BidOperatingRates = {
  designHourlyCents: 15000,
  installCrewHourlyCents: 35000,
  installCrewDailyCents: 280000,
  installDayHours: 8,
  installPerPersonHourCents: 15000,
  shopLaborCentsPerHour: 5000,
  defaultMarkupPercentMilli: 200000,
  salesTaxPercentMilli: 8125,
  configured: false,
};

export async function loadBidOperatingRates(
  tenantId: string,
  db: Pick<PrismaClient, 'tenantOperatingRates'> = prisma
): Promise<BidOperatingRates> {
  const row = await db.tenantOperatingRates.findUnique({ where: { tenantId } });
  if (!row) return { ...DEFAULT_BID_OPERATING_RATES };
  return {
    designHourlyCents: row.designHourlyCents,
    installCrewHourlyCents: row.installCrewHourlyCents,
    installCrewDailyCents: row.installCrewDailyCents,
    installDayHours: Math.max(1, row.installDayHours),
    installPerPersonHourCents: row.installPerPersonHourCents,
    shopLaborCentsPerHour: row.shopLaborCentsPerHour,
    defaultMarkupPercentMilli: row.defaultMarkupPercentMilli,
    salesTaxPercentMilli: Math.max(0, row.salesTaxPercentMilli),
    configured: true,
  };
}

/** Sell multiplier (milli) from the company default markup percent. */
export function multiplierMilliFromMarkupPercentMilli(markupPercentMilli: number): number {
  return Math.round((1 + Math.max(0, markupPercentMilli) / 100_000) * 1000);
}
