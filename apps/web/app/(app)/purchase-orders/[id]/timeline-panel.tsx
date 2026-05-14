'use client';

import { startTransition, useState } from 'react';
import { useRouter } from 'next/navigation';
import { POEventKind } from '@bvisible/db';
import { addPoNoteAction } from './actions';

interface TimelineEvent {
  id: string;
  kind: POEventKind;
  message: string;
  createdAt: string;
  actorLabel: string | null;
}

const KIND_ICON: Record<POEventKind, string> = {
  CREATED: '＋',
  CREATED_FROM_ESTIMATE: '⇆',
  LINES_SAVED: '✎',
  STATUS_CHANGED: '⚑',
  QBO_NUMBER_ASSIGNED: '#',
  VENDOR_ASSIGNED: '◉',
  ATTACHMENT_ADDED: '📎',
  ATTACHMENT_DELETED: '−',
  NOTE_ADDED: '✦',
  CANCELED: '⊘',
  VENDOR_REPLY: '✉',
  VENDOR_LOWER_PRICE: '↓',
};

interface TimelinePanelProps {
  purchaseOrderId: string;
  events: ReadonlyArray<TimelineEvent>;
}

export function PoTimelinePanel({ purchaseOrderId, events }: TimelinePanelProps) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submitNote(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const trimmed = note.trim();
    if (trimmed.length === 0) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await addPoNoteAction({
        purchaseOrderId,
        note: trimmed,
      });
      if (r.error) setErr(r.error);
      else {
        setNote('');
        startTransition(() => router.refresh());
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] shadow-[var(--shadow-bv-card)]">
      <div className="flex items-center justify-between border-b border-[var(--color-bv-border)] px-5 py-3">
        <h2 className="text-[14.5px] font-semibold tracking-tight text-[var(--color-bv-text)]">
          Timeline
        </h2>
        <span className="text-[11.5px] uppercase tracking-wider text-[var(--color-bv-muted)]">
          {events.length} event{events.length === 1 ? '' : 's'}
        </span>
      </div>
      <ol className="divide-y divide-[var(--color-bv-border)]">
        {events.map((e) => (
          <li key={e.id} className="flex items-start gap-3 px-5 py-3">
            <span
              aria-hidden
              className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] text-[12px] text-[var(--color-bv-muted)]"
            >
              {KIND_ICON[e.kind] ?? '•'}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] text-[var(--color-bv-text)] break-words">{e.message}</p>
              <p className="mt-0.5 text-[11px] text-[var(--color-bv-muted)] tabular-nums">
                {new Date(e.createdAt).toLocaleString()}
                {e.actorLabel ? ` · ${e.actorLabel}` : ''}
              </p>
            </div>
          </li>
        ))}
        {events.length === 0 ? (
          <li className="px-5 py-8 text-center text-[12.5px] text-[var(--color-bv-muted)]">
            No events yet.
          </li>
        ) : null}
      </ol>
      <form
        onSubmit={submitNote}
        className="flex items-end gap-2 border-t border-[var(--color-bv-border)] px-5 py-3"
      >
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-[11.5px] uppercase tracking-wider text-[var(--color-bv-muted)]">
            Add a note
          </span>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.currentTarget.value)}
            placeholder="e.g. Called vendor, lead time 2 weeks"
            maxLength={500}
            className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-1.5 text-[13px] text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)] focus:bg-[var(--color-bv-surface)]"
          />
        </label>
        <button
          type="submit"
          disabled={busy || note.trim().length === 0}
          className="inline-flex items-center justify-center rounded-[6px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? 'Adding…' : 'Add'}
        </button>
      </form>
      {err ? (
        <p className="px-5 pb-3 text-[11.5px] text-rose-700">{err}</p>
      ) : null}
    </section>
  );
}
