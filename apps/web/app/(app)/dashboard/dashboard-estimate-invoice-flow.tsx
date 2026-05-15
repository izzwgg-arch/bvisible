import Link from 'next/link';
import type { ReactNode } from 'react';

import type {
  DashboardEstimateInvoiceFlow,
  EstimateMissingInvoiceRow,
  PaidEstimateInvoiceRow,
  UnpaidEstimateInvoiceRow,
} from '@/lib/dashboard/get-dashboard-estimate-invoice-flow';
import { formatMoney } from '@/lib/estimate/format';

export function DashboardEstimateInvoiceFlowSections({
  data,
}: {
  data: DashboardEstimateInvoiceFlow;
}) {
  const hasAnything =
    data.approvedAwaitingInvoice.length > 0 ||
    data.unpaidInvoicesOnApprovedEstimates.length > 0 ||
    data.recentlyPaidEstimateInvoices.length > 0;

  if (!hasAnything) {
    return null;
  }

  return (
    <div className="mb-10 grid gap-8 xl:grid-cols-3">
      <AttentionColumn
        title="Approved · missing invoice"
        hint="Accepted quotes without a linked sales invoice yet (explicit conversion action)."
        empty="Nothing pending — every approved estimate has an invoice link."
        rows={data.approvedAwaitingInvoice.map(missingInvoiceRow)}
      />
      <AttentionColumn
        title="Unpaid estimate invoices"
        hint="Invoices created from estimates still marked unpaid."
        empty="No open invoices tied to estimates."
        rows={data.unpaidInvoicesOnApprovedEstimates.map(unpaidRow)}
      />
      <AttentionColumn
        title="Recently paid · estimate invoices"
        hint="Latest customer settlements recorded against estimate-linked invoices."
        empty="No paid invoice activity captured recently."
        rows={data.recentlyPaidEstimateInvoices.map(paidRow)}
      />
    </div>
  );
}

function missingInvoiceRow(r: EstimateMissingInvoiceRow) {
  return {
    key: r.estimateId,
    href: `/estimates/${r.estimateId}`,
    primary: r.number,
    secondary: r.title,
    tertiary: r.clientCompanyName,
    sortIso: r.sortAt.toISOString(),
    pill: 'No invoice',
    pillClass: 'border-amber-200 bg-amber-50 text-amber-950',
    footline: (
      <span className="mt-2 inline-block text-[11px] text-[var(--color-bv-muted)]">
        Create invoice from the estimate fulfillment panel.
      </span>
    ),
  };
}

function unpaidRow(r: UnpaidEstimateInvoiceRow) {
  return {
    key: r.invoiceId,
    href: `/invoices/${r.invoiceId}`,
    primary: r.invoiceNumber,
    secondary: r.title,
    tertiary: `${r.clientCompanyName} · ${formatMoney(r.subtotalCents)}`,
    sortIso: r.sortAt.toISOString(),
    pill: 'Unpaid',
    pillClass: 'border-amber-200 bg-amber-50 text-amber-950',
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

function paidRow(r: PaidEstimateInvoiceRow) {
  return {
    key: r.invoiceId,
    href: `/invoices/${r.invoiceId}`,
    primary: r.invoiceNumber,
    secondary: r.title,
    tertiary: `${r.clientCompanyName} · ${formatMoney(r.subtotalCents)}`,
    sortIso: r.paidAt.toISOString(),
    pill: 'Paid',
    pillClass: 'border-emerald-200 bg-emerald-50 text-emerald-950',
    footline: (
      <>
        <time
          dateTime={r.paidAt.toISOString()}
          className="mt-2 inline-block text-[11px] text-[var(--color-bv-muted)]"
        >
          Paid {formatMedium(r.paidAt.toISOString())}
        </time>
        <Link
          href={`/estimates/${r.estimateId}`}
          className="mt-1 block text-[11px] font-medium text-[var(--color-bv-accent)] hover:underline"
        >
          Estimate {r.estimateNumber} →
        </Link>
      </>
    ),
  };
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
                      {formatMedium(r.sortIso)}
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

function formatMedium(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
