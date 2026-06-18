// Deterministic vendor / material label normalization (no fuzzy matching, no AI).

const TRAILING_UNIT_SUFFIX =
  /\s+(?:EA|EACH|PCS?|PC|PAIR|PAIRS|SET|SETS|ROLL|ROLLS|SHEET|SHEETS|SQ\s*FT|SQFT|SF|LF|LINEAR\s*FT|YD|YARD|BOX|CASE|PK|PACK)\s*$/i;

/** Deterministic token folds (no fuzzy scoring). */
function foldVendorMaterialTokens(normalizedUpper: string): string {
  const tokens = normalizedUpper.split(' ').filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const next = tokens[i + 1];
    if (t === 'CORO' && next === 'PLAST') {
      out.push('COROPLAST');
      i += 1;
      continue;
    }
    if (t === 'CORO') {
      out.push('COROPLAST');
      continue;
    }
    out.push(t);
  }
  return out.join(' ');
}

const PLURAL_TO_SINGULAR: ReadonlyArray<[RegExp, string]> = [
  [/\bSHEETS\b/g, 'SHEET'],
  [/\bROLLS\b/g, 'ROLL'],
  [/\bPAIRS\b/g, 'PAIR'],
  [/\bSETS\b/g, 'SET'],
  [/\bBOXES\b/g, 'BOX'],
];

/** Strip vendor unit tokens from the material label before catalog keying. */
export function stripTrailingUnitSuffix(normalized: string): string {
  let s = normalized;
  for (let i = 0; i < 3; i++) {
    const next = s.replace(TRAILING_UNIT_SUFFIX, '').trim();
    if (next === s) break;
    s = next;
  }
  return s.trim();
}

/**
 * Canonical material key for deterministic alias clustering.
 * Same tokens in different order map to one key (display normalize may differ).
 */
export function canonicalMaterialKey(raw: string): string {
  const base = stripTrailingUnitSuffix(normalizeVendorItemName(raw));
  if (!base) return '';
  const tokens = base.split(' ').filter(Boolean);
  return [...new Set(tokens)].sort((a, b) => a.localeCompare(b)).join(' ');
}

/** Vendor SKU / part number normalization (exact match only). */
export function normalizeVendorSku(raw: string): string {
  return raw
    .replace(/\s+/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9\-_.]/g, '');
}

export function normalizeVendorItemName(raw: string): string {
  let s = raw.replace(/\r/g, '').trim();
  if (s.length === 0) return '';

  s = s.replace(/[’']/g, "'");
  s = s.replace(/(\d+(?:\.\d+)?)"/g, '$1IN');
  s = s.replace(
    /\b(\d+(?:\.\d+)?)\s*(?:IN|INCH|INCHES)\b/gi,
    (_, n: string) => `${n}IN`,
  );
  s = s.replace(/\b(\d+(?:\.\d+)?)\s*MM\b/gi, (_, n: string) => `${n}MM`);
  s = s.replace(/\b(\d+(?:\.\d+)?)\s*CM\b/gi, (_, n: string) => `${n}CM`);

  s = s.replace(
    /\b(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)\b/g,
    (_, a: string, b: string) => `${a}X${b}`,
  );

  s = s.replace(/([A-Z0-9])[-–—.]([A-Z0-9])/gi, '$1$2');
  s = s.replace(/[-–—]+/g, ' ');

  for (const [re, rep] of PLURAL_TO_SINGULAR) {
    s = s.replace(re, rep);
  }

  s = foldVendorMaterialTokens(s);

  s = s.replace(/\s+/g, ' ');
  s = s.replace(/^[,;:|=\-–—]+/, '').replace(/[,;:|=\-–—]+$/, '');
  s = s.replace(/\s+/g, ' ').trim();

  return s.toUpperCase();
}

const DISPLAY_ACRONYMS = new Set(['acm', 'pvc', 'abs', 'eps', 'petg', 'uv', 'led']);

/** Human-readable label for vendor catalog / price rows (UI only). */
export function formatVendorItemDisplayName(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase();
      if (/^\d+x\d+$/.test(lower)) return lower.toUpperCase();
      if (/\d/.test(lower)) return lower.toUpperCase();
      if (DISPLAY_ACRONYMS.has(lower)) return lower.toUpperCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}
