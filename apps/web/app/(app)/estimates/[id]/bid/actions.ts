'use server';

// Bid Estimator server actions. Every action: requireTenantId() → zod →
// tenant-scoped lookup of the BID estimate → work → audit (for meaningful
// decisions only — autosave keystrokes are never audited) → revalidate.

import { revalidatePath } from 'next/cache';
import { BidDecisionScope, BidSourceStatus, EstimateStatus, EstimateType, Prisma, prisma, Role } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { writeAuditLog } from '@/lib/auth/audit';
import { readRequestContext } from '@/lib/request-context';
import { recomputeEstimateTotals } from '@/lib/estimate/recompute-estimate-totals';
import { loadBidPricingContext } from '@/lib/bid/catalog';
import { buildBidFinalOutputs, type BidFinalOutputs } from '@/lib/bid/final-outputs';
import { processBidSourceFile, type ImportSummary } from '@/lib/bid/import';
import { BID_SOURCE_KIND, setBidLineRate } from '@/lib/bid/lines';
import { answerBidQuestion } from '@/lib/bid/questions';
import {
  MAX_UPLOAD_BYTES,
  defaultRoleForFile,
  detectBidMime,
  newStorageKey,
  persistBidSourceBytes,
  safeOriginalFilename,
} from '@/lib/bid/uploads';
import {
  addManualBidLineSchema,
  answerBidQuestionSchema,
  applyRepriceSchema,
  confirmBidLineSchema,
  estimateIdSchema,
  excludeBidLineSchema,
  reprocessBidSourceSchema,
  saveBidWorkflowSchema,
  saveDesignSchema,
  saveInstallSchema,
  setBidLineOverrideSchema,
  setCurrentTakeoffSchema,
  uploadBidSourceMetaSchema,
} from '@/lib/bid/validators';
import {
  applyRepriceDiffs,
  computeRepriceDiffs,
  confirmBidLine,
  saveBidWorkflowPatch,
  saveDesignDecision,
  saveInstallDecision,
  type RepriceDiff,
  type SaveWorkflowResult,
} from '@/lib/bid/workflow';
import { EstimateLineKind, PricingEngine } from '@bvisible/db';

type Actor = Awaited<ReturnType<typeof requireTenantId>>;

async function requireBidEstimate(me: Actor, estimateId: string) {
  const estimate = await prisma.estimate.findFirst({
    where: { id: estimateId, tenantId: me.tenantId, deletedAt: null, estimateType: EstimateType.BID },
    select: { id: true, number: true, status: true },
  });
  return estimate;
}

function isAdmin(me: Actor): boolean {
  return me.role === Role.ADMIN || me.role === Role.SUPER_ADMIN;
}

function bidPaths(estimateId: string): string[] {
  return [`/estimates/${estimateId}/bid`, `/estimates/${estimateId}`, `/estimates/${estimateId}/preview`, `/estimates/${estimateId}/qbme`, '/estimates'];
}

function revalidateBid(estimateId: string) {
  for (const p of bidPaths(estimateId)) revalidatePath(p);
}

// ---------------------------------------------------------------------------
// Autosave
// ---------------------------------------------------------------------------

