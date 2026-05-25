import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { safeOriginalFilename } from '@/lib/po/uploads';
import { emailAttachmentDedupeKey } from './run';
import { buildEmailReviewReasonCodes } from './review-reasons';

describe('emailAttachmentDedupeKey', () => {
  it('collapses identical filename+bytes', () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const n = safeOriginalFilename('x/../evil.pdf');
    const a = emailAttachmentDedupeKey(n, bytes);
    const b = emailAttachmentDedupeKey(n, bytes);
    expect(a).toBe(b);
    expect(a).toContain(createHash('sha256').update(bytes).digest('hex'));
  });

  it('differs when bytes differ', () => {
    const n = safeOriginalFilename('doc.pdf');
    const a = emailAttachmentDedupeKey(n, new Uint8Array([1]));
    const b = emailAttachmentDedupeKey(n, new Uint8Array([2]));
    expect(a).not.toBe(b);
  });
});

describe('email ingest operational safety (static contracts)', () => {
  it('run.ts dedupes attachments before persist (no duplicate rows)', async () => {
    const src = await readFile(new URL('./run.ts', import.meta.url), 'utf8');
    expect(src).toContain('seenAttachmentKeys');
    expect(src).toContain('emailAttachmentDedupeKey');
    expect(src).toMatch(/if \(seenAttachmentKeys\.has\(dedupeKey\)\)/);
  });

  it('run.ts records skipped attachments with skipReason for review UI', async () => {
    const src = await readFile(new URL('./run.ts', import.meta.url), 'utf8');
    expect(src).toContain('UnsupportedAttachmentError');
    expect(src).toContain('skipped: true');
    expect(src).toContain('skipReason');
  });

  it('run.ts only calls vendor price extraction inside materializeOnPo', async () => {
    const src = await readFile(new URL('./run.ts', import.meta.url), 'utf8');
    const fnStart = src.indexOf('async function materializeOnPo');
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = src.slice(fnStart, fnStart + 12_000);
    expect(fnBody).toContain('runVendorPriceExtractionAfterMaterialize');
    const unmatchedBranch = src.match(
      /\} else \{[\s\S]*?status: EmailIngestStatus\.UNMATCHED[\s\S]*?reviewReasonCodes: unmatchedCodes/,
    )?.[0];
    expect(unmatchedBranch).toBeTruthy();
    expect(unmatchedBranch!).not.toContain(
      'runVendorPriceExtractionAfterMaterialize',
    );
  });

  it('enqueue.ts prevents duplicate OCR rows via unique poAttachmentId', async () => {
    const src = await readFile(
      new URL('../ocr/enqueue.ts', import.meta.url),
      'utf8',
    );
    expect(src).toContain('Idempotent enqueue');
    expect(src).toContain('P2002');
    expect(src).toContain("'duplicate'");
  });

  it('materializeOnPo short-circuits duplicate VENDOR_REPLY for same email', async () => {
    const src = await readFile(new URL('./run.ts', import.meta.url), 'utf8');
    expect(src).toContain('alreadyMaterialized');
    expect(src).toContain('POEventKind.VENDOR_REPLY');
    expect(src).toContain('sourceEmailId: args.ingestedEmailId');
  });

  it('OCR worker sets REVIEW_REQUIRED — no auto vendor-price apply', async () => {
    const worker = await readFile(
      new URL('../ocr/worker.ts', import.meta.url),
      'utf8',
    );
    expect(worker).toContain('OcrJobStatus.REVIEW_REQUIRED');
    expect(worker).not.toContain('persistApprovedOcrPriceLines');
    expect(worker).not.toContain('VendorPriceExtractionMethod.OCR_APPROVED');
  });

  it('OCR approve action gates on REVIEW_REQUIRED before price persist', async () => {
    const src = await readFile(
      new URL('../../app/(app)/admin/ocr-review/actions.ts', import.meta.url),
      'utf8',
    );
    expect(src).toContain('OcrJobStatus.REVIEW_REQUIRED');
    expect(src).toContain('persistApprovedOcrPriceLines');
  });

  it('skipped attachments surface ATTACHMENT_REJECTED in review codes', () => {
    const codes = buildEmailReviewReasonCodes({
      hasIncomingAttachments: true,
      storedAttachments: [{ skipped: true, skipReason: 'size_exceeded' }],
      match: {
        reason: 'NONE',
        purchaseOrderId: null,
        vendorId: 'v1',
        hint: null,
        matcherReviewCodes: ['UNKNOWN_PO'],
      },
    });
    expect(codes).toContain('ATTACHMENT_REJECTED');
    expect(codes).toContain('MANUAL_REVIEW_REQUIRED');
  });
});
