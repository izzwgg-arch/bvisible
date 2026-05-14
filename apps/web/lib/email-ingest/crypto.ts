import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

// Symmetric envelope for IMAP passwords stored in TenantEmailInbox.
// AES-256-GCM with a 12-byte random IV per ciphertext. The encryption
// key is derived from INGEST_SECRET (a base64-or-hex blob in
// /opt/bvisible/shared/env/.env). A DB leak alone never yields a live
// password — the key is held only in process memory.
//
// The ciphertext format is base64(iv | tag | ciphertext) so a single
// column round-trips cleanly.

const KEY_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;

class IngestCryptoConfigError extends Error {
  readonly kind = 'config' as const;
  constructor(message: string) {
    super(message);
    this.name = 'IngestCryptoConfigError';
  }
}

function loadKey(): Buffer {
  const raw = process.env.INGEST_SECRET;
  if (!raw) {
    throw new IngestCryptoConfigError(
      'INGEST_SECRET is required to encrypt/decrypt IMAP passwords'
    );
  }
  // Accept any reasonably-sized secret string. We hash it to land at
  // exactly 32 bytes (AES-256) so the operator can pick a length they
  // can rotate easily without breaking the cipher.
  return createHash('sha256').update(raw, 'utf8').digest();
}

export interface SealedSecret {
  cipherText: string;
}

export function sealSecret(plain: string): SealedSecret {
  const key = loadKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const out = Buffer.concat([iv, tag, enc]).toString('base64');
  return { cipherText: out };
}

export function openSecret(cipherText: string): string {
  const key = loadKey();
  const buf = Buffer.from(cipherText, 'base64');
  if (buf.length < IV_LEN + TAG_LEN + 1) {
    throw new IngestCryptoConfigError('Sealed secret is malformed.');
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
  return dec.toString('utf8');
}

// Constant-time compare of the shared-secret header used by the
// internal tick route. Avoids leaking via response timing whether
// the configured secret matches the prefix of the supplied value.
export function safeCompareSecret(
  presented: string | null | undefined,
  expected: string | null | undefined
): boolean {
  if (!presented || !expected) return false;
  const a = Buffer.from(presented, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export { KEY_LEN as INGEST_KEY_LEN, IV_LEN as INGEST_IV_LEN };
