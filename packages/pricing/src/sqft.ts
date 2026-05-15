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

/** Total sq ft for identical pieces: pieceSqft × count (4 decimal rounding like computeSqft). */
export function computeTotalSqft(pieceSqft: number, pieceCount: number): number {
  const p = Math.max(0, Number.isFinite(pieceSqft) ? pieceSqft : 0);
  const n = Math.max(0, Number.isFinite(pieceCount) ? Math.floor(pieceCount) : 0);
  const raw = p * n;
  return Math.round(raw * 10000) / 10000;
}

/** Width × height per piece (sq ft each) plus total for `pieceCount` identical pieces. */
export function computePieceAndTotalSqftFromInches(
  widthInches: number,
  heightInches: number,
  pieceCount: number,
): { pieceSqft: number; totalSqft: number } {
  const pieceSqft = computeSqft(widthInches, heightInches);
  const n = Math.max(0, Number.isFinite(pieceCount) ? Math.floor(pieceCount) : 0);
  const totalSqft = computeTotalSqft(pieceSqft, n);
  return { pieceSqft, totalSqft };
}
