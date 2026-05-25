import Link from 'next/link';
import { EstimateStatus } from '@bvisible/db';
import { labelEstimateStatus } from '@/lib/ui/status-labels';

const STEPS = [
  { key: 'draft', label: 'Draft' },
  { key: 'quote', label: 'Quote sent' },
  { key: 'approved', label: 'Approved' },
  { key: 'po', label: 'PO' },
  { key: 'invoice', label: 'Invoice' },
] as const;

function stepState(input: {
  status: EstimateStatus;
  quoteSent: boolean;
  hasPo: boolean;
  hasInvoice: boolean;
}): Record<(typeof STEPS)[number]['key'], 'done' | 'current' | 'upcoming'> {
  const { status, quoteSent, hasPo, hasInvoice } = input;
  const isRejected = status === EstimateStatus.REJECTED;
  const isFinalized = status === EstimateStatus.FINALIZED;

  if (isRejected) {
    return {
      draft: 'done',
      quote: quoteSent ? 'done' : 'upcoming',
      approved: 'upcoming',
      po: 'upcoming',
      invoice: 'upcoming',
    };
  }

  const draftDone = status !== EstimateStatus.DRAFT || quoteSent;
  const quoteDone = quoteSent || status === EstimateStatus.APPROVED || isFinalized;
  const approvedDone =
    status === EstimateStatus.APPROVED || isFinalized;
  const poDone = hasPo;
  const invoiceDone = hasInvoice;

  let current: (typeof STEPS)[number]['key'] = 'draft';
  if (status === EstimateStatus.DRAFT && !quoteSent) current = 'draft';
  else if (status === EstimateStatus.SENT || (status === EstimateStatus.DRAFT && quoteSent))
    current = 'quote';
  else if (status === EstimateStatus.APPROVED && !hasPo) current = 'po';
  else if (status === EstimateStatus.APPROVED && hasPo && !hasInvoice) current = 'invoice';
  else if (isFinalized) current = 'invoice';
  else if (status === EstimateStatus.APPROVED) current = 'approved';

  const map = (key: (typeof STEPS)[number]['key'], done: boolean): 'done' | 'current' | 'upcoming' => {
    if (current === key) return 'current';
    return done ? 'done' : 'upcoming';
  };

  return {
    draft: map('draft', draftDone),
    quote: map('quote', quoteDone),
    approved: map('approved', approvedDone),
    po: map('po', poDone),
    invoice: map('invoice', invoiceDone),
  };
}

export function EstimateDailyWorkflowStrip({
  status,
  quoteSent,
  hasPo,
  hasInvoice,
  primaryHref,
  primaryLabel,
  hint,
}: {
  status: EstimateStatus;
  quoteSent: boolean;
  hasPo: boolean;
  hasInvoice: boolean;
  primaryHref: string;
  primaryLabel: string;
  hint: string;
}) {
  const states = stepState({ status, quoteSent, hasPo, hasInvoice });

  return (
    <section className="mb-6 rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-4 py-3 shadow-[var(--shadow-bv-card)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <ol className="flex flex-wrap items-center gap-1.5">
          {STEPS.map((step, i) => {
            const s = states[step.key];
            return (
              <li key={step.key} className="flex items-center gap-1.5">
                <span
                  className={`rounded-full border px-2.5 py-0.5 text-[10.5px] font-semibold leading-tight ${
                    s === 'current'
                      ? 'border-[var(--color-bv-accent)] bg-[var(--color-bv-accent)]/10 text-[var(--color-bv-accent)]'
                      : s === 'done'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                        : 'border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] text-[var(--color-bv-muted)]'
                  }`}
                >
                  {step.label}
                </span>
                {i < STEPS.length - 1 ? (
                  <span className="text-[10px] text-[var(--color-bv-muted)]" aria-hidden>
                    →
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
        <div className="flex shrink-0 flex-col items-end gap-1 sm:items-end">
          <Link
            href={primaryHref as never}
            className="inline-flex items-center justify-center rounded-[8px] bg-[var(--color-bv-accent)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--color-bv-accent-foreground)] shadow-sm hover:opacity-95"
          >
            {primaryLabel}
          </Link>
          <span className="max-w-[280px] text-right text-[11px] leading-snug text-[var(--color-bv-muted)]">
            {hint}
          </span>
        </div>
      </div>
      {status === EstimateStatus.REJECTED ? (
        <p className="mt-2 text-[12px] text-[var(--color-bv-muted)]">
          Status: <strong className="text-[var(--color-bv-text)]">{labelEstimateStatus(status)}</strong> — return to Draft or Sent after revising.
        </p>
      ) : null}
    </section>
  );
}
