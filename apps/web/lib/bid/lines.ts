// Persistence for bid lines: EstimateLineItem (money, ordering, customer
// description, qbItem, snapshot columns) + BidLineDetail (source, match,
// review status, explanation). Every write is tenant-scoped and joins the
// caller's transaction.

import {
  BidLineReviewStatus,
  BidMatchLevel,
  EstimateLineKind,
  PricingEngine,
  Prisma,
  type PrismaClient,
  type QbItem,
} from '@bvisible/db';
import type { PricedLine } from './price-line';
import type { MatchResult } from './match-standard-sign';
import type { BidPricingSnapshot, ExplanationStep, PricingSource } from './types';

type Db = Prisma.TransactionClient | PrismaClient;

/** Sort orders: sign lines 0..N, then design / installation / shipping at fixed high slots. */
export const BID_SORT = { DESIGN: 100_000, INSTALL: 100_010, SHIPPING: 100_020 } as const;

export const BID_SOURCE_KIND = {
  LINE: 'BID_LINE',
  DESIGN: 'BID_DESIGN',
  INSTALL: 'BID_INSTALL',
  MANUAL: 'BID_MANUAL',
} as const;

export interface BidLineSourceInfo {
  sourceFileId: string | null;
  sourceSheetName: string | null;
  sourceRowRef: string | null;
  sourceItem: string;
  sourceDescription: string | null;
  sourceQtyMilli: number;
  sourceUnit: string | null;
  sectionHeading: string | null;
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export interface CreateBidLineArgs {
  tenantId: string;
  estimateId: string;
  sortOrder: number;
  priced: PricedLine;
  match: MatchResult;
  source: BidLineSourceInfo;
  internalNotes?: string | null;
}

/** Create one sign line + its detail row from a priced candidate. Returns the line id. */
export async function createBidLine(db: Db, args: CreateBidLineArgs): Promise<string> {
  const { priced, match } = args;
  const line = await db.estimateLineItem.create({
    data: {
      tenantId: args.tenantId,
      estimateId: args.estimateId,
      sortOrder: args.sortOrder,
      kind: EstimateLineKind.MATERIAL,
      description: args.source.sourceItem.slice(0, 400),
      customerDescription: priced.customerDescription,
      qtyMilli: priced.billableQtyMilli,
      unitCostCents: priced.rateCents,
      computedCostCents: priced.totalCents,
      markupExempt: true,
      sourceKind: BID_SOURCE_KIND.LINE,
      qbItem: priced.qbItem,
      pricingEngine: priced.snapshot.engine === 'STANDARD_SIGN' ? PricingEngine.STANDARD_SIGN : PricingEngine.BID_RATE,
      pricingMethod: priced.pricingMethod,
      pricingInputsSnapshotJson: json(priced.snapshot),
      pricingOutputSnapshotJson: json({ totalCents: priced.totalCents, explanation: priced.explanation }),
      formulaVersion: priced.snapshot.formulaVersion,
      internalNotes: args.internalNotes ?? null,
      hiddenFromCustomer: false,
    },
    select: { id: true },
  });
  await db.bidLineDetail.create({
    data: {
      tenantId: args.tenantId,
      estimateId: args.estimateId,
      lineId: line.id,
      sourceFileId: args.source.sourceFileId,
      sourceSheetName: args.source.sourceSheetName,
      sourceRowRef: args.source.sourceRowRef,
      sourceItem: args.source.sourceItem,
      sourceDescription: args.source.sourceDescription,
      sourceQtyMilli: args.source.sourceQtyMilli,
      sourceUnit: args.source.sourceUnit,
      sectionHeading: args.source.sectionHeading,
      normalizedDescription: null,
      standardSignId: match.sign?.id ?? null,
      standardSignKey: match.sign?.signKey ?? null,
      matchLevel: match.level as BidMatchLevel,
      matchConfidenceMilli: match.confidenceMilli,
      reviewStatus: priced.reviewStatus as BidLineReviewStatus,
      pricingUnit: priced.pricingUnit,
      pricingSource: priced.pricingSource,
      explanationJson: json(priced.explanation),
    },
  });
  return line.id;
}

export interface RepriceBidLineArgs {
  tenantId: string;
  estimateId: string;
  lineId: string;
  priced: PricedLine;
  match: MatchResult | null;
  reviewStatus: BidLineReviewStatus;
  pricingSource?: PricingSource;
  explanationExtra?: ExplanationStep[];
  overrides?: Prisma.InputJsonValue | null;
  keepDescription?: boolean;
}

/** Update an existing line's money/snapshot/description from a fresh pricing pass. */
export async function applyPricedLine(db: Db, args: RepriceBidLineArgs): Promise<void> {
  const { priced } = args;
  const explanation = [...priced.explanation, ...(args.explanationExtra ?? [])];
  await db.estimateLineItem.update({
    where: { id: args.lineId, tenantId: args.tenantId },
    data: {
      ...(args.keepDescription ? {} : { customerDescription: priced.customerDescription }),
      qtyMilli: priced.billableQtyMilli,
      unitCostCents: priced.rateCents,
      computedCostCents: priced.totalCents,
      markupExempt: true,
      qbItem: priced.qbItem,
      pricingEngine: priced.snapshot.engine === 'STANDARD_SIGN' ? PricingEngine.STANDARD_SIGN : PricingEngine.BID_RATE,
      pricingMethod: priced.pricingMethod,
      pricingInputsSnapshotJson: json(priced.snapshot),
      pricingOutputSnapshotJson: json({ totalCents: priced.totalCents, explanation }),
      formulaVersion: priced.snapshot.formulaVersion,
      hiddenFromCustomer: args.reviewStatus === 'EXCLUDED',
    },
  });
  await db.bidLineDetail.update({
    where: { lineId: args.lineId },
    data: {
      standardSignId: args.match?.sign?.id ?? undefined,
      standardSignKey: args.match?.sign?.signKey ?? undefined,
      matchLevel: args.match ? (args.match.level as BidMatchLevel) : undefined,
      matchConfidenceMilli: args.match?.confidenceMilli,
      reviewStatus: args.reviewStatus,
      pricingUnit: priced.pricingUnit,
      pricingSource: args.pricingSource ?? priced.pricingSource,
      explanationJson: json(explanation),
      ...(args.overrides !== undefined ? { overridesJson: args.overrides === null ? Prisma.DbNull : args.overrides } : {}),
    },
  });
}

/** Set a project-specific / custom unit rate on a bid line (office decision, custom rate). */
export async function setBidLineRate(
  db: Db,
  args: {
    tenantId: string;
    estimateId: string;
    lineId: string;
    rateCents: number;
    pricingSource: 'OFFICE_DECISION' | 'CUSTOM_RATE';
    reviewStatus: BidLineReviewStatus;
    decision: { byUserId: string; at: Date; reason: string | null; projectSpecific: boolean; label: string };
    customerDescription?: string | null;
    qbItem?: QbItem | null;
    billableQtyMilli?: number | null;
  }
): Promise<{ oldRateCents: number; newRateCents: number; totalCents: number }> {
  const line = await db.estimateLineItem.findFirstOrThrow({
    where: { id: args.lineId, tenantId: args.tenantId, estimateId: args.estimateId },
    select: { qtyMilli: true, unitCostCents: true, pricingInputsSnapshotJson: true, pricingOutputSnapshotJson: true },
  });
  const qtyMilli = args.billableQtyMilli ?? line.qtyMilli;
  const totalCents = Math.round((qtyMilli * args.rateCents) / 1000);
  const prevSnapshot = (line.pricingInputsSnapshotJson ?? {}) as Partial<BidPricingSnapshot>;
  const prevOutput = (line.pricingOutputSnapshotJson ?? {}) as { explanation?: ExplanationStep[] };
  const explanation: ExplanationStep[] = [
    ...(prevOutput.explanation ?? []).filter((s) => s.label !== 'Total' && s.label !== 'Rate' && s.label !== 'Decision'),
    { label: 'Decision', value: args.decision.label, note: args.decision.reason ?? undefined },
    { label: 'Rate', value: `$${(args.rateCents / 100).toFixed(2)} (${args.decision.projectSpecific ? 'this project only' : 'company standard'})` },
    { label: 'Total', value: `${qtyMilli / 1000} × $${(args.rateCents / 100).toFixed(2)} = $${(totalCents / 100).toFixed(2)}` },
  ];
  const snapshot: Partial<BidPricingSnapshot> = {
    ...prevSnapshot,
    engine: prevSnapshot.engine ?? 'BID_RATE',
    pricingSource: args.pricingSource,
    rateSource: args.pricingSource === 'OFFICE_DECISION' ? 'OFFICE' : 'CUSTOM',
    rateCents: args.rateCents,
    billableQtyMilli: qtyMilli,
    projectSpecific: args.decision.projectSpecific,
    approvedById: args.decision.byUserId,
    approvedAt: args.decision.at.toISOString(),
    decisionReason: args.decision.reason,
    computedTotalCents: totalCents,
    markupExempt: true,
  };
  await db.estimateLineItem.update({
    where: { id: args.lineId, tenantId: args.tenantId },
    data: {
      qtyMilli,
      unitCostCents: args.rateCents,
      computedCostCents: totalCents,
      markupExempt: true,
      pricingEngine: PricingEngine.BID_RATE,
      pricingInputsSnapshotJson: json(snapshot),
      pricingOutputSnapshotJson: json({ totalCents, explanation }),
      hiddenFromCustomer: false,
      ...(args.customerDescription ? { customerDescription: args.customerDescription } : {}),
      ...(args.qbItem ? { qbItem: args.qbItem } : {}),
    },
  });
  await db.bidLineDetail.update({
    where: { lineId: args.lineId },
    data: {
      reviewStatus: args.reviewStatus,
      pricingSource: args.pricingSource,
      explanationJson: json(explanation),
      overridesJson: json({
        rateCents: args.rateCents,
        byUserId: args.decision.byUserId,
        at: args.decision.at.toISOString(),
        reason: args.decision.reason,
        projectSpecific: args.decision.projectSpecific,
      }),
    },
  });
  return { oldRateCents: line.unitCostCents, newRateCents: args.rateCents, totalCents };
}

/** Upsert the Design or Installation service line. */
export async function upsertServiceLine(
  db: Db,
  args: {
    tenantId: string;
    estimateId: string;
    existingLineId: string | null;
    kind: 'DESIGN' | 'INSTALL';
    qtyMilli: number;
    rateCents: number;
    totalCents: number;
    description: string;
    customerDescription: string;
    snapshot: Record<string, unknown>;
    explanation: ExplanationStep[];
    pricingUnit: string;
  }
): Promise<string> {
  const qbItem: QbItem = args.kind === 'DESIGN' ? 'DESIGN' : 'INSTALLATION';
  const data = {
    kind: args.kind === 'DESIGN' ? EstimateLineKind.DESIGN : EstimateLineKind.INSTALL,
    description: args.description.slice(0, 400),
    customerDescription: args.customerDescription,
    qtyMilli: args.qtyMilli,
    unitCostCents: args.rateCents,
    computedCostCents: args.totalCents,
    markupExempt: true,
    sourceKind: args.kind === 'DESIGN' ? BID_SOURCE_KIND.DESIGN : BID_SOURCE_KIND.INSTALL,
    qbItem,
    pricingEngine: PricingEngine.BID_RATE,
    pricingMethod: args.kind === 'DESIGN' ? 'PER_HOUR' : args.pricingUnit === 'DAY' ? 'PER_DAY' : 'PER_HOUR',
    pricingInputsSnapshotJson: json(args.snapshot),
    pricingOutputSnapshotJson: json({ totalCents: args.totalCents, explanation: args.explanation }),
    formulaVersion: 'bid-pricing-v1',
    hiddenFromCustomer: false,
  };
  if (args.existingLineId) {
    const existing = await db.estimateLineItem.findFirst({ where: { id: args.existingLineId, tenantId: args.tenantId, estimateId: args.estimateId }, select: { id: true } });
    if (existing) {
      await db.estimateLineItem.update({ where: { id: existing.id, tenantId: args.tenantId }, data });
      await db.bidLineDetail.updateMany({
        where: { lineId: existing.id, tenantId: args.tenantId },
        data: { reviewStatus: 'CONFIRMED', pricingUnit: args.pricingUnit, pricingSource: 'OPERATING_RATE', explanationJson: json(args.explanation), sourceQtyMilli: args.qtyMilli },
      });
      return existing.id;
    }
  }
  const line = await db.estimateLineItem.create({
    data: {
      tenantId: args.tenantId,
      estimateId: args.estimateId,
      sortOrder: args.kind === 'DESIGN' ? BID_SORT.DESIGN : BID_SORT.INSTALL,
      ...data,
    },
    select: { id: true },
  });
  await db.bidLineDetail.create({
    data: {
      tenantId: args.tenantId,
      estimateId: args.estimateId,
      lineId: line.id,
      sourceItem: args.kind === 'DESIGN' ? 'Design' : 'Installation',
      sourceQtyMilli: args.qtyMilli,
      matchLevel: 'NONE',
      matchConfidenceMilli: 0,
      reviewStatus: 'CONFIRMED',
      pricingUnit: args.pricingUnit,
      pricingSource: 'OPERATING_RATE',
      explanationJson: json(args.explanation),
    },
  });
  return line.id;
}

export async function removeServiceLine(db: Db, tenantId: string, estimateId: string, lineId: string | null): Promise<void> {
  if (!lineId) return;
  await db.estimateLineItem.deleteMany({ where: { id: lineId, tenantId, estimateId } });
}
