import { EstimateStatus } from '@bvisible/db';
import { labelEstimateStatus } from '@/lib/ui/status-labels';

const STEPS = [
  { key: 'draft', label: 'Draft' },
  { key: 'quote', label: 'Quote sent' },
  { key: 'approved', label: 'Approved' },
  { key: 'po', label: 'PO' },
  { key: 'invoice', label: 'Invoice' },
] as const;

function stepState(input: {
  status: EstimateStatus;
  quoteSent: boolean;
  hasPo: boolean;
  hasInvoice: boolean;
}): Record<(typeof STEPS)[number]['key'], 'done' | 'current' | 'upcoming'> {
  const { status, quoteSent, hasPo, hasInvoice } = input;
  const isRejected = status === EstimateStatus.REJECTED;
  const isFinalized = status === EstimateStatus.FINALIZED;

  if (isRejected) {
    return {
      draft: 'done',
      quote: quoteSent ? 'done' : 'upcoming',
      approved: 'upcoming',
      po: 'upcoming',
      invoice: 'upcoming',
    };
  }

  const draftDone = status !== EstimateStatus.DRAFT || quoteSent;
  const quoteDone = quoteSent || status === EstimateStatus.APPROVED || isFinalized;
  const approvedDone =
    status === EstimateStatus.APPROVED || isFinalized;
  const poDone = hasPo;
  const invoiceDone = hasInvoice;

  let current: (typeof STEPS)[number]['key'] = 'draft';
  if (status === EstimateStatus.DRAFT && !quoteSent) current = 'draft';
  else if (status === EstimateStatus.SENT || (status === EstimateStatus.DRAFT && quoteSent))
    current = 'quote';
  else if (status === EstimateStatus.APPROVED && !hasPo) current = 'po';
  else if (status === EstimateStatus.APPROVED && hasPo && !hasInvoice) current = 'invoice';
  else if (isFinalized) current = 'invoice';
  else if (status === EstimateStatus.APPROVED) current = 'approved';

  const map = (key: (typeof STEPS)[number]['key'], done: boolean): 'done' | 'current' | 'upcoming' => {
    if (current === key) return 'current';
    return done ? 'done' : 'upcoming';
  };

  return {
    draft: map('draft', draftDone),
    quote: map('quote', quoteDone),
    approved: map('approved', approvedDone),
    po: map('po', poDone),
    invoice: map('invoice', invoiceDone),
  };
}

export function EstimateDailyWorkflowStrip({
  status,
  quoteSent,
  hasPo,
  hasInvoice,
}: {
  status: EstimateStatus;
  quoteSent: boolean;
  hasPo: boolean;
  hasInvoice: boolean;
  primaryHref: string;
  primaryLabel: string;
  hint: string;
}) {
  const states = stepState({ status, quoteSent, hasPo, hasInvoice });
  const doneCount = STEPS.filter((s) => states[s.key] === 'done').length;

  return (
    <section className="overflow-hidden rounded-[22px] border border-white/80 bg-white/92 shadow-[0_16px_44px_-32px_rgba(15,23,42,0.34)] backdrop-blur-xl">
      <div className="px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[0.16em] text-slate-500 ring-1 ring-inset ring-slate-200">
              Workflow
            </span>
            <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700 ring-1 ring-inset ring-blue-200">
              {doneCount}/{STEPS.length} complete
            </span>
          </div>
          <ol className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {STEPS.map((step, i) => {
              const s = states[step.key];
              return (
                <li
                  key={step.key}
                  className={`flex min-w-0 items-center gap-2 rounded-[14px] border px-3 py-2.5 transition ${
                    s === 'current'
                      ? 'border-blue-200 bg-blue-50 shadow-sm'
                      : s === 'done'
                        ? 'border-emerald-200 bg-emerald-50/80'
                        : 'border-slate-200 bg-white/80'
                  }`}
                >
                  <span
                    className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border text-[11px] font-bold transition-colors ${
                      s === 'current'
                        ? 'border-blue-500 bg-blue-600 text-white shadow-[0_8px_18px_-12px_rgba(37,99,235,0.9)]'
                        : s === 'done'
                          ? 'border-emerald-500 bg-emerald-500 text-white'
                          : 'border-slate-200 bg-white text-slate-400'
                    }`}
                  >
                    {s === 'done' ? '✓' : i + 1}
                  </span>
                  <span className="min-w-0">
                    <span
                      className={`block truncate text-[11.5px] font-bold leading-tight ${
                        s === 'current'
                          ? 'text-blue-700'
                          : s === 'done'
                            ? 'text-emerald-800'
                            : 'text-slate-500'
                      }`}
                    >
                      {step.label}
                    </span>
                    <span
                      className={`mt-0.5 block text-[9.5px] font-semibold uppercase tracking-wide ${
                        s === 'current'
                          ? 'text-blue-500'
                          : s === 'done'
                            ? 'text-emerald-600'
                            : 'text-slate-300'
                      }`}
                    >
                      {s === 'current' ? 'Current' : s === 'done' ? 'Done' : 'Next'}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
      {status === EstimateStatus.REJECTED ? (
        <div className="border-t border-rose-100 bg-rose-50/60 px-5 py-2.5">
          <p className="text-[12px] text-rose-700">
            Status: <strong className="font-semibold">{labelEstimateStatus(status)}</strong> — return
            to Draft or Sent after revising.
          </p>
        </div>
      ) : null}
    </section>
  );
}
