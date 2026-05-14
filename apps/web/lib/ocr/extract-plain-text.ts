import { execFile } from 'node:child_process';
import {
  mkdtemp,
  readFile,
  readdir,
  writeFile,
  rm,
} from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { promisify } from 'node:util';
import sharp from 'sharp';

const execFileAsync = promisify(execFile);

const MIN_NATIVE_PDF_CHARS = 48;

async function tryPdfNativeText(buffer: Buffer): Promise<string | null> {
  try {
    const mod = await import('pdf-parse');
    const pdfParse =
      typeof mod === 'function'
        ? (mod as (b: Buffer) => Promise<{ text: string }>)
        : ((((mod as { default?: unknown }).default ??
            mod) as unknown) as (b: Buffer) => Promise<{ text: string }>);
    const { text } = await pdfParse(buffer);
    const t = text.replace(/\s+/g, ' ').trim();
    return t.length >= MIN_NATIVE_PDF_CHARS ? text : null;
  } catch {
    return null;
  }
}

/** Host `tesseract` CLI (Phase 13). Install: `apt install tesseract-ocr`. */
async function ocrImageBuffer(buffer: Buffer): Promise<string> {
  const prepared = await sharp(buffer)
    .rotate()
    .resize({
      width: 2200,
      height: 2200,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 84 })
    .toBuffer();

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'bv-ocr-img-'));
  try {
    const imgPath = path.join(tmpDir, 'in.jpg');
    await writeFile(imgPath, prepared);
    const outBase = path.join(tmpDir, 'out');
    await execFileAsync(
      'tesseract',
      [imgPath, outBase, '-l', 'eng'],
      { timeout: 180_000 }
    );
    return await readFile(`${outBase}.txt`, 'utf8');
  } finally {
    try {
      await rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

async function tryPdfRasterOcr(buffer: Buffer): Promise<string | null> {
  let tmpDir: string | null = null;
  try {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'bv-ocr-pdf-'));
    const pdfPath = path.join(tmpDir, 'doc.pdf');
    await writeFile(pdfPath, buffer);

    const prefix = path.join(tmpDir, 'page');
    await execFileAsync(
      'pdftoppm',
      ['-png', '-r', '200', '-f', '1', '-l', '5', pdfPath, prefix],
      { timeout: 120_000 }
    );

    const files = (await readdir(tmpDir))
      .filter((f) => f.endsWith('.png'))
      .sort();
    if (files.length === 0) return null;

    const chunks: string[] = [];
    for (const f of files) {
      const pngPath = path.join(tmpDir, f);
      const imgBuf = await readFile(pngPath);
      chunks.push(await ocrImageBuffer(imgBuf));
    }
    return chunks.join('\n\n');
  } catch {
    return null;
  } finally {
    if (tmpDir) {
      try {
        await rm(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Local OCR / text extraction. Never logs raw document contents.
 * PDFs: tries embedded text first; scanned PDFs require `pdftoppm` on PATH.
 */
export async function extractPlainTextFromAttachment(args: {
  absolutePath: string;
  mimeType: string;
}): Promise<{ text: string; engineLabel: string }> {
  const buf = await readFile(args.absolutePath);

  if (args.mimeType === 'application/pdf') {
    const native = await tryPdfNativeText(buf);
    if (native) {
      return { text: native, engineLabel: 'pdf-parse (native text)' };
    }
    const raster = await tryPdfRasterOcr(buf);
    if (raster && raster.trim().length > 0) {
      return { text: raster, engineLabel: 'pdftoppm + tesseract-cli' };
    }
    throw new Error('pdf_no_extractable_text');
  }

  if (
    args.mimeType === 'image/jpeg' ||
    args.mimeType === 'image/png' ||
    args.mimeType === 'image/webp'
  ) {
    const text = await ocrImageBuffer(buf);
    return { text, engineLabel: 'tesseract-cli' };
  }

  throw new Error('unsupported_mime_for_ocr');
}