export async function saveBidWorkflowAction(payload: unknown): Promise<SaveWorkflowResult> {
  const me = await requireTenantId();
  const parsed = saveBidWorkflowSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, conflict: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  const { estimateId, expectedVersion, patch } = parsed.data;
  const estimate = await requireBidEstimate(me, estimateId);
  if (!estimate) return { ok: false, conflict: false, error: 'Estimate not found.' };
  const result = await saveBidWorkflowPatch({ tenantId: me.tenantId, estimateId, actorId: me.id, expectedVersion, patch });
  if (result.ok && patch.completedSteps?.includes(1) && patch.currentStep && patch.currentStep > 1) {
    // "Save and continue" from Step 1 — one audit row per completion, not per keystroke.
    const ctx = await readRequestContext();
    await writeAuditLog({ action: 'bid_project_details_saved', userId: me.id, tenantId: me.tenantId, targetType: 'estimate', targetId: estimateId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, metadata: { number: estimate.number, projectName: patch.projectName ?? undefined } });
  }
  if (result.ok) revalidatePath('/estimates');
  return result;
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export interface UploadBidSourceResult {
  ok: boolean;
  error: string | null;
  fileId: string | null;
  status: BidSourceStatus | null;
  summary: ImportSummary | null;
}

export async function uploadBidSourceAction(formData: FormData): Promise<UploadBidSourceResult> {
  const me = await requireTenantId();
  const ctx = await readRequestContext();
  const meta = uploadBidSourceMetaSchema.safeParse({
    estimateId: formData.get('estimateId'),
    role: formData.get('role') || undefined,
    note: formData.get('note') || undefined,
    supersedesId: formData.get('supersedesId') || undefined,
    makeCurrentTakeoff: formData.get('makeCurrentTakeoff') === 'true' ? true : formData.get('makeCurrentTakeoff') === 'false' ? false : undefined,
  });
  if (!meta.success) return { ok: false, error: meta.error.issues[0]?.message ?? 'Invalid input.', fileId: null, status: null, summary: null };
  const estimate = await requireBidEstimate(me, meta.data.estimateId);
  if (!estimate) return { ok: false, error: 'Estimate not found.', fileId: null, status: null, summary: null };
  if (estimate.status === EstimateStatus.FINALIZED) return { ok: false, error: 'Estimate is finalized.', fileId: null, status: null, summary: null };

  const file = formData.get('file');
  if (!(file instanceof File)) return { ok: false, error: 'Choose a file to upload.', fileId: null, status: null, summary: null };
  if (file.size <= 0) return { ok: false, error: `${file.name}: the file is empty.`, fileId: null, status: null, summary: null };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: `${file.name}: larger than ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`, fileId: null, status: null, summary: null };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const detected = detectBidMime(bytes, file.name);
  if (!detected) {
    return { ok: false, error: `${file.name}: unsupported file type. Upload Excel (.xlsx/.xls), CSV, PDF, images, or Word (.docx).`, fileId: null, status: null, summary: null };
  }
  const originalFilename = safeOriginalFilename(file.name);
  const storageKey = newStorageKey(originalFilename);
  const role = meta.data.role ?? defaultRoleForFile(detected.family, originalFilename);
  const isSpreadsheet = detected.family === 'SPREADSHEET';

  // Revision chain: the new file supersedes the old one; the old row + bytes stay.
  let supersedes: { id: string; version: number; isCurrentTakeoff: boolean } | null = null;
  if (meta.data.supersedesId) {
    supersedes = await prisma.bidSourceFile.findFirst({ where: { id: meta.data.supersedesId, tenantId: me.tenantId, estimateId: estimate.id }, select: { id: true, version: true, isCurrentTakeoff: true } });
    if (!supersedes) return { ok: false, error: 'The file being replaced was not found.', fileId: null, status: null, summary: null };
  }
  const currentTakeoff = await prisma.bidSourceFile.findFirst({ where: { tenantId: me.tenantId, estimateId: estimate.id, isCurrentTakeoff: true }, select: { id: true } });
  const makeCurrent = isSpreadsheet && (meta.data.makeCurrentTakeoff ?? (supersedes?.isCurrentTakeoff || !currentTakeoff));

  await persistBidSourceBytes({ tenantId: me.tenantId, estimateId: estimate.id, storageKey, bytes });

  const created = await prisma.$transaction(async (tx) => {
    if (makeCurrent) {
      await tx.bidSourceFile.updateMany({ where: { tenantId: me.tenantId, estimateId: estimate.id, isCurrentTakeoff: true }, data: { isCurrentTakeoff: false } });
    }
    if (supersedes) {
      await tx.bidSourceFile.update({ where: { id: supersedes.id }, data: { supersededAt: new Date(), isCurrentTakeoff: false } });
    }
    return tx.bidSourceFile.create({
      data: {
        tenantId: me.tenantId,
        estimateId: estimate.id,
        role,
        status: 'UPLOADED',
        originalFilename,
        storageKey,
        mimeType: detected.mime,
        sizeBytes: file.size,
        uploadedById: me.id,
        version: supersedes ? supersedes.version + 1 : 1,
        supersedesId: supersedes?.id ?? null,
        isCurrentTakeoff: makeCurrent,
        isEvidence: !isSpreadsheet || !makeCurrent,
        note: meta.data.note ?? null,
      },
      select: { id: true },
    });
  });

  await writeAuditLog({
    action: supersedes ? 'bid_source_revision_uploaded' : 'bid_source_uploaded',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'bid_source_file',
    targetId: created.id,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { estimateId: estimate.id, number: estimate.number, filename: originalFilename, mime: detected.mime, sizeBytes: file.size, role, supersedesId: supersedes?.id ?? null, isCurrentTakeoff: makeCurrent },
  });

  const processed = await processBidSourceFile({ tenantId: me.tenantId, estimateId: estimate.id, fileId: created.id, actorId: me.id });
  await writeAuditLog({
    action: processed.ok ? 'bid_source_processed' : 'bid_source_processing_failed',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'bid_source_file',
    targetId: created.id,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { estimateId: estimate.id, status: processed.status, error: processed.error, summary: processed.summary ? { signLines: processed.summary.signLines, rowsRead: processed.summary.rowsRead, added: processed.summary.added, updated: processed.summary.updated, removed: processed.summary.removed } : null },
  });
  if (processed.summary && makeCurrent) {
    await writeAuditLog({ action: 'bid_takeoff_imported', userId: me.id, tenantId: me.tenantId, targetType: 'estimate', targetId: estimate.id, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, metadata: { fileId: created.id, ...summaryMeta(processed.summary) } });
    await prisma.bidEstimateWorkflow.updateMany({ where: { tenantId: me.tenantId, estimateId: estimate.id }, data: { completedSteps: { push: 2 } } });
  }
  revalidateBid(estimate.id);
  return { ok: processed.ok || processed.status === 'READY', error: processed.error, fileId: created.id, status: processed.status, summary: processed.summary };
}

