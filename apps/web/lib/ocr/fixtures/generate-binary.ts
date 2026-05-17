import { writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import sharp from 'sharp';
import {
  FIXTURE_IMAGE_RECEIPT_OCR_TEXT,
  FIXTURE_MULTI_LINE_INVOICE,
} from './sample-invoices';

function pdfEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * Tiny single-page PDF with embedded text (pdf-parse native path).
 * Generated in-memory — not committed to git.
 */
export function buildMinimalTextPdf(lines: string[]): Buffer {
  const startY = 740;
  const lineHeight = 14;
  const textOps: string[] = ['BT', '/F1 11 Tf'];
  for (let i = 0; i < lines.length; i++) {
    const y = startY - i * lineHeight;
    textOps.push(`1 0 0 1 72 ${y} Tm (${pdfEscape(lines[i] ?? '')}) Tj`);
  }
  textOps.push('ET');
  const stream = textOps.join('\n');
  const streamLen = Buffer.byteLength(stream, 'utf8');

  const parts: string[] = ['%PDF-1.4\n'];
  const offs: Record<number, number> = {};
  const add = (n: number, body: string) => {
    offs[n] = Buffer.byteLength(parts.join(''), 'utf8');
    parts.push(`${n} 0 obj\n${body}\nendobj\n`);
  };
  add(1, '<< /Type /Catalog /Pages 2 0 R >>');
  add(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  add(
    3,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>'
  );
  add(4, `<< /Length ${streamLen} >>\nstream\n${stream}\nendstream`);
  add(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  const body = parts.join('');
  const xrefStart = Buffer.byteLength(body, 'utf8');
  let xref = 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i <= 5; i++) {
    xref += `${String(offs[i]).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(body + xref + trailer, 'utf8');
}

/** Raster receipt PNG for tesseract (generated on demand). */
export async function buildReceiptPngBuffer(lines: string[]): Promise<Buffer> {
  const escaped = lines
    .map(
      (l, i) =>
        `<text x="40" y="${48 + i * 28}" font-family="monospace" font-size="18" fill="#111">${l
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')}</text>`
    )
    .join('');
  const h = Math.max(320, 60 + lines.length * 28);
  const svg = `<svg width="680" height="${h}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#fff"/>
    ${escaped}
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

export async function writeOcrFixtureFiles(dir: string): Promise<{
  pdfPath: string;
  pngPath: string;
}> {
  const pdfPath = path.join(dir, 'fixture-invoice.pdf');
  const pngPath = path.join(dir, 'fixture-receipt.png');
  await writeFile(
    pdfPath,
    buildMinimalTextPdf(FIXTURE_MULTI_LINE_INVOICE.split('\n'))
  );
  await writeFile(
    pngPath,
    await buildReceiptPngBuffer(FIXTURE_IMAGE_RECEIPT_OCR_TEXT.split('\n'))
  );
  return { pdfPath, pngPath };
}
