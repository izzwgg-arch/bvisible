import { parseMoneyToCents } from '@/lib/vendor-pricing/extract';

export interface ReceiptDocumentGuesses {
  vendorNameGuess: string | null;
  invoiceNumberGuess: string | null;
  receiptNumberGuess: string | null;
  subtotalCentsGuess: number | null;
  taxCentsGuess: number | null;
  totalCentsGuess: number | null;
  documentDateGuess: Date | null;
}

function firstMatch(re: RegExp, text: string): string | null {
  const m = text.match(re);
  return m?.[1]?.trim() ?? null;
}

/** Deterministic header-ish extraction from OCR / PDF text (suggestions only). */
export function parseReceiptDocumentGuesses(text: string): ReceiptDocumentGuesses {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  let vendorNameGuess: string | null = null;
  for (const line of lines.slice(0, 8)) {
    if (/^(thank\s+you|receipt|invoice|subtotal|tax|total)/i.test(line)) continue;
    if (line.length >= 3 && line.length <= 120 && /[A-Za-z]/.test(line)) {
      vendorNameGuess = line.slice(0, 500);
      break;
    }
  }

  const invoiceNumberGuess =
    firstMatch(/\b(?:invoice|inv\.?)\s*#?\s*([A-Z0-9][A-Z0-9\-]{4,40})\b/i, normalized) ??
    firstMatch(/\b(?:invoice|inv\.?)\s*:\s*([A-Z0-9][A-Z0-9\-]{4,40})\b/i, normalized);

  const receiptNumberGuess =
    firstMatch(/\b(?:receipt|rec\.?)\s*#?\s*([A-Z0-9][A-Z0-9\-]{4,40})\b/i, normalized) ??
    firstMatch(/\border\s*#?\s*([A-Z0-9][A-Z0-9\-]{4,40})\b/i, normalized);

  const pickMoney = (label: string): number | null => {
    const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const reLine = new RegExp(
      `^\\s*${esc}\\s*[:\\-]?\\s*(?:USD)?\\s*\\$?\\s*([\\d,]+\\.\\d{2})\\s*$`,
      'i'
    );
    for (const line of lines) {
      const m = line.match(reLine);
      if (m?.[1]) {
        const cents = parseMoneyToCents(m[1]);
        if (cents != null) return cents;
      }
    }
    return null;
  };

  const subtotalCentsGuess = pickMoney('Subtotal');
  const taxCentsGuess =
    pickMoney('Tax') ??
    pickMoney('Sales Tax') ??
    pickMoney('GST') ??
    pickMoney('HST');
  const totalCentsGuess =
    pickMoney('Total') ??
    pickMoney('Amount Due') ??
    pickMoney('Balance Due');

  let documentDateGuess: Date | null = null;
  const dateRaw =
    firstMatch(
      /\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/,
      normalized
    ) ??
    firstMatch(
      /\b(20\d{2}-\d{2}-\d{2})\b/,
      normalized
    );
  if (dateRaw) {
    const d = new Date(dateRaw);
    if (!Number.isNaN(d.getTime())) documentDateGuess = d;
  }

  return {
    vendorNameGuess,
    invoiceNumberGuess,
    receiptNumberGuess,
    subtotalCentsGuess,
    taxCentsGuess,
    totalCentsGuess,
    documentDateGuess,
  };
}
