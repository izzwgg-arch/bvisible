import type { EstimateTimelineRowSerialized } from '@/lib/estimate/load-estimate-quote-staff-ui';

export function EstimateTimelineSection(props: { rows: EstimateTimelineRowSerialized[] }) {
  if (props.rows.length === 0) {
    return (
      <section className="rounded-[var(--radius-bv)] border border-dashed border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-4 py-6 shadow-[var(--shadow-bv-card)]">
        <h2 className="text-[13px] font-semibold text-[var(--color-bv-text)]">Estimate timeline</h2>
        <p className="mt-2 text-[13px] text-[var(--color-bv-muted)]">
          No timeline entries yet — sending the quote or recording customer responses will populate this list.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-4 shadow-[var(--shadow-bv-card)]">
      <h2 className="text-[13px] font-semibold text-[var(--color-bv-text)]">Estimate timeline</h2>
      <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-bv-muted)]">
        Read-only audit-backed history for this estimate (most recent at bottom).
      </p>
      <ul className="mt-4 space-y-3 border-l border-[var(--color-bv-border)] pl-4">
        {props.rows.map((r) => (
          <li key={r.rowKey} className="relative">
            <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-[var(--color-bv-accent)]" />
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-[13px] font-medium text-[var(--color-bv-text)]">{r.title}</p>
              <time
                dateTime={r.sortAtIso}
                className="text-[11px] tabular-nums text-[var(--color-bv-muted)]"
              >
                {formatShort(r.sortAtIso)}
              </time>
            </div>
            {r.subtitle ? (
              <p className="mt-1 text-[12.5px] leading-snug text-[var(--color-bv-muted)]">{r.subtitle}</p>
            ) : null}
            <p className="mt-1 text-[10px] uppercase tracking-wide text-[var(--color-bv-muted)]">
              {r.source === 'timeline_event' ? 'Timeline record' : 'Audit record'}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function formatShort(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
