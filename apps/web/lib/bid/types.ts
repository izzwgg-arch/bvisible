// Shared pure types for the Bid Estimator. No Prisma, no React, no I/O —
// safe to import from tests, server modules, and client components.

import type { BidLineReviewStatus, BidMatchLevel, BidQuestionKind, QbItem } from '@bvisible/db';

export const BID_STEP_COUNT = 7;

export const BID_STEPS = [
  { step: 1, key: 'project', label: 'Project details' },
  { step: 2, key: 'sources', label: 'Upload files' },
  { step: 3, key: 'pricing', label: 'Review pricing' },
  { step: 4, key: 'questions', label: 'Ask the office' },
  { step: 5, key: 'design', label: 'Design' },
  { step: 6, key: 'installation', label: 'Installation' },
  { step: 7, key: 'final', label: 'Final review' },
] as const;

export type BidStep = (typeof BID_STEPS)[number]['step'];

export function isBidStep(value: unknown): value is BidStep {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= BID_STEP_COUNT;
}

/** How a standard sign / line is priced. */
export const PRICING_METHODS = [
  'PER_SIGN',
  'PER_SET',
  'PER_SQFT',
  'PER_CHARACTER',
  'PER_LINEAR_FT',
  'PER_HOUR',
  'PER_DAY',
] as const;
export type PricingMethod = (typeof PRICING_METHODS)[number];

export const PRICING_UNITS = ['SIGN', 'SET', 'SQ_FT', 'CHARACTER', 'LINEAR_FT', 'HOUR', 'DAY', 'EACH'] as const;
export type PricingUnit = (typeof PRICING_UNITS)[number];

export const PRICING_UNIT_FOR_METHOD: Record<PricingMethod, PricingUnit> = {
  PER_SIGN: 'SIGN',
  PER_SET: 'SET',
  PER_SQFT: 'SQ_FT',
  PER_CHARACTER: 'CHARACTER',
  PER_LINEAR_FT: 'LINEAR_FT',
  PER_HOUR: 'HOUR',
  PER_DAY: 'DAY',
};

export function pricingUnitLabel(unit: PricingUnit | string | null | undefined, qty = 2): string {
  const one = qty === 1;
  switch (unit) {
    case 'SIGN':
      return one ? 'sign' : 'signs';
    case 'SET':
      return one ? 'set' : 'sets';
    case 'SQ_FT':
      return 'sq ft';
    case 'CHARACTER':
      return one ? 'character' : 'characters';
    case 'LINEAR_FT':
      return 'linear ft';
    case 'HOUR':
      return one ? 'hour' : 'hours';
    case 'DAY':
      return one ? 'day' : 'days';
    case 'EACH':
    default:
      return one ? 'each' : 'each';
  }
}

export function pricingMethodLabel(method: PricingMethod | string | null | undefined): string {
  switch (method) {
    case 'PER_SIGN':
      return 'per sign';
    case 'PER_SET':
      return 'per set';
    case 'PER_SQFT':
      return 'per square foot';
    case 'PER_CHARACTER':
      return 'per character';
    case 'PER_LINEAR_FT':
      return 'per linear foot';
    case 'PER_HOUR':
      return 'per hour';
    case 'PER_DAY':
      return 'per day';
    default:
      return 'per unit';
  }
}

export function isPricingMethod(value: unknown): value is PricingMethod {
  return typeof value === 'string' && (PRICING_METHODS as readonly string[]).includes(value);
}

/** Where a line's rate came from. */
export const PRICING_SOURCES = [
  'STANDARD_SIGN',
  'SHEET_SQFT',
  'OFFICE_DECISION',
  'CUSTOM_RATE',
  'OPERATING_RATE',
  'SOURCE_PRICE',
  'UNPRICED',
] as const;
export type PricingSource = (typeof PRICING_SOURCES)[number];

/** One reviewable step of a calculation explanation. */
export interface ExplanationStep {
  label: string;
  value: string;
  /** Optional plain-English note ("converted set to character count"). */
  note?: string;
}

/**
 * Snapshot saved on EstimateLineItem.pricingInputsSnapshotJson for every
 * priced bid line. Editing the Sheet or a standard sign later never
 * changes a saved estimate — repricing is an explicit, audited action.
 */
