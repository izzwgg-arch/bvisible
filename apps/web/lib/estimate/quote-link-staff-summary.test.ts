import { describe, expect, it } from 'vitest';
import { EstimateStatus } from '@bvisible/db';

import {
  buildQuoteStaffSummary,
  deriveQuoteLinkStaffPhase,
  isAwaitingQuoteCustomerResponse,
  pickActiveQuoteLink,
  quotePhaseStaffBadgeLabel,
  shouldDisableQuoteLinkRegenerate,
  type QuoteLinkRowSummaryInput,
} from '@/lib/estimate/quote-link-staff-summary';

const baseLink = (patch: Partial<QuoteLinkRowSummaryInput>): QuoteLinkRowSummaryInput => ({
  id: 'lnk',
  revokedAt: null,
  expiresAt: null,
  respondedAt: null,
  acceptedAt: null,
  declinedAt: null,
  acceptedByName: null,
  acceptedNote: null,
  declinedByName: null,
  declinedNote: null,
  lastViewedAt: null,
  createdAt: new Date('2026-05-01T12:00:00Z'),
  ...patch,
});

describe('quote-link staff summary', () => {
  const now = new Date('2026-06-01T12:00:00Z');

  it('deriveQuoteLinkStaffPhase marks revoked before expiry when no response', () => {
    expect(
      deriveQuoteLinkStaffPhase(now, baseLink({ revokedAt: new Date('2026-05-02T12:00:00Z') }))
    ).toBe('revoked');
  });

  it('deriveQuoteLinkStaffPhase prefers accepted response over revoked flag ordering edge', () => {
    expect(
      deriveQuoteLinkStaffPhase(
        now,
        baseLink({
          respondedAt: new Date('2026-05-03T12:00:00Z'),
          acceptedAt: new Date('2026-05-03T12:00:00Z'),
          revokedAt: null,
        })
      )
    ).toBe('accepted');
  });

  it('pickActiveQuoteLink skips revoked and expired rows', () => {
    const rows = [
      baseLink({
        id: 'old',
        revokedAt: new Date('2026-05-02T12:00:00Z'),
        createdAt: new Date('2026-05-01T12:00:00Z'),
      }),
      baseLink({
        id: 'current',
        createdAt: new Date('2026-05-10T12:00:00Z'),
      }),
    ];
    expect(pickActiveQuoteLink(now, rows)?.id).toBe('current');
  });

  it('buildQuoteStaffSummary maps awaiting + emailed headline', () => {
    const s = buildQuoteStaffSummary(now, EstimateStatus.SENT, [
      baseLink({ id: 'x', createdAt: new Date('2026-05-15T12:00:00Z') }),
    ]);
    expect(s.phase).toBe('awaiting_customer');
    expect(s.headline).toContain('awaiting');
  });

  it('shouldDisableQuoteLinkRegenerate when respondedAt set', () => {
    expect(
      shouldDisableQuoteLinkRegenerate(
        baseLink({ respondedAt: new Date('2026-05-02T12:00:00Z'), acceptedAt: new Date('2026-05-02T12:00:00Z') })
      )
    ).toBe(true);
    expect(shouldDisableQuoteLinkRegenerate(baseLink({}))).toBe(false);
  });

  it('isAwaitingQuoteCustomerResponse matches spec', () => {
    expect(
      isAwaitingQuoteCustomerResponse(
        now,
        EstimateStatus.SENT,
        baseLink({ id: 'a', respondedAt: null })
      )
    ).toBe(true);
    expect(
      isAwaitingQuoteCustomerResponse(now, EstimateStatus.DRAFT, baseLink({ id: 'a', respondedAt: null }))
    ).toBe(false);
    expect(
      isAwaitingQuoteCustomerResponse(
        now,
        EstimateStatus.SENT,
        baseLink({
          id: 'a',
          respondedAt: new Date('2026-05-03T12:00:00Z'),
          acceptedAt: new Date('2026-05-03T12:00:00Z'),
        })
      )
    ).toBe(false);
  });

  it('quotePhaseStaffBadgeLabel covers phases', () => {
    expect(quotePhaseStaffBadgeLabel('not_issued')).toBe('Not issued');
    expect(quotePhaseStaffBadgeLabel('awaiting_customer')).toBe('Awaiting response');
    expect(quotePhaseStaffBadgeLabel('accepted')).toBe('Accepted');
    expect(quotePhaseStaffBadgeLabel('declined')).toBe('Declined');
    expect(quotePhaseStaffBadgeLabel('revoked')).toBe('Revoked');
    expect(quotePhaseStaffBadgeLabel('expired')).toBe('Expired');
  });
});
