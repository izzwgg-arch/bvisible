// Source-file processing + takeoff import (server side).
//
//   processBidSourceFile: reads the stored bytes, parses spreadsheets into
//   bid_source_rows (every row, classified), records the per-file result,
//   and — for the current takeoff — turns product candidates into estimate
//   lines through match → price → persist. PDFs / images / documents are
//   evidence: recorded as READY with a page count when available.
//
//   Re-processing (a revision or a different tab) RECONCILES instead of
//   wiping: existing lines keep human decisions (answered questions,
//   custom rates, confirmations); quantities and source links are updated;
//   new items become new lines; items missing from the new takeoff are
//   flagged EXCLUDED (never silently deleted).

import { BidSourceStatus, Prisma, prisma, type BidSourceRole } from '@bvisible/db';
import { loadBidPricingContext, type BidPricingContext } from './catalog';
import { createBidLine, applyPricedLine, BID_SOURCE_KIND } from './lines';
import { matchStandardSign, type MatchResult } from './match-standard-sign';
import { parseBidWorkbook, summarizeRowRef, type ParsedTab, type ParsedWorkbook, type ProductCandidate } from './parse-bid-takeoff';
import { priceBidLine, type PricedLine } from './price-line';
import { readWorkbookTabs } from './read-workbook';
import { normalizeSignText } from './text-extract';
import { readBidSourceBytes, detectBidMime } from './uploads';
import { recomputeEstimateTotals } from '@/lib/estimate/recompute-estimate-totals';
import { persistQuestionDrafts } from './questions';
import { rankStandardSignSuggestions } from './ai-suggest';

export interface ImportSummary {
  files: number;
  rowsRead: number;
  productRows: number;
  signLines: number;
  headingsIgnored: number;
  totalsIgnored: number;
  taxRowsIgnored: number;
  serviceRowsDeferred: number;
  takeoffQty: number;
  autoPriced: number;
  needsReview: number;
  officeQuestions: number;
  blocked: number;
  primaryTab: string | null;
  tabs: Array<{ sheetName: string; productLines: number; rowsRead: number; usable: boolean }>;
  added: number;
  updated: number;
  removed: number;
  processedAt: string;
}

function json(v: unknown): Prisma.InputJsonValue {
  return v as Prisma.InputJsonValue;
}

async function countPdfPages(bytes: Buffer): Promise<number | null> {
  try {
    const text = bytes.toString('latin1');
    const matches = text.match(/\/Type\s*\/Page[^s]/g);
    return matches ? matches.length : null;
  } catch {
    return null;
  }
}

export interface ProcessResult {
  ok: boolean;
  status: BidSourceStatus;
  error: string | null;
  summary: ImportSummary | null;
}

