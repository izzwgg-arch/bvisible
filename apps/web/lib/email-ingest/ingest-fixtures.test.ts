import { describe, expect, it } from 'vitest';
import { parseRawMessage } from './parse';
import {
  buildPdfAttachmentEmail,
  buildTextEmail,
  minimalPdfBytes,
} from './fixtures/mime';

describe('parseRawMessage fixtures', () => {
  it('preserves RE:/FW: style subjects', async () => {
    const buf = buildTextEmail({
      messageId: '<re-1@test>',
      subject: 'RE: FW: Quote for PO-5001',
      from: 'Vendor <vendor@vendor.com>',
      body: 'Please find attached.\r\n',
    });
    const p = await parseRawMessage(buf);
    expect(p.subject).toContain('RE:');
    expect(p.subject).toContain('PO-5001');
    expect(p.fromAddress).toBe('vendor@vendor.com');
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
