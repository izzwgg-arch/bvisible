import Link from 'next/link';

const NODE_BASE =
  'flex min-h-[2.75rem] flex-1 flex-col justify-center rounded-[10px] border px-3 py-2 text-center';
const DONE = 'border-emerald-200 bg-emerald-50 text-emerald-950';
const OPEN = 'border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] text-[var(--color-bv-muted)]';

export function EstimateRelationshipFlowStrip(props: {
  estimateId: string;
  quoteDone: boolean;
  poDone: boolean;
  invoiceDone: boolean;
  paidDone: boolean;
  firstPoId: string | null;
  invoiceId: string | null;
}) {
  const nodes: Array<{
    label: string;
    done: boolean;
    href: string | null;
    hint: string | null;
  }> = [
    {
      label: 'Quote',
      done: props.quoteDone,
      href: `/estimates/${props.estimateId}/preview`,
      hint: 'Customer-facing quote',
    },
    {
      label: 'PO',
      done: props.poDone,
      href: props.firstPoId ? `/purchase-orders/${props.firstPoId}` : null,
      hint: props.poDone ? 'Linked purchase order' : 'No PO linked yet',
    },
    {
      label: 'Invoice',
      done: props.invoiceDone,
      href: props.invoiceId ? `/invoices/${props.invoiceId}` : null,
      hint: props.invoiceDone ? 'Sales invoice created' : 'No invoice yet',
    },
    {
      label: 'Paid',
      done: props.paidDone,
      href: props.invoiceId ? `/invoices/${props.invoiceId}` : null,
      hint: props.paidDone ? 'Marked paid in app' : 'Awaiting payment record',
    },
  ];

  return (
    <div className="mt-4 rounded-[10px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-3">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--color-bv-muted)]">
        Relationship flow
      </p>
      <div className="mt-3 flex flex-wrap items-stretch gap-2 md:flex-nowrap">
        {nodes.map((n, i) => (
          <div key={n.label} className="flex min-w-[140px] flex-1 items-center gap-2">
            <div className="flex-1">
              {n.href ? (
                <Link
                  href={n.href as never}
                  className={`block ${NODE_BASE} ${n.done ? DONE : OPEN} transition-colors hover:opacity-95`}
                >
                  <span className="text-[12px] font-semibold">{n.label}</span>
                  {n.hint ? (
                    <span className="mt-0.5 block text-[10.5px] leading-snug opacity-90">{n.hint}</span>
                  ) : null}
                </Link>
              ) : (
                <div className={`${NODE_BASE} ${n.done ? DONE : OPEN}`}>
                  <span className="text-[12px] font-semibold">{n.label}</span>
                  {n.hint ? (
                    <span className="mt-0.5 block text-[10.5px] leading-snug opacity-90">{n.hint}</span>
                  ) : null}
                </div>
              )}
            </div>
            {i < nodes.length - 1 ? (
              <span className="hidden text-[14px] text-[var(--color-bv-muted)] md:inline" aria-hidden>
                →
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
