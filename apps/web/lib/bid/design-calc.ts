// Design (Step 5) — recommended hours are based on the SETUP work: unique
// templates, variable data, artwork condition, proofing rounds and
// production-file preparation. Never on total sign quantity alone. The
// estimator may override the hours; the rate is the live design rate.

import { computeLineCostCents } from '@bvisible/pricing';
import type { DesignInputs, ExplanationStep } from './types';

export const DEFAULT_DESIGN_INPUTS: DesignInputs = {
  uniqueLayouts: 0,
  variableDataSets: 0,
  startingFiles: 'EXISTING_TEMPLATES',
  variableData: 'CLEAN_SPREADSHEET',
  proofingRounds: 1,
  productionFiles: true,
  approvedHours: null,
  assumptions: [],
  internalNote: null,
};

/** Hours per unique layout by starting-file condition. */
const LAYOUT_HOURS: Record<DesignInputs['startingFiles'], number> = {
  EXISTING_TEMPLATES: 0.5,
  SOME_NEW_ARTWORK: 1.0,
  FROM_SCRATCH: 1.75,
};

/** Hours per variable-data set (room / unit lists) by data condition. */
const DATA_HOURS: Record<DesignInputs['variableData'], number> = {
  CLEAN_SPREADSHEET: 0.25,
  MANUAL_ENTRY: 0.75,
  NOT_SUPPLIED: 1.0,
};

const PROOF_ROUND_HOURS = 0.5;
const PRODUCTION_FILES_HOURS = 1.0;
const MINIMUM_HOURS = 1;

export interface DesignRecommendation {
  recommendedHours: number;
  breakdown: ExplanationStep[];
  assumptions: string[];
}

function round(h: number): number {
  return Math.round(h * 4) / 4;
}

export function recommendDesignHours(input: DesignInputs): DesignRecommendation {
  const layouts = Math.max(0, Math.floor(input.uniqueLayouts));
  const sets = Math.max(0, Math.floor(input.variableDataSets));
  const rounds = Math.max(0, Math.floor(input.proofingRounds));
  const breakdown: ExplanationStep[] = [];
  let hours = 0;

  const layoutHours = round(layouts * LAYOUT_HOURS[input.startingFiles]);
  hours += layoutHours;
  breakdown.push({ label: 'Unique layouts', value: `${layouts} × ${LAYOUT_HOURS[input.startingFiles]} h = ${layoutHours} h`, note: startingFilesLabel(input.startingFiles) });

  const dataHours = round(sets * DATA_HOURS[input.variableData]);
  hours += dataHours;
  breakdown.push({ label: 'Variable data', value: `${sets} set${sets === 1 ? '' : 's'} × ${DATA_HOURS[input.variableData]} h = ${dataHours} h`, note: variableDataLabel(input.variableData) });

  const proofHours = round(rounds * PROOF_ROUND_HOURS);
  hours += proofHours;
  breakdown.push({ label: 'Proofing & corrections', value: `${rounds} round${rounds === 1 ? '' : 's'} × ${PROOF_ROUND_HOURS} h = ${proofHours} h` });

  if (input.productionFiles) {
    hours += PRODUCTION_FILES_HOURS;
    breakdown.push({ label: 'Production files', value: `${PRODUCTION_FILES_HOURS} h`, note: 'Production-ready exports and file organization.' });
  }

  if (hours > 0 && hours < MINIMUM_HOURS) {
    breakdown.push({ label: 'Minimum', value: `${MINIMUM_HOURS} h` });
    hours = MINIMUM_HOURS;
  }
  const recommended = round(hours);

  const assumptions = [
    startingFilesAssumption(input.startingFiles),
    variableDataAssumption(input.variableData),
    `${rounds} proofing and correction ${rounds === 1 ? 'cycle' : 'cycles'} included.`,
    input.productionFiles ? 'Production exports and file organization included.' : 'Production-file preparation not included.',
  ];
  return { recommendedHours: recommended, breakdown, assumptions };
}

export interface DesignLineCalc {
  hoursMilli: number;
  rateCents: number;
  totalCents: number;
  description: string;
  assumptions: string[];
  recommendation: DesignRecommendation;
}

export function computeDesignLine(input: DesignInputs, designHourlyCents: number): DesignLineCalc {
  const recommendation = recommendDesignHours(input);
  const hours = input.approvedHours !== null && Number.isFinite(input.approvedHours) ? Math.max(0, input.approvedHours) : recommendation.recommendedHours;
  const hoursMilli = Math.round(hours * 1000);
  const totalCents = computeLineCostCents({ qtyMilli: hoursMilli, unitCostCents: designHourlyCents });
  const assumptions = [...recommendation.assumptions, ...input.assumptions.filter((a) => a.trim())];
  return {
    hoursMilli,
    rateCents: designHourlyCents,
    totalCents,
    description: 'Layout, variable-data setup, proofing, corrections, and production-ready file preparation.',
    assumptions,
    recommendation,
  };
}

export function startingFilesLabel(v: DesignInputs['startingFiles']): string {
  switch (v) {
    case 'EXISTING_TEMPLATES':
      return 'Existing templates';
    case 'SOME_NEW_ARTWORK':
      return 'Some new artwork';
    case 'FROM_SCRATCH':
      return 'Designed from scratch';
  }
}

export function variableDataLabel(v: DesignInputs['variableData']): string {
  switch (v) {
    case 'CLEAN_SPREADSHEET':
      return 'Clean spreadsheet supplied';
    case 'MANUAL_ENTRY':
      return 'Manual copy entry';
    case 'NOT_SUPPLIED':
      return 'Not yet supplied';
  }
}

function startingFilesAssumption(v: DesignInputs['startingFiles']): string {
  switch (v) {
    case 'EXISTING_TEMPLATES':
      return 'Existing templates will be used.';
    case 'SOME_NEW_ARTWORK':
      return 'Some new artwork will be created; existing templates reused where possible.';
    case 'FROM_SCRATCH':
      return 'All layouts will be designed from scratch.';
  }
}

function variableDataAssumption(v: DesignInputs['variableData']): string {
  switch (v) {
    case 'CLEAN_SPREADSHEET':
      return 'Room and unit data will be batch populated from the supplied spreadsheet.';
    case 'MANUAL_ENTRY':
      return 'Room and unit copy will be entered manually.';
    case 'NOT_SUPPLIED':
      return 'Room and unit data to be supplied by the customer before production.';
  }
}
