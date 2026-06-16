import Link from 'next/link';

import { IconCheck } from '@/components/estimate/estimate-surface';

const NODE_BASE =
  'group flex min-h-[3.25rem] flex-1 items-center gap-2.5 rounded-[12px] border px-3 py-2.5 transition';
const DONE =
  'border-emerald-200 bg-emerald-50/80 text-emerald-900 hover:border-emerald-300';
const OPEN =
  'border-slate-200 bg-white text-slate-500 hover:border-slate-300';

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

  const doneCount = nodes.filter((n) => n.done).length;

  return (
    <div className="mt-4 rounded-[14px] border border-slate-200 bg-slate-50/70 p-3.5">
      <div className="flex items-center justify-between">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-400">
          Relationship flow
        </p>
        <span className="text-[10.5px] font-semibold tabular-nums text-slate-400">
          {doneCount}/{nodes.length} complete
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-stretch gap-2 md:flex-nowrap">
        {nodes.map((n, i) => {
          const inner = (
            <>
              <span
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-bold ${
                  n.done
                    ? 'bg-emerald-500 text-white'
                    : 'bg-white text-slate-400 ring-1 ring-inset ring-slate-200'
                }`}
                aria-hidden
              >
                {n.done ? <IconCheck width={14} height={14} /> : i + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-[12.5px] font-semibold leading-tight">{n.label}</span>
                {n.hint ? (
                  <span className="mt-0.5 block truncate text-[10.5px] leading-snug opacity-80">
                    {n.hint}
                  </span>
                ) : null}
              </span>
            </>
          );
          return (
            <div key={n.label} className="flex min-w-[150px] flex-1 items-center gap-2">
              <div className="flex-1">
                {n.href ? (
                  <Link href={n.href as never} className={`${NODE_BASE} ${n.done ? DONE : OPEN}`}>
                    {inner}
                  </Link>
                ) : (
                  <div className={`${NODE_BASE} ${n.done ? DONE : OPEN}`}>{inner}</div>
                )}
              </div>
              {i < nodes.length - 1 ? (
                <span className="hidden text-slate-300 md:inline" aria-hidden>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14M13 6l6 6-6 6" />
                  </svg>
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
