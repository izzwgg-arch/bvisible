import { describe, expect, it } from 'vitest';
import { EmailIngestStatus, POStatus } from '@bvisible/db';
import {
  getEmailReviewPoSuggestions,
  type PoSuggestionCandidate,
} from './email-review-po-suggestions';

const now = new Date('2026-05-20T12:00:00Z');

function po(
  over: Partial<PoSuggestionCandidate> & Pick<PoSuggestionCandidate, 'id' | 'number'>,
): PoSuggestionCandidate {
  return {
    qboPoNumber: null,
    vendorId: 'v1',
    vendorName: 'Acme Supply',
    vendorEmail: 'vendor@vendor.com',
    status: POStatus.SENT,
    updatedAt: new Date('2026-05-18T10:00:00Z'),
    estimateTitle: null,
    clientCompanyName: null,
    ...over,
  };
}

describe('getEmailReviewPoSuggestions', () => {
  it('returns empty for MATCHED rows', () => {
    const out = getEmailReviewPoSuggestions({
      status: EmailIngestStatus.MATCHED,
      fromAddress: 'vendor@vendor.com',
      subject: 'PO-5001',
      bodyTextSnippet: null,
      matchHint: null,
      matchedVendorId: 'v1',
      reviewReasonCodes: [],
      attachmentFilenames: [],
      candidatePos: [po({ id: 'a', number: 'PO-5001' })],
      senderVendorId: 'v1',
      now,
    });
    expect(out).toHaveLength(0);
  });

  it('ranks both POs when multiple internal tokens match', () => {
    const candidates = [
      po({ id: 'a', number: 'PO-5001', updatedAt: new Date('2026-05-10') }),
      po({ id: 'b', number: 'PO-5002', updatedAt: new Date('2026-05-19') }),
    ];
    const out = getEmailReviewPoSuggestions({
      status: EmailIngestStatus.UNMATCHED,
      fromAddress: 'vendor@vendor.com',
      subject: 'PO-5001 and PO-5002 combined',
      bodyTextSnippet: null,
      matchHint: 'PO-5001, PO-5002',
      matchedVendorId: 'v1',
      reviewReasonCodes: ['MULTIPLE_PO_MATCHES'],
      attachmentFilenames: [],
      candidatePos: candidates,
      senderVendorId: 'v1',
      now,
    });
    expect(out.length).toBeGreaterThanOrEqual(2);
    expect(out[0]!.number).toBe('PO-5002');
    expect(out[0]!.confidence).toBe('strong');
    expect(out.map((s) => s.number).sort()).toEqual(['PO-5001', 'PO-5002']);
  });

  it('orders vendor open POs by recency when no token', () => {
    const out = getEmailReviewPoSuggestions({
      status: EmailIngestStatus.UNMATCHED,
      fromAddress: 'vendor@vendor.com',
      subject: 'FYI',
      bodyTextSnippet: null,
      matchHint: 'vendor@vendor.com',
      matchedVendorId: 'v1',
      reviewReasonCodes: ['MULTIPLE_VENDOR_PO_CANDIDATES'],
      attachmentFilenames: [],
      candidatePos: [
        po({
          id: 'old',
          number: 'PO-7001',
          updatedAt: new Date('2026-05-01'),
        }),
        po({
          id: 'new',
          number: 'PO-7002',
          updatedAt: new Date('2026-05-19'),
        }),
      ],
      senderVendorId: 'v1',
      now,
    });
    expect(out[0]!.number).toBe('PO-7002');
    expect(out[0]!.reasons).toContain('Vendor sender');
    expect(out[0]!.reasons).toContain('Recently updated');
  });

  it('boosts PO when number appears in attachment filename', () => {
    const out = getEmailReviewPoSuggestions({
      status: EmailIngestStatus.UNMATCHED,
      fromAddress: 'vendor@vendor.com',
      subject: 'Invoice',
      bodyTextSnippet: '',
      matchHint: null,
      matchedVendorId: 'v1',
      reviewReasonCodes: [],
      attachmentFilenames: ['invoice-PO-1234.pdf'],
      candidatePos: [
        po({ id: 'hit', number: 'PO-1234' }),
        po({ id: 'miss', number: 'PO-9999', vendorId: 'v2' }),
      ],
      senderVendorId: 'v1',
      now,
    });
    expect(out[0]!.number).toBe('PO-1234');
    expect(out[0]!.reasons).toContain('PO # in filename');
  });

  it('suggests QBO token match', () => {
    const out = getEmailReviewPoSuggestions({
      status: EmailIngestStatus.UNMATCHED,
      fromAddress: 'vendor@vendor.com',
      subject: 'Ref QBO-7788',
      bodyTextSnippet: null,
      matchHint: 'QBO-7788',
      matchedVendorId: 'v1',
      reviewReasonCodes: ['MULTIPLE_QBO_MATCHES'],
      attachmentFilenames: [],
      candidatePos: [
        po({ id: 'q', number: 'PO-3003', qboPoNumber: 'QBO-7788' }),
      ],
      senderVendorId: 'v1',
      now,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.reasons).toContain('QBO # in email');
    expect(out[0]!.confidence).toBe('strong');
  });

  it('ranks canceled PO lower than open PO for same vendor', () => {
    const out = getEmailReviewPoSuggestions({
      status: EmailIngestStatus.UNMATCHED,
      fromAddress: 'vendor@vendor.com',
      subject: 'Hello',
      bodyTextSnippet: null,
      matchHint: null,
      matchedVendorId: 'v1',
      reviewReasonCodes: ['MULTIPLE_VENDOR_PO_CANDIDATES'],
      attachmentFilenames: [],
      candidatePos: [
        po({
          id: 'c',
          number: 'PO-CAN',
          status: POStatus.CANCELED,
          updatedAt: new Date('2026-05-19'),
        }),
        po({
          id: 'o',
          number: 'PO-OPEN',
          status: POStatus.SENT,
          updatedAt: new Date('2026-05-18'),
        }),
      ],
      senderVendorId: 'v1',
      now,
    });
    expect(out[0]!.number).toBe('PO-OPEN');
  });

  it('uses estimate/client tokens when present in email', () => {
    const out = getEmailReviewPoSuggestions({
      status: EmailIngestStatus.UNMATCHED,
      fromAddress: 'vendor@vendor.com',
      subject: 'Signage for Riverside Plaza job',
      bodyTextSnippet: null,
      matchHint: null,
      matchedVendorId: 'v1',
      reviewReasonCodes: [],
      attachmentFilenames: [],
      candidatePos: [
        po({
          id: 'hit',
          number: 'PO-9001',
          estimateTitle: 'Riverside Plaza banners',
          clientCompanyName: 'Riverside Holdings',
        }),
        po({ id: 'miss', number: 'PO-9002', estimateTitle: 'Other job' }),
      ],
      senderVendorId: 'v1',
      now,
    });
    expect(out[0]!.number).toBe('PO-9001');
    expect(out[0]!.reasons).toContain('Job/client mention');
  });

  it('returns empty when no signal reaches threshold', () => {
    const out = getEmailReviewPoSuggestions({
      status: EmailIngestStatus.UNMATCHED,
      fromAddress: 'unknown@other.com',
      subject: 'Hello',
      bodyTextSnippet: null,
      matchHint: null,
      matchedVendorId: null,
      reviewReasonCodes: [],
      attachmentFilenames: [],
      candidatePos: [
        po({
          id: 'x',
          number: 'PO-9999',
          vendorId: 'v9',
          updatedAt: new Date('2024-01-01'),
        }),
      ],
      senderVendorId: null,
      now,
    });
    expect(out).toHaveLength(0);
  });

  it('caps at three suggestions', () => {
    const candidates = Array.from({ length: 6 }, (_, i) =>
      po({
        id: `p${i}`,
        number: `PO-50${i}0`,
        updatedAt: new Date(`2026-05-${10 + i}`),
      }),
    );
    const out = getEmailReviewPoSuggestions({
      status: EmailIngestStatus.PENDING,
      fromAddress: 'vendor@vendor.com',
      subject: candidates.map((c) => c.number).join(' '),
      bodyTextSnippet: null,
      matchHint: null,
      matchedVendorId: 'v1',
      reviewReasonCodes: ['MULTIPLE_PO_MATCHES'],
      attachmentFilenames: [],
      candidatePos: candidates,
      senderVendorId: 'v1',
      now,
    });
    expect(out.length).toBeLessThanOrEqual(3);
  });
});
