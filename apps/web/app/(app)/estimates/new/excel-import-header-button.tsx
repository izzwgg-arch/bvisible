'use client';

// Header trigger for the Excel import. The page header is a server
// component and the import panel's state lives inside the guided
// builder, so this button signals the builder through a DOM event
// rather than shared React state.

export const OPEN_EXCEL_IMPORT_EVENT = 'bv:open-excel-import';

export function ExcelImportHeaderButton() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent(OPEN_EXCEL_IMPORT_EVENT))}
      className="inline-flex items-center justify-center rounded-[8px] bg-[var(--color-bv-accent)] px-3.5 py-2 text-[13.5px] font-semibold text-white hover:opacity-95"
    >
      ⇪ Import from Excel
    </button>
  );
}
