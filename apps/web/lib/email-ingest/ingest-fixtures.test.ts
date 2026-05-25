import { mkdir, writeFile } from 'node:fs/promises';
import { describe, expect, it, vi } from 'vitest';
import { parseRawMessage } from './parse';
import {
  buildEmptyAttachmentEmail,
  buildForwardedVendorChainEmail,
  buildInlineImageSpamEmail,
  buildMixedAttachmentEmail,
  buildMultiPdfAttachmentEmail,
  buildPdfAttachmentEmail,
  buildTextEmail,
  buildUnsupportedPlusPdfEmail,
  minimalPdfBytes,
  unsupportedBinaryBytes,
} from './fixtures/mime';
import { emailAttachmentDedupeKey } from './run';
import { safeOriginalFilename } from '@/lib/po/uploads';
import { buildEmailReviewReasonCodes } from './review-reasons';
import { persistEmailAttachment, UnsupportedAttachmentError } from './storage';

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

/** Mirrors run.ts attachment dedupe before persist. */
function dedupeParsedAttachments(
  attachments: ReadonlyArray<{ filename: string; bytes: Uint8Array }>,
): typeof attachments {
  const seen = new Set<string>();
  const out: typeof attachments[number][] = [];
  for (const att of attachments) {
    const norm = safeOriginalFilename(att.filename);
    const key = emailAttachmentDedupeKey(norm, att.bytes);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...att, filename: norm });
  }
  return out;
}

