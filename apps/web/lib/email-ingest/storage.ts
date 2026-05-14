import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  ALLOWED_MIMES,
  detectMimeFromBytes,
  newStorageKey,
  resolveAttachmentPath,
  safeOriginalFilename,
  type AllowedMime,
  type DetectedMime,
} from '@/lib/po/uploads';

// Inbound email attachments live under a separate subtree from
// hand-uploaded PO attachments so a stray email never collides with a
// human upload AND a misconfigured ingest never corrupts the live PO
// directory.
//
//   /opt/bvisible/shared/uploads/<tenantId>/email/<ingestedEmailId>/<storageKey>
//
// When an email is matched (or manually linked) we COPY the bytes into
// the matched PO's directory and create a POAttachment row. Both paths
// reuse the same magic-byte allowlist + path-traversal protection from
// apps/web/lib/po/uploads.ts, so the security envelope is identical.

function uploadRoot(): string {
  return path.resolve(process.env.UPLOAD_DIR ?? '/opt/bvisible/shared/uploads');
}

function emailDir(tenantId: string, ingestedEmailId: string): string {
  if (!/^[a-z0-9]+$/i.test(tenantId)) {
    throw new Error('invalid_tenant_id');
  }
  if (!/^[a-z0-9]+$/i.test(ingestedEmailId)) {
    throw new Error('invalid_ingested_email_id');
  }
  return path.join(uploadRoot(), tenantId, 'email', ingestedEmailId);
}

export interface PersistEmailAttachmentInput {
  tenantId: string;
  ingestedEmailId: string;
  originalFilename: string;
  bytes: Uint8Array;
}

export interface PersistedEmailAttachment {
  storageKey: string;
  absolutePath: string;
  detected: DetectedMime;
  sha256: string;
}

export class UnsupportedAttachmentError extends Error {
  readonly kind = 'unsupported_mime' as const;
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedAttachmentError';
  }
}

// Persist an inbound attachment under the per-email directory, after
// magic-byte sniff + allowlist enforcement. Returns the metadata the
// caller writes into IngestedEmailAttachment.
export async function persistEmailAttachment(
  input: PersistEmailAttachmentInput
): Promise<PersistedEmailAttachment> {
  const detected = detectMimeFromBytes(input.bytes);
  if (!detected || !ALLOWED_MIMES.includes(detected.mime)) {
    throw new UnsupportedAttachmentError(
      `MIME outside allowlist (${ALLOWED_MIMES.join(', ')})`
    );
  }
  const original = safeOriginalFilename(input.originalFilename);
  const storageKey = newStorageKey(original);
  const dir = emailDir(input.tenantId, input.ingestedEmailId);
  await mkdir(dir, { recursive: true, mode: 0o750 });
  const target = path.join(dir, storageKey);
  await writeFile(target, input.bytes, { mode: 0o640 });
  const sha256 = createHash('sha256').update(input.bytes).digest('hex');
  return { storageKey, absolutePath: target, detected, sha256 };
}

export function resolveEmailAttachmentPath(
  tenantId: string,
  ingestedEmailId: string,
  storageKey: string
): string {
  if (!/^[a-z0-9._-]+$/i.test(storageKey)) {
    throw new Error('invalid_storage_key');
  }
  const dir = emailDir(tenantId, ingestedEmailId);
  const candidate = path.resolve(dir, storageKey);
  const dirResolved = path.resolve(dir);
  if (
    !candidate.startsWith(dirResolved + path.sep) &&
    candidate !== dirResolved
  ) {
    throw new Error('path_traversal_blocked');
  }
  return candidate;
}

// Promote an ingested-email attachment into a PO attachment by copying
// the bytes (cheap on the same filesystem, atomic-enough for our
// purposes). We keep the email-side row + bytes for audit; the PO row
// gets a fresh storageKey under the per-PO directory and its own
// `mimeType` from the same trusted detection result.
export interface PromoteToPoInput {
  tenantId: string;
  purchaseOrderId: string;
  ingestedEmailId: string;
  emailStorageKey: string;
  originalFilename: string;
  detectedMime: AllowedMime;
}

export interface PromotedAttachment {
  poStorageKey: string;
  poAbsolutePath: string;
}

export async function promoteEmailAttachmentToPo(
  input: PromoteToPoInput
): Promise<PromotedAttachment> {
  const src = resolveEmailAttachmentPath(
    input.tenantId,
    input.ingestedEmailId,
    input.emailStorageKey
  );
  const poStorageKey = newStorageKey(input.originalFilename);
  const poPath = resolveAttachmentPath(
    input.tenantId,
    input.purchaseOrderId,
    poStorageKey
  );
  await mkdir(path.dirname(poPath), { recursive: true, mode: 0o750 });
  await copyFile(src, poPath);
  return { poStorageKey, poAbsolutePath: poPath };
}
