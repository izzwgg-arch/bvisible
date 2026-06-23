'use client';

import { type ReactNode, useRef, useState } from 'react';

export function BulkDeleteForm({
  action,
  itemLabel,
  children,
  className,
}: {
  action: (formData: FormData) => Promise<void>;
  itemLabel: string;
  children: ReactNode;
  className?: string;
}) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const [selectedCount, setSelectedCount] = useState(0);
  const [allSelected, setAllSelected] = useState(false);

  function checkboxInputs(): HTMLInputElement[] {
    return Array.from(formRef.current?.querySelectorAll<HTMLInputElement>('input[name="ids"]') ?? []);
  }

  function syncSelection() {
    const boxes = checkboxInputs();
    const checked = boxes.filter((box) => box.checked).length;
    setSelectedCount(checked);
    setAllSelected(boxes.length > 0 && checked === boxes.length);
  }

  function toggleAll(checked: boolean) {
    for (const box of checkboxInputs()) {
      box.checked = checked;
    }
    syncSelection();
  }

  function confirmDelete(event: React.FormEvent<HTMLFormElement>) {
    if (selectedCount === 0) {
      event.preventDefault();
      return;
    }
    if (!window.confirm(`Delete ${selectedCount} selected ${itemLabel}?`)) {
      event.preventDefault();
    }
  }

  return (
    <form ref={formRef} action={action} onChange={syncSelection} onSubmit={confirmDelete} className={className}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-slate-100 bg-white/80 px-4 py-3 shadow-sm">
        <label className="inline-flex items-center gap-2 text-[12.5px] font-semibold text-slate-600">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={(event) => toggleAll(event.currentTarget.checked)}
            className="h-4 w-4 rounded border-slate-300 text-[var(--color-bv-accent)] focus:ring-[var(--color-bv-accent)]"
          />
          Select all
        </label>
        <button
          type="submit"
          disabled={selectedCount === 0}
          className="inline-flex items-center justify-center rounded-[12px] border border-rose-200 bg-rose-50 px-4 py-2 text-[12.5px] font-bold text-rose-700 shadow-sm transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {selectedCount > 0 ? `Delete ${selectedCount} selected` : 'Delete selected'}
        </button>
      </div>
      {children}
    </form>
  );
}
