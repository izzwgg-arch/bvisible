'use client';

import Link from 'next/link';
import { startTransition, useState } from 'react';
import { useRouter } from 'next/navigation';
import { POStatus } from '@bvisible/db';
import { formatMoney } from '@/lib/estimate/format';
import { setPoQboNumberAction, setPoVendorAction, type SavePoState } from './actions';
import type { PoEditorBootstrap } from './editor';

const STATUS_OPTIONS: ReadonlyArray<POStatus> = [
  POStatus.DRAFT,
  POStatus.SENT,
  POStatus.ORDERED,
  POStatus.PARTIALLY_RECEIVED,
  POStatus.RECEIVED,
  POStatus.CANCELED,
];

const STATUS_TONE: Record<POStatus, string> = {
  DRAFT: 'border-slate-200 bg-slate-50 text-slate-700',
  SENT: 'border-blue-200 bg-blue-50 text-blue-700',
  ORDERED: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  PARTIALLY_RECEIVED: 'border-amber-200 bg-amber-50 text-amber-800',
  RECEIVED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  CANCELED: 'border-rose-200 bg-rose-50 text-rose-700',
};

interface MetaPanelProps {
  bootstrap: PoEditorBootstrap;
  subtotalCents: number;
  dirty: boolean;
  saving: boolean;
  statusBusy: boolean;
  deleting: boolean;
  saveState: SavePoState;
  onSave: () => void;
  onStatusChange: (next: POStatus) => void;
  onDelete: (() => void) | null;
}

