/** Parse user-entered USD into integer cents (≥ 0). Returns null when invalid. */
export function parseUsdToCents(raw: string): number | null {
  const t = raw.trim().replace(/[$,\s]/g, '');
  if (!t) return null;
  const n = Number.parseFloat(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}
