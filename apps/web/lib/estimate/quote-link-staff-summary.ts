import { EstimateStatus } from '@bvisible/db';

/** Derived UX phase for the newest quote link (staff-facing). */
export type QuoteLinkStaffPhase =
  | 'not_issued'
  | 'awaiting_customer'
  | 'accepted'
  | 'declined'
  | 'revoked'
  | 'expired';

export interface QuoteLinkRowSummaryInput {
  id: string;
  revokedAt: Date | null;
  expiresAt: Date | null;
  respondedAt: Date | null;
  acceptedAt: Date | null;
  declinedAt: Date | null;
  acceptedByName: string | null;
  acceptedNote: string | null;
  declinedByName: string | null;
  declinedNote: string | null;
  lastViewedAt: Date | null;
  createdAt: Date;
}

export interface QuoteStaffSummary {
  phase: QuoteLinkStaffPhase;
  headline: string;
  detail: string | null;
  responderName: string | null;
  responderNote: string | null;
  respondedAt: Date | null;
  latestLink: QuoteLinkRowSummaryInput | null;
  /** Public link currently usable by customer (not revoked, not expired). */
  activeLink: QuoteLinkRowSummaryInput | null;
}

/** Links sorted newest-first (`createdAt` desc). */
export function pickActiveQuoteLink(
  now: Date,
  linksNewestFirst: readonly QuoteLinkRowSummaryInput[]
): QuoteLinkRowSummaryInput | null {
  return (
    linksNewestFirst.find(
      (l) =>
        l.revokedAt === null &&
        (l.expiresAt === null || l.expiresAt > now)
    ) ?? null
  );
}

export function deriveQuoteLinkStaffPhase(
  now: Date,
  link: QuoteLinkRowSummaryInput | null
): QuoteLinkStaffPhase {
  if (!link) return 'not_issued';
  if (link.respondedAt !== null) {
    if (link.acceptedAt !== null) return 'accepted';
    if (link.declinedAt !== null) return 'declined';
  }
  if (link.revokedAt !== null) return 'revoked';
  if (link.expiresAt !== null && link.expiresAt <= now) return 'expired';
  return 'awaiting_customer';
}

export function quotePhaseStaffBadgeLabel(phase: QuoteLinkStaffPhase): string {
  switch (phase) {
    case 'not_issued':
      return 'Not issued';
    case 'awaiting_customer':
      return 'Awaiting response';
    case 'accepted':
      return 'Accepted';
    case 'declined':
      return 'Declined';
    case 'revoked':
      return 'Revoked';
    case 'expired':
      return 'Expired';
  }
}

export function buildQuoteStaffSummary(
  now: Date,
  estimateStatus: EstimateStatus,
  linksNewestFirst: readonly QuoteLinkRowSummaryInput[]
): QuoteStaffSummary {
  const latestLink = linksNewestFirst[0] ?? null;
  const activeLink = pickActiveQuoteLink(now, linksNewestFirst);
  const phase = deriveQuoteLinkStaffPhase(now, latestLink);

  const responderName = latestLink
    ? latestLink.acceptedAt !== null
      ? latestLink.acceptedByName
      : latestLink.declinedAt !== null
        ? latestLink.declinedByName
        : null
    : null;
  const responderNote = latestLink
    ? latestLink.acceptedAt !== null
      ? latestLink.acceptedNote
      : latestLink.declinedAt !== null
        ? latestLink.declinedNote
        : null
    : null;
  const respondedAt =
    latestLink && latestLink.respondedAt !== null ? latestLink.respondedAt : null;

  const emailed =
    estimateStatus === EstimateStatus.SENT ||
    estimateStatus === EstimateStatus.APPROVED ||
    estimateStatus === EstimateStatus.REJECTED ||
    estimateStatus === EstimateStatus.FINALIZED;

  let headline: string;
  let detail: string | null = null;

  switch (phase) {
    case 'not_issued':
      headline = 'No customer quote link yet';
      detail =
        'Generate a public link to share the quote or mention it when emailing.';
      break;
    case 'awaiting_customer':
      headline = emailed ? 'Quote sent — awaiting customer response' : 'Public link active';
      detail = emailed
        ? 'Customer has an open Accept / Decline panel while this link stays active.'
        : 'Customer link works — consider emailing via Preview when ready.';
      break;
    case 'accepted':
      headline = 'Customer accepted this quote';
      detail = 'Estimate moved to Approved via public response.';
      break;
    case 'declined':
      headline = 'Customer declined this quote';
      detail = 'Estimate marked Rejected via public response.';
      break;
    case 'revoked':
      headline = 'Latest link revoked';
      detail =
        activeLink !== null
          ? 'An older link was revoked; a newer active link exists.'
          : 'Issue a new link if the customer still needs access.';
      break;
    case 'expired':
      headline = 'Latest link expired';
      detail =
        activeLink !== null
          ? 'An older link expired; a newer active link exists.'
          : 'Rotate the link if the customer needs more time.';
      break;
  }

  return {
    phase,
    headline,
    detail,
    responderName,
    responderNote,
    respondedAt,
    latestLink,
    activeLink,
  };
}

export function shouldDisableQuoteLinkRegenerate(latestLink: QuoteLinkRowSummaryInput | null): boolean {
  return latestLink !== null && latestLink.respondedAt !== null;
}

export function isAwaitingQuoteCustomerResponse(
  now: Date,
  estimateStatus: EstimateStatus,
  activeLink: QuoteLinkRowSummaryInput | null
): boolean {
  return (
    estimateStatus === EstimateStatus.SENT &&
    activeLink !== null &&
    activeLink.respondedAt === null
  );
}
