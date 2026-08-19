// Installation (Step 6) — hourly or daily crew pricing. Recommended crew
// hours consider mounting, buildings, floors, travel, mobilizations, lift
// and posts — never sign quantity alone. Rates are the live crew rates.

import { computeLineCostCents } from '@bvisible/pricing';
import type { ExplanationStep, InstallInputs } from './types';

export const DEFAULT_INSTALL_INPUTS: InstallInputs = {
  mode: 'DAYS',
  amount: null,
  crewSize: 2,
  travelHours: 1,
  mobilizations: 1,
  buildings: 1,
  floors: 1,
  siteMovement: 'NORMAL',
  liftRequired: false,
  equipment: null,
  existingPosts: true,
  newPosts: 0,
  wallMounted: true,
  surfacesReady: true,
  electricalScope: 'NONE',
  finalElectricalExcluded: true,
  permitsAssumed: 'BY_CUSTOMER',
  customerAssumptions: [],
  internalNote: null,
};

export interface InstallScope {
  /** Interior / wall-mounted sign count (tape or screw). */
  interiorSigns: number;
  /** Exterior post / panel signs. */
  exteriorSigns: number;
  /** Dimensional / channel letter characters (stud mounted, layout heavy). */
  letterCharacters: number;
  /** Illuminated units (LED / halo) — extra time for wiring to the point of connection. */
  illuminatedUnits: number;
}

const HOURS = {
  interiorSign: 0.15,
  exteriorSignExistingPost: 0.5,
  exteriorSignNewPost: 1.5,
  letterCharacter: 0.5,
  illuminatedUnit: 0.75,
  setupPerMobilization: 1.0,
  perExtraBuilding: 0.75,
  perExtraFloor: 0.5,
  liftSetup: 1.5,
  cleanupPerDay: 0.5,
};

const MOVEMENT_FACTOR: Record<InstallInputs['siteMovement'], number> = { LOW: 0.9, NORMAL: 1.0, HIGH: 1.2 };
const SURFACE_NOT_READY_FACTOR = 1.15;

export interface InstallRecommendation {
  crewHours: number;
  crewDays: number;
  breakdown: ExplanationStep[];
}

function r2(h: number): number {
  return Math.round(h * 4) / 4;
}

export function recommendInstallHours(input: InstallInputs, scope: InstallScope, dayHours: number): InstallRecommendation {
  const breakdown: ExplanationStep[] = [];
  let hours = 0;
  const day = Math.max(1, dayHours);

  const interior = r2(scope.interiorSigns * HOURS.interiorSign);
  if (scope.interiorSigns > 0) {
    hours += interior;
    breakdown.push({ label: 'Interior / wall-mounted signs', value: `${scope.interiorSigns} × ${HOURS.interiorSign} h = ${interior} h` });
  }
  if (scope.exteriorSigns > 0) {
    const perSign = input.existingPosts && input.newPosts === 0 ? HOURS.exteriorSignExistingPost : HOURS.exteriorSignNewPost;
    const ext = r2(scope.exteriorSigns * perSign);
    hours += ext;
    breakdown.push({ label: 'Exterior signs', value: `${scope.exteriorSigns} × ${perSign} h = ${ext} h`, note: input.existingPosts && input.newPosts === 0 ? 'Existing posts' : 'New posts to set' });
  }
  if (scope.letterCharacters > 0) {
    const letters = r2(scope.letterCharacters * HOURS.letterCharacter);
    hours += letters;
    breakdown.push({ label: 'Dimensional / channel characters', value: `${scope.letterCharacters} × ${HOURS.letterCharacter} h = ${letters} h`, note: 'Layout, pattern, and stud mounting.' });
  }
  if (scope.illuminatedUnits > 0 && input.electricalScope !== 'NONE') {
    const ill = r2(scope.illuminatedUnits * HOURS.illuminatedUnit);
    hours += ill;
    breakdown.push({ label: 'Illuminated units', value: `${scope.illuminatedUnits} × ${HOURS.illuminatedUnit} h = ${ill} h`, note: 'Wiring to the point of connection; final hookup by a licensed electrician.' });
  }

  const mob = Math.max(1, input.mobilizations);
  const setup = r2(mob * HOURS.setupPerMobilization + Math.max(0, input.travelHours) * mob);
  hours += setup;
  breakdown.push({ label: 'Mobilization, travel & setup', value: `${mob} × (${HOURS.setupPerMobilization} h + ${input.travelHours} h travel) = ${setup} h` });

  const extraBuildings = Math.max(0, input.buildings - 1) * HOURS.perExtraBuilding;
  const extraFloors = Math.max(0, input.floors - 1) * HOURS.perExtraFloor;
  if (extraBuildings + extraFloors > 0) {
    const mv = r2(extraBuildings + extraFloors);
    hours += mv;
    breakdown.push({ label: 'Site movement', value: `${input.buildings} building${input.buildings === 1 ? '' : 's'}, ${input.floors} floor${input.floors === 1 ? '' : 's'} → +${mv} h` });
  }
  if (input.liftRequired) {
    hours += HOURS.liftSetup;
    breakdown.push({ label: 'Lift', value: `+${HOURS.liftSetup} h setup / repositioning` });
  }

  const factor = MOVEMENT_FACTOR[input.siteMovement] * (input.surfacesReady ? 1 : SURFACE_NOT_READY_FACTOR);
  if (factor !== 1) {
    const before = hours;
    hours = r2(hours * factor);
    breakdown.push({ label: 'Site conditions', value: `× ${factor.toFixed(2)} (${before} h → ${hours} h)`, note: `${input.siteMovement.toLowerCase()} site movement${input.surfacesReady ? '' : ', surfaces not ready'}` });
  }

  const days = Math.max(1, Math.ceil(hours / day));
  const cleanup = r2(days * HOURS.cleanupPerDay);
  hours = r2(hours + cleanup);
  breakdown.push({ label: 'Layout & cleanup', value: `${days} day${days === 1 ? '' : 's'} × ${HOURS.cleanupPerDay} h = ${cleanup} h` });

  const crewDays = Math.round((hours / day) * 2) / 2; // half-day steps
  breakdown.push({ label: 'Recommendation', value: `${hours} crew-hours ≈ ${crewDays} crew-days (${day}-hour days)` });
  return { crewHours: hours, crewDays, breakdown };
}

