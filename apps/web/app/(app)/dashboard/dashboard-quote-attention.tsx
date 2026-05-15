import Link from 'next/link';

import type { DashboardQuoteAttention } from '@/lib/dashboard/get-quote-attention';

export function DashboardQuoteAttentionSections({ data }: { data: DashboardQuoteAttention }) {
  const hasAnything =
    data.awaitingCustomerResponse.length > 0 ||
    data.recentlyAccepted.length > 0 ||
    data.recentlyDeclined.length > 0;

  if (!hasAnything) {
    return null;
  }

  return (
    <div className="mb-10 grid gap-8 xl:grid-cols-3">
      <AttentionColumn
        title="Quotes awaiting customer"
        hint="Sent estimates with an active public link and no response yet."
        empty="No sent quotes are waiting on the customer right now."
        rows={data.awaitingCustomerResponse.map((r) => ({
          key: r.estimateId,
          href: `/estimates/${r.estimateId}`,
          primary: r.number,
          secondary: r.title,
          tertiary: r.clientCompanyName,
          sortIso: r.sortAt.toISOString(),
          pill: 'Awaiting',
          pillClass: 'border-sky-200 bg-sky-50 text-sky-950',
        }))}
      />
      <AttentionColumn
        title="Recently accepted quotes"
        hint="Latest customer Accept actions via public links."
        empty="No recent accepts recorded."
        rows={data.recentlyAccepted.map((r) => ({
          key: r.estimateId,
          href: `/estimates/${r.estimateId}`,
          primary: r.number,
          secondary: r.title,
          tertiary: r.clientCompanyName,
          sortIso: r.sortAt.toISOString(),
          pill: 'Accepted',
          pillClass: 'border-emerald-200 bg-emerald-50 text-emerald-950',
        }))}
      />
      <AttentionColumn
        title="Recently declined quotes"
        hint="Latest customer Decline actions via public links."
        empty="No recent declines recorded."
        rows={data.recentlyDeclined.map((r) => ({
          key: r.estimateId,
          href: `/estimates/${r.estimateId}`,
          primary: r.number,
          secondary: r.title,
          tertiary: r.clientCompanyName,
          sortIso: r.sortAt.toISOString(),
          pill: 'Declined',
          pillClass: 'border-amber-200 bg-amber-50 text-amber-950',
        }))}
      />
    </div>
  );
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
                className="flex items-start justify-between gap-3 rounded-[10px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-4 py-3 shadow-[var(--shadow-bv-card)] transition-colors hover:bg-[var(--color-bv-bg)]"
              >
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
