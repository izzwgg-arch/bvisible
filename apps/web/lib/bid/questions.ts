// Office questions: persistence of drafts produced by the pricing engine,
// and applying an answer to the affected line (recalculate, snapshot,
// audit metadata). Project-scoped answers touch only this estimate;
// PERMANENT answers additionally promote a standard sign / alias (admin
// only — the server action gates the role, this module records it).

import { BidDecisionScope, BidQuestionStatus, Prisma, prisma, type PrismaClient, type QbItem, StandardSignSource } from '@bvisible/db';
import { computeLineCostCents } from '@bvisible/pricing';
import type { BidPricingContext } from './catalog';
import { applyPricedLine, setBidLineRate } from './lines';
import { matchStandardSign, type CatalogSign, type MatchResult } from './match-standard-sign';
import { priceBidLine } from './price-line';
import { normalizeSignText } from './text-extract';
import { normalizeSignKey } from '@/lib/sheet-sync/parse-standard-signs';
import { recomputeEstimateTotals } from '@/lib/estimate/recompute-estimate-totals';
import type { BidQuestionChoice, BidQuestionDraft } from './types';

type Db = Prisma.TransactionClient | PrismaClient;

function json(v: unknown): Prisma.InputJsonValue {
  return v as Prisma.InputJsonValue;
}

export async function persistQuestionDrafts(
  db: Db,
  args: { tenantId: string; estimateId: string; lineId: string | null; drafts: ReadonlyArray<BidQuestionDraft> }
): Promise<string[]> {
  const ids: string[] = [];
  const base = await db.bidQuestion.count({ where: { tenantId: args.tenantId, estimateId: args.estimateId } });
  let i = 0;
  for (const d of args.drafts) {
    const row = await db.bidQuestion.create({
      data: {
        tenantId: args.tenantId,
        estimateId: args.estimateId,
        lineId: args.lineId,
        kind: d.kind,
        status: 'OPEN',
        title: d.title.slice(0, 300),
        sourceRef: d.sourceRef?.slice(0, 300) ?? null,
        sourceText: d.sourceText,
        systemFound: d.systemFound,
        whyUnsafe: d.whyUnsafe,
        whyMatters: d.whyMatters,
        choicesJson: json(d.choices),
        sortOrder: base + i,
      },
      select: { id: true },
    });
    ids.push(row.id);
    i += 1;
  }
  return ids;
}

export interface CustomAnswer {
  rateCents?: number | null;
  description?: string | null;
  qbItem?: QbItem | null;
  widthIn?: number | null;
  heightIn?: number | null;
  wording?: string | null;
  characterCount?: number | null;
  billableQty?: number | null;
  standardSignKey?: string | null;
}

export interface AnswerQuestionArgs {
  tenantId: string;
  estimateId: string;
  questionId: string;
  choiceKey: string;
  custom: CustomAnswer | null;
  note: string | null;
  scope: BidDecisionScope;
  actorId: string;
  /** True when the caller verified the actor may change permanent pricing. */
  canPromote: boolean;
  context: BidPricingContext;
}

export interface AnswerQuestionResult {
  ok: boolean;
  error: string | null;
  lineId: string | null;
  oldRateCents: number | null;
  newRateCents: number | null;
  totalCents: number | null;
  promotedStandardSignId: string | null;
}

