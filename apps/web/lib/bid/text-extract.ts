// Small deterministic text helpers used by the takeoff parser, the
// standard-sign matcher and the pricing engine: dimensions, sign wording
// (for per-character pricing) and attribute keywords. Pure functions with
// tests — no AI here.

export interface ExtractedDimensions {
  widthIn: number | null;
  heightIn: number | null;
  /** "18 inches high" style — a single height with no width. */
  heightOnlyIn: number | null;
  raw: string | null;
}

const FEET_INCHES = String.raw`(\d+(?:\.\d+)?)\s*(?:'|ft\.?|feet|foot)(?:\s*-?\s*(\d+(?:\.\d+)?)\s*(?:"|''|in\.?|inch(?:es)?)?)?`;

function toInches(feet: string | undefined, inches: string | undefined): number | null {
  const f = feet ? Number(feet) : NaN;
  const i = inches ? Number(inches) : 0;
  if (!Number.isFinite(f)) return null;
  return f * 12 + (Number.isFinite(i) ? i : 0);
}

function parseLength(token: string): number | null {
  const t = token.trim().toLowerCase();
  // 2'-6" / 2' 6" / 2 ft
  const fi = new RegExp(`^${FEET_INCHES}$`, 'i').exec(t);
  if (fi) return toInches(fi[1], fi[2]);
  // 12" / 12 in / 12-inch / 12 inches
  const inch = /^(\d+(?:\.\d+)?)\s*(?:"|''|in\.?|inch(?:es)?|-inch)?$/.exec(t);
  if (inch) return Number(inch[1]);
  return null;
}

/**
 * Finds "W × H" pairs such as 6" x 8", 6"×8", 12x18, 6 × 8-inch, 8 x 10 in,
 * 2'-0" x 3'-0", or a lone height ("18 inches high", "18\" tall", "2' numerals").
 */
export function extractDimensions(text: string | null | undefined): ExtractedDimensions {
  const none: ExtractedDimensions = { widthIn: null, heightIn: null, heightOnlyIn: null, raw: null };
  if (!text) return none;
  const src = text.replace(/[“”]/g, '"').replace(/[’]/g, "'");

  const pair = /(\d+(?:\.\d+)?(?:\s*(?:'|ft\.?|feet)\s*-?\s*\d*(?:\.\d+)?)?\s*(?:"|''|in\.?|inch(?:es)?|-inch)?)\s*(?:x|×|by)\s*(\d+(?:\.\d+)?(?:\s*(?:'|ft\.?|feet)\s*-?\s*\d*(?:\.\d+)?)?\s*(?:"|''|in\.?|inch(?:es)?|-inch)?)/i.exec(src);
  if (pair) {
    let w = parseLength(pair[1]!);
    let h = parseLength(pair[2]!);
    // "6 x 8-inch": unit given once at the end applies to both.
    if (w !== null && h !== null && /-?inch|"|in\b/i.test(pair[2]!) && !/(?:'|ft|feet|"|in)/i.test(pair[1]!)) {
      // both are inches already
    }
    if (w !== null && h !== null && /'|ft|feet/i.test(pair[2]!) && !/(?:'|ft|feet|"|in)/i.test(pair[1]!)) {
      // "2 x 3'" → both feet
      w = w * 12;
    }
    if (w !== null && h !== null && w > 0 && h > 0 && w <= 2000 && h <= 2000) {
      return { widthIn: w, heightIn: h, heightOnlyIn: null, raw: pair[0] };
    }
  }

  const heightOnly = /(\d+(?:\.\d+)?)\s*(?:"|''|-?inch(?:es)?|in\.?|'|ft\.?|feet)\s+(?:[a-z][\w-]*\s+){0,2}?(?:high|tall|height|letters?|numerals?|characters?|cap(?:ital)?s?)\b/i.exec(src);
  if (heightOnly) {
    const unit = heightOnly[0];
    let h = Number(heightOnly[1]);
    if (/'|ft|feet/i.test(unit) && !/"|inch|in\b/i.test(unit)) h *= 12;
    if (h > 0 && h <= 2000) return { widthIn: null, heightIn: null, heightOnlyIn: h, raw: heightOnly[0] };
  }
  return none;
}

export interface ExtractedWording {
  text: string;
  /** Letters + digits only (spaces and punctuation are not billed). */
  characterCount: number;
  source: 'QUOTED' | 'CAPS' | 'DASH' | 'NONE';
}

const STOP_CAPS = new Set(['ADA', 'EXIT', 'ID', 'PVC', 'HIP', 'LED', 'VHB', 'UL', 'NYC', 'BOH', 'MEP', 'FDC', 'HDU', 'CNC', 'OSHA', 'ANSI', 'ICC', 'ASME', 'BC', 'EV', 'AFF']);

/**
 * Sign wording used for per-character pricing: quoted text first
 * (“AZURA PHASE 1”), then a "— AZURA PHASE 1" tail, then the longest run of
 * ALL-CAPS words / numbers that is not a common acronym.
 */
export function extractWording(text: string | null | undefined): ExtractedWording {
  const none: ExtractedWording = { text: '', characterCount: 0, source: 'NONE' };
  if (!text) return none;
  const src = text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");

  const quoted = /"([^"]{1,80})"/.exec(src) ?? /'([^']{2,80})'/.exec(src);
  if (quoted && /[A-Za-z0-9]/.test(quoted[1]!)) {
    const t = quoted[1]!.trim().replace(/[,.;:]+$/, '');
    return { text: t, characterCount: countChargeableCharacters(t), source: 'QUOTED' };
  }

  const dash = /[—–-]\s*([A-Z0-9][A-Z0-9 &'.\-]{2,60})\s*$/.exec(src.trim());
  if (dash) {
    const t = dash[1]!.trim();
    if (/[A-Z]{2,}/.test(t) || /\d/.test(t)) return { text: t, characterCount: countChargeableCharacters(t), source: 'DASH' };
  }

  // Longest run of ALL-CAPS tokens (>=2 tokens, or 1 token with digits).
  const tokens = src.split(/\s+/);
  let best: string[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length > best.length) best = run;
    run = [];
  };
  for (const raw of tokens) {
    const tok = raw.replace(/^[("'\[]+|[)"'\],.;:]+$/g, '');
    const isCaps = /^[A-Z0-9][A-Z0-9&'.\-]*$/.test(tok) && /[A-Z0-9]/.test(tok) && !STOP_CAPS.has(tok);
    if (isCaps) run.push(tok);
    else flush();
  }
  flush();
  const meaningful = best.filter((t) => t.length > 0);
  if (meaningful.length >= 2 || (meaningful.length === 1 && /\d/.test(meaningful[0]!) && meaningful[0]!.length >= 3)) {
    const t = meaningful.join(' ');
    return { text: t, characterCount: countChargeableCharacters(t), source: 'CAPS' };
  }
  return none;
}

export function countChargeableCharacters(text: string): number {
  return (text.match(/[A-Za-z0-9]/g) ?? []).length;
}

export interface SignAttributes {
  braille: boolean;
  tactile: boolean;
  illuminated: boolean;
  /** 'HALO' | 'FACE' | 'NON_ILLUMINATED' | null when unknown */
  illumination: 'HALO' | 'FACE' | 'NON_ILLUMINATED' | null;
  material: string | null;
  mounting: string | null;
  dimensional: boolean;
  channelLetters: boolean;
  wrap: boolean;
  canopy: boolean;
  reflective: boolean;
}

export function extractSignAttributes(text: string | null | undefined): SignAttributes {
  const t = (text ?? '').toLowerCase();
  const braille = /braille/.test(t);
  const tactile = /tactile|raised (?:text|copy|character|letter|number)/.test(t) || braille;
  const halo = /halo|reverse[- ]?lit|reverse[- ]?channel/.test(t);
  const face = /face[- ]?lit|front[- ]?lit/.test(t);
  const nonIll = /non[- ]?illuminated|not illuminated|unlit/.test(t);
  const illuminated = !nonIll && (halo || face || /illuminated|backlit|led|lit\b/.test(t));
  const material =
    /acrylic/.test(t) ? 'acrylic'
    : /aluminum|aluminium/.test(t) ? 'aluminum'
    : /\bpvc\b/.test(t) ? 'PVC'
    : /\bhdu\b|urethane/.test(t) ? 'HDU'
    : /vinyl/.test(t) ? 'vinyl'
    : /wood|walnut|oak|maple/.test(t) ? 'wood'
    : /metal|steel|stainless|bronze|brass|satin[- ]nickel|cast/.test(t) ? 'metal'
    : /coroplast/.test(t) ? 'coroplast'
    : null;
  const mounting =
    /stud[- ]?mount/.test(t) ? 'stud mounted'
    : /vhb|tape/.test(t) ? 'tape mounted'
    : /post|pole/.test(t) ? 'post mounted'
    : /flush|wall[- ]?mount|surface[- ]?mount/.test(t) ? 'wall mounted'
    : /hanging|suspend|ceiling/.test(t) ? 'suspended'
    : /projecting|blade/.test(t) ? 'projecting'
    : null;
  const channelLetters = /channel letter/.test(t) || (illuminated && /letter|character|numeral/.test(t));
  const dimensional = !channelLetters && /dimensional|3[- ]?d\b|cut[- ]?out|individual (?:letters|numerals|characters)|(?:letters|numerals) (?:mounted|stud)/.test(t);
  return {
    braille,
    tactile,
    illuminated,
    illumination: nonIll ? 'NON_ILLUMINATED' : halo ? 'HALO' : face ? 'FACE' : null,
    material,
    mounting,
    dimensional,
    channelLetters,
    wrap: /vehicle wrap|\bwrap\b/.test(t),
    canopy: /\bcanop(?:y|ies)\b|awning/.test(t),
    reflective: /reflective|\bhip\b|engineer grade/.test(t),
  };
}

/** Lowercase, fold × → x, strip punctuation to spaces, collapse whitespace. */
export function normalizeSignText(text: string | null | undefined): string {
  return (text ?? '')
    .toLowerCase()
    .replace(/[“”"’']/g, '')
    .replace(/×/g, 'x')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9/.\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
