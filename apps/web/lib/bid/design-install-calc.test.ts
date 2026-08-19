import { describe, expect, it } from 'vitest';
import { DEFAULT_DESIGN_INPUTS, computeDesignLine, recommendDesignHours } from './design-calc';
import { DEFAULT_INSTALL_INPUTS, buildInstallCustomerAssumptions, computeInstallLine, convertInstallAmount, recommendInstallHours } from './install-calc';

describe('design calculator', () => {
  it('is driven by unique layouts + variable data + proofing + production files, not by sign quantity', () => {
    const rec = recommendDesignHours({ ...DEFAULT_DESIGN_INPUTS, uniqueLayouts: 14, variableDataSets: 4, proofingRounds: 1, productionFiles: true });
    // 14 × 0.5 + 4 × 0.25 + 0.5 + 1 = 9.5
    expect(rec.recommendedHours).toBe(9.5);
    expect(rec.breakdown.map((s) => s.label)).toEqual(['Unique layouts', 'Variable data', 'Proofing & corrections', 'Production files']);
    // One template used 100 times is NOT 100 designs: same inputs, same hours.
    const same = recommendDesignHours({ ...DEFAULT_DESIGN_INPUTS, uniqueLayouts: 1, variableDataSets: 1 });
    expect(same.recommendedHours).toBe(2.25);
  });

  it('starting-file and data conditions raise the recommendation', () => {
    const scratch = recommendDesignHours({ ...DEFAULT_DESIGN_INPUTS, uniqueLayouts: 4, startingFiles: 'FROM_SCRATCH', variableDataSets: 2, variableData: 'MANUAL_ENTRY' });
    // 4 × 1.75 + 2 × 0.75 + 0.5 + 1 = 10
    expect(scratch.recommendedHours).toBe(10);
    expect(scratch.assumptions[0]).toMatch(/from scratch/);
  });

  it('uses the approved hours when given and the live rate for the total', () => {
    const line = computeDesignLine({ ...DEFAULT_DESIGN_INPUTS, uniqueLayouts: 14, approvedHours: 12 }, 15000);
    expect(line.hoursMilli).toBe(12_000);
    expect(line.rateCents).toBe(15000);
    expect(line.totalCents).toBe(180_000);
    expect(line.description).toMatch(/production-ready/);
    const auto = computeDesignLine({ ...DEFAULT_DESIGN_INPUTS, uniqueLayouts: 2 }, 12000);
    expect(auto.hoursMilli).toBe(2_500);
    expect(auto.totalCents).toBe(30_000);
  });
});

describe('installation calculator', () => {
  const scope = { interiorSigns: 300, exteriorSigns: 56, letterCharacters: 23, illuminatedUnits: 12 };

  it('accounts for mounting, buildings, floors, travel, mobilizations and lift — not just quantity', () => {
    const base = recommendInstallHours({ ...DEFAULT_INSTALL_INPUTS, buildings: 1, floors: 1 }, scope, 8);
    const bigger = recommendInstallHours({ ...DEFAULT_INSTALL_INPUTS, buildings: 3, floors: 5, liftRequired: true, siteMovement: 'HIGH', surfacesReady: false, newPosts: 10, existingPosts: false }, scope, 8);
    expect(bigger.crewHours).toBeGreaterThan(base.crewHours);
    expect(bigger.breakdown.map((s) => s.label)).toEqual(expect.arrayContaining(['Interior / wall-mounted signs', 'Exterior signs', 'Dimensional / channel characters', 'Mobilization, travel & setup', 'Site movement', 'Lift', 'Site conditions', 'Layout & cleanup', 'Recommendation']));
    expect(base.crewDays).toBe(Math.round((base.crewHours / 8) * 2) / 2);
  });

  it('prices by day or by hour with the live crew rates and keeps the hour equivalent', () => {
    const rates = { installCrewHourlyCents: 35000, installCrewDailyCents: 280000, installDayHours: 8 };
    const days = computeInstallLine({ ...DEFAULT_INSTALL_INPUTS, mode: 'DAYS', amount: 4.5 }, rates, null);
    expect(days.qtyMilli).toBe(4_500);
    expect(days.rateCents).toBe(280000);
    expect(days.totalCents).toBe(1_260_000);
    expect(days.equivalentHours).toBe(36);
    expect(days.formula).toBe('4.5 days × $2,800.00 per 8-hour day');
    const hours = computeInstallLine({ ...DEFAULT_INSTALL_INPUTS, mode: 'HOURS', amount: 36 }, rates, null);
    expect(hours.totalCents).toBe(1_260_000);
    expect(hours.description).toMatch(/priced by crew hours/);
  });

  it('switching modes converts the amount instead of changing the total unexpectedly', () => {
    expect(convertInstallAmount(36, 'HOURS', 'DAYS', 8)).toBe(4.5);
    expect(convertInstallAmount(4.5, 'DAYS', 'HOURS', 8)).toBe(36);
    expect(convertInstallAmount(37, 'HOURS', 'DAYS', 8)).toBe(4.5); // half-day steps
  });

  it('states electrical exclusion and posts in the customer assumptions', () => {
    const a = buildInstallCustomerAssumptions({ ...DEFAULT_INSTALL_INPUTS, finalElectricalExcluded: true, existingPosts: true });
    expect(a).toEqual(expect.arrayContaining(['Interior signs mount to ready surfaces.', 'Exterior post signs use existing posts.', 'Final electrical connection is excluded and must be completed by a licensed electrician.']));
    const b = buildInstallCustomerAssumptions({ ...DEFAULT_INSTALL_INPUTS, existingPosts: false, newPosts: 4, finalElectricalExcluded: false, electricalScope: 'ELECTRICIAN_REQUIRED' });
    expect(b).toEqual(expect.arrayContaining(['4 new posts to be set.', 'Electrical connection included as described.']));
  });
});
