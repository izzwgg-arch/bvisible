import { hash, verify } from '@node-rs/argon2';

// OWASP Argon2id recommended baseline: 19 MiB memory, 2 iterations, parallelism 1.
// We bump memory to 64 MiB because the production box has 47 GB and we'd
// rather a single login take ~50ms than ~10ms. Re-tune if login latency
// becomes a problem (rare — auth is bursty, not sustained).
//
// algorithm: 2 = Argon2id (Algorithm.Argon2id from @node-rs/argon2; we
// inline the value because it's a const enum and isolatedModules forbids
// referencing ambient const-enum members).
const ARGON2_OPTS = {
  algorithm: 2,
  memoryCost: 65536, // KiB → 64 MiB
  timeCost: 3,
  parallelism: 1,
} as const;

export async function hashPassword(plaintext: string): Promise<string> {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('hashPassword: empty input');
  }
  return hash(plaintext, ARGON2_OPTS);
}

export async function verifyPassword(
  plaintext: string,
  storedHash: string
): Promise<boolean> {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    return false;
  }
  if (typeof storedHash !== 'string' || storedHash.length === 0) {
    return false;
  }
  try {
    return await verify(storedHash, plaintext);
  } catch {
    // Malformed hash, wrong algorithm, etc. Treat as a verification miss
    // rather than throwing — login flow turns this into "invalid credentials".
    return false;
  }
}