export interface InstallRates {
  installCrewHourlyCents: number;
  installCrewDailyCents: number;
  installDayHours: number;
}

export interface InstallLineCalc {
  mode: 'HOURS' | 'DAYS';
  qtyMilli: number;
  rateCents: number;
  totalCents: number;
  equivalentHours: number;
  description: string;
  customerAssumptions: string[];
  formula: string;
}

/** Convert an amount between hourly and daily without changing the total unexpectedly. */
export function convertInstallAmount(amount: number, from: 'HOURS' | 'DAYS', to: 'HOURS' | 'DAYS', dayHours: number): number {
  if (from === to) return amount;
  const day = Math.max(1, dayHours);
  return from === 'HOURS' ? Math.round((amount / day) * 2) / 2 : Math.round(amount * day * 4) / 4;
}

export function buildInstallCustomerAssumptions(input: InstallInputs): string[] {
  const out: string[] = [];
  out.push(input.wallMounted && input.surfacesReady ? 'Interior signs mount to ready surfaces.' : 'Mounting surfaces to be made ready by others.');
  if (input.existingPosts && input.newPosts === 0) out.push('Exterior post signs use existing posts.');
  else if (input.newPosts > 0) out.push(`${input.newPosts} new post${input.newPosts === 1 ? '' : 's'} to be set.`);
  out.push(`Normal site access and ${input.mobilizations} mobilization${input.mobilizations === 1 ? '' : 's'}.`);
  if (input.liftRequired) out.push(`Lift required${input.equipment ? ` (${input.equipment})` : ''}.`);
  if (input.finalElectricalExcluded) out.push('Final electrical connection is excluded and must be completed by a licensed electrician.');
  else if (input.electricalScope !== 'NONE') out.push('Electrical connection included as described.');
  if (input.permitsAssumed === 'BY_CUSTOMER') out.push('Permits, if required, by the customer.');
  else if (input.permitsAssumed === 'INCLUDED') out.push('Permit handling included.');
  return [...out, ...input.customerAssumptions.filter((a) => a.trim())];
}

export function computeInstallLine(input: InstallInputs, rates: InstallRates, recommendation: InstallRecommendation | null): InstallLineCalc {
  const day = Math.max(1, rates.installDayHours);
  const mode = input.mode;
  const amount = input.amount !== null && Number.isFinite(input.amount) ? Math.max(0, input.amount) : recommendation ? (mode === 'DAYS' ? recommendation.crewDays : recommendation.crewHours) : 0;
  const rateCents = mode === 'DAYS' ? rates.installCrewDailyCents : rates.installCrewHourlyCents;
  const qtyMilli = Math.round(amount * 1000);
  const totalCents = computeLineCostCents({ qtyMilli, unitCostCents: rateCents });
  const equivalentHours = mode === 'DAYS' ? amount * day : amount;
  const unitLabel = mode === 'DAYS' ? `${day}-hour crew days` : 'crew hours';
  const assumptions = buildInstallCustomerAssumptions(input);
  const crew = `${input.crewSize}-person crew`;
  return {
    mode,
    qtyMilli,
    rateCents,
    totalCents,
    equivalentHours,
    description: `Installation labor for the complete sign package priced by ${unitLabel} (${crew}); ${assumptions.slice(0, 3).map((a) => a.replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase())).join('; ')}.`,
    customerAssumptions: assumptions,
    formula: mode === 'DAYS' ? `${amount} days × $${(rateCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })} per ${day}-hour day` : `${amount} hours × $${(rateCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })} per hour`,
  };
}
