'use client';

import type { ReactNode } from 'react';

export function EstimateCollapsibleSection({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      className="group overflow-hidden rounded-[26px] border border-white/80 bg-white/90 shadow-[0_22px_64px_-38px_rgba(15,23,42,0.36)] backdrop-blur-xl"
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 bg-white px-6 py-5 marker:content-none [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-3 text-[15px] font-bold tracking-tight text-slate-950">
          <span
            aria-hidden
            className="grid h-8 w-8 place-items-center rounded-[10px] bg-blue-50 text-blue-600 ring-1 ring-inset ring-blue-100 transition-transform group-open:rotate-90"
          >
            ›
          </span>
          {title}
        </span>
        <span className="text-[12.5px] font-medium text-slate-500 group-open:hidden">{summary}</span>
        <span className="hidden rounded-full bg-white px-2.5 py-1 text-[11.5px] font-semibold text-slate-400 ring-1 ring-inset ring-slate-200 group-open:inline">
          Click to collapse
        </span>
      </summary>
      <div className="border-t border-slate-100 bg-slate-50/70 px-5 pb-5 pt-5 md:px-6 md:pb-6">
        {children}
      </div>
    </details>
  );
}
