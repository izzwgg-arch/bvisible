import { createHash } from 'node:crypto';
import {
  POEventKind,
  Prisma,
  VendorPriceConfidence,
  VendorPriceExtractionMethod,
  prisma,
} from '@bvisible/db';
import { writeAuditLog } from '@/lib/auth/audit';
import {
  extractPricesFromFilename,
  extractPricesFromSubject,
  extractPricesFromTextBlob,
  type ExtractedPriceCandidate,
} from './extract';
import { normalizeVendorItemName } from './normalize';

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function formatLowerPriceMessage(
  itemNorm: string,
  oldCents: number,
  newCents: number
): string {
  const delta = oldCents - newCents;
  return (
    `Lower price detected for ${itemNorm}: was ${formatMoney(oldCents)} → ${formatMoney(newCents)} ` +
    `(−${formatMoney(delta)}). Operational alert — prices are not auto-updated.`
  ).slice(0, 900);
}

export function buildDedupeKey(parts: Record<string, unknown>): string {
  const payload = JSON.stringify(parts);
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

async function resolveCatalogItem(
  tenantId: string,
  vendorId: string,
  normalized: string
): Promise<{ id: string }> {
  const existing = await prisma.vendorCatalogItem.findUnique({
    where: {
      tenantId_vendorId_nameNormalized: {
        tenantId,
        vendorId,
        nameNormalized: normalized,
      },
    },
    select: { id: true },
  });
  if (existing) return existing;

  const alias = await prisma.vendorItemAlias.findUnique({
    where: {
      tenantId_vendorId_aliasNormalized: {
        tenantId,
        vendorId,
        aliasNormalized: normalized,
      },
    },
    select: { vendorCatalogItemId: true },
  });
  if (alias) return { id: alias.vendorCatalogItemId };

  const row = await prisma.vendorCatalogItem.create({
    data: { tenantId, vendorId, nameNormalized: normalized },
    select: { id: true },
  });
  return row;
}

type ObservationSource =
  | {
      kind: 'email';
      ingestedEmailId: string;
      sourceAttachmentId: string | null;
    }
  | {
      kind: 'ocr';
      ocrDocumentId: string;
      ocrLineItemId: string;
      sourcePoAttachmentId: string;
    };

async function persistPriceObservation(args: {
  tenantId: string;
  vendorId: string;
  purchaseOrderId: string;
  actorId: string;
  candidate: ExtractedPriceCandidate;
  source: ObservationSource;
}): Promise<
  | { outcome: 'inserted'; vendorPriceHistoryId: string }
  | { outcome: 'duplicate' }
  | { outcome: 'skipped' }
> {
  const itemNorm = normalizeVendorItemName(args.candidate.itemRaw);
  if (!itemNorm || itemNorm.length < 2) return { outcome: 'skipped' };

  const dedupeKey =
    args.source.kind === 'email'
      ? buildDedupeKey({
          tenantId: args.tenantId,
          emailId: args.source.ingestedEmailId,
          attachmentId: args.source.sourceAttachmentId,
          method: args.candidate.method,
          ord: args.candidate.ordinal,
          item: itemNorm,
          price: args.candidate.priceCents,
          unit: args.candidate.unit,
        })
      : buildDedupeKey({
          tenantId: args.tenantId,
          ocrDocumentId: args.source.ocrDocumentId,
          ocrLineItemId: args.source.ocrLineItemId,
          method: args.candidate.method,
          item: itemNorm,
          price: args.candidate.priceCents,
          unit: args.candidate.unit,
        });

  const catalog = await resolveCatalogItem(
    args.tenantId,
    args.vendorId,
    itemNorm
  );

  const prev = await prisma.vendorPriceHistory.findFirst({
    where: {
      tenantId: args.tenantId,
      vendorCatalogItemId: catalog.id,
    },
    orderBy: { createdAt: 'desc' },
    select: { priceCents: true },
  });

  const historyBase = {
    tenantId: args.tenantId,
    vendorId: args.vendorId,
    vendorCatalogItemId: catalog.id,
    itemNameRaw: args.candidate.itemRaw.slice(0, 500),
    itemNameNormalized: itemNorm.slice(0, 400),
    priceCents: args.candidate.priceCents,
    unit: args.candidate.unit,
    quantityMilli: args.candidate.quantityMilli,
    confidence: args.candidate.confidence,
    extractionMethod: args.candidate.method,
    dedupeKey,
  };

  let insertedHistoryId: string | undefined;
  try {
    const row = await prisma.vendorPriceHistory.create({
      data:
        args.source.kind === 'email'
          ? {
              ...historyBase,
              sourceEmailId: args.source.ingestedEmailId,
              sourceAttachmentId: args.source.sourceAttachmentId,
            }
          : {
              ...historyBase,
              sourceEmailId: null,
              sourceAttachmentId: null,
              sourcePoAttachmentId: args.source.sourcePoAttachmentId,
              ocrLineItemId: args.source.ocrLineItemId,
            },
      select: { id: true },
    });
    insertedHistoryId = row.id;
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      return { outcome: 'duplicate' };
    }
    throw err;
  }

  if (prev && args.candidate.priceCents < prev.priceCents) {
    await prisma.vendorPriceNotification.create({
      data:
        args.source.kind === 'email'
          ? {
              tenantId: args.tenantId,
              vendorId: args.vendorId,
              vendorCatalogItemId: catalog.id,
              oldPriceCents: prev.priceCents,
              newPriceCents: args.candidate.priceCents,
              sourceEmailId: args.source.ingestedEmailId,
            }
          : {
              tenantId: args.tenantId,
              vendorId: args.vendorId,
              vendorCatalogItemId: catalog.id,
              oldPriceCents: prev.priceCents,
              newPriceCents: args.candidate.priceCents,
              sourceOcrDocumentId: args.source.ocrDocumentId,
            },
    });

    await prisma.pOEvent.create({
      data: {
        tenantId: args.tenantId,
        purchaseOrderId: args.purchaseOrderId,
        kind: POEventKind.VENDOR_LOWER_PRICE,
        message: formatLowerPriceMessage(
          itemNorm,
          prev.priceCents,
          args.candidate.priceCents
        ),
        metadata: {
          vendorCatalogItemId: catalog.id,
          oldPriceCents: prev.priceCents,
          newPriceCents: args.candidate.priceCents,
          sourceEmailId:
            args.source.kind === 'email'
              ? args.source.ingestedEmailId
              : undefined,
          sourceOcrDocumentId:
            args.source.kind === 'ocr'
              ? args.source.ocrDocumentId
              : undefined,
          itemNameNormalized: itemNorm,
        },
        actorId: args.actorId,
        sourceEmailId:
          args.source.kind === 'email' ? args.source.ingestedEmailId : null,
      },
    });

    await writeAuditLog({
      action: 'vendor_price_lower_detected',
      tenantId: args.tenantId,
      targetType: 'vendor_catalog_item',
      targetId: catalog.id,
      metadata: {
        vendorId: args.vendorId,
        oldPriceCents: prev.priceCents,
        newPriceCents: args.candidate.priceCents,
        sourceEmailId:
          args.source.kind === 'email'
            ? args.source.ingestedEmailId
            : undefined,
        sourceOcrDocumentId:
          args.source.kind === 'ocr'
            ? args.source.ocrDocumentId
            : undefined,
      },
    });
  }

  return { outcome: 'inserted', vendorPriceHistoryId: insertedHistoryId! };
}

