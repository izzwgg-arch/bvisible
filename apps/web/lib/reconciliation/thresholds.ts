function parseBoundedInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Basis points (100 = 1%) default for unit-price proximity vs PO line. */
export function readReconciliationThresholds(): {
  priceTolBps: number;
  absolutePriceTolCents: number;
  qtyTolBps: number;
} {
  return {
    priceTolBps: parseBoundedInt(
      process.env.RECON_PRICE_TOLERANCE_BPS,
      100,
      0,
      10_000,
    ),
    absolutePriceTolCents: parseBoundedInt(
      process.env.RECON_ABSOLUTE_PRICE_TOLERANCE_CENTS,
      50,
      0,
      1_000_000,
    ),
    qtyTolBps: parseBoundedInt(
      process.env.RECON_QTY_TOLERANCE_BPS,
      100,
      0,
      10_000,
    ),
  };
}