function summaryMeta(s: ImportSummary) {
  return { rowsRead: s.rowsRead, signLines: s.signLines, takeoffQty: s.takeoffQty, headingsIgnored: s.headingsIgnored, totalsIgnored: s.totalsIgnored, autoPriced: s.autoPriced, needsReview: s.needsReview, officeQuestions: s.officeQuestions, added: s.added, updated: s.updated, removed: s.removed, primaryTab: s.primaryTab };
}

export async function reprocessBidSourceAction(payload: unknown): Promise<UploadBidSourceResult> {
  const me = await requireTenantId();
  const ctx = await readRequestContext();
  const parsed = reprocessBidSourceSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.', fileId: null, status: null, summary: null };
  const estimate = await requireBidEstimate(me, parsed.data.estimateId);
  if (!estimate) return { ok: false, error: 'Estimate not found.', fileId: null, status: null, summary: null };
  if (estimate.status === EstimateStatus.FINALIZED) return { ok: false, error: 'Estimate is finalized.', fileId: null, status: null, summary: null };
  const processed = await processBidSourceFile({ tenantId: me.tenantId, estimateId: estimate.id, fileId: parsed.data.fileId, actorId: me.id, preferredTab: parsed.data.preferredTab ?? null });
  await writeAuditLog({ action: processed.ok ? 'bid_source_processed' : 'bid_source_processing_failed', userId: me.id, tenantId: me.tenantId, targetType: 'bid_source_file', targetId: parsed.data.fileId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, metadata: { estimateId: estimate.id, status: processed.status, error: processed.error, preferredTab: parsed.data.preferredTab ?? null, reprocess: true } });
  if (processed.summary) {
    await writeAuditLog({ action: 'bid_takeoff_imported', userId: me.id, tenantId: me.tenantId, targetType: 'estimate', targetId: estimate.id, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, metadata: { fileId: parsed.data.fileId, reprocess: true, ...summaryMeta(processed.summary) } });
  }
  revalidateBid(estimate.id);
  return { ok: processed.ok, error: processed.error, fileId: parsed.data.fileId, status: processed.status, summary: processed.summary };
}

