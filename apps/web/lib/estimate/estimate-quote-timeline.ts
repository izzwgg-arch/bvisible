import type { EstimateTimelineKind } from '@bvisible/db';

export type EstimateUnifiedTimelineSource = 'timeline_event' | 'audit_log';

export interface EstimateUnifiedTimelineRow {
  /** Stable key for React lists */
  rowKey: string;
  source: EstimateUnifiedTimelineSource;
  sortAt: Date;
  title: string;
  subtitle: string | null;
}

export interface TimelineEventInput {
  id: string;
  kind: EstimateTimelineKind;
  createdAt: Date;
  metadata: unknown;
}

export interface AuditTimelineInput {
  id: string;
  action: string;
  createdAt: Date;
  metadata: unknown | null;
}

function invoiceCreatedSubtitle(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const m = metadata as Record<string, unknown>;
  const num = typeof m.invoiceNumber === 'string' && m.invoiceNumber.trim() ? m.invoiceNumber.trim() : null;
  return num ? `Invoice ${num}` : null;
}

function quoteTimelineSubtitle(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const m = metadata as Record<string, unknown>;
  const name =
    typeof m.customerName === 'string' && m.customerName.trim()
      ? m.customerName.trim()
      : null;
  const noteTrunc =
    typeof m.customerNoteTruncated === 'string' && m.customerNoteTruncated.trim()
      ? m.customerNoteTruncated.trim()
      : null;
  const parts: string[] = [];
  if (name) parts.push(`Name: ${name}`);
  if (noteTrunc) parts.push(`Note: ${noteTrunc}`);
  return parts.length ? parts.join(' · ') : null;
}

function statusChangedSubtitle(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const m = metadata as Record<string, unknown>;
  const from = typeof m.from === 'string' ? m.from : null;
  const to = typeof m.to === 'string' ? m.to : null;
  if (from && to) return `${from} → ${to}`;
  return null;
}

/**
 * Merge timeline events + estimate-targeted audits into one chronological list.
 * Omits `estimate_quote_accepted` / `estimate_quote_declined` audits — those are represented by `QUOTE_*` timeline rows.
 */
export function mergeEstimateStaffTimeline(
  events: readonly TimelineEventInput[],
  audits: readonly AuditTimelineInput[]
): EstimateUnifiedTimelineRow[] {
  const rows: EstimateUnifiedTimelineRow[] = [];

  for (const ev of events) {
    let title: string;
    switch (ev.kind) {
      case 'QUOTE_ACCEPTED':
        title = 'Quote accepted (public link)';
        break;
      case 'QUOTE_DECLINED':
        title = 'Quote declined (public link)';
        break;
      case 'INVOICE_CREATED_FROM_ESTIMATE':
        title = 'Invoice created from estimate';
        break;
      default:
        title = `Estimate timeline (${String(ev.kind)})`;
    }
    rows.push({
      rowKey: `tl:${ev.id}`,
      source: 'timeline_event',
      sortAt: ev.createdAt,
      title,
      subtitle:
        ev.kind === 'QUOTE_ACCEPTED' || ev.kind === 'QUOTE_DECLINED'
          ? quoteTimelineSubtitle(ev.metadata)
          : ev.kind === 'INVOICE_CREATED_FROM_ESTIMATE'
            ? invoiceCreatedSubtitle(ev.metadata)
            : null,
    });
  }

  const auditActions = new Set([
    'estimate_sent_to_client',
    'estimate_quote_viewed_public',
    'estimate_status_changed',
    'estimate_finalized',
    'estimate_unfinalized',
  ]);

  for (const a of audits) {
    if (!auditActions.has(a.action)) continue;

    let title: string;
    let subtitle: string | null = null;

    switch (a.action) {
      case 'estimate_sent_to_client':
        title = 'Estimate emailed to customer';
        break;
      case 'estimate_quote_viewed_public':
        title = 'Quote viewed (public link)';
        break;
      case 'estimate_status_changed':
        title = 'Estimate status changed';
        subtitle = statusChangedSubtitle(a.metadata);
        break;
      case 'estimate_finalized':
        title = 'Estimate finalized';
        break;
      case 'estimate_unfinalized':
        title = 'Estimate unfinalized';
        break;
      default:
        continue;
    }

    rows.push({
      rowKey: `al:${a.id}`,
      source: 'audit_log',
      sortAt: a.createdAt,
      title,
      subtitle,
    });
  }

  rows.sort((a, b) => a.sortAt.getTime() - b.sortAt.getTime());
  return rows;
}
