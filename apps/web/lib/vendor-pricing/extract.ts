import type {
  VendorPriceConfidence,
  VendorPriceExtractionMethod,
} from '@bvisible/db';

export interface ExtractedPriceCandidate {
  itemRaw: string;
  priceCents: number;
  unit: string | null;
  quantityMilli: number | null;
  confidence: VendorPriceConfidence;
  method: VendorPriceExtractionMethod;
  /** Stable ordinal within this extraction batch (for dedupeKey). */
  ordinal: number;
  sourceAttachmentId: string | null;
}

const PHONE_LINE =
  /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/;
const HAS_LETTER = /[A-Za-z]/;

/** Parse "$1,234.56" or "1234.5" → cents. */
export function parseMoneyToCents(raw: string): number | null {
  const t = raw.replace(/,/g, '').trim();
  if (!t || !/\d/.test(t)) return null;
  const n = Number.parseFloat(t);
  if (!Number.isFinite(n)) return null;
  const cents = Math.round(n * 100);
  if (cents <= 0 || cents > 100_000_000) return null;
  return cents;
}

function stripExtension(filename: string): string {
  return filename.replace(/\.[A-Za-z0-9]{1,8}$/, '');
}

function looksLikeGarbageItem(item: string): boolean {
  const t = item.trim();
  if (t.length < 2) return true;
  if (!HAS_LETTER.test(t)) return true;
  if (/^[\d\s.$€£,-]+$/.test(t)) return true;
  return false;
}

function confidenceFor(
  method: VendorPriceExtractionMethod,
  item: string
): VendorPriceConfidence {
  if (method === 'FILENAME_REGEX') return 'MEDIUM';
  if (method === 'SUBJECT_REGEX') return 'MEDIUM';
  if (!HAS_LETTER.test(item)) return 'LOW';
  return 'HIGH';
}

function tryPatternsOnLine(
  line: string,
  method: VendorPriceExtractionMethod,
  attachmentId: string | null,
  ordinalBase: number
): ExtractedPriceCandidate[] {
  const trimmed = line.trim();
  if (trimmed.length === 0 || PHONE_LINE.test(trimmed)) return [];

  const patterns: RegExp[] = [
    /^(.+?):\s*\$?([\d,]+\.?\d*)\s*$/i,
    /^(.+?)\s*=\s*\$?([\d,]+\.?\d*)\s*$/i,
    /^(.+?)\s*[|]\s*\$?([\d,]+\.?\d*)\s*$/i,
    /^(.+?)\s*[—\-]\s*\$?([\d,]+\.?\d*)\s*$/,
    /^(.+?)\s+\$([\d,]+\.?\d*)\s*$/i,
  ];

  let ord = ordinalBase;
  const out: ExtractedPriceCandidate[] = [];

  for (const re of patterns) {
    const m = trimmed.match(re);
    if (!m) continue;
    const rawItem = m[1];
    const rawPrice = m[2];
    if (rawItem === undefined || rawPrice === undefined) continue;
    const itemRaw = rawItem.trim();
    const priceCents = parseMoneyToCents(rawPrice);
    if (priceCents === null || looksLikeGarbageItem(itemRaw)) continue;

    let unit: string | null = null;
    const um = itemRaw.match(
      /\b(EACH|SHEET|ROLL|SQ\s*FT|SQFT|LF|LINEAR\s*FT|YD|BOX|CASE)\b/i
    );
    if (um?.[1]) unit = um[1].toUpperCase().replace(/\s+/g, ' ');

    out.push({
      itemRaw,
      priceCents,
      unit,
      quantityMilli: null,
      confidence: confidenceFor(method, itemRaw),
      method,
      ordinal: ord++,
      sourceAttachmentId: attachmentId,
    });
    break;
  }

  return out;
}

export function extractPricesFromTextBlob(
  text: string | null | undefined,
  method: VendorPriceExtractionMethod,
  attachmentId: string | null
): ExtractedPriceCandidate[] {
  if (!text) return [];
  const lines = text.split('\n');
  const out: ExtractedPriceCandidate[] = [];
  let nextOrdinal = 0;
  for (const line of lines) {
    const chunk = tryPatternsOnLine(line, method, attachmentId, nextOrdinal);
    if (chunk.length > 0) {
      nextOrdinal += chunk.length;
      out.push(...chunk);
    }
  }
  return out;
}

export function extractPricesFromSubject(
  subject: string,
  attachmentId: null
): ExtractedPriceCandidate[] {
  return tryPatternsOnLine(subject, 'SUBJECT_REGEX', attachmentId, 0);
}

export function extractPricesFromFilename(
  filename: string,
  attachmentId: string | null
): ExtractedPriceCandidate[] {
  const base = stripExtension(filename).replace(/_/g, ' ');
  const candidates = tryPatternsOnLine(
    base,
    'FILENAME_REGEX',
    attachmentId,
    0
  );
  if (candidates.length > 0) return candidates;
  // Fallback: last "$NNN" token in filename
  const m = base.match(/\$([\d,]+\.?\d*)/);
  if (!m || m[1] === undefined) return [];
  const priceCents = parseMoneyToCents(m[1]);
  if (priceCents === null) return [];
  const before = base.slice(0, m.index ?? 0).trim();
  if (before.length < 2 || !HAS_LETTER.test(before)) return [];
  return [
    {
      itemRaw: before,
      priceCents,
      unit: null,
      quantityMilli: null,
      confidence: 'MEDIUM',
      method: 'FILENAME_REGEX',
      ordinal: 0,
      sourceAttachmentId: attachmentId,
    },
  ];
}
