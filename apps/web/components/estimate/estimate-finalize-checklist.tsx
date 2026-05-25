import Link from 'next/link';
import type { EstimateFinalizeChecklist } from '@/lib/estimate/estimate-finalize-checklist';

export function EstimateFinalizeChecklistPanel({
  checklist,
}: {
  checklist: EstimateFinalizeChecklist;
}) {
  if (checklist.items.length === 0) return null;

  return (
    <div className="mt-4 rounded-[10px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-bv-muted)]">
          Closeout checklist
        </h3>
        {checklist.readyToFinalize ? (
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-950">
            Ready to finalize
          </span>
        ) : null}
      </div>
      {checklist.blockedSummary ? (
        <p className="mt-2 text-[12px] leading-snug text-[var(--color-bv-muted)]">
          {checklist.blockedSummary}
        </p>
      ) : null}
      <ul className="mt-3 flex flex-col gap-2">
        {checklist.items.map((item) => (
          <li key={item.key} className="flex items-start gap-2 text-[12.5px]">
            <span
              className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold ${
                item.done
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                  : 'border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] text-[var(--color-bv-muted)]'
              }`}
              aria-hidden
            >
              {item.done ? '✓' : ''}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={
                    item.done
                      ? 'font-medium text-[var(--color-bv-text)]'
                      : 'font-medium text-[var(--color-bv-text)]'
                  }
                >
                  {item.label}
                </span>
                {item.href && !item.done ? (
                  <Link
                    href={item.href as never}
                    className="text-[11.5px] font-medium text-[var(--color-bv-accent)] hover:underline"
                  >
                    Fix →
                  </Link>
                ) : null}
              </div>
              {item.detail ? (
                <p className="mt-0.5 text-[11.5px] leading-snug text-[var(--color-bv-muted)]">
                  {item.detail}
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
