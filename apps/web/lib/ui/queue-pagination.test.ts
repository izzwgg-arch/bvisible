import { describe, expect, it } from 'vitest';
import {
  OPERATIONAL_QUEUE_PAGE_SIZE,
  buildQueueLoadMoreHref,
  formatQueueShowingLabel,
  parseQueuePage,
  queueFetchTake,
  resolveQueuePage,
} from './queue-pagination';

describe('queue-pagination', () => {
  it('parseQueuePage defaults and clamps', () => {
    expect(parseQueuePage(undefined)).toBe(1);
    expect(parseQueuePage('2')).toBe(2);
    expect(parseQueuePage('0')).toBe(1);
    expect(parseQueuePage('abc')).toBe(1);
  });

  it('queueFetchTake grows cumulatively with sentinel row', () => {
    expect(queueFetchTake(1)).toBe(OPERATIONAL_QUEUE_PAGE_SIZE + 1);
    expect(queueFetchTake(2)).toBe(OPERATIONAL_QUEUE_PAGE_SIZE * 2 + 1);
  });

  it('resolveQueuePage trims sentinel without duplicates', () => {
    const items = Array.from({ length: OPERATIONAL_QUEUE_PAGE_SIZE + 5 }, (_, i) => i);
    const page1 = resolveQueuePage(items, 1);
    expect(page1.loadedCount).toBe(OPERATIONAL_QUEUE_PAGE_SIZE);
    expect(page1.hasMore).toBe(true);
    expect(page1.rows).toHaveLength(OPERATIONAL_QUEUE_PAGE_SIZE);

    const page2 = resolveQueuePage(items, 2);
    expect(page2.loadedCount).toBe(items.length);
    expect(page2.hasMore).toBe(false);
  });

  it('buildQueueLoadMoreHref preserves filters', () => {
    expect(
      buildQueueLoadMoreHref('/admin/ocr-review', { status: 'review', stale: '1' }, 1),
    ).toBe('/admin/ocr-review?status=review&stale=1&page=2');
    expect(
      buildQueueLoadMoreHref('/admin/email-ingestion', { filter: 'unmatched' }, 2),
    ).toBe('/admin/email-ingestion?filter=unmatched&page=3');
  });

  it('formatQueueShowingLabel includes total when truncated', () => {
    expect(formatQueueShowingLabel({ loaded: 50, total: 120 })).toBe('Showing 50 of 120');
    expect(formatQueueShowingLabel({ loaded: 10, total: 10 })).toBe('Showing 10');
  });
});