/** Process one uploaded file. `preferredTab` lets the operator pick a different sheet. */
export async function processBidSourceFile(args: {
  tenantId: string;
  estimateId: string;
  fileId: string;
  actorId: string;
  preferredTab?: string | null;
  context?: BidPricingContext;
}): Promise<ProcessResult> {
  const file = await prisma.bidSourceFile.findFirst({
    where: { id: args.fileId, tenantId: args.tenantId, estimateId: args.estimateId },
  });
  if (!file) return { ok: false, status: 'FAILED', error: 'Source file not found.', summary: null };

  await prisma.bidSourceFile.update({ where: { id: file.id }, data: { status: 'PROCESSING', processingError: null } });

  const bytes = await readBidSourceBytes(args.tenantId, args.estimateId, file.storageKey);
  if (!bytes) {
    await prisma.bidSourceFile.update({ where: { id: file.id }, data: { status: 'FAILED', processingError: 'Stored file is missing on disk.' } });
    return { ok: false, status: 'FAILED', error: 'Stored file is missing on disk.', summary: null };
  }
  const detected = detectBidMime(bytes, file.originalFilename);
  if (!detected) {
    await prisma.bidSourceFile.update({ where: { id: file.id }, data: { status: 'UNSUPPORTED', processingError: 'File type is not supported.' } });
    return { ok: false, status: 'UNSUPPORTED', error: 'File type is not supported.', summary: null };
  }

  if (detected.family !== 'SPREADSHEET') {
    const pages = detected.family === 'PDF' ? await countPdfPages(bytes) : null;
    await prisma.bidSourceFile.update({
      where: { id: file.id },
      data: { status: 'READY', processedAt: new Date(), resultJson: json({ family: detected.family, pages }) },
    });
    return { ok: true, status: 'READY', error: null, summary: null };
  }

  let workbook: ParsedWorkbook;
  try {
    workbook = parseBidWorkbook(readWorkbookTabs(bytes, file.originalFilename));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not read the workbook.';
    await prisma.bidSourceFile.update({ where: { id: file.id }, data: { status: 'FAILED', processingError: message.slice(0, 1000) } });
    return { ok: false, status: 'FAILED', error: message, summary: null };
  }

  const primaryName = args.preferredTab && workbook.tabs.some((t) => t.sheetName === args.preferredTab && t.columns) ? args.preferredTab : workbook.primaryTabName;
  const primary = workbook.tabs.find((t) => t.sheetName === primaryName) ?? null;

  // Persist EVERY row of every tab (replace this file's prior rows).
  await prisma.$transaction(async (tx) => {
    await tx.bidSourceRow.deleteMany({ where: { tenantId: args.tenantId, estimateId: args.estimateId, sourceFileId: file.id } });
    const rows = workbook.tabs.flatMap((tab) =>
      tab.rows.map((r) => ({
        tenantId: args.tenantId,
        estimateId: args.estimateId,
        sourceFileId: file.id,
        sheetName: r.sheetName.slice(0, 200),
        rowNumber: r.rowNumber,
        rowKind: r.rowKind,
        rawItem: r.rawItem,
        rawDescription: r.rawDescription,
        rawQtyText: r.rawQtyText?.slice(0, 60) ?? null,
        rawQtyMilli: r.rawQty === null ? null : Math.round(r.rawQty * 1000),
        rawUnit: r.rawUnit,
        rawCostCents: r.rawCostCents,
        rawPriceCents: r.rawPriceCents,
        rawExtendedCents: r.rawExtendedCents,
        sectionHeading: r.sectionHeading,
      }))
    );
    for (let i = 0; i < rows.length; i += 500) {
      await tx.bidSourceRow.createMany({ data: rows.slice(i, i + 500) });
    }
  });

  if (!primary || primary.products.filter((p) => !p.service).length === 0) {
    await prisma.bidSourceFile.update({
      where: { id: file.id },
      data: {
        status: 'NEEDS_REVIEW',
        processedAt: new Date(),
        processingError: 'No takeoff rows (item + quantity) were found. Choose a different tab or add lines manually.',
        resultJson: json({ family: 'SPREADSHEET', tabs: workbook.tabs.map(tabInfo), primaryTab: null }),
      },
    });
    return { ok: false, status: 'NEEDS_REVIEW', error: 'No takeoff rows were found in this file.', summary: null };
  }

  const summary = file.isCurrentTakeoff
    ? await applyTakeoffToEstimate({ tenantId: args.tenantId, estimateId: args.estimateId, file: { id: file.id, role: file.role }, tab: primary, workbook, actorId: args.actorId, context: args.context })
    : baseSummary(workbook, primary);

  await prisma.bidSourceFile.update({
    where: { id: file.id },
    data: {
      status: 'READY',
      processedAt: new Date(),
      processingError: null,
      resultJson: json({ family: 'SPREADSHEET', tabs: workbook.tabs.map(tabInfo), primaryTab: primary.sheetName, counts: primary.counts, title: primary.title }),
    },
  });
  if (file.isCurrentTakeoff) {
    await prisma.bidEstimateWorkflow.updateMany({
      where: { tenantId: args.tenantId, estimateId: args.estimateId },
      data: { importSummaryJson: json(summary) },
    });
  }
  return { ok: true, status: 'READY', error: null, summary };
}

function tabInfo(tab: ParsedTab) {
  return { sheetName: tab.sheetName, productLines: tab.counts.productLines, rowsRead: tab.counts.rowsRead, usable: !!tab.columns && tab.counts.productLines > 0 };
}