describe('parseRawMessage fixtures', () => {
  it('preserves nested RE:/FW: style subjects', async () => {
    const buf = buildTextEmail({
      messageId: '<re-1@test>',
      subject: 'RE: FW: RE: Quote for PO-5001',
      from: 'Vendor <vendor@vendor.com>',
      body: 'Please find attached.\r\n',
    });
    const p = await parseRawMessage(buf);
    expect(p.subject).toMatch(/RE:/);
    expect(p.subject).toMatch(/FW:/);
    expect(p.subject).toContain('PO-5001');
    expect(p.fromAddress).toBe('vendor@vendor.com');
  });

  it('extracts forwarded chain with original vendor From/Subject headers', async () => {
    const buf = buildForwardedVendorChainEmail({
      messageId: '<fwd-vendor@test>',
      subject: 'Fwd: PO docs',
      forwarderFrom: 'Buyer <buyer@client.com>',
      originalFrom: 'Acct <acct@vendor.com>',
      originalSubject: 'Invoice PO-6100',
      bodyTail: 'Tracking attached.',
    });
    const p = await parseRawMessage(buf);
    expect(p.fromAddress).toBe('buyer@client.com');
    expect(p.bodyTextSnippet).toMatch(/acct@vendor\.com/i);
    expect(p.bodyTextSnippet).toMatch(/Invoice PO-6100/);
    expect(p.bodyTextSnippet).toMatch(/PO-6100/);
  });

  it('extracts forwarded chain snippet with multiple PO tokens in body', async () => {
    const buf = buildTextEmail({
      messageId: '<fwd-1@test>',
      subject: 'Fwd: updates',
      from: 'Buyer <buyer@client.com>',
      body: [
        '---------- Forwarded message ---------',
        'Vendor wrote:',
        'We can ship PO-6001 and PO-6002 next week.',
      ].join('\n'),
    });
    const p = await parseRawMessage(buf);
    expect(p.bodyTextSnippet).toMatch(/PO-6001/);
    expect(p.bodyTextSnippet).toMatch(/PO-6002/);
  });

  it('parses multiple PDF attachments', async () => {
    const pdf = minimalPdfBytes();
    const buf = buildMultiPdfAttachmentEmail({
      messageId: '<multi-pdf@test>',
      subject: 'RE: RE: Invoices PO-8000',
      from: 'Acct <acct@vendor.com>',
      files: [
        { filename: 'inv-a.pdf', pdfBytes: pdf },
        { filename: 'inv-b.pdf', pdfBytes: pdf },
      ],
    });
    const p = await parseRawMessage(buf);
    expect(p.attachments.length).toBe(2);
    expect(p.subject).toMatch(/RE:/);
  });

  it('parses inline image spam with a real PDF attachment', async () => {
    const buf = buildInlineImageSpamEmail({
      messageId: '<inline-spam@test>',
      subject: 'Your order update',
      from: 'News <news@vendor.com>',
      inlineImageCount: 5,
    });
    const p = await parseRawMessage(buf);
    expect(p.attachments.length).toBeGreaterThanOrEqual(1);
    expect(
      p.attachments.some((a) => a.filename.toLowerCase().endsWith('.pdf')),
    ).toBe(true);
  });

  it('drops zero-byte attachment parts but keeps valid PDF', async () => {
    const buf = buildEmptyAttachmentEmail({
      messageId: '<empty-att@test>',
      subject: 'Broken + good attachment',
      from: 'Acct <acct@vendor.com>',
    });
    const p = await parseRawMessage(buf);
    expect(p.attachments.length).toBe(1);
    expect(p.attachments[0]!.filename).toBe('real-invoice.pdf');
  });

  it('parses unsupported binary plus valid PDF', async () => {
    const buf = buildUnsupportedPlusPdfEmail({
      messageId: '<mixed-types@test>',
      subject: 'Docs attached',
      from: 'Acct <acct@vendor.com>',
    });
    const p = await parseRawMessage(buf);
    expect(p.attachments.length).toBe(2);
    expect(p.attachments.some((a) => a.filename.endsWith('.exe'))).toBe(true);
    expect(p.attachments.some((a) => a.filename.endsWith('.pdf'))).toBe(true);
  });

  it('sanitizes path-traversal filename on attachment', async () => {
    const pdf = minimalPdfBytes();
    const buf = buildPdfAttachmentEmail({
      messageId: '<traversal@test>',
      subject: 'Invoice',
      from: 'Acct <acct@vendor.com>',
      filename: '../../etc/PO-9000-invoice.pdf',
      pdfBytes: pdf,
    });
    const p = await parseRawMessage(buf);
    expect(p.attachments.length).toBe(1);
    expect(p.attachments[0]!.filename).toContain('..');
    expect(safeOriginalFilename(p.attachments[0]!.filename)).toBe(
      'PO-9000-invoice.pdf',
    );
  });

  it('parses invoice-like PDF attachment', async () => {
    const pdf = minimalPdfBytes();
    const buf = buildPdfAttachmentEmail({
      messageId: '<pdf-1@test>',
      subject: 'Invoice for PO-7000',
      from: 'Acct <acct@vendor.com>',
      filename: 'INV-PO-7000.pdf',
      pdfBytes: pdf,
    });
    const p = await parseRawMessage(buf);
    expect(p.attachments.length).toBe(1);
    expect(p.attachments[0]!.filename.toLowerCase()).toContain('inv');
    expect(p.attachments[0]!.bytes.byteLength).toBeGreaterThan(10);
  });
});