export async function setCurrentTakeoffAction(payload: unknown): Promise<UploadBidSourceResult> {
  const me = await requireTenantId();
  const parsed = setCurrentTakeoffSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: 'Invalid input.', fileId: null, status: null, summary: null };
  const estimate = await requireBidEstimate(me, parsed.data.estimateId);
  if (!estimate) return { ok: false, error: 'Estimate not found.', fileId: null, status: null, summary: null };
  if (estimate.status === EstimateStatus.FINALIZED) return { ok: false, error: 'Estimate is finalized.', fileId: null, status: null, summary: null };
  const file = await prisma.bidSourceFile.findFirst({ where: { id: parsed.data.fileId, tenantId: me.tenantId, estimateId: estimate.id }, select: { id: true } });
  if (!file) return { ok: false, error: 'File not found.', fileId: null, status: null, summary: null };
  await prisma.$transaction([
    prisma.bidSourceFile.updateMany({ where: { tenantId: me.tenantId, estimateId: estimate.id, isCurrentTakeoff: true }, data: { isCurrentTakeoff: false } }),
    prisma.bidSourceFile.update({ where: { id: file.id }, data: { isCurrentTakeoff: true, isEvidence: false } }),
  ]);
  return reprocessBidSourceAction({ estimateId: estimate.id, fileId: file.id });
}

// ---------------------------------------------------------------------------
// Pricing review
// ---------------------------------------------------------------------------

export interface BidMutationResult {
  ok: boolean;
  error: string | null;
}

export async function confirmBidLineAction(payload: unknown): Promise<BidMutationResult> {
  const me = await requireTenantId();
  const ctx = await readRequestContext();
  const parsed = confirmBidLineSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: 'Invalid input.' };
  const estimate = await requireBidEstimate(me, parsed.data.estimateId);
  if (!estimate) return { ok: false, error: 'Estimate not found.' };
  if (estimate.status === EstimateStatus.FINALIZED) return { ok: false, error: 'Estimate is finalized.' };
  const ok = await confirmBidLine(prisma, { tenantId: me.tenantId, estimateId: estimate.id, lineId: parsed.data.lineId });
  if (!ok) return { ok: false, error: 'This line is not waiting for confirmation.' };
  await writeAuditLog({ action: 'bid_match_confirmed', userId: me.id, tenantId: me.tenantId, targetType: 'estimate_line', targetId: parsed.data.lineId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, metadata: { estimateId: estimate.id } });
  revalidateBid(estimate.id);
  return { ok: true, error: null };
}

export async function setBidLineOverrideAction(payload: unknown): Promise<BidMutationResult> {
  const me = await requireTenantId();
  const ctx = await readRequestContext();
  const parsed = setBidLineOverrideSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  const estimate = await requireBidEstimate(me, parsed.data.estimateId);
  if (!estimate) return { ok: false, error: 'Estimate not found.' };
  if (estimate.status === EstimateStatus.FINALIZED) return { ok: false, error: 'Estimate is finalized.' };
  const d = parsed.data;
  const line = await prisma.estimateLineItem.findFirst({ where: { id: d.lineId, tenantId: me.tenantId, estimateId: estimate.id }, select: { id: true, unitCostCents: true, qtyMilli: true, customerDescription: true, qbItem: true } });
  if (!line) return { ok: false, error: 'Line not found.' };
  const rateChange = d.rateCents !== null && d.rateCents !== undefined && d.rateCents !== line.unitCostCents;
  if (rateChange && !isAdmin(me)) return { ok: false, error: 'Only an office administrator can approve a custom rate. Ask the office, or leave a note on the line.' };
  if (rateChange && !d.reason?.trim()) return { ok: false, error: 'A reason is required when changing a rate.' };

  await prisma.$transaction(async (tx) => {
    if (rateChange) {
      await setBidLineRate(tx, {
        tenantId: me.tenantId,
        estimateId: estimate.id,
        lineId: line.id,
        rateCents: d.rateCents!,
        pricingSource: 'CUSTOM_RATE',
        reviewStatus: 'CONFIRMED',
        decision: { byUserId: me.id, at: new Date(), reason: d.reason ?? null, projectSpecific: true, label: 'Custom rate approved by the office' },
        customerDescription: d.customerDescription ?? null,
        qbItem: d.qbItem ?? null,
        billableQtyMilli: d.billableQty !== null && d.billableQty !== undefined ? Math.round(d.billableQty * 1000) : null,
      });
    } else {
      const data: Prisma.EstimateLineItemUpdateInput = {};
      if (d.customerDescription !== undefined && d.customerDescription !== null) data.customerDescription = d.customerDescription;
      if (d.qbItem !== undefined && d.qbItem !== null) data.qbItem = d.qbItem;
      if (d.billableQty !== undefined && d.billableQty !== null) {
        const qtyMilli = Math.round(d.billableQty * 1000);
        data.qtyMilli = qtyMilli;
        data.computedCostCents = Math.round((qtyMilli * line.unitCostCents) / 1000);
      }
      await tx.estimateLineItem.update({ where: { id: line.id, tenantId: me.tenantId }, data });
      if (d.billableQty !== undefined && d.billableQty !== null) {
        await tx.bidLineDetail.updateMany({ where: { lineId: line.id, tenantId: me.tenantId }, data: { overridesJson: { billableQtyMilli: Math.round(d.billableQty * 1000), byUserId: me.id, at: new Date().toISOString(), reason: d.reason ?? null } as Prisma.InputJsonValue } });
      }
    }
    await recomputeEstimateTotals(tx, me.tenantId, estimate.id);
  });
  if (rateChange) {
    await writeAuditLog({ action: 'bid_custom_rate_approved', userId: me.id, tenantId: me.tenantId, targetType: 'estimate_line', targetId: line.id, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, metadata: { estimateId: estimate.id, oldRateCents: line.unitCostCents, newRateCents: d.rateCents, reason: d.reason, scope: 'PROJECT' } });
  }
  revalidateBid(estimate.id);
  return { ok: true, error: null };
}

