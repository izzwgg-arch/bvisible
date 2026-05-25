import type { EmailReviewReasonCode } from './review-reasons';
import { EmailIngestStatus, POStatus } from '@bvisible/db';

/** Keep in sync with `match.ts` token patterns (deterministic only). */
const INTERNAL_PO_TOKEN = /\bPO-\d{4,8}\b/gi;
const QBO_LIKE_TOKEN = /\b[A-Za-z]{0,4}-?\d{2,10}\b/gi;
const MAX_QBO_TOKENS = 24;

const OPEN_STATUSES: ReadonlySet<POStatus> = new Set([
  POStatus.DRAFT,
  POStatus.SENT,
  POStatus.ORDERED,
  POStatus.PARTIALLY_RECEIVED,
]);

export type EmailReviewPoSuggestionConfidence =
  | 'strong'
  | 'possible'
  | 'weak';

export type PoSuggestionCandidate = {
  id: string;
  number: string;
  qboPoNumber: string | null;
  vendorId: string;
  vendorName: string | null;
  vendorEmail: string | null;
  status: POStatus;
  updatedAt: Date;
  estimateTitle: string | null;
  clientCompanyName: string | null;
};

export type EmailReviewPoSuggestion = {
  purchaseOrderId: string;
  number: string;
  qboPoNumber: string | null;
  vendorName: string | null;
  status: POStatus;
  updatedAtIso: string;
  confidence: EmailReviewPoSuggestionConfidence;
  /** Deterministic reason chips — never percentages. */
  reasons: string[];
  /** Sort key only — not shown in UI. */
  score: number;
};

export type EmailReviewPoSuggestionInput = {
  status: EmailIngestStatus;
  fromAddress: string;
  subject: string;
  bodyTextSnippet: string | null;
  matchHint: string | null;
  matchedVendorId: string | null;
  reviewReasonCodes: readonly EmailReviewReasonCode[];
  attachmentFilenames: readonly string[];
  candidatePos: readonly PoSuggestionCandidate[];
  /** Resolved vendor id for sender email when known. */
  senderVendorId: string | null;
  now?: Date;
};

function dedupeTokens(tokens: string[]): string[] {
  return Array.from(
    new Set(tokens.map((t) => t.trim()).filter((t) => t.length > 0)),
  );
}

function haystackForEmail(input: EmailReviewPoSuggestionInput): string {
  return [
    input.subject ?? '',
    input.bodyTextSnippet ?? '',
    input.matchHint ?? '',
    input.attachmentFilenames.join(' '),
  ].join('\n');
}

function extractInternalPoTokens(haystack: string): string[] {
  return dedupeTokens(
    (haystack.match(INTERNAL_PO_TOKEN) ?? []).map((t) => t.toUpperCase()),
  );
}

function extractQboTokens(haystack: string): string[] {
  return dedupeTokens(haystack.match(QBO_LIKE_TOKEN) ?? []).slice(
    0,
    MAX_QBO_TOKENS,
  );
}

/** Safe overlap tokens from estimate title / client name (no fuzzy match). */
function contextOverlapTokens(
  title: string | null,
  clientName: string | null,
): string[] {
  const raw = [title ?? '', clientName ?? ''].join(' ');
  const words = raw
    .split(/[^A-Za-z0-9]+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 4);
  return dedupeTokens(words.map((w) => w.toLowerCase()));
}

function haystackContainsToken(haystackLower: string, token: string): boolean {
  if (token.length < 4) return false;
  return haystackLower.includes(token.toLowerCase());
}

function recencyPoints(updatedAt: Date, now: Date): number {
  const ms = now.getTime() - updatedAt.getTime();
  if (ms < 0) return 8;
  const days = ms / (24 * 60 * 60 * 1000);
  if (days <= 7) return 15;
  if (days <= 30) return 8;
  return 0;
}

function statusPoints(status: POStatus): number {
  if (status === POStatus.CANCELED) return -40;
  if (status === POStatus.RECEIVED) return 5;
  if (OPEN_STATUSES.has(status)) return 20;
  return 0;
}

