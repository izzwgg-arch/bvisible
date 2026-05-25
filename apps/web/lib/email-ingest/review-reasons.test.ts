import { describe, expect, it } from 'vitest';
import { EmailMatchReason } from '@bvisible/db';
import {
  buildEmailReviewReasonCodes,
  countEmailReasonFilter,
  dedupeSorted,
  explainEmailMatch,
  explainUnmatchedReview,
  matchesEmailReasonFilter,
  mergeEmailReviewReasonCodes,
  mergeOcrReviewCodes,
  parseStoredReviewReasonCodes,
} from './review-reasons';
import type { MatchResult } from './match';

function m(partial: Partial<MatchResult> & Pick<MatchResult, 'reason'>): MatchResult {
  return {
    purchaseOrderId: null,
    vendorId: null,
    hint: null,
    matcherReviewCodes: undefined,
    ...partial,
  };
}

describe('buildEmailReviewReasonCodes', () => {
  it('flags no MIME parts and manual review on NONE', () => {
    const codes = buildEmailReviewReasonCodes({
      hasIncomingAttachments: false,
      storedAttachments: [],
      match: m({
        reason: 'NONE',
        matcherReviewCodes: ['MULTIPLE_PO_MATCHES'],
      }),
    });
    expect(codes).toEqual([
      'MANUAL_REVIEW_REQUIRED',
      'MULTIPLE_PO_MATCHES',
      'NO_ATTACHMENTS',
    ]);
  });

  it('adds ATTACHMENT_REJECTED for skipped rows', () => {
    const codes = buildEmailReviewReasonCodes({
      hasIncomingAttachments: true,
      storedAttachments: [
        { skipped: true, skipReason: 'size_exceeded' },
        { skipped: false, skipReason: null },
      ],
      match: m({ reason: 'PO_NUMBER', purchaseOrderId: 'x', vendorId: 'v' }),
    });
    expect(codes).toEqual(['ATTACHMENT_REJECTED']);
  });

  it('merges OCR statuses', () => {
    expect(mergeOcrReviewCodes(['PENDING', 'FAILED', 'CONFIRMED'])).toEqual(
      dedupeSorted(['OCR_PENDING', 'OCR_FAILED']),
    );
  });

  it('mergeEmailReviewReasonCodes dedupes', () => {
    expect(
      mergeEmailReviewReasonCodes(
        ['OCR_PENDING', 'MANUAL_REVIEW_REQUIRED'],
        ['OCR_PENDING'],
      ),
    ).toEqual(['MANUAL_REVIEW_REQUIRED', 'OCR_PENDING']);
  });
});

describe('parseStoredReviewReasonCodes', () => {
  it('filters unknown strings', () => {
    expect(parseStoredReviewReasonCodes(['UNKNOWN_PO', 'FAKE', 'OCR_PENDING'])).toEqual([
      'OCR_PENDING',
      'UNKNOWN_PO',
    ]);
  });
});

describe('explainEmailMatch', () => {
  it('covers PO, QBO, vendor+recent, manual', () => {
    expect(
      explainEmailMatch({
        matchReason: EmailMatchReason.PO_NUMBER,
        matchHint: 'PO-1001',
      }),
    ).toContain('PO-1001');
    expect(
      explainEmailMatch({
        matchReason: EmailMatchReason.VENDOR_AND_RECENT,
        matchHint: 'a@b.com',
      }),
    ).toContain('30 days');
    expect(
      explainEmailMatch({
        matchReason: EmailMatchReason.MANUAL,
        matchHint: 'PO-9',
      }),
    ).toContain('manually');
  });
});

describe('explainUnmatchedReview', () => {
  it('mentions multiple PO matches', () => {
    const t = explainUnmatchedReview({
      codes: ['MULTIPLE_PO_MATCHES', 'MANUAL_REVIEW_REQUIRED'],
      matchHint: 'PO-1, PO-2',
    });
    expect(t.toLowerCase()).toContain('multiple internal');
  });
});

describe('matchesEmailReasonFilter', () => {
  it('filters attachment and ambiguous buckets', () => {
    expect(
      matchesEmailReasonFilter(['ATTACHMENT_REJECTED', 'MANUAL_REVIEW_REQUIRED'], 'attachment_rejected')
    ).toBe(true);
    expect(
      matchesEmailReasonFilter(['MULTIPLE_PO_MATCHES'], 'ambiguous')
    ).toBe(true);
    expect(
      matchesEmailReasonFilter(['OCR_PENDING'], 'ocr_pending')
    ).toBe(true);
    expect(
      matchesEmailReasonFilter(['OCR_PENDING'], 'attachment_rejected')
    ).toBe(false);
  });

  it('counts rows per filter', () => {
    const rows = [
      { reviewReasonCodes: ['ATTACHMENT_REJECTED'] as const },
      { reviewReasonCodes: ['MULTIPLE_PO_MATCHES'] as const },
      { reviewReasonCodes: ['OCR_PENDING'] as const },
    ];
    expect(countEmailReasonFilter(rows, 'all')).toBe(3);
    expect(countEmailReasonFilter(rows, 'attachment_rejected')).toBe(1);
    expect(countEmailReasonFilter(rows, 'ambiguous')).toBe(1);
    expect(countEmailReasonFilter(rows, 'ocr_pending')).toBe(1);
  });
});
