import { describe, expect, it } from 'vitest';
import { EstimateTimelineKind } from '@bvisible/db';

import { mergeEstimateStaffTimeline } from '@/lib/estimate/estimate-quote-timeline';

describe('estimate quote timeline merge', () => {
  it('sorts ascending by createdAt', () => {
    const rows = mergeEstimateStaffTimeline(
      [
        {
          id: 't2',
          kind: EstimateTimelineKind.QUOTE_ACCEPTED,
          createdAt: new Date('2026-05-02T12:00:00Z'),
          metadata: { customerName: 'Ada', customerNoteTruncated: 'OK' },
        },
      ],
      [
        {
          id: 'a1',
          action: 'estimate_sent_to_client',
          createdAt: new Date('2026-05-01T08:00:00Z'),
          metadata: null,
        },
      ]
    );
    expect(rows.map((r) => r.title)).toEqual([
      'Estimate emailed to customer',
      'Quote accepted (public link)',
    ]);
    expect(rows[1]?.subtitle).toContain('Ada');
  });

  it('ignores estimate_quote_declined audits because QUOTE_DECLINED timeline is canonical', () => {
    const rows = mergeEstimateStaffTimeline(
      [
        {
          id: 'tl',
          kind: EstimateTimelineKind.QUOTE_DECLINED,
          createdAt: new Date('2026-05-03T12:00:00Z'),
          metadata: { customerName: 'Bob', customerNoteTruncated: 'Pass' },
        },
      ],
      [
        {
          id: 'bad',
          action: 'estimate_quote_declined',
          createdAt: new Date('2026-05-03T12:00:01Z'),
          metadata: {},
        },
      ]
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toContain('declined');
  });

  it('maps estimate_status_changed metadata', () => {
    const rows = mergeEstimateStaffTimeline([], [
      {
        id: 'sc',
        action: 'estimate_status_changed',
        createdAt: new Date('2026-05-01T09:00:00Z'),
        metadata: { from: 'DRAFT', to: 'SENT' },
      },
    ]);
    expect(rows[0]?.subtitle).toBe('DRAFT → SENT');
  });
});
