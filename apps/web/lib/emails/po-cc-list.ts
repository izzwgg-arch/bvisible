// Parsing and validation for a purchase-order CC list.
//
// Pure and dependency-free ON PURPOSE: the admin form, the pre-send confirm
// panel, and the server actions all import this same module, so the list the
// operator sees validated in the browser is normalized by exactly the same
// code that decides what gets put in the CC header. A client-side copy of
// these rules would eventually disagree with the server's.

/// Max addresses on one list. Not a protocol limit — a guard so a paste
/// accident cannot turn one PO into a hundred-recipient blast.
export const PO_CC_MAX_RECIPIENTS = 25;

/// Deliberately simple, and the same shape used elsewhere in the app
/// (lib/po/office-reminder.ts `isValidEmail`). Real deliverability is proven
/// by the send, not by a clever regex.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidCcEmail(value: string): boolean {
  const v = value.trim();
  if (!v || v.length > 320) return false;
  return EMAIL_RE.test(v);
}

export interface NormalizedCcList {
  /// Cleaned, de-duplicated, order-preserving list. Safe to store or send.
  emails: string[];
  /// Entries that were rejected, in the order they were given, so the form
  /// can point at exactly what to fix instead of a generic failure.
  invalid: string[];
  /// True when more than PO_CC_MAX_RECIPIENTS valid addresses were supplied.
  tooMany: boolean;
}

/// Accepts either an array of entries or a single string of addresses
/// separated by commas, semicolons, or newlines — operators paste all three.
///
/// An empty result is a legitimate outcome, not an error: a blank CC list
/// means the vendor is the only recipient.
export function normalizeCcList(input: ReadonlyArray<string> | string): NormalizedCcList {
  const raw = typeof input === 'string' ? [input] : input;
  const parts = raw.flatMap((entry) => (entry ?? '').split(/[,;\n\r]+/));

  const emails: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();

  for (const part of parts) {
    const value = part.trim();
    if (!value) continue;
    if (!isValidCcEmail(value)) {
      invalid.push(value);
      continue;
    }
    // Case-insensitive de-dupe, but keep what the operator typed: mail hosts
    // ignore case in the domain, and a doubled address CCs someone twice.
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    emails.push(value);
  }

  return {
    emails: emails.slice(0, PO_CC_MAX_RECIPIENTS),
    invalid,
    tooMany: emails.length > PO_CC_MAX_RECIPIENTS,
  };
}
