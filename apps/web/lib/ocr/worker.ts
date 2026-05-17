import { OcrJobStatus, prisma } from '@bvisible/db';
import { resolveAttachmentPath } from '@/lib/po/uploads';
import { normalizeVendorItemName } from '@/lib/vendor-pricing/normalize';
import { extractPlainTextFromAttachment } from './extract-plain-text';
import { parseReceiptDocumentGuesses } from './parse-receipt';
import { parseReceiptLineCandidates } from './parse-receipt-lines';

/** Bounded retries before FAILED — avoids infinite OCR loops on corrupt bytes. */
export const OCR_MAX_ATTEMPTS = 14;

const SNIPPET_LEN = 8000;
const MAX_LINE_ITEMS = 120;

function truncateErr(msg: string): string {
  return msg.replace(/\s+/g, ' ').trim().slice(0, 380);
}

export async function claimNextOcrDocument(): Promise<{
  id: string;
  tenantId: string;
  poAttachmentId: string;
  attemptAfterClaim: number;
} | null> {
  return prisma.$transaction(async (tx) => {
    const doc = await tx.ocrDocument.findFirst({
      where: {
        attemptCount: { lt: OCR_MAX_ATTEMPTS },
        poAttachmentId: { not: null },
        OR: [
          { status: OcrJobStatus.PENDING },
          {
            status: OcrJobStatus.PROCESSING,
            lockedUntil: { lt: new Date() },
          },
        ],
      },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        tenantId: true,
        poAttachmentId: true,
        attemptCount: true,
      },
    });
    if (!doc?.poAttachmentId) return null;

    const updated = await tx.ocrDocument.update({
      where: { id: doc.id },
      data: {
        status: OcrJobStatus.PROCESSING,
        lockedUntil: new Date(Date.now() + 4 * 60 * 1000),
        attemptCount: { increment: 1 },
      },
      select: { attemptCount: true },
    });

    return {
      id: doc.id,
      tenantId: doc.tenantId,
      poAttachmentId: doc.poAttachmentId,
      attemptAfterClaim: updated.attemptCount,
    };
  });
}

async function failJob(
  id: string,
  attemptAfterClaim: number,
  err: unknown
): Promise<void> {
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : 'unknown_error';
  await prisma.ocrDocument.update({
    where: { id },
    data: {
      status:
        attemptAfterClaim >= OCR_MAX_ATTEMPTS
          ? OcrJobStatus.FAILED
          : OcrJobStatus.PENDING,
      lastError: truncateErr(msg),
      lockedUntil: null,
    },
  });
}

export async function processOcrDocument(job: {
  id: string;
  tenantId: string;
  poAttachmentId: string;
  attemptAfterClaim: number;
}): Promise<void> {
  const att = await prisma.pOAttachment.findFirst({
    where: {
      id: job.poAttachmentId,
      tenantId: job.tenantId,
    },
    select: {
      id: true,
      purchaseOrderId: true,
      storageKey: true,
      mimeType: true,
    },
  });
  if (!att) {
    await failJob(job.id, job.attemptAfterClaim, new Error('attachment_missing'));
    return;
  }

  let absolutePath: string;
  try {
    absolutePath = resolveAttachmentPath(
      job.tenantId,
      att.purchaseOrderId,
      att.storageKey
    );
  } catch {
    await failJob(job.id, job.attemptAfterClaim, new Error('resolve_path_failed'));
    return;
  }

  try {
    const { text, engineLabel } = await extractPlainTextFromAttachment({
      absolutePath,
      mimeType: att.mimeType,
    });

    const guesses = parseReceiptDocumentGuesses(text);
    const candidates = parseReceiptLineCandidates(text, MAX_LINE_ITEMS);

    const snippet =
      text.length > SNIPPET_LEN ? text.slice(0, SNIPPET_LEN) : text;

    await prisma.$transaction(async (tx) => {
      await tx.ocrLineItem.deleteMany({ where: { ocrDocumentId: job.id } });

      let sortOrder = 0;
      for (const c of candidates) {
        const norm = normalizeVendorItemName(c.itemRaw);
        await tx.ocrLineItem.create({
          data: {
            ocrDocumentId: job.id,
            sortOrder: sortOrder++,
            rawLineText: `${c.itemRaw}`.slice(0, 2000),
            itemLabelNormalized:
              norm.length > 0 ? norm.slice(0, 400) : null,
            quantityMilliGuess: c.quantityMilli,
            unitPriceCentsGuess: c.priceCents,
            confidence: c.confidence,
            extractionSource: c.parseReason.slice(0, 80),
          },
        });
      }

      await tx.ocrDocument.update({
        where: { id: job.id },
        data: {
          status: OcrJobStatus.REVIEW_REQUIRED,
          lockedUntil: null,
          lastError: null,
          engineLabel,
          rawTextCharCount: text.length,
          rawTextSnippet: snippet,
          vendorNameGuess: guesses.vendorNameGuess,
          invoiceNumberGuess: guesses.invoiceNumberGuess,
          receiptNumberGuess: guesses.receiptNumberGuess,
          subtotalCentsGuess: guesses.subtotalCentsGuess,
          taxCentsGuess: guesses.taxCentsGuess,
          totalCentsGuess: guesses.totalCentsGuess,
          documentDateGuess: guesses.documentDateGuess,
        },
      });
    });
  } catch (err) {
    await failJob(job.id, job.attemptAfterClaim, err);
  }
}

export async function runOcrWorkerTick(maxJobs = 3): Promise<{
  processed: number;
}> {
  let processed = 0;
  for (let i = 0; i < maxJobs; i++) {
    const job = await claimNextOcrDocument();
    if (!job) break;
    await processOcrDocument(job);
    processed += 1;
  }
  return { processed };
}
