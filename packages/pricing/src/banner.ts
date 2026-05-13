// Banner pricing helper (R-EST-03):
//   $4.00 / sqft up to 200 sqft
//   $3.00 / sqft for area above 200 sqft
//   $0.50 / grommet
//   $45.00 minimum charge
//
// Returns integer cents. The editor uses this to fill in qty + unit
// cost for a single MATERIAL line via the "Banner calculator" button;
// it does not store anything banner-specific on the line itself.

import { roundCents } from './money';

export interface BannerInput {
  sqft: number;
  grommets: number;
}

export interface BannerOutput {
  cents: number;
  // Echoed back for the UI so the calculator dialog can show the
  // breakdown before the user clicks "Insert as line".
  baseCents: number;
  overCents: number;
  grommetCents: number;
  appliedMinimum: boolean;
}

const RATE_BASE_PER_SQFT_CENTS = 400;
const RATE_OVER_PER_SQFT_CENTS = 300;
const OVERAGE_THRESHOLD_SQFT = 200;
const GROMMET_CENTS = 50;
const MINIMUM_CENTS = 4500;

export function bannerPrice(input: BannerInput): BannerOutput {
  const sqft = Math.max(0, Number.isFinite(input.sqft) ? input.sqft : 0);
  const grommets = Math.max(
    0,
    Number.isFinite(input.grommets) ? Math.trunc(input.grommets) : 0
  );

  const baseSqft = Math.min(sqft, OVERAGE_THRESHOLD_SQFT);
  const overSqft = Math.max(0, sqft - OVERAGE_THRESHOLD_SQFT);

  const baseCents = roundCents(baseSqft * RATE_BASE_PER_SQFT_CENTS);
  const overCents = roundCents(overSqft * RATE_OVER_PER_SQFT_CENTS);
  const grommetCents = grommets * GROMMET_CENTS;

  const computed = baseCents + overCents + grommetCents;
  const appliedMinimum = computed < MINIMUM_CENTS;
  const cents = appliedMinimum ? MINIMUM_CENTS : computed;

  return { cents, baseCents, overCents, grommetCents, appliedMinimum };
}