export function PoMetaPanel(props: MetaPanelProps) {
  const {
    bootstrap,
    subtotalCents,
    dirty,
    saving,
    statusBusy,
    deleting,
    saveState,
    onSave,
    onStatusChange,
    onDelete,
  } = props;
  const router = useRouter();
  const po = bootstrap.po;

  const [qboInput, setQboInput] = useState(po.qboPoNumber ?? '');
  const [qboBusy, setQboBusy] = useState(false);
  const [qboMsg, setQboMsg] = useState<string | null>(null);

  const [vendorBusy, setVendorBusy] = useState(false);
  const [vendorMsg, setVendorMsg] = useState<string | null>(null);

  async function commitQbo() {
    if (qboBusy) return;
    setQboBusy(true);
    setQboMsg(null);
    try {
      const trimmed = qboInput.trim();
      if (trimmed === (po.qboPoNumber ?? '')) {
        setQboBusy(false);
        return;
      }
      const r = await setPoQboNumberAction({
        purchaseOrderId: po.id,
        qboPoNumber: trimmed.length > 0 ? trimmed : null,
      });
      if (r.error) setQboMsg(r.error);
      else startTransition(() => router.refresh());
    } finally {
      setQboBusy(false);
    }
  }

  async function commitVendor(vendorId: string) {
    if (vendorBusy) return;
    setVendorBusy(true);
    setVendorMsg(null);
    try {
      const r = await setPoVendorAction({
        purchaseOrderId: po.id,
        vendorId: vendorId.length > 0 ? vendorId : null,
      });
      if (r.error) setVendorMsg(r.error);
      else startTransition(() => router.refresh());
    } finally {
      setVendorBusy(false);
    }
  }

  return (
    <aside className="sticky top-6 flex flex-col gap-4">
      <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-5 shadow-[var(--shadow-bv-card)]">
        <h2 className="text-[14.5px] font-semibold tracking-tight text-[var(--color-bv-text)]">
          Subtotal
        </h2>
        <div className="mt-1 text-[22px] font-semibold tabular-nums text-[var(--color-bv-text)]">
          {formatMoney(subtotalCents)}
        </div>
        <p className="mt-1 text-[11.5px] text-[var(--color-bv-muted)]">
          Sum of line costs. PO is cost-side only — no markup applied here.
        </p>

        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            onClick={onSave}
            disabled={saving || !dirty}
            className="inline-flex items-center justify-center rounded-[8px] bg-[var(--color-bv-accent)] px-3.5 py-2 text-[13.5px] font-medium text-[var(--color-bv-accent-foreground)] shadow-sm transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? 'Saving…' : dirty ? 'Save changes (⌘S)' : 'Saved'}
          </button>
          {saveState.error ? (
            <p className="text-[12px] text-rose-700">{saveState.error}</p>
          ) : saveState.savedAt ? (
            <p className="text-[12px] text-emerald-700">
              Saved · subtotal {formatMoney(saveState.subtotalCents ?? 0)}
            </p>
          ) : null}
        </div>
      </section>

      <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-5 shadow-[var(--shadow-bv-card)]">
        <h3 className="text-[13.5px] font-semibold text-[var(--color-bv-text)]">QuickBooks PO #</h3>
        <p className="mt-1 text-[11.5px] text-[var(--color-bv-muted)]">
          Enter the number QuickBooks gave this PO. Required before the linked
          estimate can be finalized (R-EST-04).
        </p>
        <div className="mt-2 flex items-center gap-2">
          <input
            type="text"
            value={qboInput}
            onChange={(e) => setQboInput(e.currentTarget.value)}
            onBlur={commitQbo}
            placeholder="e.g. 1024"
            maxLength={40}
            autoComplete="off"
            spellCheck={false}
            className="flex-1 rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-1.5 font-mono text-[13px] text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)] focus:bg-[var(--color-bv-surface)]"
          />
          {qboBusy ? (
            <span className="text-[11.5px] text-[var(--color-bv-muted)]">Saving…</span>
          ) : null}
        </div>
        {qboMsg ? (
          <p className="mt-1 text-[11.5px] text-rose-700">{qboMsg}</p>
        ) : null}
      </section>

      <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-5 shadow-[var(--shadow-bv-card)]">
        <h3 className="text-[13.5px] font-semibold text-[var(--color-bv-text)]">Vendor</h3>
        <select
          value={po.vendor?.id ?? ''}
          onChange={(e) => commitVendor(e.currentTarget.value)}
          disabled={vendorBusy}
          className="mt-2 w-full rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[13px] text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)] focus:bg-[var(--color-bv-surface)]"
        >
          <option value="">— no vendor —</option>
          {bootstrap.vendors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        {vendorMsg ? (
          <p className="mt-1 text-[11.5px] text-rose-700">{vendorMsg}</p>
        ) : null}
        <p className="mt-2 text-[11.5px] text-[var(--color-bv-muted)]">
          <Link href="/vendors/new" className="text-[var(--color-bv-accent)] underline">
            Add a new vendor
          </Link>
        </p>
      </section>

      {po.estimate ? (
        <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-5 shadow-[var(--shadow-bv-card)]">
          <h3 className="text-[13.5px] font-semibold text-[var(--color-bv-text)]">
            Linked estimate
          </h3>
          <p className="mt-1 text-[12.5px] text-[var(--color-bv-muted)]">
            <Link
              href={`/estimates/${po.estimate.id}` as never}
              className="font-mono text-[13px] text-[var(--color-bv-accent)] hover:underline"
            >
              {po.estimate.number}
            </Link>{' '}
            · {po.estimate.title}
          </p>
        </section>
      ) : null}

      <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-5 shadow-[var(--shadow-bv-card)]">
        <h3 className="text-[13.5px] font-semibold text-[var(--color-bv-text)]">Status</h3>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {STATUS_OPTIONS.map((s) => {
            const active = po.status === s;
            return (
              <button
                key={s}
                type="button"
                disabled={statusBusy || active}
                onClick={() => onStatusChange(s)}
                className={`inline-flex items-center justify-center rounded-[6px] border px-2 py-1.5 text-[11.5px] font-medium leading-tight ${
                  active
                    ? STATUS_TONE[s]
                    : 'border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] text-[var(--color-bv-muted)] hover:bg-[var(--color-bv-surface)]'
                } disabled:cursor-not-allowed`}
              >
                {s.replace('_', ' ')}
              </button>
            );
          })}
        </div>
      </section>

      {onDelete ? (
        <section className="rounded-[var(--radius-bv)] border border-rose-100 bg-rose-50/40 p-4">
          <h3 className="text-[13px] font-semibold text-rose-800">Danger zone</h3>
          <p className="mt-1 text-[11.5px] text-rose-700">
            Soft-deletes this PO. It disappears from the list. Audit log retains the row.
          </p>
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            className="mt-2 inline-flex items-center justify-center rounded-[6px] border border-rose-200 bg-white px-2.5 py-1.5 text-[12px] font-medium text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {deleting ? 'Deleting…' : 'Delete PO'}
          </button>
        </section>
      ) : null}
    </aside>
  );
}