export async function addManualBidLineAction(payload: unknown): Promise<BidMutationResult & { lineId?: string }> {
  const me = await requireTenantId();
  const ctx = await readRequestContext();
  const parsed = addManualBidLineSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  const estimate = await requireBidEstimate(me, parsed.data.estimateId);
  if (!estimate) return { ok: false, error: 'Estimate not found.' };
  if (estimate.status === EstimateStatus.FINALIZED) return { ok: false, error: 'Estimate is finalized.' };
  const d = parsed.data;
  if (d.rateCents > 0 && !isAdmin(me)) {
    // Estimators may add lines; a non-zero custom rate is a pricing decision.
    return { ok: false, error: 'Only an office administrator can set a custom rate. Add the line with a $0 rate and raise an office question, or ask the office.' };
  }
  const qtyMilli = Math.round(d.qty * 1000);
  const totalCents = Math.round((qtyMilli * d.rateCents) / 1000);
  const lineId = await prisma.$transaction(async (tx) => {
    const maxSort = await tx.estimateLineItem.aggregate({ where: { estimateId: estimate.id, tenantId: me.tenantId, sortOrder: { lt: 100_000 } }, _max: { sortOrder: true } });
    const line = await tx.estimateLineItem.create({
      data: {
        tenantId: me.tenantId,
        estimateId: estimate.id,
        sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
        kind: EstimateLineKind.MATERIAL,
        description: d.name,
        customerDescription: d.customerDescription,
        qtyMilli,
        unitCostCents: d.rateCents,
        computedCostCents: totalCents,
        markupExempt: true,
        sourceKind: BID_SOURCE_KIND.MANUAL,
        qbItem: d.qbItem,
        pricingEngine: PricingEngine.BID_RATE,
        pricingMethod: 'PER_SIGN',
        pricingInputsSnapshotJson: { engine: 'BID_RATE', formulaVersion: 'bid-pricing-v1', pricingMethod: 'PER_SIGN', pricingUnit: d.unit ?? 'SIGN', pricingSource: d.rateCents > 0 ? 'CUSTOM_RATE' : 'UNPRICED', rateSource: d.rateCents > 0 ? 'CUSTOM' : 'NONE', rateCents: d.rateCents, sourceQtyMilli: qtyMilli, billableQtyMilli: qtyMilli, markupExempt: true, projectSpecific: true, approvedById: d.rateCents > 0 ? me.id : null, approvedAt: d.rateCents > 0 ? new Date().toISOString() : null, computedTotalCents: totalCents } as Prisma.InputJsonValue,
        pricingOutputSnapshotJson: { totalCents, explanation: [{ label: 'Manual line', value: `${d.qty} × $${(d.rateCents / 100).toFixed(2)} = $${(totalCents / 100).toFixed(2)}`, note: 'Entered by hand in the Bid Estimator.' }] } as Prisma.InputJsonValue,
        formulaVersion: 'bid-pricing-v1',
      },
      select: { id: true },
    });
    await tx.bidLineDetail.create({
      data: {
        tenantId: me.tenantId,
        estimateId: estimate.id,
        lineId: line.id,
        sourceItem: d.name,
        sourceQtyMilli: qtyMilli,
        sourceUnit: d.unit ?? null,
        matchLevel: 'NONE',
        matchConfidenceMilli: 0,
        reviewStatus: d.rateCents > 0 ? 'CONFIRMED' : 'BLOCKED',
        pricingUnit: d.unit ?? 'SIGN',
        pricingSource: d.rateCents > 0 ? 'CUSTOM_RATE' : 'UNPRICED',
        explanationJson: [{ label: 'Manual line', value: `${d.qty} × $${(d.rateCents / 100).toFixed(2)}`, note: 'Entered by hand in the Bid Estimator.' }] as Prisma.InputJsonValue,
      },
    });
    await recomputeEstimateTotals(tx, me.tenantId, estimate.id);
    return line.id;
  });
  await writeAuditLog({ action: 'bid_line_added', userId: me.id, tenantId: me.tenantId, targetType: 'estimate_line', targetId: lineId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, metadata: { estimateId: estimate.id, name: d.name, qty: d.qty, rateCents: d.rateCents, qbItem: d.qbItem } });
  revalidateBid(estimate.id);
  return { ok: true, error: null, lineId };
}

