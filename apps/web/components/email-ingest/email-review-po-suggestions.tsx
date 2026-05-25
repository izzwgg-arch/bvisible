'use client';

import type { EmailReviewPoSuggestion } from '@/lib/email-ingest/email-review-po-suggestions';
import { formatPoSuggestionAge } from '@/lib/email-ingest/email-review-po-suggestions';
import { labelPoStatus } from '@/lib/ui/status-labels';
import type { POStatus } from '@bvisible/db';

const CONFIDENCE_STYLE: Record<
  EmailReviewPoSuggestion['confidence'],
  string
> = {
  strong: 'border-emerald-200 bg-emerald-50 text-emerald-950',
  possible: 'border-sky-200 bg-sky-50 text-sky-950',
  weak: 'border-slate-200 bg-slate-50 text-slate-800',
};

const CONFIDENCE_LABEL: Record<EmailReviewPoSuggestion['confidence'], string> = {
  strong: 'Strong candidate',
  possible: 'Possible candidate',
  weak: 'Weak candidate',
};

export function EmailReviewPoSuggestionsPanel({
  suggestions,
  busy,
  onLink,
}: {
  suggestions: readonly EmailReviewPoSuggestion[];
  busy: boolean;
  onLink: (purchaseOrderId: string) => void;
}) {
  const now = new Date();

  return (
    <div className="mt-3 rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2.5">
      <p className="text-[11px] font-medium text-[var(--color-bv-muted)]">
        Suggestions only — operator must choose. Nothing links automatically.
      </p>
      {suggestions.length === 0 ? (
        <p className="mt-2 text-[12px] text-[var(--color-bv-muted)]">
          No safe PO suggestion.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {suggestions.map((s) => (
            <li
              key={s.purchaseOrderId}
              className="flex flex-wrap items-start justify-between gap-2 rounded-[6px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-2.5 py-2"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[12.5px] font-semibold text-[var(--color-bv-text)]">
                    {s.number}
                  </span>
                  {s.qboPoNumber ? (
                    <span className="text-[11px] text-[var(--color-bv-muted)]">
                      QBO {s.qboPoNumber}
                    </span>
                  ) : null}
                  <span
                    className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${CONFIDENCE_STYLE[s.confidence]}`}
                  >
                    {CONFIDENCE_LABEL[s.confidence]}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-[var(--color-bv-muted)]">
                  {s.vendorName ?? 'No vendor'} · {labelPoStatus(s.status as POStatus)} ·{' '}
                  updated {formatPoSuggestionAge(s.updatedAtIso, now)}
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {s.reasons.map((r) => (
                    <span
                      key={r}
                      className="rounded-full border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-bv-text)]"
                    >
                      {r}
                    </span>
                  ))}
                </div>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => onLink(s.purchaseOrderId)}
                className="shrink-0 inline-flex items-center justify-center rounded-[6px] border border-[var(--color-bv-border)] bg-[var(--color-bv-text)] px-2.5 py-1 text-[11.5px] font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busy ? 'Linking…' : 'Link to this PO'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
