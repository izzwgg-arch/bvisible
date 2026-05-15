// Banner pricing helper (R-EST-03):
//   $4.00 / sqft up to 200 sqft
//   $3.00 / sqft for area above 200 sqft
//   $0.50 / grommet
//   $45.00 minimum charge
//
// Returns integer cents. The estimate Pricing helper applies results as
// one MATERIAL line (qty 1 × computed unit cost) only when the user clicks Apply.

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

  // Handoff: MAX(area × tiered rate, $45) + grommets — minimum applies to print area only.
  const computedMaterial = baseCents + overCents;
  const appliedMinimum = computedMaterial < MINIMUM_CENTS;
  const materialCents = appliedMinimum ? MINIMUM_CENTS : computedMaterial;
  const cents = materialCents + grommetCents;

  return { cents, baseCents, overCents, grommetCents, appliedMinimum };
}
