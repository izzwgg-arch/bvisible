import { randomBytes, createHash } from 'node:crypto';

// 32 bytes = 256 bits of entropy. Base64url to keep them URL-safe (used in
// invite + reset links). Length: 43 characters (no padding).
const TOKEN_BYTES = 32;

export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

// We store SHA-256(token) in the DB so a DB leak does not leak live
// tokens. Argon2 is overkill here — these tokens are already 256 bits of
// uniform random, so the only attack is offline brute-force which costs
// 2^256 even with SHA-256. Cheap is correct.
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

// Convenience for invite/reset links: the path-encoded form of the raw
// token. Identical to the raw token (base64url is already URL-safe) but
// makes intent explicit at call sites.
export function tokenForUrl(token: string): string {
  return token;
}
