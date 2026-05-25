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
  defaultCollapsed?: boolean;
}) {
  const {
    estimateId,
    estimateNumber,
    estimateTitle,
    clientCompanyName,
    estimateStatus,
    quoteSummaryProps,
    defaultCollapsed = false,
  } = props;

  return (
    <details
      className="mb-6 rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] shadow-[var(--shadow-bv-card)]"
      open={!defaultCollapsed}
    >
      <summary className="cursor-pointer list-none px-4 py-3 marker:content-none [&::-webkit-details-marker]:hidden">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-bv-muted)]">
              Originating estimate
            </p>
            <p className="mt-0.5 text-[14px] font-semibold text-[var(--color-bv-text)]">
              <span className="font-mono text-[var(--color-bv-accent)]">{estimateNumber}</span>
              <span> · {estimateTitle}</span>
            </p>
            <p className="text-[12px] text-[var(--color-bv-muted)]">{clientCompanyName}</p>
          </div>
          <span className="rounded-full border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--color-bv-text)]">
            {labelEstimateStatus(estimateStatus)}
          </span>
        </div>
      </summary>
      <div className="border-t border-[var(--color-bv-border)] px-4 pb-4 pt-3">
        <EstimateQuoteResponseSummary {...quoteSummaryProps} />
        <Link
          href={`/estimates/${estimateId}`}
          className="mt-3 inline-flex text-[13px] font-medium text-[var(--color-bv-accent)] hover:underline"
        >
          Open estimate workspace →
        </Link>
      </div>
    </details>
  );
}