function confidenceFromScore(score: number): EmailReviewPoSuggestionConfidence {
  if (score >= 100) return 'strong';
  if (score >= 55) return 'possible';
  return 'weak';
}

function shouldSuggest(input: EmailReviewPoSuggestionInput): boolean {
  return (
    input.status === EmailIngestStatus.UNMATCHED ||
    input.status === EmailIngestStatus.PENDING
  );
}

/**
 * Deterministic PO ranking for operator review only.
 * Does not change `matchEmail` and never auto-links.
 */
export function getEmailReviewPoSuggestions(
  input: EmailReviewPoSuggestionInput,
): EmailReviewPoSuggestion[] {
  if (!shouldSuggest(input)) return [];
  if (input.candidatePos.length === 0) return [];

  const now = input.now ?? new Date();
  const haystack = haystackForEmail(input);
  const haystackLower = haystack.toLowerCase();
  const internalTokens = extractInternalPoTokens(haystack);
  const qboTokens = extractQboTokens(haystack);
  const vendorId = input.senderVendorId ?? input.matchedVendorId;

  const scored: EmailReviewPoSuggestion[] = [];

  for (const po of input.candidatePos) {
    let score = 0;
    const reasons: string[] = [];

    if (internalTokens.includes(po.number.toUpperCase())) {
      score += 100;
      reasons.push('PO # in email');
    }

    if (
      po.qboPoNumber &&
      qboTokens.some(
        (t) => t === po.qboPoNumber || t.toLowerCase() === po.qboPoNumber!.toLowerCase(),
      )
    ) {
      score += 90;
      reasons.push('QBO # in email');
    }

    if (vendorId && po.vendorId === vendorId) {
      score += 40;
      reasons.push('Vendor sender');
    }

    const fnHay = haystackLower;
    if (fnHay.includes(po.number.toLowerCase())) {
      const inFilename = input.attachmentFilenames.some((f) =>
        f.toLowerCase().includes(po.number.toLowerCase()),
      );
      if (inFilename) {
        score += 35;
        reasons.push('PO # in filename');
      }
    }

    const sp = statusPoints(po.status);
    if (sp > 0 && OPEN_STATUSES.has(po.status)) {
      score += sp;
      reasons.push('Open PO');
    } else if (po.status === POStatus.RECEIVED) {
      score += sp;
      reasons.push('Received PO');
    } else if (po.status === POStatus.CANCELED) {
      score += sp;
    }

    const rp = recencyPoints(po.updatedAt, now);
    if (rp > 0) {
      score += rp;
      reasons.push('Recently updated');
    }

    const overlap = contextOverlapTokens(po.estimateTitle, po.clientCompanyName);
    let overlapHits = 0;
    for (const tok of overlap) {
      if (haystackContainsToken(haystackLower, tok)) {
        overlapHits += 1;
        if (overlapHits === 1) reasons.push('Job/client mention');
      }
    }
    if (overlapHits > 0) {
      score += Math.min(50, overlapHits * 25);
    }

    const identityReasons = new Set([
      'PO # in email',
      'QBO # in email',
      'Vendor sender',
      'PO # in filename',
      'Job/client mention',
    ]);
    if (score < 15) continue;
    if (!reasons.some((r) => identityReasons.has(r))) continue;

    scored.push({
      purchaseOrderId: po.id,
      number: po.number,
      qboPoNumber: po.qboPoNumber,
      vendorName: po.vendorName,
      status: po.status,
      updatedAtIso: po.updatedAt.toISOString(),
      confidence: confidenceFromScore(score),
      reasons: dedupeTokens(reasons),
      score,
    });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (
      new Date(b.updatedAtIso).getTime() - new Date(a.updatedAtIso).getTime()
    );
  });

  return scored.slice(0, 3);
}

export function formatPoSuggestionAge(updatedAtIso: string, now: Date): string {
  const ms = now.getTime() - new Date(updatedAtIso).getTime();
  if (ms < 0) return 'just now';
  const days = Math.floor(ms / (24 * 60 * 60 * 1000));
  if (days === 0) return 'today';
  if (days === 1) return '1d ago';
  if (days < 30) return `${days}d ago`;
  return '30d+ ago';
}
