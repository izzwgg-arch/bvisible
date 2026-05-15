import Link from 'next/link';

import type { EstimateStatus } from '@bvisible/db';

import {
  EstimateQuoteResponseSummary,
  type EstimateQuoteResponseSummaryProps,
} from '@/components/estimate/estimate-quote-response-summary';
import { labelEstimateStatus } from '@/lib/ui/status-labels';

export function PoEstimateOriginSection(props: {
  estimateId: string;
  estimateNumber: string;
  estimateTitle: string;
  clientCompanyName: string;
  estimateStatus: EstimateStatus;
  quoteSummaryProps: EstimateQuoteResponseSummaryProps;
}) {
  const {
    estimateId,
    estimateNumber,
    estimateTitle,
    clientCompanyName,
    estimateStatus,
    quoteSummaryProps,
  } = props;

  return (
    <section className="mb-6 rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-5 shadow-[var(--shadow-bv-card)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-bv-muted)]">
            Originating estimate
          </p>
          <h2 className="mt-1 text-[16px] font-semibold text-[var(--color-bv-text)]">
            <Link
              href={`/estimates/${estimateId}`}
              className="font-mono text-[var(--color-bv-accent)] hover:underline"
            >
              {estimateNumber}
            </Link>
            <span className="text-[var(--color-bv-text)]"> · {estimateTitle}</span>
          </h2>
          <p className="mt-1 text-[13px] text-[var(--color-bv-muted)]">{clientCompanyName}</p>
        </div>
        <span className="rounded-full border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-bv-text)]">
          Quote status: {labelEstimateStatus(estimateStatus)}
        </span>
      </div>
      <div className="mt-4 border-t border-[var(--color-bv-border)] pt-4">
        <EstimateQuoteResponseSummary {...quoteSummaryProps} />
      </div>
      <div className="mt-4">
        <Link
          href={`/estimates/${estimateId}`}
          className="text-[13px] font-medium text-[var(--color-bv-accent)] hover:underline"
        >
          Open estimate workspace →
        </Link>
      </div>
    </section>
  );
}
