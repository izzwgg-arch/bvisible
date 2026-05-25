import Link from 'next/link';
import type { EstimateFinalizeChecklist } from '@/lib/estimate/estimate-finalize-checklist';

export function EstimateFinalizeChecklistPanel({
  checklist,
}: {
  checklist: EstimateFinalizeChecklist;
}) {
  if (checklist.items.length === 0) return null;

  const pending = checklist.items.filter((item) => !item.done);

  return (
    <div className="mt-4 rounded-[10px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-bv-muted)]">
          Closeout checklist
        </h3>
        {checklist.readyToFinalize ? (
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-950">
            Ready to finalize
          </span>
        ) : pending.length > 0 ? (
          <span className="text-[10.5px] tabular-nums text-[var(--color-bv-muted)]">
            {pending.length} remaining
          </span>
        ) : null}
      </div>
      <ul className="mt-2 flex flex-col gap-1.5">
        {checklist.items.map((item) => (
          <li
            key={item.key}
            className="flex items-center gap-2 rounded-[6px] px-1 py-0.5 text-[12px]"
          >
            <span
              className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border text-[9px] font-bold ${
                item.done
                  ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                  : 'border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] text-[var(--color-bv-muted)]'
              }`}
              aria-hidden
            >
              {item.done ? '✓' : ''}
            </span>
            <ChecklistRow item={item} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChecklistRow({
  item,
}: {
  item: EstimateFinalizeChecklist['items'][number];
}) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="font-medium text-[var(--color-bv-text)]">{item.label}</span>
        {item.key === 'invoice' && !item.done ? (
          <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-bv-muted)]">
            Optional
          </span>
        ) : null}
        {item.href && !item.done ? (
          <Link
            href={item.href as never}
            className="text-[11px] font-medium text-[var(--color-bv-accent)] hover:underline"
          >
            Fix →
          </Link>
        ) : null}
      </div>
      {item.detail ? (
        <p className="text-[11px] leading-snug text-[var(--color-bv-muted)]">{item.detail}</p>
      ) : null}
    </div>
  );
}
