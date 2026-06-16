import Link from 'next/link';
import type { EstimateFinalizeChecklist } from '@/lib/estimate/estimate-finalize-checklist';
import { IconCheck } from '@/components/estimate/estimate-surface';

export function EstimateFinalizeChecklistPanel({
  checklist,
}: {
  checklist: EstimateFinalizeChecklist;
}) {
  if (checklist.items.length === 0) return null;

  const pending = checklist.items.filter((item) => !item.done);

  return (
    <div className="mt-4 rounded-[14px] border border-slate-200 bg-white px-4 py-3.5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-slate-400">
          Closeout checklist
        </h3>
        {checklist.readyToFinalize ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
            Ready to finalize
          </span>
        ) : pending.length > 0 ? (
          <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[10.5px] font-semibold tabular-nums text-amber-700 ring-1 ring-inset ring-amber-200">
            {pending.length} remaining
          </span>
        ) : null}
      </div>
      <ul className="mt-2.5 flex flex-col gap-1">
        {checklist.items.map((item) => (
          <li
            key={item.key}
            className="flex items-center gap-2.5 rounded-[8px] px-1.5 py-1 text-[12px]"
          >
            <span
              className={`grid h-4 w-4 shrink-0 place-items-center rounded-full text-[9px] font-bold ${
                item.done
                  ? 'bg-emerald-500 text-white'
                  : 'bg-slate-100 text-slate-300 ring-1 ring-inset ring-slate-200'
              }`}
              aria-hidden
            >
              {item.done ? <IconCheck width={11} height={11} /> : ''}
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
        <span className={`font-medium ${item.done ? 'text-slate-500' : 'text-slate-800'}`}>
          {item.label}
        </span>
        {item.key === 'invoice' && !item.done ? (
          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-slate-400">
            Optional
          </span>
        ) : null}
        {item.href && !item.done ? (
          <Link
            href={item.href as never}
            className="text-[11px] font-semibold text-blue-600 hover:underline"
          >
            Fix →
          </Link>
        ) : null}
      </div>
      {item.detail ? (
        <p className="text-[11px] leading-snug text-slate-400">{item.detail}</p>
      ) : null}
    </div>
  );
}
