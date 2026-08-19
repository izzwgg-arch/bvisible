// Zod schemas for every Bid Estimator server action payload. Same
// conventions as lib/validators.ts (trim, bounded lengths, cuid ids).

import { z } from 'zod';
import { BidDecisionScope, BidSourceRole, QbItem } from '@bvisible/db';
import { BID_STEP_COUNT, type BidStep } from './types';

const cuid = z.string().trim().min(1).max(64);
const short = (n: number) => z.string().trim().max(n).nullable().optional();
const money = z.number().int().min(0).max(1_000_000_000); // cents
const qty = z.number().min(0).max(1_000_000);

export const bidStepSchema = z.number().int().min(1).max(BID_STEP_COUNT).transform((n) => n as BidStep);

export const createBidEstimateSchema = z.object({
  clientId: cuid,
  projectName: z.string().trim().min(1, 'Project name is required.').max(200),
  salesRepId: cuid.nullable().optional(),
});

export const designInputsSchema = z.object({
  uniqueLayouts: z.number().int().min(0).max(10_000),
  variableDataSets: z.number().int().min(0).max(10_000),
  startingFiles: z.enum(['EXISTING_TEMPLATES', 'SOME_NEW_ARTWORK', 'FROM_SCRATCH']),
  variableData: z.enum(['CLEAN_SPREADSHEET', 'MANUAL_ENTRY', 'NOT_SUPPLIED']),
  proofingRounds: z.number().int().min(0).max(20),
  productionFiles: z.boolean(),
  approvedHours: z.number().min(0).max(10_000).nullable(),
  assumptions: z.array(z.string().trim().max(300)).max(20),
  internalNote: z.string().trim().max(2000).nullable(),
});

export const installInputsSchema = z.object({
  mode: z.enum(['HOURS', 'DAYS']),
  amount: z.number().min(0).max(100_000).nullable(),
  crewSize: z.number().int().min(1).max(20),
  travelHours: z.number().min(0).max(1000),
  mobilizations: z.number().int().min(1).max(100),
  buildings: z.number().int().min(1).max(500),
  floors: z.number().int().min(1).max(500),
  siteMovement: z.enum(['LOW', 'NORMAL', 'HIGH']),
  liftRequired: z.boolean(),
  equipment: z.string().trim().max(200).nullable(),
  existingPosts: z.boolean(),
  newPosts: z.number().int().min(0).max(10_000),
  wallMounted: z.boolean(),
  surfacesReady: z.boolean(),
  electricalScope: z.enum(['NONE', 'LOW_VOLTAGE_ONLY', 'ELECTRICIAN_REQUIRED']),
  finalElectricalExcluded: z.boolean(),
  permitsAssumed: z.enum(['BY_CUSTOMER', 'INCLUDED', 'NOT_APPLICABLE']),
  customerAssumptions: z.array(z.string().trim().max(300)).max(20),
  internalNote: z.string().trim().max(2000).nullable(),
});

export const saveBidWorkflowSchema = z.object({
  estimateId: cuid,
  expectedVersion: z.number().int().min(1),
  patch: z.object({
    currentStep: bidStepSchema.optional(),
    completedSteps: z.array(bidStepSchema).max(BID_STEP_COUNT).optional(),
    projectName: short(200),
    projectAddress: short(500),
    projectContactName: short(200),
    projectContactEmail: short(254),
    projectContactPhone: short(60),
    poNumber: short(80),
    customerReference: short(120),
    bidSource: short(80),
    dueDate: short(40),
    bidDeadline: short(40),
    internalNotes: short(4000),
    designInputs: designInputsSchema.optional(),
    installInputs: installInputsSchema.optional(),
  }),
});

export const uploadBidSourceMetaSchema = z.object({
  estimateId: cuid,
  role: z.nativeEnum(BidSourceRole).optional(),
  note: z.string().trim().max(500).optional(),
  /// When set, the upload is a revision of that file (previous stays on record).
  supersedesId: cuid.optional(),
  makeCurrentTakeoff: z.boolean().optional(),
});

export const reprocessBidSourceSchema = z.object({
  estimateId: cuid,
  fileId: cuid,
  preferredTab: z.string().trim().max(200).nullable().optional(),
});

export const setCurrentTakeoffSchema = z.object({ estimateId: cuid, fileId: cuid });

export const answerBidQuestionSchema = z.object({
  estimateId: cuid,
  questionId: cuid,
  choiceKey: z.string().trim().min(1).max(80),
  note: z.string().trim().max(1000).nullable().optional(),
  scope: z.nativeEnum(BidDecisionScope).default(BidDecisionScope.PROJECT),
  custom: z
    .object({
      rateCents: money.nullable().optional(),
      description: z.string().trim().max(1000).nullable().optional(),
      qbItem: z.nativeEnum(QbItem).nullable().optional(),
      widthIn: z.number().min(0).max(2000).nullable().optional(),
      heightIn: z.number().min(0).max(2000).nullable().optional(),
      wording: z.string().trim().max(200).nullable().optional(),
      characterCount: z.number().int().min(0).max(10_000).nullable().optional(),
      billableQty: qty.nullable().optional(),
      standardSignKey: z.string().trim().max(120).nullable().optional(),
    })
    .nullable()
    .optional(),
});

export const confirmBidLineSchema = z.object({ estimateId: cuid, lineId: cuid });

export const setBidLineOverrideSchema = z.object({
  estimateId: cuid,
  lineId: cuid,
  rateCents: money.nullable().optional(),
  billableQty: qty.nullable().optional(),
  customerDescription: z.string().trim().max(1000).nullable().optional(),
  qbItem: z.nativeEnum(QbItem).nullable().optional(),
  reason: z.string().trim().max(500).nullable().optional(),
});

export const addManualBidLineSchema = z.object({
  estimateId: cuid,
  name: z.string().trim().min(1).max(200),
  customerDescription: z.string().trim().min(1).max(1000),
  qty: qty.refine((v) => v > 0, 'Quantity must be greater than zero.'),
  rateCents: money,
  qbItem: z.nativeEnum(QbItem),
  unit: z.string().trim().max(30).optional(),
});

export const excludeBidLineSchema = z.object({ estimateId: cuid, lineId: cuid, reason: z.string().trim().max(500).nullable().optional() });

export const saveDesignSchema = z.object({ estimateId: cuid, included: z.boolean(), inputs: designInputsSchema });
export const saveInstallSchema = z.object({ estimateId: cuid, included: z.boolean(), inputs: installInputsSchema });

export const applyRepriceSchema = z.object({ estimateId: cuid, lineIds: z.array(cuid).min(1).max(500) });
export const estimateIdSchema = z.object({ estimateId: cuid });

export type SaveBidWorkflowInput = z.infer<typeof saveBidWorkflowSchema>;
export type AnswerBidQuestionInput = z.infer<typeof answerBidQuestionSchema>;
export type SaveDesignInput = z.infer<typeof saveDesignSchema>;
export type SaveInstallInput = z.infer<typeof saveInstallSchema>;