function baseSummary(workbook: ParsedWorkbook, primary: ParsedTab): ImportSummary {
  return {
    files: 1,
    rowsRead: primary.counts.rowsRead,
    productRows: primary.counts.productRows,
    signLines: primary.counts.productLines,
    headingsIgnored: primary.counts.headings + primary.counts.headers,
    totalsIgnored: primary.counts.subtotals + primary.counts.totals,
    taxRowsIgnored: primary.counts.tax,
    serviceRowsDeferred: primary.counts.serviceRows,
    takeoffQty: primary.counts.takeoffQty,
    autoPriced: 0,
    needsReview: 0,
    officeQuestions: 0,
    blocked: 0,
    primaryTab: primary.sheetName,
    tabs: workbook.tabs.map(tabInfo),
    added: 0,
    updated: 0,
    removed: 0,
    processedAt: new Date().toISOString(),
  };
}

export interface ApplyTakeoffArgs {
  tenantId: string;
  estimateId: string;
  file: { id: string; role: BidSourceRole };
  tab: ParsedTab;
  workbook: ParsedWorkbook;
  actorId: string;
  context?: BidPricingContext;
}

/** Match → price → persist every product candidate of the primary tab. */
export async function applyTakeoffToEstimate(args: ApplyTakeoffArgs): Promise<ImportSummary> {
  const ctx = args.context ?? (await loadBidPricingContext(args.tenantId));
  const summary = baseSummary(args.workbook, args.tab);
  const candidates = args.tab.products.filter((p) => !p.service);

  const existing = await prisma.bidLineDetail.findMany({
    where: { tenantId: args.tenantId, estimateId: args.estimateId, line: { sourceKind: BID_SOURCE_KIND.LINE } },
    include: { line: { select: { id: true, sortOrder: true, unitCostCents: true, qtyMilli: true } } },
  });
  const existingByKey = new Map<string, (typeof existing)[number]>();
  for (const d of existing) existingByKey.set(normalizeSignText(d.sourceItem ?? ''), d);

  let nextSort = existing.reduce((m, d) => Math.max(m, d.line.sortOrder + 1), 0);
  const seenKeys = new Set<string>();

  // AI ranking (optional, never applied automatically): only for candidates
  // the deterministic ladder could not settle.
  const matches = new Map<string, MatchResult>();
  for (const cand of candidates) matches.set(cand.key, matchStandardSign({ name: cand.name, description: cand.description, sectionHeading: cand.sectionHeading }, ctx.catalog));
  const undecided = candidates.filter((c) => {
    const m = matches.get(c.key)!;
    return m.level === 'NONE' || m.level === 'AMBIGUOUS';
  });
  const aiSuggestions = undecided.length > 0 ? await rankStandardSignSuggestions(args.tenantId, undecided.map((c) => ({ key: c.key, name: c.name, description: c.description })), ctx.catalog).catch(() => null) : null;

  for (const cand of candidates) {
    seenKeys.add(cand.key);
    const match = matches.get(cand.key)!;
    const sourceRef = summarizeRowRef(args.tab.sheetName, cand.rowNumbers);
    const priced: PricedLine = priceBidLine({ candidate: { ...cand, extendedCents: cand.extendedCents }, match, sources: ctx.sources, sourceRef });
    const prior = existingByKey.get(cand.key);
    const sourceQtyMilli = Math.round(cand.qty * 1000);

    let lineId: string;
    if (prior) {
      lineId = prior.lineId;
      const decided = prior.pricingSource === 'OFFICE_DECISION' || prior.pricingSource === 'CUSTOM_RATE' || prior.reviewStatus === 'CONFIRMED';
      await prisma.$transaction(async (tx) => {
        if (decided) {
          // Keep the human decision; refresh quantity from the new takeoff.
          const ratio = prior.sourceQtyMilli > 0 ? sourceQtyMilli / prior.sourceQtyMilli : 1;
          const newBillable = prior.sourceQtyMilli > 0 && prior.line.qtyMilli > 0 ? Math.round(prior.line.qtyMilli * ratio) : priced.billableQtyMilli;
          const total = Math.round((newBillable * prior.line.unitCostCents) / 1000);
          await tx.estimateLineItem.update({ where: { id: prior.lineId, tenantId: args.tenantId }, data: { qtyMilli: newBillable, computedCostCents: total } });
          await tx.bidLineDetail.update({
            where: { lineId: prior.lineId },
            data: { sourceFileId: args.file.id, sourceSheetName: args.tab.sheetName, sourceRowRef: sourceRef, sourceQtyMilli, sourceDescription: cand.description, sectionHeading: cand.sectionHeading },
          });
        } else {
          await applyPricedLine(tx, { tenantId: args.tenantId, estimateId: args.estimateId, lineId: prior.lineId, priced, match, reviewStatus: priced.reviewStatus });
          await tx.bidLineDetail.update({
            where: { lineId: prior.lineId },
            data: { sourceFileId: args.file.id, sourceSheetName: args.tab.sheetName, sourceRowRef: sourceRef, sourceQtyMilli, sourceDescription: cand.description, sectionHeading: cand.sectionHeading, aiSuggestionJson: aiSuggestions?.[cand.key] ? json(aiSuggestions[cand.key]) : undefined },
          });
          // Replace still-open auto-generated questions for this line.
          await tx.bidQuestion.deleteMany({ where: { tenantId: args.tenantId, lineId: prior.lineId, status: 'OPEN' } });
          await persistQuestionDrafts(tx, { tenantId: args.tenantId, estimateId: args.estimateId, lineId: prior.lineId, drafts: priced.questions });
        }
      });
      summary.updated += 1;
    } else {
      lineId = await prisma.$transaction(async (tx) => {
        const id = await createBidLine(tx, {
          tenantId: args.tenantId,
          estimateId: args.estimateId,
          sortOrder: nextSort++,
          priced,
          match,
          source: {
            sourceFileId: args.file.id,
            sourceSheetName: args.tab.sheetName,
            sourceRowRef: sourceRef,
            sourceItem: cand.name,
            sourceDescription: cand.description,
            sourceQtyMilli,
            sourceUnit: cand.unit,
            sectionHeading: cand.sectionHeading,
          },
        });
        if (aiSuggestions?.[cand.key]) {
          await tx.bidLineDetail.update({ where: { lineId: id }, data: { aiSuggestionJson: json(aiSuggestions[cand.key]) } });
        }
        await persistQuestionDrafts(tx, { tenantId: args.tenantId, estimateId: args.estimateId, lineId: id, drafts: priced.questions });
        return id;
      });
      summary.added += 1;
    }

    // Link the contributing source rows to the line.
    await prisma.bidSourceRow.updateMany({
      where: { tenantId: args.tenantId, estimateId: args.estimateId, sourceFileId: args.file.id, sheetName: args.tab.sheetName, rowNumber: { in: cand.rowNumbers } },
      data: { lineId },
    });
  }

  // Lines from a previous takeoff that no longer appear → EXCLUDED, kept visible for review.
  for (const [key, d] of existingByKey) {
    if (seenKeys.has(key)) continue;
    if (d.reviewStatus === 'EXCLUDED') continue;
    await prisma.$transaction(async (tx) => {
      await tx.bidLineDetail.update({ where: { lineId: d.lineId }, data: { reviewStatus: 'EXCLUDED', explanationJson: json([{ label: 'Removed', value: 'This item is not in the latest takeoff revision.' }]) } });
      await tx.estimateLineItem.update({ where: { id: d.lineId, tenantId: args.tenantId }, data: { hiddenFromCustomer: true, unitCostCents: 0, computedCostCents: 0 } });
      await tx.bidQuestion.updateMany({ where: { tenantId: args.tenantId, lineId: d.lineId, status: 'OPEN' }, data: { status: 'DISMISSED' } });
    });
    summary.removed += 1;
  }

  await recomputeEstimateTotals(prisma, args.tenantId, args.estimateId);

  const details = await prisma.bidLineDetail.findMany({
    where: { tenantId: args.tenantId, estimateId: args.estimateId, line: { sourceKind: BID_SOURCE_KIND.LINE } },
    select: { reviewStatus: true },
  });
  for (const d of details) {
    if (d.reviewStatus === 'AUTO_PRICED' || d.reviewStatus === 'CONFIRMED') summary.autoPriced += 1;
    else if (d.reviewStatus === 'NEEDS_REVIEW') summary.needsReview += 1;
    else if (d.reviewStatus === 'OFFICE_QUESTION') summary.officeQuestions += 1;
    else if (d.reviewStatus === 'BLOCKED') summary.blocked += 1;
  }
  summary.signLines = details.filter((d) => d.reviewStatus !== 'EXCLUDED').length;
  return summary;
}
