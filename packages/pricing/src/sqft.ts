// Square footage from inches (R-EST-02): sqft = w_in * h_in / 144.
// Returned as a JS number with 4 decimals of precision; UI rounds to
// 2 for display. Used by banner pricing and the channel-letter helper
// (deferred to a later phase).

export function computeSqft(widthInches: number, heightInches: number): number {
  if (!Number.isFinite(widthInches) || !Number.isFinite(heightInches)) return 0;
  if (widthInches <= 0 || heightInches <= 0) return 0;
  const raw = (widthInches * heightInches) / 144;
  return Math.round(raw * 10000) / 10000;
}

/**
 * Total area for `pieceCount` identical rectangles (R-EST-02).
 * `pieceCount` is truncated to a non-negative integer.
 */
export function computeTotalSqftFromPieces(
  sqftPerPiece: number,
  pieceCount: number,
): number {
  const sq = Math.max(0, Number.isFinite(sqftPerPiece) ? sqftPerPiece : 0);
  const n = Math.max(0, Math.trunc(Number.isFinite(pieceCount) ? pieceCount : 0));
  const raw = sq * n;
  return Math.round(raw * 10000) / 10000;
}