async function persistOneCandidate(args: {
  tenantId: string;
  vendorId: string;
  ingestedEmailId: string;
  purchaseOrderId: string;
  actorId: string;
  candidate: ExtractedPriceCandidate;
}): Promise<
  | { outcome: 'inserted'; vendorPriceHistoryId: string }
  | { outcome: 'duplicate' }
  | { outcome: 'skipped' }
> {
  return persistPriceObservation({
    tenantId: args.tenantId,
    vendorId: args.vendorId,
    purchaseOrderId: args.purchaseOrderId,
    actorId: args.actorId,
    candidate: args.candidate,
    source: {
      kind: 'email',
      ingestedEmailId: args.ingestedEmailId,
      sourceAttachmentId: args.candidate.sourceAttachmentId,
    },
  });
}

/**
 * Writes operator-approved OCR line items to VendorPriceHistory (dedupe-safe).
 * Never called automatically — only from OCR review server actions.
 */
export async function persistApprovedOcrPriceLines(args: {
  tenantId: string;
  vendorId: string;
  purchaseOrderId: string;
  actorId: string;
  ocrDocumentId: string;
  sourcePoAttachmentId: string;
  lines: ReadonlyArray<{
    ocrLineItemId: string;
    itemRaw: string;
    priceCents: number;
    unit: string | null;
    quantityMilli: number | null;
  }>;
}): Promise<{
  inserted: number;
  duplicates: number;
  skipped: number;
  insertedHistoryIds: string[];
}> {
  let inserted = 0;
  let duplicates = 0;
  let skipped = 0;
  const insertedHistoryIds: string[] = [];

  let ord = 0;
  for (const line of args.lines) {
    const candidate: ExtractedPriceCandidate = {
      itemRaw: line.itemRaw,
      priceCents: line.priceCents,
      unit: line.unit,
      quantityMilli: line.quantityMilli,
      confidence: VendorPriceConfidence.HIGH,
      method: VendorPriceExtractionMethod.OCR_APPROVED,
      ordinal: ord++,
      sourceAttachmentId: null,
    };

    const r = await persistPriceObservation({
      tenantId: args.tenantId,
      vendorId: args.vendorId,
      purchaseOrderId: args.purchaseOrderId,
      actorId: args.actorId,
      candidate,
      source: {
        kind: 'ocr',
        ocrDocumentId: args.ocrDocumentId,
        ocrLineItemId: line.ocrLineItemId,
        sourcePoAttachmentId: args.sourcePoAttachmentId,
      },
    });
    if (r.outcome === 'inserted') {
      inserted += 1;
      insertedHistoryIds.push(r.vendorPriceHistoryId);
    } else if (r.outcome === 'duplicate') duplicates += 1;
    else skipped += 1;
  }

  return { inserted, duplicates, skipped, insertedHistoryIds };
}

