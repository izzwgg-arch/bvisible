const BASE_MS = 2000;
const CAP_MS = 120_000;

/** Exponential backoff with optional jitter (deterministic when jitter=0). */
export function computeBackoffMs(retryCount: number, jitterMs: number): number {
  const cappedPow = Math.min(16, Math.max(0, retryCount));
  const exp = Math.min(CAP_MS, BASE_MS * Math.pow(2, cappedPow));
  return Math.min(CAP_MS, exp + Math.max(0, jitterMs));
}

export function randomJitterMs(max = 800): number {
  return Math.floor(Math.random() * max);
}
