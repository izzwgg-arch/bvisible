import { createHash } from 'node:crypto';

/** Stable SHA-256 hex for reconciliation triggers / spend-alert dedupe keys. */
export function reconciliationDedupeKey(parts: Record<string, unknown>): string {
  const sortedKeys = Object.keys(parts).sort();
  const canonical: Record<string, unknown> = {};
  for (const k of sortedKeys) {
    canonical[k] = parts[k];
  }
  return createHash('sha256')
    .update(JSON.stringify(canonical), 'utf8')
    .digest('hex');
}
