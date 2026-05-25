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
      className="group rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] shadow-[var(--shadow-bv-card)]"
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-4 py-3 marker:content-none [&::-webkit-details-marker]:hidden">
        <span className="text-[13px] font-semibold text-[var(--color-bv-text)]">{title}</span>
        <span className="text-[12px] text-[var(--color-bv-muted)] group-open:hidden">{summary}</span>
        <span className="hidden text-[12px] text-[var(--color-bv-muted)] group-open:inline">
          Click to collapse
        </span>
      </summary>
      <div className="flex flex-col gap-4 border-t border-[var(--color-bv-border)] px-4 pb-4 pt-3">
        {children}
      </div>
    </details>
  );
}
