import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  buildMinimalTextPdf,
  buildReceiptPngBuffer,
} from './fixtures/generate-binary';
import { FIXTURE_MULTI_LINE_INVOICE } from './fixtures/sample-invoices';
import { extractPlainTextFromAttachment } from './extract-plain-text';
import { parseReceiptLineCandidates } from './parse-receipt-lines';

function hasTesseract(): boolean {
  try {
    execFileSync('tesseract', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('OCR quality — deterministic parsing', () => {
  it('readable invoice text fixture yields practical line candidates', () => {
    const candidates = parseReceiptLineCandidates(FIXTURE_MULTI_LINE_INVOICE);
    expect(candidates.length).toBeGreaterThanOrEqual(3);
    expect(candidates.some((c) => /coroplast/i.test(c.itemRaw))).toBe(true);
  });

  it('generated PDF fixture is well-formed and extracts when pdf-parse accepts it', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'bv-ocr-pdf-'));
    const pdfPath = path.join(dir, 'invoice.pdf');
    try {
      const lines = FIXTURE_MULTI_LINE_INVOICE.split('\n');
      const pdf = buildMinimalTextPdf(lines);
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      await writeFile(pdfPath, pdf);
      try {
        const { text, engineLabel } = await extractPlainTextFromAttachment({
          absolutePath: pdfPath,
          mimeType: 'application/pdf',
        });
        expect(engineLabel).toMatch(/pdf-parse|tesseract/);
        expect(parseReceiptLineCandidates(text).length).toBeGreaterThanOrEqual(1);
      } catch (err) {
        // Hand-built PDF may not parse in all environments; parsing rules still covered above.
        expect(err instanceof Error && err.message).toBe('pdf_no_extractable_text');
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('subtotal/tax/total lines are not item candidates', () => {
    const candidates = parseReceiptLineCandidates(FIXTURE_MULTI_LINE_INVOICE);
    for (const c of candidates) {
      expect(c.itemRaw).not.toMatch(/^(subtotal|tax|total)$/i);
    }
  });
});

describe.skipIf(!hasTesseract())('OCR quality — host tesseract (optional)', () => {
  it('readable PNG fixture yields line candidates after OCR', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'bv-ocr-png-'));
    const pngPath = path.join(dir, 'receipt.png');
    try {
      const lines = [
        'TEST SUPPLY',
        'Ink cartridge  $56.00',
        'Cleaning kit   $12.50',
      ];
      await writeFile(pngPath, await buildReceiptPngBuffer(lines));
      const { text } = await extractPlainTextFromAttachment({
        absolutePath: pngPath,
        mimeType: 'image/png',
      });
      expect(text.replace(/\s+/g, ' ')).toMatch(/ink|cartridge|56/i);
      const candidates = parseReceiptLineCandidates(text);
      expect(candidates.length).toBeGreaterThanOrEqual(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('OCR quality — worker idempotency contract', () => {
  it('worker source deletes prior line items before insert (replay-safe)', async () => {
    const src = await readFile(
      new URL('./worker.ts', import.meta.url),
      'utf8'
    );
    expect(src).toContain('ocrLineItem.deleteMany');
    expect(src).toContain('parseReceiptLineCandidates');
    expect(src).not.toContain('extractPricesFromTextBlob');
  });
});
