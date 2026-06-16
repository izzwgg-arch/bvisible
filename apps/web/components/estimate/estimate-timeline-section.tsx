import type { EstimateTimelineRowSerialized } from '@/lib/estimate/load-estimate-quote-staff-ui';
import { SectionCard, SectionHeading, IconClock } from '@/components/estimate/estimate-surface';

export function EstimateTimelineSection(props: { rows: EstimateTimelineRowSerialized[] }) {
  if (props.rows.length === 0) {
    return (
      <SectionCard className="px-4 py-5">
        <SectionHeading
          icon={<IconClock />}
          tone="violet"
          title="Estimate timeline"
          subtitle="No timeline entries yet — sending the quote or recording customer responses will populate this list."
        />
      </SectionCard>
    );
  }

  return (
    <SectionCard className="p-4">
      <SectionHeading
        icon={<IconClock />}
        tone="violet"
        title="Estimate timeline"
        subtitle="Read-only audit-backed history for this estimate (most recent at bottom)."
      />
      <ul className="mt-4 space-y-4 border-l-2 border-slate-100 pl-5">
        {props.rows.map((r) => (
          <li key={r.rowKey} className="relative">
            <span className="absolute -left-[26px] top-1 grid h-3.5 w-3.5 place-items-center rounded-full bg-white ring-2 ring-violet-200">
              <span className="h-1.5 w-1.5 rounded-full bg-violet-500" />
            </span>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-[13px] font-semibold text-slate-800">{r.title}</p>
              <time
                dateTime={r.sortAtIso}
                className="text-[11px] tabular-nums text-slate-400"
              >
                {formatShort(r.sortAtIso)}
              </time>
            </div>
            {r.subtitle ? (
              <p className="mt-1 text-[12.5px] leading-snug text-slate-500">{r.subtitle}</p>
            ) : null}
            <span className="mt-1.5 inline-block rounded-full bg-slate-50 px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-slate-400 ring-1 ring-inset ring-slate-100">
              {r.source === 'timeline_event' ? 'Timeline record' : 'Audit record'}
            </span>
          </li>
        ))}
      </ul>
    </SectionCard>
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