export async function excludeBidLineAction(payload: unknown): Promise<BidMutationResult> {
  const me = await requireTenantId();
  const ctx = await readRequestContext();
  const parsed = excludeBidLineSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: 'Invalid input.' };
  const estimate = await requireBidEstimate(me, parsed.data.estimateId);
  if (!estimate) return { ok: false, error: 'Estimate not found.' };
  if (estimate.status === EstimateStatus.FINALIZED) return { ok: false, error: 'Estimate is finalized.' };
  const line = await prisma.estimateLineItem.findFirst({ where: { id: parsed.data.lineId, tenantId: me.tenantId, estimateId: estimate.id, sourceKind: { in: [BID_SOURCE_KIND.LINE, BID_SOURCE_KIND.MANUAL] } }, select: { id: true } });
  if (!line) return { ok: false, error: 'Line not found.' };
  await prisma.$transaction(async (tx) => {
    await tx.estimateLineItem.update({ where: { id: line.id, tenantId: me.tenantId }, data: { hiddenFromCustomer: true, unitCostCents: 0, computedCostCents: 0 } });
    await tx.bidLineDetail.updateMany({ where: { lineId: line.id, tenantId: me.tenantId }, data: { reviewStatus: 'EXCLUDED', pricingSource: 'UNPRICED', explanationJson: [{ label: 'Excluded', value: parsed.data.reason ?? 'Excluded by the estimator' }] as Prisma.InputJsonValue } });
    await tx.bidQuestion.updateMany({ where: { tenantId: me.tenantId, lineId: line.id, status: 'OPEN' }, data: { status: 'DISMISSED' } });
    await recomputeEstimateTotals(tx, me.tenantId, estimate.id);
  });
  await writeAuditLog({ action: 'bid_line_excluded', userId: me.id, tenantId: me.tenantId, targetType: 'estimate_line', targetId: line.id, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, metadata: { estimateId: estimate.id, reason: parsed.data.reason ?? null } });
  revalidateBid(estimate.id);
  return { ok: true, error: null };
}

// ---------------------------------------------------------------------------
// Office questions
// ---------------------------------------------------------------------------

export interface AnswerQuestionActionResult extends BidMutationResult {
  oldRateCents?: number | null;
  newRateCents?: number | null;
  totalCents?: number | null;
}