/** Re-run the deterministic pricing for a line with a forced sign / supplied facts. */
async function repriceWithSign(
  db: Db,
  args: {
    tenantId: string;
    estimateId: string;
    lineId: string;
    sign: CatalogSign;
    context: BidPricingContext;
    supplied: CustomAnswer | null;
    decisionLabel: string;
    actorId: string;
    note: string | null;
    projectSpecific: boolean;
  }
): Promise<{ oldRateCents: number; newRateCents: number; totalCents: number }> {
  const detail = await db.bidLineDetail.findFirstOrThrow({
    where: { lineId: args.lineId, tenantId: args.tenantId },
    include: { line: { select: { unitCostCents: true, description: true } } },
  });
  // Build a description that carries the supplied facts so extraction sees them.
  const supplement: string[] = [];
  if (args.supplied?.widthIn && args.supplied?.heightIn) supplement.push(`${args.supplied.widthIn}" x ${args.supplied.heightIn}"`);
  if (args.supplied?.wording) supplement.push(`"${args.supplied.wording}"`);
  const description = [detail.sourceDescription ?? '', ...supplement].filter(Boolean).join(' — ') || null;
  const base = matchStandardSign({ name: detail.sourceItem ?? detail.line.description, description }, args.context.catalog);
  const forced: MatchResult = {
    ...base,
    level: 'EXACT',
    sign: args.sign,
    confidenceMilli: 1000,
    conflicts: [],
    missingCritical: [],
    evidence: [`Office decision: use standard sign "${args.sign.name}".`, ...base.evidence],
  };
  if (args.supplied?.characterCount && args.supplied.characterCount > 0 && forced.extracted.wording.characterCount === 0) {
    forced.extracted = { ...forced.extracted, wording: { text: args.supplied.wording ?? '', characterCount: args.supplied.characterCount, source: 'QUOTED' } };
  }
  const priced = priceBidLine({
    candidate: {
      name: detail.sourceItem ?? detail.line.description,
      description,
      qty: detail.sourceQtyMilli / 1000,
      unit: detail.sourceUnit,
      costCents: null,
      priceCents: null,
      priceConflict: false,
      sectionHeading: detail.sectionHeading,
    },
    match: forced,
    sources: args.context.sources,
    sourceRef: detail.sourceRowRef,
  });
  // The office chose the sign, so a project-price question must not re-open here.
  const finalPriced = { ...priced, questions: [], reviewStatus: priced.priced ? ('CONFIRMED' as const) : ('OFFICE_QUESTION' as const) };
  if (args.supplied?.rateCents && args.supplied.rateCents > 0) {
    // Sign chosen + custom rate: rate is the decision, everything else from the rule.
    finalPriced.rateCents = args.supplied.rateCents;
    finalPriced.totalCents = computeLineCostCents({ qtyMilli: finalPriced.billableQtyMilli, unitCostCents: args.supplied.rateCents });
    finalPriced.pricingSource = 'OFFICE_DECISION';
    finalPriced.snapshot = { ...finalPriced.snapshot, pricingSource: 'OFFICE_DECISION', rateSource: 'OFFICE', rateCents: args.supplied.rateCents, computedTotalCents: finalPriced.totalCents, projectSpecific: args.projectSpecific, approvedById: args.actorId, approvedAt: new Date().toISOString(), decisionReason: args.note };
    finalPriced.explanation = [...finalPriced.explanation.filter((s) => s.label !== 'Total'), { label: 'Decision', value: `Rate set to $${(args.supplied.rateCents / 100).toFixed(2)} by the office`, note: args.note ?? undefined }, { label: 'Total', value: `${finalPriced.billableQtyMilli / 1000} × $${(args.supplied.rateCents / 100).toFixed(2)} = $${(finalPriced.totalCents / 100).toFixed(2)}` }];
    finalPriced.priced = true;
    finalPriced.reviewStatus = 'CONFIRMED';
  }
  await applyPricedLine(db, {
    tenantId: args.tenantId,
    estimateId: args.estimateId,
    lineId: args.lineId,
    priced: finalPriced,
    match: forced,
    reviewStatus: finalPriced.reviewStatus,
    explanationExtra: [{ label: 'Decision', value: args.decisionLabel, note: args.note ?? undefined }],
    overrides: json({ standardSignKey: args.sign.signKey, byUserId: args.actorId, at: new Date().toISOString(), reason: args.note, projectSpecific: args.projectSpecific }),
    keepDescription: !!args.supplied?.description,
  });
  if (args.supplied?.description) {
    await db.estimateLineItem.update({ where: { id: args.lineId, tenantId: args.tenantId }, data: { customerDescription: args.supplied.description } });
  }
  return { oldRateCents: detail.line.unitCostCents, newRateCents: finalPriced.rateCents, totalCents: finalPriced.totalCents };
}

