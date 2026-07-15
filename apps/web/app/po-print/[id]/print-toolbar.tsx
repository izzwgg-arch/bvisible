'use client';

// Small on-screen-only toolbar for the PO print document.
export function PrintToolbar() {
  return (
    <div className="mb-6 flex items-center justify-between rounded-lg bg-neutral-100 px-4 py-2.5 print:hidden">
      <span className="text-[12px] text-neutral-500">
        Use Print → “Save as PDF” to download this purchase order.
      </span>
      <button
        type="button"
        onClick={() => window.print()}
        className="rounded-md bg-[#16181d] px-4 py-1.5 text-[12.5px] font-semibold text-white"
      >
        Print / Save PDF
      </button>
    </div>
  );
}
