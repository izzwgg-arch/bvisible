export type EstimateQuoteResponseSummaryProps = {
  headline: string;
  detail: string | null;
  phaseLabel: string;
  estimateNumber: string;
  responderName: string | null;
  responderNote: string | null;
  respondedAtLabel: string | null;
  lastViewedAtLabel: string | null;
  linkIssuedAtLabel: string | null;
  linkExpiresAtLabel: string | null;
  activeLinkPresent: boolean;
};

function formatTs(dIso: string | null): string {
  if (!dIso) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(dIso));
  } catch {
    return '—';
  }
}

function phaseBadgeClass(phaseLabel: string): string {
  if (phaseLabel.startsWith('Accepted')) return 'border-emerald-200 bg-emerald-50 text-emerald-950';
  if (phaseLabel.startsWith('Declined')) return 'border-amber-200 bg-amber-50 text-amber-950';
  if (phaseLabel.startsWith('Awaiting')) return 'border-sky-200 bg-sky-50 text-sky-950';
  if (phaseLabel.startsWith('Revoked') || phaseLabel.startsWith('Expired'))
    return 'border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] text-[var(--color-bv-muted)]';
  return 'border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] text-[var(--color-bv-text)]';
}

export function EstimateQuoteResponseSummary(props: EstimateQuoteResponseSummaryProps) {
  return (
    <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-4 shadow-[var(--shadow-bv-card)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-bv-muted)]">
            Customer quote response
          </p>
          <h2 className="mt-1 text-[15px] font-semibold text-[var(--color-bv-text)]">{props.headline}</h2>
          {props.detail ? (
            <p className="mt-1 max-w-[640px] text-[13px] leading-relaxed text-[var(--color-bv-muted)]">
              {props.detail}
            </p>
          ) : null}
        </div>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${phaseBadgeClass(props.phaseLabel)}`}
        >
          {props.phaseLabel}
        </span>
      </div>

      <dl className="mt-4 grid gap-3 text-[12.5px] sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <dt className="text-[var(--color-bv-muted)]">Estimate</dt>
          <dd className="font-mono font-medium text-[var(--color-bv-text)]">{props.estimateNumber}</dd>
        </div>
        <div>
          <dt className="text-[var(--color-bv-muted)]">Responded</dt>
          <dd className="font-medium text-[var(--color-bv-text)]">{formatTs(props.respondedAtLabel)}</dd>
        </div>
        <div>
          <dt className="text-[var(--color-bv-muted)]">Customer name</dt>
          <dd className="font-medium text-[var(--color-bv-text)]">{props.responderName?.trim() || '—'}</dd>
        </div>
        <div className="sm:col-span-2 lg:col-span-3">
          <dt className="text-[var(--color-bv-muted)]">Customer note</dt>
          <dd className="mt-0.5 whitespace-pre-wrap font-medium text-[var(--color-bv-text)]">
            {(props.responderNote ?? '').trim() || '—'}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--color-bv-muted)]">Last viewed (public)</dt>
          <dd className="font-medium text-[var(--color-bv-text)]">{formatTs(props.lastViewedAtLabel)}</dd>
        </div>
        <div>
          <dt className="text-[var(--color-bv-muted)]">Link issued</dt>
          <dd className="font-medium text-[var(--color-bv-text)]">{formatTs(props.linkIssuedAtLabel)}</dd>
        </div>
        <div>
          <dt className="text-[var(--color-bv-muted)]">Link expires</dt>
          <dd className="font-medium text-[var(--color-bv-text)]">{formatTs(props.linkExpiresAtLabel)}</dd>
        </div>
      </dl>

      <p className="mt-3 text-[12px] text-[var(--color-bv-muted)]">
        Active customer URL in circulation:{' '}
        <strong className="text-[var(--color-bv-text)]">{props.activeLinkPresent ? 'Yes' : 'No'}</strong>
      </p>
    </section>
  );
}
