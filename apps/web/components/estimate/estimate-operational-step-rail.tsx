export type EstimateOperationalStepRailRow = {
  key: string;
  label: string;
  done: boolean;
  atIso: string | null;
};

export function EstimateOperationalStepRail(props: {
  steps: ReadonlyArray<EstimateOperationalStepRailRow>;
}) {
  return (
    <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {props.steps.map((s) => (
        <div
          key={s.key}
          className={`rounded-[10px] border px-3 py-2 ${
            s.done
              ? 'border-emerald-200 bg-emerald-50/90 text-emerald-950'
              : 'border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] text-[var(--color-bv-muted)]'
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <span className="text-[12.5px] font-semibold leading-snug">{s.label}</span>
            <span
              className={`shrink-0 rounded-full border px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide ${
                s.done
                  ? 'border-emerald-300 bg-white text-emerald-900'
                  : 'border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] text-[var(--color-bv-muted)]'
              }`}
            >
              {s.done ? 'Done' : 'Open'}
            </span>
          </div>
          {s.atIso ? (
            <time
              dateTime={s.atIso}
              className="mt-1 block text-[11px] tabular-nums text-[var(--color-bv-muted)]"
            >
              {formatMedium(s.atIso)}
            </time>
          ) : null}
        </div>
      ))}
    </div>
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
