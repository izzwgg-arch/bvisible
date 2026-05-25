import type { EmailMatchReason, OcrJobStatus } from '@bvisible/db';
import type { MatchResult } from './match';

/**
 * Deterministic review reason codes for operator queue (additive).
 * Derived only from ingest/match/OCR row state — no AI inference.
 */
export const EMAIL_REVIEW_REASON_CODES = [
  'MULTIPLE_PO_MATCHES',
  'MULTIPLE_QBO_MATCHES',
  'UNKNOWN_PO',
  'MULTIPLE_VENDOR_PO_CANDIDATES',
  'NO_ATTACHMENTS',
  'ATTACHMENT_REJECTED',
  'DUPLICATE_MESSAGE',
  'OCR_PENDING',
  'OCR_FAILED',
  'MANUAL_REVIEW_REQUIRED',
] as const;

export type EmailReviewReasonCode = (typeof EMAIL_REVIEW_REASON_CODES)[number];

const SET = new Set<string>(EMAIL_REVIEW_REASON_CODES);

export function isEmailReviewReasonCode(s: string): s is EmailReviewReasonCode {
  return SET.has(s);
}

export function parseStoredReviewReasonCodes(
  raw: unknown,
): EmailReviewReasonCode[] {
  if (!Array.isArray(raw)) return [];
  const out: EmailReviewReasonCode[] = [];
  for (const x of raw) {
    if (typeof x === 'string' && isEmailReviewReasonCode(x)) out.push(x);
  }
  return dedupeSorted(out);
}

export function dedupeSorted(
  codes: Iterable<EmailReviewReasonCode>,
): EmailReviewReasonCode[] {
  return Array.from(new Set(codes)).sort() as EmailReviewReasonCode[];
}

export function mergeEmailReviewReasonCodes(
  ...groups: Array<EmailReviewReasonCode[] | undefined | null>
): EmailReviewReasonCode[] {
  const acc: EmailReviewReasonCode[] = [];
  for (const g of groups) {
    if (!g) continue;
    for (const c of g) acc.push(c);
  }
  return dedupeSorted(acc);
}

/** Attachment + matcher-derived codes (OCR merged separately after materialize). */
export function buildEmailReviewReasonCodes(input: {
  hasIncomingAttachments: boolean;
  storedAttachments: ReadonlyArray<{ skipped: boolean; skipReason: string | null }>;
  match: MatchResult;
}): EmailReviewReasonCode[] {
  const parts: EmailReviewReasonCode[] = [];
  if (!input.hasIncomingAttachments) {
    parts.push('NO_ATTACHMENTS');
  }
  for (const a of input.storedAttachments) {
    if (a.skipped) parts.push('ATTACHMENT_REJECTED');
  }

  if (input.match.reason === 'NONE') {
    parts.push(...(input.match.matcherReviewCodes ?? []));
    parts.push('MANUAL_REVIEW_REQUIRED');
  }

  return dedupeSorted(parts);
}

export function mergeOcrReviewCodes(
  statuses: ReadonlyArray<OcrJobStatus | null | undefined>,
): EmailReviewReasonCode[] {
  const parts: EmailReviewReasonCode[] = [];
  for (const s of statuses) {
    if (!s) continue;
    if (s === 'PENDING' || s === 'PROCESSING') parts.push('OCR_PENDING');
    if (s === 'FAILED') parts.push('OCR_FAILED');
  }
  return dedupeSorted(parts);
}

/** One-line explanation for matched rows (deterministic from persisted fields). */
export function explainEmailMatch(args: {
  matchReason: EmailMatchReason;
  matchHint: string | null;
}): string {
  const h = args.matchHint?.trim();
  switch (args.matchReason) {
    case 'PO_NUMBER':
      return h
        ? `Matched by internal PO number (${h}).`
        : 'Matched by internal PO number in subject, body, or attachment filenames.';
    case 'QBO_NUMBER':
      return h
        ? `Matched by QuickBooks PO reference (${h}).`
        : 'Matched by QuickBooks PO number in subject, body, or attachment filenames.';
    case 'VENDOR_AND_RECENT':
      return 'Matched by vendor sender + exactly one open PO updated in the last 30 days.';
    case 'MANUAL':
      return h
        ? `Linked manually by operator (PO ${h}).`
        : 'Linked manually by operator.';
    case 'NONE':
    default:
      return 'Not matched to a PO.';
  }
}

/** Deterministic "why review" line from reason codes + match hint (no percentages). */
export function explainUnmatchedReview(args: {
  codes: readonly EmailReviewReasonCode[];
  matchHint: string | null;
}): string {
  const c = new Set(args.codes);
  const bits: string[] = [];
  if (c.has('MULTIPLE_PO_MATCHES')) {
    bits.push('multiple internal PO numbers resolved to different open POs');
  }
  if (c.has('MULTIPLE_QBO_MATCHES')) {
    bits.push('multiple QuickBooks PO references matched different PO rows');
  }
  if (c.has('UNKNOWN_PO')) {
    bits.push('internal PO token(s) did not match any PO in the database');
  }
  if (c.has('MULTIPLE_VENDOR_PO_CANDIDATES')) {
    bits.push('vendor has more than one recent open PO and no unique token');
  }
  if (c.has('ATTACHMENT_REJECTED')) {
    bits.push('one or more attachments were rejected (type or size)');
  }
  if (c.has('NO_ATTACHMENTS')) {
    bits.push('message had no file attachments');
  }
  if (c.has('OCR_PENDING')) bits.push('OCR still running or queued for promoted files');
  if (c.has('OCR_FAILED')) bits.push('OCR failed for at least one promoted file');
  if (c.has('MANUAL_REVIEW_REQUIRED')) {
    bits.push('needs operator link, dismiss, or retry');
  }
  if (c.has('DUPLICATE_MESSAGE')) {
    bits.push('this Message-ID was already ingested');
  }
  if (bits.length === 0) {
    return args.matchHint
      ? `No PO match — ${args.matchHint}`
      : 'No PO match — link manually, retry, or dismiss.';
  }
  const hint = args.matchHint?.trim();
  const base = `Review: ${bits.join('; ')}`;
  return hint ? `${base} (${hint})` : `${base}.`;
}

export function labelEmailReviewReasonCode(code: EmailReviewReasonCode): string {
  switch (code) {
    case 'MULTIPLE_PO_MATCHES':
      return 'Multiple PO matches';
    case 'MULTIPLE_QBO_MATCHES':
      return 'Multiple QBO matches';
    case 'UNKNOWN_PO':
      return 'Unknown PO number';
    case 'MULTIPLE_VENDOR_PO_CANDIDATES':
      return 'Multiple vendor POs';
    case 'NO_ATTACHMENTS':
      return 'No attachments';
    case 'ATTACHMENT_REJECTED':
      return 'Attachment rejected';
    case 'DUPLICATE_MESSAGE':
      return 'Duplicate message';
    case 'OCR_PENDING':
      return 'OCR pending';
    case 'OCR_FAILED':
      return 'OCR failed';
    case 'MANUAL_REVIEW_REQUIRED':
      return 'Manual review';
    default:
      return code;
  }
}