describe('attachment dedupe keys (ingest contract)', () => {
  it('dedupe keys differ for same filename different bytes', () => {
    const n = safeOriginalFilename('invoice.pdf');
    const a = emailAttachmentDedupeKey(n, new Uint8Array([1, 2]));
    const b = emailAttachmentDedupeKey(n, new Uint8Array([3, 4]));
    expect(a).not.toBe(b);
  });

  it('dedupe keys differ for duplicate bytes different filenames', () => {
    const bytes = minimalPdfBytes();
    const a = emailAttachmentDedupeKey('inv-a.pdf', bytes);
    const b = emailAttachmentDedupeKey('inv-b.pdf', bytes);
    expect(a).not.toBe(b);
  });

  it('dedupe keys match for duplicate filename+bytes (ingest skips second)', () => {
    const bytes = minimalPdfBytes();
    const n = safeOriginalFilename('invoice.pdf');
    const a = emailAttachmentDedupeKey(n, bytes);
    const b = emailAttachmentDedupeKey(n, bytes);
    expect(a).toBe(b);
  });

  it('dedupeParsedAttachments keeps duplicate bytes under different filenames', async () => {
    const pdf = minimalPdfBytes();
    const buf = buildMixedAttachmentEmail({
      messageId: '<dup-bytes@test>',
      subject: 'Dupes',
      from: 'Acct <acct@vendor.com>',
      parts: [
        {
          kind: 'attachment',
          filename: 'copy-a.pdf',
          contentType: 'application/pdf',
          bytes: pdf,
        },
        {
          kind: 'attachment',
          filename: 'copy-b.pdf',
          contentType: 'application/pdf',
          bytes: pdf,
        },
      ],
    });
    const parsed = await parseRawMessage(buf);
    const deduped = dedupeParsedAttachments(parsed.attachments);
    expect(parsed.attachments.length).toBe(2);
    expect(deduped.length).toBe(2);
  });

  it('dedupeParsedAttachments keeps same filename with different bytes', async () => {
    const pdf = minimalPdfBytes();
    const buf = buildMixedAttachmentEmail({
      messageId: '<dup-name-diff-bytes@test>',
      subject: 'Dup name diff bytes',
      from: 'Acct <acct@vendor.com>',
      parts: [
        {
          kind: 'attachment',
          filename: 'invoice.pdf',
          contentType: 'application/pdf',
          bytes: pdf,
        },
        {
          kind: 'attachment',
          filename: 'invoice.pdf',
          contentType: 'application/pdf',
          bytes: new Uint8Array([...pdf, 0xff]),
        },
      ],
    });
    const parsed = await parseRawMessage(buf);
    expect(dedupeParsedAttachments(parsed.attachments).length).toBe(2);
  });

  it('dedupeParsedAttachments collapses identical filename+bytes repeats', async () => {
    const pdf = minimalPdfBytes();
    const buf = buildMixedAttachmentEmail({
      messageId: '<dup-name@test>',
      subject: 'Dup name',
      from: 'Acct <acct@vendor.com>',
      parts: [
        {
          kind: 'attachment',
          filename: 'invoice.pdf',
          contentType: 'application/pdf',
          bytes: pdf,
        },
        {
          kind: 'attachment',
          filename: 'invoice.pdf',
          contentType: 'application/pdf',
          bytes: pdf,
        },
      ],
    });
    const parsed = await parseRawMessage(buf);
    expect(dedupeParsedAttachments(parsed.attachments).length).toBe(1);
  });
});

describe('match + review fixtures', () => {
  it('filename carries PO token while subject does not (matcher input shape)', async () => {
    const parsed = await parseRawMessage(
      buildPdfAttachmentEmail({
        messageId: '<fn-po@test>',
        subject: 'See attached',
        from: 'vendor@vendor.com',
        filename: 'invoice-PO-1234.pdf',
        pdfBytes: minimalPdfBytes(),
      }),
    );
    expect(parsed.subject).not.toMatch(/PO-1234/);
    expect(parsed.attachments[0]!.filename).toMatch(/PO-1234/i);
  });

  it('buildEmailReviewReasonCodes surfaces ATTACHMENT_REJECTED for skipped rows', () => {
    const codes = buildEmailReviewReasonCodes({
      hasIncomingAttachments: true,
      storedAttachments: [
        { skipped: true, skipReason: 'MIME outside allowlist' },
        { skipped: false, skipReason: null },
      ],
      match: {
        reason: 'PO_NUMBER',
        purchaseOrderId: 'po1',
        vendorId: 'v1',
        hint: 'PO-1',
      },
    });
    expect(codes).toContain('ATTACHMENT_REJECTED');
  });

  it('unsupported attachment bytes reject before disk write', async () => {
    await expect(
      persistEmailAttachment({
        tenantId: 'tenantabc',
        ingestedEmailId: 'emailabc',
        originalFilename: 'setup.exe',
        bytes: unsupportedBinaryBytes(),
      }),
    ).rejects.toThrow(UnsupportedAttachmentError);
    expect(mkdir).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });
});
