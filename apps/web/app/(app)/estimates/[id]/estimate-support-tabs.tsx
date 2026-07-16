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
    <section className="overflow-hidden rounded-[22px] border border-white/80 bg-white/95 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_18px_46px_-24px_rgba(15,23,42,0.26)] ring-1 ring-slate-900/[0.03]">
      <div className="grid grid-cols-2 gap-1.5 overflow-visible border-b border-slate-100 bg-white px-3 py-2.5 2xl:grid-cols-3">
        {TAB_COPY.map((tab) => {
          const selected = active === tab.id;
          const count = countFor(tab.id);
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActive(tab.id)}
              className={`inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[12px] px-2 py-2 text-center text-[12px] font-bold leading-tight transition ${
                selected
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
              }`}
            >
              {tab.label}
              {count != null && count > 0 ? (
                <span className={`rounded-full px-1.5 py-0.5 text-[10px] ring-1 ring-inset ${
                  selected
                    ? 'bg-white/20 text-white ring-white/30'
                    : 'bg-white text-slate-500 ring-slate-200'
                }`}>
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="bg-slate-50/55 p-4">{content[active]}</div>
    </section>
  );
}
