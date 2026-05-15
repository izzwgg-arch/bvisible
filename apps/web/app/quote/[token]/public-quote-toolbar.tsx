'use client';

export function PublicQuoteToolbar() {
  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex items-center justify-center rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3.5 py-2 text-[13px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
      >
        Print / Save PDF
      </button>
    </div>
  );
}
