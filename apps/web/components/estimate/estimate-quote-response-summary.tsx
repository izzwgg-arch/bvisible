import { SectionCard, SectionHeading, IconChat } from '@/components/estimate/estimate-surface';

export type EstimateQuoteResponseSummaryProps = {
  headline: string;
  detail: string | null;
  phaseLabel: string;
  estimateNumber: string;
  responderName: string | null;
  responderNote: string | null;
  respondedAtLabel: string | null;
  lastViewedAtLabel: string | null;
  linkIssuedAtLabel: string | null;
  linkExpiresAtLabel: string | null;
  activeLinkPresent: boolean;
};

function formatTs(dIso: string | null): string {
  if (!dIso) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(dIso));
  } catch {
    return '—';
  }
}

function phaseBadgeClass(phaseLabel: string): string {
  if (phaseLabel.startsWith('Accepted')) return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  if (phaseLabel.startsWith('Declined')) return 'bg-amber-50 text-amber-700 ring-amber-200';
  if (phaseLabel.startsWith('Awaiting')) return 'bg-sky-50 text-sky-700 ring-sky-200';
  if (phaseLabel.startsWith('Revoked') || phaseLabel.startsWith('Expired'))
    return 'bg-slate-50 text-slate-500 ring-slate-200';
  return 'bg-slate-50 text-slate-700 ring-slate-200';
}

function phaseTone(phaseLabel: string): 'emerald' | 'amber' | 'blue' | 'slate' {
  if (phaseLabel.startsWith('Accepted')) return 'emerald';
  if (phaseLabel.startsWith('Declined')) return 'amber';
  if (phaseLabel.startsWith('Awaiting')) return 'blue';
  return 'slate';
}

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const empty = value === '—';
  return (
    <div className="rounded-[10px] border border-slate-100 bg-slate-50/60 px-3 py-2">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">
        {label}
      </dt>
      <dd
        className={`mt-0.5 text-[12.5px] tabular-nums ${
          empty ? 'font-normal text-slate-300' : 'font-medium text-slate-800'
        } ${mono ? 'font-mono' : ''}`}
      >
        {value}
      </dd>
    </div>
  );
}

export function EstimateQuoteResponseSummary(props: EstimateQuoteResponseSummaryProps) {
  const tone = phaseTone(props.phaseLabel);
  const name = props.responderName?.trim() ?? '';
  const note = (props.responderNote ?? '').trim();
  const hasResponse = Boolean(props.respondedAtLabel || name || note);

  const RESPONSE_TONE: Record<typeof tone, string> = {
    emerald: 'border-emerald-200 bg-emerald-50/50',
    amber: 'border-amber-200 bg-amber-50/50',
    blue: 'border-sky-200 bg-sky-50/50',
    slate: 'border-slate-200 bg-slate-50/60',
  };

  return (
    <SectionCard className="p-4">
      <SectionHeading
        icon={<IconChat />}
        tone={tone}
        title={props.headline}
        subtitle={props.detail ?? undefined}
        badge={
          <span
            className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset ${phaseBadgeClass(props.phaseLabel)}`}
          >
            {props.phaseLabel}
          </span>
        }
      />

      {hasResponse ? (
        <div className={`mt-4 rounded-[14px] border p-3.5 ${RESPONSE_TONE[tone]}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[13px] font-semibold text-slate-900">{name || 'Customer'}</span>
            {props.respondedAtLabel ? (
              <span className="text-[11.5px] tabular-nums text-slate-500">
                {formatTs(props.respondedAtLabel)}
              </span>
            ) : null}
          </div>
          {note ? (
            <p className="mt-2 whitespace-pre-wrap border-l-2 border-slate-300/70 pl-3 text-[12.5px] italic leading-relaxed text-slate-600">
              “{note}”
            </p>
          ) : (
            <p className="mt-1 text-[12px] text-slate-400">No note left with the response.</p>
          )}
        </div>
      ) : (
        <div className="mt-4 flex items-center gap-3 rounded-[14px] border border-dashed border-slate-200 bg-slate-50/40 px-4 py-4">
          <span
            aria-hidden
            className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-white text-slate-300 ring-1 ring-inset ring-slate-200"
          >
            <IconChat width={18} height={18} />
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-slate-700">No customer response yet</p>
            <p className="mt-0.5 text-[12px] leading-snug text-slate-500">
              Once you share the quote link, their accept/decline and any note will appear here.
            </p>
          </div>
        </div>
      )}

      <dl className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Estimate" value={props.estimateNumber} mono />
        <Stat label="Last viewed" value={formatTs(props.lastViewedAtLabel)} />
        <Stat label="Link issued" value={formatTs(props.linkIssuedAtLabel)} />
        <Stat label="Link expires" value={formatTs(props.linkExpiresAtLabel)} />
      </dl>

      <p className="mt-3 flex items-center gap-2 text-[12px] text-slate-500">
        Active customer URL in circulation:
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${
            props.activeLinkPresent
              ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
              : 'bg-slate-50 text-slate-500 ring-slate-200'
          }`}
        >
          {props.activeLinkPresent ? 'Yes' : 'No'}
        </span>
      </p>
    </SectionCard>
  );
}
