import { mkdir, writeFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

// Centralized upload posture for the PO foundation. Anything that
// touches the filesystem on behalf of an attachment goes through this
// module so the tenant-isolation, MIME-allowlist, and path-traversal
// guarantees live in one place. See docs/ai-context/SECURITY_RULES.md.

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

// Allowlist is intentionally narrow for the foundation. Adding a new
// MIME requires a new magic-byte signature in `detectMimeFromBytes`
// below; the recorded mimeType column is *not* trusted by the
// download path — we re-detect on every stream.
export const ALLOWED_MIMES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type AllowedMime = (typeof ALLOWED_MIMES)[number];

function uploadRoot(): string {
  // UPLOAD_DIR overrides for local dev. Defaults to the layout that
  // server-scripts/04-layout-and-queue.sh provisions and that
  // deploy-once.sh symlinks into the live working tree.
  return path.resolve(process.env.UPLOAD_DIR ?? '/opt/bvisible/shared/uploads');
}

function poDir(tenantId: string, purchaseOrderId: string): string {
  // Belt-and-suspenders: refuse anything that could crawl back up the
  // tree. Tenant ids and PO ids are cuids in our schema (alphanumeric
  // only) — anything else is a programming bug or an attack.
  if (!/^[a-z0-9]+$/i.test(tenantId)) {
    throw new Error('invalid_tenant_id');
  }
  if (!/^[a-z0-9]+$/i.test(purchaseOrderId)) {
    throw new Error('invalid_purchase_order_id');
  }
  return path.join(uploadRoot(), tenantId, 'po', purchaseOrderId);
}

export function newStorageKey(originalFilename: string): string {
  const ext = safeExtension(originalFilename);
  const random = randomBytes(16).toString('hex');
  return ext ? `${random}.${ext}` : random;
}

function safeExtension(filename: string): string | null {
  const dot = filename.lastIndexOf('.');
  if (dot < 0 || dot === filename.length - 1) return null;
  const ext = filename.slice(dot + 1).toLowerCase();
  if (!/^[a-z0-9]{1,8}$/.test(ext)) return null;
  return ext;
}

export function safeOriginalFilename(filename: string): string {
  // Strip directory traversal, NUL bytes, control characters. The
  // sanitized name is for display only — the bytes on disk are keyed
  // by `newStorageKey()` which is server-generated.
  const base = filename.split(/[\\/]/).pop() ?? 'file';
  const cleaned = base.replace(/[\x00-\x1f]/g, '').slice(0, 200);
  return cleaned.length > 0 ? cleaned : 'file';
}

export interface DetectedMime {
  mime: AllowedMime;
  extHint: string;
}

// Magic-byte sniff over the first ~12 bytes. Adequate for the
// allowlist. NEVER trust the client's file.type — browsers happily
// forward whatever the OS guessed, and it's the OS that's trusting
// the extension.
export function detectMimeFromBytes(buf: Uint8Array): DetectedMime | null {
  if (buf.length < 4) return null;

  // PDF: %PDF
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
    return { mime: 'application/pdf', extHint: 'pdf' };
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return { mime: 'image/png', extHint: 'png' };
  }
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mime: 'image/jpeg', extHint: 'jpg' };
  }
  // WEBP: 'RIFF' .... 'WEBP'
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return { mime: 'image/webp', extHint: 'webp' };
  }
  return null;
}

export interface PersistAttachmentInput {
  tenantId: string;
  purchaseOrderId: string;
  storageKey: string;
  bytes: Uint8Array;
}

export async function persistAttachmentBytes(
  input: PersistAttachmentInput
): Promise<{ absolutePath: string }> {
  const dir = poDir(input.tenantId, input.purchaseOrderId);
  await mkdir(dir, { recursive: true });
  const target = resolveAttachmentPath(
    input.tenantId,
    input.purchaseOrderId,
    input.storageKey
  );
  await writeFile(target, input.bytes, { mode: 0o640 });
  return { absolutePath: target };
}

// Strict path resolver. Refuses anything that escapes the per-PO
// directory. The combination of `safeExtension` + server-generated
// `storageKey` should make this impossible, but the check is the
// security backstop.
export function resolveAttachmentPath(
  tenantId: string,
  purchaseOrderId: string,
  storageKey: string
): string {
  if (!/^[a-z0-9._-]+$/i.test(storageKey)) {
    throw new Error('invalid_storage_key');
  }
  const dir = poDir(tenantId, purchaseOrderId);
  const candidate = path.resolve(dir, storageKey);
  const dirResolved = path.resolve(dir);
  if (!candidate.startsWith(dirResolved + path.sep) && candidate !== dirResolved) {
    throw new Error('path_traversal_blocked');
  }
  return candidate;
}

export async function attachmentExists(absolutePath: string): Promise<boolean> {
  try {
    const s = await stat(absolutePath);
    return s.isFile();
  } catch {
    return false;
  }
}

export function streamAttachment(absolutePath: string): NodeJS.ReadableStream {
  return createReadStream(absolutePath);
}