/**
 * Runs after a matched vendor email is materialised onto a PO.
 * Failures are swallowed by the caller — email ingestion always wins.
 */
export async function runVendorPriceExtractionAfterMaterialize(args: {
  tenantId: string;
  vendorId: string;
  ingestedEmailId: string;
  purchaseOrderId: string;
  actorId: string;
  subject: string;
  bodyTextSnippet: string | null;
  attachments: ReadonlyArray<{
    id: string;
    originalFilename: string;
    skipped: boolean;
  }>;
}): Promise<void> {
  const merged: ExtractedPriceCandidate[] = [];
  let ord = 0;
  for (const s of extractPricesFromSubject(args.subject, null)) {
    merged.push({ ...s, ordinal: ord++ });
  }
  for (const line of extractPricesFromTextBlob(
    args.bodyTextSnippet,
    VendorPriceExtractionMethod.LINE_REGEX,
    null
  )) {
    merged.push({ ...line, ordinal: ord++ });
  }
  for (const att of args.attachments) {
    if (att.skipped) continue;
    for (const fn of extractPricesFromFilename(
      att.originalFilename,
      att.id
    )) {
      merged.push({ ...fn, ordinal: ord++ });
    }
  }

  let inserted = 0;
  let duplicates = 0;
  let skipped = 0;

  for (const c of merged) {
    const r = await persistOneCandidate({
      tenantId: args.tenantId,
      vendorId: args.vendorId,
      ingestedEmailId: args.ingestedEmailId,
      purchaseOrderId: args.purchaseOrderId,
      actorId: args.actorId,
      candidate: c,
    });
    if (r.outcome === 'inserted') inserted += 1;
    else if (r.outcome === 'duplicate') duplicates += 1;
    else skipped += 1;
  }

  if (inserted > 0 || duplicates > 0) {
    // eslint-disable-next-line no-console
    console.info('vendor_price_extraction', {
      tenantId: args.tenantId,
      vendorId: args.vendorId,
      emailId: args.ingestedEmailId,
      inserted,
      duplicates,
      skipped,
      candidates: merged.length,
    });
  }
}