export interface BidPricingSnapshot {
  engine: 'STANDARD_SIGN' | 'BID_RATE';
  formulaVersion: string;
  pricingMethod: PricingMethod;
  pricingUnit: PricingUnit;
  pricingSource: PricingSource;
  standardSignKey: string | null;
  standardSignId: string | null;
  sheetItemKey: string | null;
  sheetTab: string | null;
  sheetRow: number | null;
  sheetSyncedAt: string | null;
  rateSource: 'SHEET' | 'OVERRIDE' | 'SIGN_LITERAL' | 'OFFICE' | 'CUSTOM' | 'OPERATING_RATE' | 'SOURCE' | 'NONE';
  rateCents: number;
  minimumChargeCents: number | null;
  minimumApplied: boolean;
  wastePercentMilli: number | null;
  markupExempt: true;
  sourceQtyMilli: number;
  billableQtyMilli: number;
  dimensions: { widthIn: number | null; heightIn: number | null } | null;
  characterCount: number | null;
  wording: string | null;
  projectSpecific: boolean;
  approvedById: string | null;
  approvedAt: string | null;
  decisionReason: string | null;
  computedTotalCents: number;
}

export const BID_FORMULA_VERSION = 'bid-pricing-v1';

/** Office-question choice as stored in bid_questions.choicesJson. */
export interface BidQuestionChoice {
  key: string;
  label: string;
  detail?: string;
  rateCents?: number;
  totalCents?: number;
  standardSignKey?: string;
  standardSignId?: string;
  pricingMethod?: PricingMethod;
  qbItem?: QbItem;
  /** True for the "enter another rate" path. */
  custom?: boolean;
}

export interface BidQuestionDraft {
  kind: BidQuestionKind;
  title: string;
  sourceRef: string | null;
  sourceText: string | null;
  systemFound: string | null;
  whyUnsafe: string | null;
  whyMatters: string | null;
  choices: BidQuestionChoice[];
}

/** Status color vocabulary (green / yellow / blue / red / gray). */
export type BidTone = 'green' | 'yellow' | 'blue' | 'red' | 'gray';

export function reviewStatusTone(status: BidLineReviewStatus): BidTone {
  switch (status) {
    case 'AUTO_PRICED':
    case 'CONFIRMED':
      return 'green';
    case 'NEEDS_REVIEW':
      return 'yellow';
    case 'OFFICE_QUESTION':
      return 'blue';
    case 'BLOCKED':
      return 'red';
    case 'PENDING':
    case 'EXCLUDED':
    default:
      return 'gray';
  }
}

export function reviewStatusLabel(status: BidLineReviewStatus): string {
  switch (status) {
    case 'AUTO_PRICED':
      return 'Auto-priced';
    case 'CONFIRMED':
      return 'Confirmed';
    case 'NEEDS_REVIEW':
      return 'Check';
    case 'OFFICE_QUESTION':
      return 'Office question';
    case 'BLOCKED':
      return 'Blocked';
    case 'EXCLUDED':
      return 'Excluded';
    case 'PENDING':
    default:
      return 'Pending';
  }
}

export function matchLevelLabel(level: BidMatchLevel): string {
  switch (level) {
    case 'EXACT':
      return 'Exact match';
    case 'PROBABLE':
      return 'Probable match';
    case 'AMBIGUOUS':
      return 'Several possible matches';
    case 'NONE':
    default:
      return 'No standard sign';
  }
}

/** Design calculator inputs (Step 5), stored as designInputsJson. */
export interface DesignInputs {
  uniqueLayouts: number;
  variableDataSets: number;
  /** 'EXISTING_TEMPLATES' | 'SOME_NEW_ARTWORK' | 'FROM_SCRATCH' */
  startingFiles: 'EXISTING_TEMPLATES' | 'SOME_NEW_ARTWORK' | 'FROM_SCRATCH';
  /** 'CLEAN_SPREADSHEET' | 'MANUAL_ENTRY' | 'NOT_SUPPLIED' */
  variableData: 'CLEAN_SPREADSHEET' | 'MANUAL_ENTRY' | 'NOT_SUPPLIED';
  proofingRounds: number;
  /** Production-ready exports + file organization included. */
  productionFiles: boolean;
  /** Approved hours (estimator may override the recommendation). */
  approvedHours: number | null;
  assumptions: string[];
  internalNote: string | null;
}

/** Installation calculator inputs (Step 6), stored as installInputsJson. */
export interface InstallInputs {
  mode: 'HOURS' | 'DAYS';
  /** Entered amount in the selected mode (hours or days). */
  amount: number | null;
  crewSize: number;
  travelHours: number;
  mobilizations: number;
  buildings: number;
  floors: number;
  siteMovement: 'LOW' | 'NORMAL' | 'HIGH';
  liftRequired: boolean;
  equipment: string | null;
  existingPosts: boolean;
  newPosts: number;
  wallMounted: boolean;
  surfacesReady: boolean;
  electricalScope: 'NONE' | 'LOW_VOLTAGE_ONLY' | 'ELECTRICIAN_REQUIRED';
  finalElectricalExcluded: boolean;
  permitsAssumed: 'BY_CUSTOMER' | 'INCLUDED' | 'NOT_APPLICABLE';
  customerAssumptions: string[];
  internalNote: string | null;
}
