import { createHash, randomBytes, timingSafeEqual } from 'crypto';

/** ~43 chars, URL-safe (base64url). */
export function generateRawQuoteToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashQuoteToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

/** Base64url tokens from generateRawQuoteToken(); rejects injection / garbage lengths. */
export function isPlausibleQuoteToken(raw: string): boolean {
  if (typeof raw !== 'string') return false;
  if (raw.length < 40 || raw.length > 64) return false;
  return /^[A-Za-z0-9_-]+$/.test(raw);
}

/** Timing-safe compare of two SHA-256 hex strings (64 hex chars each). */
export function timingSafeEqualHex(aHex: string, bHex: string): boolean {
  try {
    const a = Buffer.from(aHex, 'hex');
    const b = Buffer.from(bHex, 'hex');
    if (a.length !== b.length || a.length !== 32) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
