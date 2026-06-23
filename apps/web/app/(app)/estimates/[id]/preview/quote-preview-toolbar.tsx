'use client';

export function QuotePreviewToolbar({ backHref, downloadHref }: { backHref: string; downloadHref: string }) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-2 print:hidden">
      <a
        href={downloadHref}
        className="inline-flex items-center justify-center rounded-[8px] bg-[var(--color-bv-accent)] px-4 py-2 text-[13.5px] font-medium text-[var(--color-bv-accent-foreground)] shadow-sm hover:opacity-95"
      >
        Download PDF
      </a>
      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex items-center justify-center rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-4 py-2 text-[13.5px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
      >
        Print
      </button>
      <a
        href="#customer-send"
        className="inline-flex items-center justify-center rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-4 py-2 text-[13.5px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
      >
        Jump to send
      </a>
      <a
        href={backHref}
        className="inline-flex items-center justify-center rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-4 py-2 text-[13.5px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
      >
        Back to editor
      </a>
    </div>
  );
}
