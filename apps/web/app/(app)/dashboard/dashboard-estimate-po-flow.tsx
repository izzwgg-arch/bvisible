import Link from 'next/link';
import type { ReactNode } from 'react';

import type {
  DashboardEstimatePoFlow,
  EstimatePoFlowRow,
  EstimatePoReconAttentionRow,
  RecentPoFromEstimateRow,
} from '@/lib/dashboard/get-estimate-po-flow';

export function DashboardEstimatePoFlowSections({ data }: { data: DashboardEstimatePoFlow }) {
  const hasAnything =
    data.acceptedAwaitingPo.length > 0 ||
    data.recentPosFromEstimates.length > 0 ||
    data.approvedWithLinkedPo.length > 0 ||
    data.estimateLinkedPoReconciliationAttention.length > 0;

  if (!hasAnything) {
    return null;
  }

  return (
    <div className="mb-10 grid gap-8 xl:grid-cols-2">
      <AttentionColumn
        title="Accepted quotes awaiting PO"
        hint="Approved estimates with no linked purchase order yet (explicit estimateId link)."
        empty="Nothing waiting — every approved estimate has at least one PO."
        rows={data.acceptedAwaitingPo.map(flowRow)}
      />
      <AttentionColumn
        title="Recent POs created from estimates"
        hint="Latest purchase orders that reference an estimate."
        empty="No estimate-linked PO activity recently."
        rows={data.recentPosFromEstimates.map(poRow)}
      />
      <AttentionColumn
        title="Accepted quotes with linked POs"
        hint="Approved estimates that already have operational PO coverage."
        empty="No approved estimates with PO links in the recent window."
        rows={data.approvedWithLinkedPo.map(flowRow)}
      />
      <AttentionColumn
        title="Estimate-linked PO reconciliation queue"
        hint="POs tied to estimates whose latest reconciliation still needs operator attention."
        empty="No outstanding reconciliation states on estimate-linked POs."
        rows={data.estimateLinkedPoReconciliationAttention.map(reconRow)}
      />
    </div>
  );
}

function flowRow(r: EstimatePoFlowRow) {
  return {
    key: r.estimateId,
    href: `/estimates/${r.estimateId}`,
    primary: r.number,
    secondary: r.title,
    tertiary: r.clientCompanyName,
    sortIso: r.sortAt.toISOString(),
    pill: 'Approved',
    pillClass: 'border-emerald-200 bg-emerald-50 text-emerald-950',
    footline: null as ReactNode,
  };
}

function poRow(r: RecentPoFromEstimateRow) {
  return {
    key: r.poId,
    href: `/purchase-orders/${r.poId}`,
    primary: r.poNumber,
    secondary: r.title,
    tertiary: `${r.clientCompanyName} · ${r.estimateNumber}`,
    sortIso: r.createdAt.toISOString(),
    pill: 'From estimate',
    pillClass: 'border-indigo-200 bg-indigo-50 text-indigo-950',
    footline: (
      <Link
        href={`/estimates/${r.estimateId}`}
        className="mt-2 inline-block text-[11px] font-medium text-[var(--color-bv-accent)] hover:underline"
      >
        Estimate {r.estimateNumber} →
      </Link>
    ),
  };
}

function reconRow(r: EstimatePoReconAttentionRow) {
  return {
    key: r.poId,
    href: `/purchase-orders/${r.poId}`,
    primary: r.poNumber,
    secondary: `Estimate ${r.estimateNumber}`,
    tertiary: humanReconStatus(r.reconStatus),
    sortIso: r.sortAt.toISOString(),
    pill: 'Recon',
    pillClass: 'border-amber-200 bg-amber-50 text-amber-950',
    footline: (
      <Link
        href={`/estimates/${r.estimateId}`}
        className="mt-2 inline-block text-[11px] font-medium text-[var(--color-bv-accent)] hover:underline"
      >
        Open estimate →
      </Link>
    ),
  };
}

function humanReconStatus(s: EstimatePoReconAttentionRow['reconStatus']): string {
  switch (s) {
    case 'PENDING':
      return 'Latest run: pending';
    case 'PARTIAL':
      return 'Latest run: partial match';
    case 'VARIANCE':
      return 'Latest run: variance';
    case 'REVIEW_REQUIRED':
      return 'Latest run: review required';
    default:
      return `Latest run: ${s}`;
  }
}

function AttentionColumn(props: {
  title: string;
  hint: string;
  empty: string;
  rows: Array<{
    key: string;
    href: string;
    primary: string;
    secondary: string;
    tertiary: string;
    sortIso: string;
    pill: string;
    pillClass: string;
    footline: ReactNode;
  }>;
}) {
  return (
    <section>
      <h2 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-bv-muted)]">
        {props.title}
      </h2>
      <p className="mb-3 text-[12px] leading-snug text-[var(--color-bv-muted)]">{props.hint}</p>
      {props.rows.length === 0 ? (
        <div className="rounded-[var(--radius-bv)] border border-dashed border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-4 py-8 text-center text-[13px] text-[var(--color-bv-muted)] shadow-[var(--shadow-bv-card)]">
          {props.empty}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {props.rows.map((r) => (
            <li key={r.key}>
              <Link
                href={r.href as never}
                className="flex flex-col rounded-[10px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-4 py-3 shadow-[var(--shadow-bv-card)] transition-colors hover:bg-[var(--color-bv-bg)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className="font-mono text-[13px] font-semibold text-[var(--color-bv-accent)]">
                      {r.primary}
                    </span>
                    <span className="mt-0.5 block truncate text-[13px] text-[var(--color-bv-text)]">{r.secondary}</span>
                    <span className="mt-0.5 block truncate text-[12px] text-[var(--color-bv-muted)]">{r.tertiary}</span>
                    <time
                      dateTime={r.sortIso}
                      className="mt-2 block text-[11px] tabular-nums text-[var(--color-bv-muted)]"
                    >
                      {formatTs(r.sortIso)}
                    </time>
                  </div>
                  <span
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${r.pillClass}`}
                  >
                    {r.pill}
                  </span>
                </div>
                {r.footline}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function formatTs(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
