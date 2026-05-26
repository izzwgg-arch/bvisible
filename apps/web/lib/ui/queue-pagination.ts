/** Default page size for admin operational queues (OCR, email, reconciliation). */
export const OPERATIONAL_QUEUE_PAGE_SIZE = 50;

/** Dashboard / summary widgets preview at most this many rows per bucket. */
export const DASHBOARD_QUEUE_PREVIEW_LIMIT = 12;

const MAX_PAGE = 200;

export function parseQueuePage(raw: string | undefined): number {
  if (!raw?.trim()) return 1;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_PAGE);
}

/** Cumulative fetch: page 1 → 50 rows, page 2 → 100, etc. Request one extra row to detect `hasMore`. */
export function queueFetchTake(page: number): number {
  return page * OPERATIONAL_QUEUE_PAGE_SIZE + 1;
}

export function resolveQueuePage<T>(items: T[], page: number): {
  rows: T[];
  hasMore: boolean;
  loadedCount: number;
} {
  const limit = page * OPERATIONAL_QUEUE_PAGE_SIZE;
  const hasMore = items.length > limit;
  const rows = hasMore ? items.slice(0, limit) : items;
  return { rows, hasMore, loadedCount: rows.length };
}

export function buildQueueLoadMoreHref(
  basePath: string,
  params: Record<string, string | undefined>,
  currentPage: number,
): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '') sp.set(key, value);
  }
  if (currentPage > 1) {
    sp.set('page', String(currentPage + 1));
  } else {
    sp.set('page', '2');
  }
  const q = sp.toString();
  return q ? `${basePath}?${q}` : basePath;
}

export function formatQueueShowingLabel(input: {
  loaded: number;
  total?: number | null;
  suffix?: string;
}): string {
  const { loaded, total, suffix } = input;
  const extra = suffix ? ` ${suffix}` : '';
  if (total != null && total > loaded) {
    return `Showing ${loaded} of ${total}${extra}`;
  }
  return `Showing ${loaded}${extra}`;
}
