'use client';

import { useActionState, useState } from 'react';
import { CustomerPicker, NEW_CUSTOMER, type CustomerOption } from '@/components/app/customer-picker';
import { startBidEstimateAction, type StartBidEstimateState } from './actions';

const INITIAL: StartBidEstimateState = { error: null };

export function StartBidForm({ clients, defaultClientId, defaultClientName, users, currentUserId }: { clients: CustomerOption[]; defaultClientId: string | null; defaultClientName: string | null; users: Array<{ id: string; name: string }>; currentUserId: string }) {
  const [state, action, pending] = useActionState(startBidEstimateAction, INITIAL);
  const [clientId, setClientId] = useState(defaultClientId ?? '');
  const inputCls = 'w-full rounded-[10px] border border-[var(--color-bv-border)] bg-white px-3 py-2.5 text-[13.5px] text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)] focus:ring-2 focus:ring-[var(--color-bv-accent)]/20';
  const labelCls = 'mb-1.5 block text-[12px] font-bold text-[var(--color-bv-text)]';

  return (
    <form action={action} className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-6 shadow-[var(--shadow-bv-card)]">
      <input type="hidden" name="clientId" value={clientId === NEW_CUSTOMER ? '' : clientId} />
      <div className="grid gap-5 md:grid-cols-2">
        <div className="md:col-span-2">
          <label className={labelCls} htmlFor="start-customer">Customer / company <span className="text-[var(--color-bv-accent)]">*</span></label>
          <div id="start-customer">
            <CustomerPicker value={clientId} onChange={setClientId} initialClients={clients} initialSelectedName={defaultClientName} />
          </div>
          <p className="mt-1.5 text-[11.5px] text-[var(--color-bv-muted)]">Search the existing customer list. Choose &ldquo;+ New customer&rdquo; only when the company is not on file — the same name reuses the existing record.</p>
        </div>
        {clientId === NEW_CUSTOMER ? (
          <div className="md:col-span-2">
            <label className={labelCls} htmlFor="newClientName">New customer name <span className="text-[var(--color-bv-accent)]">*</span></label>
            <input id="newClientName" name="newClientName" className={inputCls} placeholder="Company or customer" />
          </div>
        ) : null}
        <div>
          <label className={labelCls} htmlFor="projectName">Project name <span className="text-[var(--color-bv-accent)]">*</span></label>
          <input id="projectName" name="projectName" className={inputCls} placeholder="e.g. Azura Phase 1" required maxLength={200} />
        </div>
        <div>
          <label className={labelCls} htmlFor="salesRepId">Bid estimator / sales rep</label>
          <select id="salesRepId" name="salesRepId" className={inputCls} defaultValue={currentUserId}>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}{u.id === currentUserId ? ' (you)' : ''}</option>
            ))}
          </select>
        </div>
      </div>
      {state.error ? <p className="mt-4 rounded-[8px] bg-rose-50 px-3 py-2 text-[12.5px] font-semibold text-rose-700">{state.error}</p> : null}
      <div className="mt-6 flex items-center justify-between gap-3">
        <p className="text-[11.5px] text-[var(--color-bv-muted)]">Address, contact, PO number and dates are entered on Step 1 — none of them block preliminary pricing.</p>
        <button type="submit" disabled={pending || !clientId} className="inline-flex items-center justify-center rounded-[10px] bg-[var(--color-bv-text)] px-5 py-2.5 text-[13px] font-bold text-white shadow-sm hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-60">
          {pending ? 'Starting…' : 'Start bid estimate →'}
        </button>
      </div>
    </form>
  );
}
