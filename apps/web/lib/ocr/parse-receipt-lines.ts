import type { VendorPriceConfidence } from '@bvisible/db';
import { parseMoneyToCents } from '@/lib/vendor-pricing/extract';

export interface ReceiptLineCandidate {
  itemRaw: string;
  priceCents: number;
  unit: string | null;
  quantityMilli: number | null;
  sourceLineText: string;
  /** Short deterministic label for UI / extractionSource (max ~60 chars). */
  parseReason: string;
  confidence: VendorPriceConfidence;
}

const PHONE_LINE =
  /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/;
const HAS_LETTER = /[A-Za-z]/;

const SKIP_SUMMARY_LINE =
  /^\s*(?:sub\s*total|subtotal|tax|sales\s*tax|gst|hst|vat|total|amount\s*due|balance\s*due|grand\s*total|shipping|freight|discount|payment|paid|change\s*due|tip|gratuity|card\s*#|auth\s*#)\b/i;

const META_ONLY_LINE =
  /^\s*(?:invoice|inv\.?|receipt|rec\.?|order|po)\s*#?\s*[:.\-]?\s*[A-Z0-9][A-Z0-9\-]{2,40}\s*$/i;

const DATE_ONLY_LINE =
  /^\s*(?:date|dated)?\s*\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\s*$/i;

function toQuantityMilli(qty: number): number | null {
  if (!Number.isFinite(qty) || qty <= 0 || qty > 100_000) return null;
  return Math.round(qty * 1000);
}

function extractUnit(itemRaw: string): string | null {
  const um = itemRaw.match(
    /\b(EACH|EA|PCS?|SHEET|ROLL|SQ\s*FT|SQFT|LF|LINEAR\s*FT|YD|BOX|CASE|PK|PACK)\b/i
  );
  return um?.[1] ? um[1].toUpperCase().replace(/\s+/g, ' ') : null;
}

function looksLikeItemLabel(item: string): boolean {
  const t = item.trim();
  if (t.length < 2) return false;
  if (!HAS_LETTER.test(t)) return false;
  if (/^[\d\s.$€£¥,-]+$/.test(t)) return false;
  if (META_ONLY_LINE.test(t)) return false;
  if (SKIP_SUMMARY_LINE.test(t)) return false;
  return true;
}

function pushCandidate(
  out: ReceiptLineCandidate[],
  seen: Set<string>,
  args: Omit<ReceiptLineCandidate, 'confidence'> & { confidence?: VendorPriceConfidence }
): void {
  const key = `${args.itemRaw.toLowerCase()}|${args.priceCents}|${args.quantityMilli ?? ''}`;
  if (seen.has(key)) return;
  seen.add(key);
  out.push({
    ...args,
    confidence: args.confidence ?? 'LOW',
  });
}

type LineMatch = {
  itemRaw: string;
  priceCents: number;
  quantityMilli: number | null;
  unit: string | null;
  parseReason: string;
};

function tryMatchLine(trimmed: string): LineMatch | null {
  if (trimmed.length === 0 || PHONE_LINE.test(trimmed)) return null;
  if (SKIP_SUMMARY_LINE.test(trimmed)) return null;
  if (META_ONLY_LINE.test(trimmed)) return null;
  if (DATE_ONLY_LINE.test(trimmed)) return null;

  // 2 x $45.00  or  2 x 45.00
  const qtyTimes = trimmed.match(
    /^(.+?)\s+(\d+(?:\.\d+)?)\s*x\s*(?:USD\s*)?\$?\s*([\d,]+\.\d{2})\s*$/i
  );
  if (qtyTimes) {
    const itemRaw = qtyTimes[1]!.trim();
    const qty = Number.parseFloat(qtyTimes[2]!);
    const priceCents = parseMoneyToCents(qtyTimes[3]!);
    if (priceCents != null && looksLikeItemLabel(itemRaw)) {
      return {
        itemRaw,
        priceCents,
        quantityMilli: toQuantityMilli(qty),
        unit: extractUnit(itemRaw),
        parseReason: 'qty_times_unit_price',
      };
    }
  }

  // Item ... qty 2 ... $45.00
  const qtyLabel = trimmed.match(
    /^(.+?)\s+qty\s*[:.]?\s*(\d+(?:\.\d+)?)\s+(?:USD\s*)?\$?\s*([\d,]+\.\d{2})\s*$/i
  );
  if (qtyLabel) {
    const itemRaw = qtyLabel[1]!.trim();
    const qty = Number.parseFloat(qtyLabel[2]!);
    const priceCents = parseMoneyToCents(qtyLabel[3]!);
    if (priceCents != null && looksLikeItemLabel(itemRaw)) {
      return {
        itemRaw,
        priceCents,
        quantityMilli: toQuantityMilli(qty),
        unit: extractUnit(itemRaw),
        parseReason: 'qty_label_unit_price',
      };
    }
  }

  // 2 @ $45.00
  const qtyAt = trimmed.match(
    /^(.+?)\s+(\d+(?:\.\d+)?)\s*@\s*(?:USD\s*)?\$?\s*([\d,]+\.\d{2})\s*$/i
  );
  if (qtyAt) {
    const itemRaw = qtyAt[1]!.trim();
    const qty = Number.parseFloat(qtyAt[2]!);
    const priceCents = parseMoneyToCents(qtyAt[3]!);
    if (priceCents != null && looksLikeItemLabel(itemRaw)) {
      return {
        itemRaw,
        priceCents,
        quantityMilli: toQuantityMilli(qty),
        unit: extractUnit(itemRaw),
        parseReason: 'qty_at_unit_price',
      };
    }
  }

  const patterns: { re: RegExp; reason: string }[] = [
    { re: /^(.+?):\s*(?:USD\s*)?\$?\s*([\d,]+\.\d{2})\s*$/i, reason: 'label_colon_price' },
    { re: /^(.+?)\s*=\s*(?:USD\s*)?\$?\s*([\d,]+\.\d{2})\s*$/i, reason: 'label_equals_price' },
    { re: /^(.+?)\s+\$\s*([\d,]+\.\d{2})\s*$/i, reason: 'label_dollar_price' },
    { re: /^(.+?)\s+(?:USD\s*)?([\d,]+\.\d{2})\s*$/i, reason: 'label_trailing_price' },
    { re: /^(.+?)\s*[—\-]\s*(?:USD\s*)?\$?\s*([\d,]+\.\d{2})\s*$/i, reason: 'label_dash_price' },
  ];

  for (const { re, reason } of patterns) {
    const m = trimmed.match(re);
    if (!m?.[1] || !m[2]) continue;
    const itemRaw = m[1].trim();
    const priceCents = parseMoneyToCents(m[2]);
    if (priceCents == null || !looksLikeItemLabel(itemRaw)) continue;
    // Avoid invoice # lines where trailing token is not a plausible line price
    if (/^(?:invoice|inv\.?|receipt|order)\s*#?/i.test(itemRaw) && itemRaw.length < 40) {
      continue;
    }
    return {
      itemRaw,
      priceCents,
      quantityMilli: null,
      unit: extractUnit(itemRaw),
      parseReason: reason,
    };
  }

  return null;
}

/**
 * Deterministic receipt/invoice line extraction for OCR text.
 * Skips subtotal/tax/total rows and invoice-meta-only lines.
 */
export function parseReceiptLineCandidates(
  text: string,
  maxItems = 120
): ReceiptLineCandidate[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  const out: ReceiptLineCandidate[] = [];
  const seen = new Set<string>();

  for (const raw of lines) {
    const trimmed = raw.trim();
    const match = tryMatchLine(trimmed);
    if (!match) continue;
    pushCandidate(out, seen, {
      ...match,
      sourceLineText: trimmed.slice(0, 2000),
    });
    if (out.length >= maxItems) break;
  }

  return out;
}
