// Bid source-file storage. Same posture as PO attachments (lib/po/uploads.ts):
// server-generated storage keys, sanitized display filenames, magic-byte
// MIME detection (the client Content-Type is never trusted), per-tenant
// per-estimate directories, path-traversal backstop, 25 MB cap. The
// allowlist is wider than PO's (takeoffs are spreadsheets; plans are PDFs)
// and every extra type has its own byte signature below.

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  MAX_UPLOAD_BYTES,
  detectMimeFromBytes as detectPoMime,
  newStorageKey,
  safeOriginalFilename,
} from '@/lib/po/uploads';
import type { BidSourceRole } from '@bvisible/db';

export { MAX_UPLOAD_BYTES, newStorageKey, safeOriginalFilename };

export const BID_ALLOWED_MIMES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
  'application/vnd.ms-excel', // xls
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // docx
  'text/plain',
] as const;

export type BidAllowedMime = (typeof BID_ALLOWED_MIMES)[number];

export { BID_ACCEPT_ATTRIBUTE } from './upload-constants';

export interface BidDetectedMime {
  mime: BidAllowedMime;
  extHint: string;
  /** SPREADSHEET files are parsed; everything else is evidence only. */
  family: 'SPREADSHEET' | 'PDF' | 'IMAGE' | 'DOCUMENT';
}

function extOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

function looksLikeText(buf: Uint8Array): boolean {
  const n = Math.min(buf.length, 4096);
  if (n === 0) return false;
  let printable = 0;
  for (let i = 0; i < n; i += 1) {
    const b = buf[i]!;
    if (b === 0) return false;
    if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127) || b >= 128) printable += 1;
  }
  return printable / n > 0.97;
}

/**
 * Magic-byte detection for the bid allowlist. ZIP containers (xlsx / docx)
 * share a signature, so the extension decides between them — but only after
 * the bytes proved it is a real ZIP; a renamed .exe never passes.
 */
export function detectBidMime(buf: Uint8Array, filename: string): BidDetectedMime | null {
  const po = detectPoMime(buf);
  if (po) {
    return { mime: po.mime, extHint: po.extHint, family: po.mime === 'application/pdf' ? 'PDF' : 'IMAGE' };
  }
  const ext = extOf(filename);
  // ZIP: 50 4B 03 04 (also 05 06 / 07 08 for empty/spanned archives)
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07)) {
    if (ext === 'xlsx' || ext === 'xlsm') {
      return { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extHint: 'xlsx', family: 'SPREADSHEET' };
    }
    if (ext === 'docx') {
      return { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', extHint: 'docx', family: 'DOCUMENT' };
    }
    return null;
  }
  // OLE2 compound document (legacy .xls / .doc): D0 CF 11 E0 A1 B1 1A E1
  if (
    buf.length >= 8 &&
    buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0 &&
    buf[4] === 0xa1 && buf[5] === 0xb1 && buf[6] === 0x1a && buf[7] === 0xe1
  ) {
    if (ext === 'xls') return { mime: 'application/vnd.ms-excel', extHint: 'xls', family: 'SPREADSHEET' };
    return null;
  }
  if (looksLikeText(buf)) {
    if (ext === 'csv') return { mime: 'text/csv', extHint: 'csv', family: 'SPREADSHEET' };
    if (ext === 'txt') return { mime: 'text/plain', extHint: 'txt', family: 'DOCUMENT' };
  }
  return null;
}

/** Default role from the detected family + filename hints. */
export function defaultRoleForFile(family: BidDetectedMime['family'], filename: string): BidSourceRole {
  const f = filename.toLowerCase();
  if (family === 'SPREADSHEET') return 'TAKEOFF';
  if (family === 'IMAGE') return 'PHOTO';
  if (family === 'PDF') {
    if (/spec/.test(f)) return 'SPECIFICATION';
    if (/draw|detail|elev|shop/.test(f)) return 'DRAWING';
    if (/plan|site|floor|mark/.test(f)) return 'PLAN';
    return 'PLAN';
  }
  return 'DOCUMENT';
}

function uploadRoot(): string {
  return path.resolve(process.env.UPLOAD_DIR ?? '/opt/bvisible/shared/uploads');
}

function estimateDir(tenantId: string, estimateId: string): string {
  if (!/^[a-z0-9]+$/i.test(tenantId)) throw new Error('invalid_tenant_id');
  if (!/^[a-z0-9]+$/i.test(estimateId)) throw new Error('invalid_estimate_id');
  return path.join(uploadRoot(), tenantId, 'estimate', estimateId);
}

export function resolveBidSourcePath(tenantId: string, estimateId: string, storageKey: string): string {
  if (!/^[a-z0-9._-]+$/i.test(storageKey)) throw new Error('invalid_storage_key');
  const dir = estimateDir(tenantId, estimateId);
  const candidate = path.resolve(dir, storageKey);
  const dirResolved = path.resolve(dir);
  if (!candidate.startsWith(dirResolved + path.sep) && candidate !== dirResolved) {
    throw new Error('path_traversal_blocked');
  }
  return candidate;
}

export async function persistBidSourceBytes(input: {
  tenantId: string;
  estimateId: string;
  storageKey: string;
  bytes: Uint8Array;
}): Promise<{ absolutePath: string }> {
  const dir = estimateDir(input.tenantId, input.estimateId);
  await mkdir(dir, { recursive: true });
  const target = resolveBidSourcePath(input.tenantId, input.estimateId, input.storageKey);
  await writeFile(target, input.bytes, { mode: 0o640 });
  return { absolutePath: target };
}

export async function readBidSourceBytes(tenantId: string, estimateId: string, storageKey: string): Promise<Buffer | null> {
  try {
    return await readFile(resolveBidSourcePath(tenantId, estimateId, storageKey));
  } catch {
    return null;
  }
}