/** Promote a project decision to a permanent standard sign (source = APP). Idempotent by signKey; never duplicates a name. */
export async function promoteStandardSign(
  db: Db,
  args: {
    tenantId: string;
    actorId: string;
    name: string;
    aliasFor: string | null;
    rateCents: number | null;
    customerDescription: string | null;
    qbItem: QbItem | null;
    baseSign: CatalogSign | null;
  }
): Promise<{ id: string; created: boolean; aliasAdded: boolean }> {
  const norm = normalizeSignText(args.name);
  const existingByName = await db.standardSign.findFirst({ where: { tenantId: args.tenantId, OR: [{ nameNormalized: norm }, { aliases: { has: args.name } }] } });
  if (args.baseSign) {
    // Decision confirms an existing sign under a new wording → add an alias so future imports match automatically.
    const row = await db.standardSign.findFirst({ where: { tenantId: args.tenantId, signKey: args.baseSign.signKey } });
    if (row) {
      const alias = args.aliasFor?.trim();
      const aliasAdded = !!alias && !row.aliases.some((a) => normalizeSignText(a) === normalizeSignText(alias)) && row.nameNormalized !== normalizeSignText(alias);
      if (aliasAdded || (args.rateCents && args.rateCents !== row.rateCents)) {
        await db.standardSign.update({
          where: { id: row.id },
          data: {
            aliases: aliasAdded ? [...row.aliases, alias!] : row.aliases,
            ...(args.rateCents && args.rateCents > 0 ? { rateCents: args.rateCents, rateKey: String((args.rateCents / 100).toFixed(2)) } : {}),
            source: row.source === StandardSignSource.SHEET ? StandardSignSource.SHEET : StandardSignSource.APP,
          },
        });
      }
      return { id: row.id, created: false, aliasAdded };
    }
  }
  if (existingByName) {
    if (args.rateCents && args.rateCents > 0 && existingByName.rateCents !== args.rateCents && existingByName.source === StandardSignSource.APP) {
      await db.standardSign.update({ where: { id: existingByName.id }, data: { rateCents: args.rateCents, rateKey: (args.rateCents / 100).toFixed(2) } });
    }
    return { id: existingByName.id, created: false, aliasAdded: false };
  }
  let signKey = normalizeSignKey(args.name) || `sign-${Date.now()}`;
  const clash = await db.standardSign.findFirst({ where: { tenantId: args.tenantId, signKey } });
  if (clash) signKey = `${signKey}-${Date.now().toString(36)}`.slice(0, 120);
  const created = await db.standardSign.create({
    data: {
      tenantId: args.tenantId,
      signKey,
      source: StandardSignSource.APP,
      active: true,
      name: args.name.slice(0, 400),
      nameNormalized: norm.slice(0, 400),
      qbItem: args.qbItem ?? 'SALES',
      customerDescription: args.customerDescription,
      pricingMethod: 'PER_SIGN',
      pricingUnit: 'SIGN',
      rateKey: args.rateCents && args.rateCents > 0 ? (args.rateCents / 100).toFixed(2) : null,
      rateCents: args.rateCents && args.rateCents > 0 ? args.rateCents : null,
      aliases: args.aliasFor && normalizeSignText(args.aliasFor) !== norm ? [args.aliasFor] : [],
      createdById: args.actorId,
    },
    select: { id: true },
  });
  return { id: created.id, created: true, aliasAdded: false };
}

