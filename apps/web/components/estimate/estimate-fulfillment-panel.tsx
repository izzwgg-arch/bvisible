import Link from 'next/link';

import type { EstimateStatus } from '@bvisible/db';
import { EstimateStatus as ES } from '@bvisible/db';

import { formatMoney } from '@/lib/estimate/format';
import type {
  EstimateLinkedPoBootstrap,
  FulfillmentHeadline,
} from '@/lib/estimate/estimate-fulfillment';
import {
  receiptOcrOperationalHint,
  reconciliationGuidanceLabel,
} from '@/lib/estimate/estimate-fulfillment';
import { labelPoStatus } from '@/lib/ui/status-labels';

const PO_STATUS_CHIP =
  'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide';

const PO_CHIP_PALETTE: Record<string, string> = {
  DRAFT: 'border-slate-200 bg-slate-50 text-slate-800',
  SENT: 'border-sky-200 bg-sky-50 text-sky-950',
  ORDERED: 'border-indigo-200 bg-indigo-50 text-indigo-950',
  PARTIALLY_RECEIVED: 'border-amber-200 bg-amber-50 text-amber-950',
  RECEIVED: 'border-emerald-200 bg-emerald-50 text-emerald-950',
  CANCELED: 'border-rose-200 bg-rose-50 text-rose-950',
};

export function EstimateFulfillmentPanel(props: {
  estimateId: string;
  estimateStatus: EstimateStatus;
  headline: FulfillmentHeadline;
  hints: string[];
  linkedPos: ReadonlyArray<EstimateLinkedPoBootstrap>;
}) {
  const { estimateId, estimateStatus, headline, hints, linkedPos } = props;
  const showApprovedPrimary =
    estimateStatus === ES.APPROVED && linkedPos.length === 0;

  return (
    <section
      className={`rounded-[var(--radius-bv)] border bg-[var(--color-bv-surface)] p-5 shadow-[var(--shadow-bv-card)] ${
        headline.muted
          ? 'border-[var(--color-bv-border)] opacity-80'
          : 'border-[var(--color-bv-border)]'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-bv-muted)]">
            {headline.title}
          </h2>
          {headline.subtitle ? (
            <p
              className={`mt-1 text-[13px] leading-snug ${
                headline.muted ? 'text-[var(--color-bv-muted)]' : 'text-[var(--color-bv-text)]'
              }`}
            >
              {headline.subtitle}
            </p>
          ) : null}
        </div>
        {estimateStatus === ES.APPROVED ? (
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-950">
            Accepted quote
          </span>
        ) : null}
      </div>

      {hints.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1.5 text-[12.5px] leading-snug text-[var(--color-bv-muted)]">
          {hints.map((h, idx) => (
            <li key={`${idx}-${h.slice(0, 48)}`} className="flex gap-2">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[var(--color-bv-muted)]" />
              <span>{h}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {showApprovedPrimary ? (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Link
            href={`/purchase-orders/new?estimateId=${estimateId}`}
            className="inline-flex flex-1 items-center justify-center rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-4 py-2.5 text-[13px] font-semibold text-[var(--color-bv-text)] shadow-sm hover:bg-[var(--color-bv-bg)] sm:flex-none"
          >
            Link existing purchase order
          </Link>
          <Link
            href="#estimate-create-po"
            className="inline-flex flex-1 items-center justify-center rounded-[8px] bg-[var(--color-bv-accent)] px-4 py-2.5 text-[13px] font-semibold text-[var(--color-bv-accent-foreground)] shadow-sm hover:opacity-95 sm:flex-none"
          >
            Create purchase order from estimate
          </Link>
        </div>
      ) : null}

      {estimateStatus === ES.APPROVED && linkedPos.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={`/purchase-orders/new?estimateId=${estimateId}`}
            className="inline-flex items-center justify-center rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[12.5px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-surface)]"
          >
            Link another PO
          </Link>
          <Link
            href="#estimate-create-po"
            className="inline-flex items-center justify-center rounded-[8px] bg-[var(--color-bv-accent)] px-3 py-2 text-[12.5px] font-medium text-[var(--color-bv-accent-foreground)] shadow-sm hover:opacity-95"
          >
            Create another PO from estimate
          </Link>
        </div>
      ) : null}

      {linkedPos.length > 0 ? (
        <div className="mt-5 border-t border-[var(--color-bv-border)] pt-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-bv-muted)]">
            Linked purchase orders
          </h3>
          <ul className="mt-2 flex flex-col gap-2">
            {linkedPos.map((p) => {
              const reconPhrase = reconciliationGuidanceLabel(p.latestReconciliationStatus);
              const ocrPhrase = receiptOcrOperationalHint({
                receiptishAttachmentCount: p.receiptishAttachmentCount,
                ocrPendingOrProcessingCount: p.ocrPendingOrProcessingCount,
                ocrNeedsReviewCount: p.ocrNeedsReviewCount,
              });
              const chipClass =
                PO_CHIP_PALETTE[p.status] ??
                'border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] text-[var(--color-bv-text)]';
              return (
                <li
                  key={p.id}
                  className="rounded-[10px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2.5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <Link
                        href={`/purchase-orders/${p.id}`}
                        className="font-mono text-[13px] font-semibold text-[var(--color-bv-accent)] hover:underline"
                      >
                        {p.number}
                      </Link>
                      <div className="mt-0.5 truncate text-[11.5px] text-[var(--color-bv-muted)]">
                        {p.vendor?.name ?? 'No vendor'} · {formatMoney(p.subtotalCents)} PO total · created{' '}
                        <time dateTime={p.createdAtIso}>
                          {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
                            new Date(p.createdAtIso)
                          )}
                        </time>
                      </div>
                    </div>
                    <span className={`${PO_STATUS_CHIP} ${chipClass}`}>{labelPoStatus(p.status)}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {p.reconciliationNeedsAttention ? (
                      <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-950">
                        Reconciliation attention
                      </span>
                    ) : null}
                    {reconPhrase ? (
                      <span className="rounded-full border border-[var(--color-bv-border)] bg-white px-2 py-0.5 text-[10px] font-medium text-[var(--color-bv-text)]">
                        {reconPhrase}
                      </span>
                    ) : null}
                    {ocrPhrase ? (
                      <span className="rounded-full border border-[var(--color-bv-border)] bg-white px-2 py-0.5 text-[10px] font-medium text-[var(--color-bv-text)]">
                        {ocrPhrase}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-2">
                    <Link
                      href={`/purchase-orders/${p.id}`}
                      className="text-[12px] font-medium text-[var(--color-bv-accent)] hover:underline"
                    >
                      Open purchase order →
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