export async function answerBidQuestionAction(payload: unknown): Promise<AnswerQuestionActionResult> {
  const me = await requireTenantId();
  const ctx = await readRequestContext();
  const parsed = answerBidQuestionSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  const estimate = await requireBidEstimate(me, parsed.data.estimateId);
  if (!estimate) return { ok: false, error: 'Estimate not found.' };
  if (estimate.status === EstimateStatus.FINALIZED) return { ok: false, error: 'Estimate is finalized.' };
  const d = parsed.data;
  const admin = isAdmin(me);
  // Choices that introduce a rate not coming from a rule need office authority.
  const introducesRate = d.choiceKey === 'custom' || d.choiceKey === 'source' || (d.custom?.rateCents !== null && d.custom?.rateCents !== undefined);
  if (introducesRate && !admin) return { ok: false, error: 'Approving a custom or project-specific rate needs an office administrator. You can still pick a standard sign, use the current rule, supply a missing size or wording, or exclude the line.' };
  if (introducesRate && !d.note?.trim()) return { ok: false, error: 'Add a short reason for the approved rate.' };

  const context = await loadBidPricingContext(me.tenantId);
  let result;
  try {
    result = await answerBidQuestion({ tenantId: me.tenantId, estimateId: estimate.id, questionId: d.questionId, choiceKey: d.choiceKey, custom: d.custom ?? null, note: d.note ?? null, scope: d.scope, actorId: me.id, canPromote: admin, context });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not apply the answer.' };
  }
  if (!result.ok) return { ok: false, error: result.error };
  await writeAuditLog({
    action: 'bid_question_answered',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'bid_question',
    targetId: d.questionId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { estimateId: estimate.id, lineId: result.lineId, choiceKey: d.choiceKey, scope: d.scope, oldRateCents: result.oldRateCents, newRateCents: result.newRateCents, totalCents: result.totalCents, note: d.note ?? null, custom: d.custom ?? null },
  });
  if (introducesRate) {
    await writeAuditLog({ action: 'bid_custom_rate_approved', userId: me.id, tenantId: me.tenantId, targetType: 'estimate_line', targetId: result.lineId ?? d.questionId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, metadata: { estimateId: estimate.id, questionId: d.questionId, oldRateCents: result.oldRateCents, newRateCents: result.newRateCents, reason: d.note ?? null, scope: d.scope } });
  }
  if (result.promotedStandardSignId) {
    await writeAuditLog({ action: 'bid_standard_sign_promoted', userId: me.id, tenantId: me.tenantId, targetType: 'standard_sign', targetId: result.promotedStandardSignId, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, metadata: { estimateId: estimate.id, questionId: d.questionId, scope: BidDecisionScope.PERMANENT, rateCents: result.newRateCents } });
    revalidatePath('/pricing-backend');
  }
  revalidateBid(estimate.id);
  return { ok: true, error: null, oldRateCents: result.oldRateCents, newRateCents: result.newRateCents, totalCents: result.totalCents };
}

// ---------------------------------------------------------------------------
// Design / installation
// ---------------------------------------------------------------------------

export interface ServiceDecisionResult extends BidMutationResult {
  totalCents?: number;
  qtyMilli?: number;
  rateCents?: number;
}

export async function saveDesignAction(payload: unknown): Promise<ServiceDecisionResult> {
  const me = await requireTenantId();
  const ctx = await readRequestContext();
  const parsed = saveDesignSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  const estimate = await requireBidEstimate(me, parsed.data.estimateId);
  if (!estimate) return { ok: false, error: 'Estimate not found.' };
  const r = await saveDesignDecision({ tenantId: me.tenantId, estimateId: estimate.id, actorId: me.id, included: parsed.data.included, inputs: parsed.data.inputs });
  if (!r.ok) return { ok: false, error: r.error };
  await writeAuditLog({ action: 'bid_design_saved', userId: me.id, tenantId: me.tenantId, targetType: 'estimate', targetId: estimate.id, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, metadata: { included: parsed.data.included, hoursMilli: r.hoursMilli, rateCents: r.rateCents, totalCents: r.totalCents, inputs: parsed.data.inputs } });
  revalidateBid(estimate.id);
  return { ok: true, error: null, totalCents: r.totalCents, qtyMilli: r.hoursMilli, rateCents: r.rateCents };
}

