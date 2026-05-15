/**
 * Split estimate.header.finalPriceCents across lines proportionally to cached
 * computedCostCents (same basis as R-EST sell multiplier). Ensures the sum of
 * allocated cents equals finalPriceCents (largest-remainder method).
 */
export function allocateEstimateSellToInvoiceLines(input: {
  finalPriceCents: number;
  lines: ReadonlyArray<{ computedCostCents: number }>;
}): number[] {
  const n = input.lines.length;
  if (n === 0) return [];
  const fp = Math.max(0, Math.trunc(input.finalPriceCents));
  const weights = input.lines.map((l) => Math.max(0, Math.trunc(l.computedCostCents)));
  const wsum = weights.reduce((a, b) => a + b, 0);

  if (wsum === 0) {
    const base = Math.floor(fp / n);
    const out = Array.from({ length: n }, () => base);
    let rem = fp - base * n;
    for (let i = n - 1; i >= 0 && rem > 0; i--) {
      const cell = out[i];
      if (cell !== undefined) {
        out[i] = cell + 1;
      }
      rem--;
    }
    return out;
  }

  const raw = weights.map((w) => (fp * w) / wsum);
  const floors = raw.map((x) => Math.floor(x));
  let remainder = fp - floors.reduce((a, b) => a + b, 0);

  const order = raw
    .map((x, i) => ({ i, frac: x - (floors[i] ?? 0) }))
    .sort((a, b) => b.frac - a.frac);

  let k = 0;
  while (remainder > 0 && order.length > 0) {
    const slot = order[k % order.length];
    if (slot) {
      const prev = floors[slot.i];
      if (prev !== undefined) floors[slot.i] = prev + 1;
      remainder--;
    }
    k++;
    if (k > fp * 3) break;
  }

  return floors;
}
