import { IconCheck } from '@/components/estimate/estimate-surface';

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
          className={`flex items-start gap-2.5 rounded-[12px] border px-3 py-2.5 ${
            s.done
              ? 'border-emerald-200 bg-emerald-50/70'
              : 'border-slate-200 bg-white'
          }`}
        >
          <span
            className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold ${
              s.done
                ? 'bg-emerald-500 text-white'
                : 'bg-slate-100 text-slate-300 ring-1 ring-inset ring-slate-200'
            }`}
            aria-hidden
          >
            {s.done ? <IconCheck width={12} height={12} /> : ''}
          </span>
          <div className="min-w-0">
            <span
              className={`block text-[12.5px] font-semibold leading-snug ${
                s.done ? 'text-emerald-900' : 'text-slate-600'
              }`}
            >
              {s.label}
            </span>
            {s.atIso ? (
              <time
                dateTime={s.atIso}
                className="mt-0.5 block text-[11px] tabular-nums text-slate-400"
              >
                {formatMedium(s.atIso)}
              </time>
            ) : (
              <span className="mt-0.5 block text-[10.5px] font-medium uppercase tracking-wide text-slate-300">
                {s.done ? 'Done' : 'Pending'}
              </span>
            )}
          </div>
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