export async function saveInstallAction(payload: unknown): Promise<ServiceDecisionResult> {
  const me = await requireTenantId();
  const ctx = await readRequestContext();
  const parsed = saveInstallSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  const estimate = await requireBidEstimate(me, parsed.data.estimateId);
  if (!estimate) return { ok: false, error: 'Estimate not found.' };
  const r = await saveInstallDecision({ tenantId: me.tenantId, estimateId: estimate.id, actorId: me.id, included: parsed.data.included, inputs: parsed.data.inputs });
  if (!r.ok) return { ok: false, error: r.error };
  await writeAuditLog({ action: 'bid_installation_saved', userId: me.id, tenantId: me.tenantId, targetType: 'estimate', targetId: estimate.id, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, metadata: { included: parsed.data.included, qtyMilli: r.qtyMilli, rateCents: r.rateCents, totalCents: r.totalCents, mode: parsed.data.inputs.mode, inputs: parsed.data.inputs } });
  revalidateBid(estimate.id);
  return { ok: true, error: null, totalCents: r.totalCents, qtyMilli: r.qtyMilli, rateCents: r.rateCents };
}

// ---------------------------------------------------------------------------
// Step 7 outputs
// ---------------------------------------------------------------------------

/**
 * Current customer estimate + QBME for Step 7. The step fetches this after
 * every change so it can never render a stale document (the server component
 * snapshot is only the first paint).
 */
export async function getBidFinalOutputsAction(payload: unknown): Promise<{ ok: boolean; error: string | null; outputs: BidFinalOutputs | null }> {
  const me = await requireTenantId();
  const parsed = estimateIdSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: 'Invalid input.', outputs: null };
  const estimate = await requireBidEstimate(me, parsed.data.estimateId);
  if (!estimate) return { ok: false, error: 'Estimate not found.', outputs: null };
  const outputs = await buildBidFinalOutputs(me.tenantId, estimate.id);
  return { ok: true, error: null, outputs };
}

// ---------------------------------------------------------------------------
// Controlled repricing (admin, drafts only)
// ---------------------------------------------------------------------------

export interface RepriceCheckResult extends BidMutationResult {
  diffs: RepriceDiff[];
}

export async function checkBidRepricingAction(payload: unknown): Promise<RepriceCheckResult> {
  const me = await requireTenantId();
  const parsed = estimateIdSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: 'Invalid input.', diffs: [] };
  const estimate = await requireBidEstimate(me, parsed.data.estimateId);
  if (!estimate) return { ok: false, error: 'Estimate not found.', diffs: [] };
  if (!isAdmin(me)) return { ok: false, error: 'Only an administrator can reprice a draft.', diffs: [] };
  if (estimate.status !== EstimateStatus.DRAFT) return { ok: false, error: 'Only draft estimates can be repriced. Sent, approved and finalized estimates keep their saved pricing.', diffs: [] };
  const diffs = await computeRepriceDiffs({ tenantId: me.tenantId, estimateId: estimate.id });
  return { ok: true, error: null, diffs };
}

export async function applyBidRepricingAction(payload: unknown): Promise<RepriceCheckResult> {
  const me = await requireTenantId();
  const ctx = await readRequestContext();
  const parsed = applyRepriceSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: 'Invalid input.', diffs: [] };
  const estimate = await requireBidEstimate(me, parsed.data.estimateId);
  if (!estimate) return { ok: false, error: 'Estimate not found.', diffs: [] };
  if (!isAdmin(me)) return { ok: false, error: 'Only an administrator can reprice a draft.', diffs: [] };
  if (estimate.status !== EstimateStatus.DRAFT) return { ok: false, error: 'Only draft estimates can be repriced.', diffs: [] };
  const { applied } = await applyRepriceDiffs({ tenantId: me.tenantId, estimateId: estimate.id, actorId: me.id, lineIds: parsed.data.lineIds });
  await writeAuditLog({ action: 'bid_draft_repriced', userId: me.id, tenantId: me.tenantId, targetType: 'estimate', targetId: estimate.id, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, metadata: { lines: applied.map((d) => ({ lineId: d.lineId, oldRateCents: d.oldRateCents, newRateCents: d.newRateCents, oldTotalCents: d.oldTotalCents, newTotalCents: d.newTotalCents })) } });
  revalidateBid(estimate.id);
  return { ok: true, error: null, diffs: applied };
}