export async function answerBidQuestion(args: AnswerQuestionArgs): Promise<AnswerQuestionResult> {
  const question = await prisma.bidQuestion.findFirst({
    where: { id: args.questionId, tenantId: args.tenantId, estimateId: args.estimateId },
    include: { line: { select: { id: true, unitCostCents: true, qtyMilli: true, description: true, customerDescription: true, qbItem: true } } },
  });
  if (!question) return { ok: false, error: 'Question not found.', lineId: null, oldRateCents: null, newRateCents: null, totalCents: null, promotedStandardSignId: null };
  const choices = (question.choicesJson as unknown as BidQuestionChoice[]) ?? [];
  const choice = choices.find((c) => c.key === args.choiceKey) ?? null;
  if (!choice && args.choiceKey !== 'custom') return { ok: false, error: 'That choice is no longer available.', lineId: question.lineId, oldRateCents: null, newRateCents: null, totalCents: null, promotedStandardSignId: null };
  const custom = args.custom;
  const wantsPermanent = args.scope === BidDecisionScope.PERMANENT;
  if (wantsPermanent && !args.canPromote) {
    return { ok: false, error: 'Only an administrator can save a permanent pricing rule. Answer for this project only, or ask an admin.', lineId: question.lineId, oldRateCents: null, newRateCents: null, totalCents: null, promotedStandardSignId: null };
  }
  const now = new Date();
  let outcome: { oldRateCents: number; newRateCents: number; totalCents: number } | null = null;
  let promotedId: string | null = null;

  await prisma.$transaction(async (tx) => {
    const line = question.line;
    if (line) {
      const signKey = custom?.standardSignKey ?? choice?.standardSignKey ?? null;
      const chosenSign = signKey ? args.context.catalog.signs.find((s) => s.signKey === signKey) ?? null : null;

      if (args.choiceKey === 'exclude') {
        await tx.estimateLineItem.update({ where: { id: line.id, tenantId: args.tenantId }, data: { hiddenFromCustomer: true, unitCostCents: 0, computedCostCents: 0 } });
        await tx.bidLineDetail.update({ where: { lineId: line.id }, data: { reviewStatus: 'EXCLUDED', pricingSource: 'UNPRICED', explanationJson: json([{ label: 'Decision', value: 'Excluded — not a sign line', note: args.note ?? undefined }]) } });
        outcome = { oldRateCents: line.unitCostCents, newRateCents: 0, totalCents: 0 };
      } else if (chosenSign) {
        outcome = await repriceWithSign(tx, {
          tenantId: args.tenantId,
          estimateId: args.estimateId,
          lineId: line.id,
          sign: chosenSign,
          context: args.context,
          supplied: custom,
          decisionLabel: `Use standard sign "${chosenSign.name}"`,
          actorId: args.actorId,
          note: args.note,
          projectSpecific: !wantsPermanent,
        });
        if (wantsPermanent) {
          const promoted = await promoteStandardSign(tx, { tenantId: args.tenantId, actorId: args.actorId, name: chosenSign.name, aliasFor: question.line?.description ?? null, rateCents: custom?.rateCents ?? null, customerDescription: null, qbItem: null, baseSign: chosenSign });
          promotedId = promoted.id;
        }
      } else if (question.kind === 'SIZE' || question.kind === 'MISSING_SPEC') {
        // Supply the missing fact and re-run the rule with the already-matched sign.
        const detail = await tx.bidLineDetail.findFirstOrThrow({ where: { lineId: line.id, tenantId: args.tenantId } });
        const matched = detail.standardSignKey ? args.context.catalog.signs.find((s) => s.signKey === detail.standardSignKey) ?? null : null;
        if (!matched) throw new Error('This line has no standard sign to price with — choose a sign or enter a custom rate.');
        if (!custom || (question.kind === 'SIZE' && !(custom.widthIn && custom.heightIn)) || (question.kind === 'MISSING_SPEC' && !(custom.wording || custom.characterCount))) {
          throw new Error('Enter the missing size or wording to answer this question.');
        }
        outcome = await repriceWithSign(tx, {
          tenantId: args.tenantId,
          estimateId: args.estimateId,
          lineId: line.id,
          sign: matched,
          context: args.context,
          supplied: custom,
          decisionLabel: question.kind === 'SIZE' ? `Size supplied: ${custom.widthIn}" × ${custom.heightIn}"` : `Wording supplied: “${custom.wording ?? `${custom.characterCount} characters`}”`,
          actorId: args.actorId,
          note: args.note,
          projectSpecific: true,
        });
      } else {
        // Rate decisions: rule / source / custom (PROJECT_PRICE, RATE, STANDARD_SIGN custom, ...).
        const rateCents = args.choiceKey === 'custom' || choice?.custom ? custom?.rateCents ?? null : choice?.rateCents ?? null;
        if (rateCents === null || !Number.isFinite(rateCents) || rateCents < 0) throw new Error('Enter the approved rate.');
        const isRule = args.choiceKey === 'rule';
        outcome = await setBidLineRate(tx, {
          tenantId: args.tenantId,
          estimateId: args.estimateId,
          lineId: line.id,
          rateCents,
          pricingSource: isRule ? 'OFFICE_DECISION' : args.choiceKey === 'custom' || choice?.custom ? 'CUSTOM_RATE' : 'OFFICE_DECISION',
          reviewStatus: 'CONFIRMED',
          decision: { byUserId: args.actorId, at: now, reason: args.note, projectSpecific: !wantsPermanent, label: isRule ? 'Use current pricing rule' : choice?.detail ?? 'Custom approved rate' },
          customerDescription: custom?.description ?? null,
          qbItem: custom?.qbItem ?? choice?.qbItem ?? null,
          billableQtyMilli: custom?.billableQty && custom.billableQty > 0 ? Math.round(custom.billableQty * 1000) : null,
        });
        if (wantsPermanent && !isRule) {
          const promoted = await promoteStandardSign(tx, {
            tenantId: args.tenantId,
            actorId: args.actorId,
            name: line.description,
            aliasFor: null,
            rateCents,
            customerDescription: custom?.description ?? line.customerDescription,
            qbItem: custom?.qbItem ?? line.qbItem,
            baseSign: null,
          });
          promotedId = promoted.id;
        }
      }
    }
    await tx.bidQuestion.update({
      where: { id: question.id },
      data: {
        status: BidQuestionStatus.ANSWERED,
        answerKey: args.choiceKey.slice(0, 80),
        answerValueJson: custom ? json(custom) : Prisma.DbNull,
        answerNote: args.note,
        answerScope: args.scope,
        answeredById: args.actorId,
        answeredAt: now,
        promotedStandardSignId: promotedId,
      },
    });
    // Sibling open questions on the same line about the same decision are superseded.
    if (question.lineId && (question.kind === 'STANDARD_SIGN' || args.choiceKey === 'exclude')) {
      await tx.bidQuestion.updateMany({ where: { tenantId: args.tenantId, lineId: question.lineId, status: 'OPEN', id: { not: question.id } }, data: { status: 'DISMISSED' } });
    }
    await recomputeEstimateTotals(tx, args.tenantId, args.estimateId);
  });

  const o = outcome as { oldRateCents: number; newRateCents: number; totalCents: number } | null;
  return { ok: true, error: null, lineId: question.lineId, oldRateCents: o?.oldRateCents ?? null, newRateCents: o?.newRateCents ?? null, totalCents: o?.totalCents ?? null, promotedStandardSignId: promotedId };
}
