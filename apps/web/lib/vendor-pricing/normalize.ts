// Deterministic vendor item name normalization for catalog keys.
// Uppercase, trim, collapse whitespace, normalize dimension separators.

export function normalizeVendorItemName(raw: string): string {
  let s = raw.replace(/\r/g, '').trim();
  if (s.length === 0) return '';

  // Normalize common dimension patterns: "4 x 8", "4x8", "4 X 8" → "4X8"
  s = s.replace(
    /\b(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)\b/g,
    (_, a: string, b: string) => `${a}X${b}`
  );

  // Collapse internal whitespace; strip stray punctuation edges from extraction
  s = s.replace(/\s+/g, ' ');
  s = s.replace(/^[,;:|=\-–—]+/, '').replace(/[,;:|=\-–—]+$/, '');
  s = s.replace(/\s+/g, ' ').trim();

  return s.toUpperCase();
}
