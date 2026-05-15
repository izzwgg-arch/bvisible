import Link from 'next/link';
import { EstimateStatus, POStatus } from '@bvisible/db';
import { labelEstimateStatus, labelPoStatus } from '@/lib/ui/status-labels';

const FLOW = [
  EstimateStatus.DRAFT,
  EstimateStatus.SENT,
  EstimateStatus.APPROVED,
  EstimateStatus.FINALIZED,
] as const;

export function EstimateWorkflowRail({
  estimateNumber,
  status,
  linkedPos,
}: {
  estimateNumber: string;
  status: EstimateStatus;
  linkedPos: ReadonlyArray<{
    id: string;
    number: string;
    status: POStatus;
    qboPoNumber: string | null;
    vendorName: string | null;
  }>;
}) {
  const isFinalized = status === EstimateStatus.FINALIZED;
  const isRejected = status === EstimateStatus.REJECTED;
  const currentIndex = isRejected ? -1 : FLOW.indexOf(status);

  const hasPo = linkedPos.length > 0;
  const posWithQbo = linkedPos.filter((p) => p.qboPoNumber);
  const finalizeBlocked =
    !isFinalized && !isRejected
      ? !hasPo
        ? ('no_po' as const)
        : posWithQbo.length === 0
          ? ('no_qbo' as const)
          : null
      : null;

  const nextAction =
    finalizeBlocked === 'no_po'
      ? {
          title: 'Create a purchase order',
          body: 'Estimates finalize only after at least one linked PO exists with a QuickBooks PO number recorded.',
        }
      : finalizeBlocked === 'no_qbo'
        ? {
            title: 'Record QuickBooks PO numbers',
            body: 'Each linked PO below needs a QBO # before this estimate can finalize.',
          }
        : status === EstimateStatus.DRAFT
          ? {
              title: 'Move this quote forward',
              body: 'Send it to the customer, then mark Approved when they commit.',
            }
          : status === EstimateStatus.SENT
            ? {
                title: 'Awaiting customer decision',
                body: 'Mark Approved when they accept — then create POs from the totals panel.',
              }
            : status === EstimateStatus.APPROVED && !isFinalized
              ? {
                  title: 'Operationalize the win',
                  body: 'Create POs from approved lines, capture QBO numbers, then finalize.',
                }
              : null;

  return (
    <div className="mb-8 flex flex-col gap-5">
      <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-5 shadow-[var(--shadow-bv-card)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[var(--color-bv-muted)]">
            Estimate lifecycle
          </h2>
          <span className="rounded-full border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-2.5 py-1 text-[12px] font-medium text-[var(--color-bv-text)]">
            {estimateNumber}
          </span>
        </div>

        {isRejected ? (
          <p className="mt-4 rounded-[10px] border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-900">
            Marked <strong>Rejected</strong> — revise pricing or scope before returning to Draft or Sent.
          </p>
        ) : (
          <ol className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {FLOW.map((step, i) => {
              const stepIndex = FLOW.indexOf(step);
              const done =
                currentIndex > stepIndex ||
                (isFinalized && step === EstimateStatus.FINALIZED);
              const current = !isFinalized && currentIndex === stepIndex;
              return (
                <li key={step}>
                  <div
                    className={`flex h-full min-h-[3rem] items-center justify-center rounded-[10px] border px-3 py-2 text-center text-[12.5px] font-semibold leading-snug ${
                      done
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                        : current
                          ? 'border-[var(--color-bv-accent)] bg-[var(--color-bv-accent)]/10 text-[var(--color-bv-accent)]'
                          : 'border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] text-[var(--color-bv-muted)]'
                    }`}
                  >
                    <span className="mr-2 tabular-nums text-[11px] opacity-70">{i + 1}.</span>
                    {labelEstimateStatus(step)}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {linkedPos.length > 0 ? (
        <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-5 shadow-[var(--shadow-bv-card)]">
          <h3 className="text-[14px] font-semibold text-[var(--color-bv-text)]">Linked purchase orders</h3>
          <p className="mt-1 text-[12.5px] text-[var(--color-bv-muted)]">
            Finalizing requires at least one PO with a QuickBooks number saved.
          </p>
          <ul className="mt-4 flex flex-col gap-2">
            {linkedPos.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-4 py-3 text-[13px]"
              >
                <div className="min-w-0">
                  <Link
                    href={`/purchase-orders/${p.id}` as never}
                    className="font-mono font-semibold text-[var(--color-bv-accent)] hover:underline"
                  >
                    {p.number}
                  </Link>
                  <span className="block text-[12px] text-[var(--color-bv-muted)]">
                    {p.vendorName ?? 'No vendor'} · {labelPoStatus(p.status)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {p.qboPoNumber ? (
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11.5px] font-semibold text-emerald-900">
                      QBO {p.qboPoNumber}
                    </span>
                  ) : (
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11.5px] font-semibold text-amber-950">
                      Missing QBO #
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {finalizeBlocked ? (
        <section className="rounded-[var(--radius-bv)] border border-amber-200 bg-amber-50/80 p-5 shadow-[var(--shadow-bv-card)]">
          <h3 className="text-[14px] font-semibold text-amber-950">Why finalize is blocked</h3>
          <p className="mt-2 text-[13.5px] leading-relaxed text-amber-950/95">
            {finalizeBlocked === 'no_po'
              ? 'Create a PO from this estimate using the totals panel. Nothing is locked until you finalize.'
              : 'Enter the QuickBooks PO number on each linked PO — that proves finance issued the buy.'}
          </p>
        </section>
      ) : null}

      {nextAction && !isRejected ? (
        <section className="rounded-[var(--radius-bv)] border border-sky-200 bg-sky-50/70 p-5 shadow-[var(--shadow-bv-card)]">
          <h3 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-sky-950">Next recommended action</h3>
          <p className="mt-2 text-[14px] font-semibold text-sky-950">{nextAction.title}</p>
          <p className="mt-1 text-[13.5px] leading-relaxed text-sky-950/90">{nextAction.body}</p>
        </section>
      ) : null}
    </div>
  );
}
