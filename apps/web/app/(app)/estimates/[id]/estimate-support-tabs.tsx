'use client';

import { useState, type ReactNode } from 'react';

type SupportTab = 'workflow' | 'files' | 'activity' | 'purchase-orders' | 'reconciliation' | 'notes';

const TAB_COPY: ReadonlyArray<{ id: SupportTab; label: string }> = [
  { id: 'workflow', label: 'Workflow' },
  { id: 'files', label: 'Files' },
  { id: 'activity', label: 'Activity' },
  { id: 'purchase-orders', label: 'Purchase Orders' },
  { id: 'reconciliation', label: 'Reconciliation' },
  { id: 'notes', label: 'Notes' },
];

export function EstimateSupportTabs({
  workflow,
  files,
  activity,
  purchaseOrders,
  reconciliation,
  notes,
  purchaseOrderCount,
  activityCount,
  reconciliationCount,
}: {
  workflow: ReactNode;
  files: ReactNode;
  activity: ReactNode;
  purchaseOrders: ReactNode;
  reconciliation: ReactNode;
  notes: ReactNode;
  purchaseOrderCount: number;
  activityCount: number;
  reconciliationCount: number;
}) {
  const [active, setActive] = useState<SupportTab>('workflow');

  const content: Record<SupportTab, ReactNode> = {
    workflow,
    files,
    activity,
    'purchase-orders': purchaseOrders,
    reconciliation,
    notes,
  };

  function countFor(id: SupportTab): number | null {
    if (id === 'activity') return activityCount;
    if (id === 'purchase-orders') return purchaseOrderCount;
    if (id === 'reconciliation') return reconciliationCount;
    return null;
  }

  return (
    <section className="overflow-hidden rounded-[18px] border border-slate-200/70 bg-white/95 shadow-[0_1px_2px_rgba(15,23,41,0.04),0_14px_36px_-18px_rgba(15,23,41,0.18)]">
      <div className="flex gap-1 overflow-x-auto border-b border-slate-100 bg-white px-3 py-2">
        {TAB_COPY.map((tab) => {
          const selected = active === tab.id;
          const count = countFor(tab.id);
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActive(tab.id)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-[10px] px-3 py-2 text-[12px] font-bold transition ${
                selected
                  ? 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200'
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
              }`}
            >
              {tab.label}
              {count != null && count > 0 ? (
                <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] text-slate-500 ring-1 ring-inset ring-slate-200">
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="bg-slate-50/45 p-4">{content[active]}</div>
    </section>
  );
}
