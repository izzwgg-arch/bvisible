'use client';

import { startTransition, useMemo, useState } from 'react';
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
  OPERATOR_VENDOR_ACKNOWLEDGED: '✓',
  OPERATOR_BLOCKED: '⊘',
  OPERATOR_BLOCKED_CLEARED: '○',
  OPERATOR_RECEIVED_COMPLETE: '▣',
  VENDOR_PO_SENT: '→',
  VENDOR_PO_SEND_FAILED: '!',
  RECEIVING: '▤',
};

const VENDOR_KINDS = new Set<POEventKind>([
  POEventKind.VENDOR_REPLY,
  POEventKind.VENDOR_LOWER_PRICE,
  POEventKind.VENDOR_ASSIGNED,
]);

type DisplayRow =
  | { type: 'event'; event: TimelineEvent }
  | { type: 'collapsed'; kind: POEventKind; count: number; latest: TimelineEvent };

function dayKey(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function compressEvents(events: ReadonlyArray<TimelineEvent>): DisplayRow[] {
  const out: DisplayRow[] = [];
  let lineSaveRun = 0;
  let lineSaveLatest: TimelineEvent | null = null;

  function flushLineSaves() {
    if (lineSaveRun === 0 || !lineSaveLatest) return;
    if (lineSaveRun === 1) {
      out.push({ type: 'event', event: lineSaveLatest });
    } else {
      out.push({
        type: 'collapsed',
        kind: POEventKind.LINES_SAVED,
        count: lineSaveRun,
        latest: lineSaveLatest,
      });
    }
    lineSaveRun = 0;
    lineSaveLatest = null;
  }

  for (const e of events) {
    if (e.kind === POEventKind.LINES_SAVED) {
      lineSaveRun += 1;
      lineSaveLatest = e;
      continue;
    }
    flushLineSaves();
    out.push({ type: 'event', event: e });
  }
  flushLineSaves();
  return out;
}

function groupByDay(rows: DisplayRow[]): { day: string; rows: DisplayRow[] }[] {
  const groups: { day: string; rows: DisplayRow[] }[] = [];
  let currentDay: string | null = null;

  for (const row of rows) {
    const iso = row.type === 'event' ? row.event.createdAt : row.latest.createdAt;
    const day = dayKey(iso);
    if (day !== currentDay) {
      groups.push({ day, rows: [] });
      currentDay = day;
    }
    groups[groups.length - 1]!.rows.push(row);
  }
  return groups;
}

interface TimelinePanelProps {
  purchaseOrderId: string;
  events: ReadonlyArray<TimelineEvent>;
}

export function PoTimelinePanel({ purchaseOrderId, events }: TimelinePanelProps) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const displayRows = useMemo(() => compressEvents(events), [events]);
  const dayGroups = useMemo(() => groupByDay(displayRows), [displayRows]);
  const visibleGroups = expanded ? dayGroups : dayGroups.slice(0, 3);

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
      <div className="flex items-center justify-between border-b border-[var(--color-bv-border)] px-4 py-2.5">
        <h2 className="text-[13.5px] font-semibold tracking-tight text-[var(--color-bv-text)]">
          Timeline
        </h2>
        <span className="text-[11px] text-[var(--color-bv-muted)]">
          {events.length} event{events.length === 1 ? '' : 's'}
        </span>
      </div>
      {dayGroups.length === 0 ? (
        <p className="px-4 py-6 text-center text-[12.5px] text-[var(--color-bv-muted)]">
          No events yet.
        </p>
      ) : (
        <div className="divide-y divide-[var(--color-bv-border)]">
          {visibleGroups.map((g) => (
            <div key={g.day}>
              <p className="sticky top-0 z-[1] bg-[var(--color-bv-surface)] px-4 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-bv-muted)]">
                {g.day}
              </p>
              <ol>
                {g.rows.map((row) => (
                  <TimelineRow key={rowKey(row)} row={row} />
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
      {dayGroups.length > 3 && !expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="w-full border-t border-[var(--color-bv-border)] px-4 py-2 text-[12px] font-medium text-[var(--color-bv-accent)] hover:bg-[var(--color-bv-bg)]"
        >
          Show {dayGroups.length - 3} older day{dayGroups.length - 3 === 1 ? '' : 's'}
        </button>
      ) : null}
      <form
        onSubmit={submitNote}
        className="flex items-end gap-2 border-t border-[var(--color-bv-border)] px-4 py-2.5"
      >
        <label className="flex flex-1 flex-col gap-0.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-bv-muted)]">
            Note
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
          className="inline-flex items-center justify-center rounded-[6px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? '…' : 'Add'}
        </button>
      </form>
      {err ? <p className="px-4 pb-2 text-[11.5px] text-rose-700">{err}</p> : null}
    </section>
  );
}

function rowKey(row: DisplayRow): string {
  if (row.type === 'event') return row.event.id;
  return `collapsed-${row.kind}-${row.latest.id}`;
}

function TimelineRow({ row }: { row: DisplayRow }) {
  if (row.type === 'collapsed') {
    return (
      <li className="flex items-start gap-2 px-4 py-2 text-[12.5px] text-[var(--color-bv-muted)]">
        <span
          aria-hidden
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] text-[10px]"
        >
          {KIND_ICON[row.kind]}
        </span>
        <span>
          Lines saved <strong className="font-semibold text-[var(--color-bv-text)]">{row.count}×</strong>
          <span className="ml-1 tabular-nums">
            · last {new Date(row.latest.createdAt).toLocaleTimeString(undefined, { timeStyle: 'short' })}
          </span>
        </span>
      </li>
    );
  }

  const e = row.event;
  const vendorHighlight = VENDOR_KINDS.has(e.kind);

  return (
    <li
      className={`flex items-start gap-2 px-4 py-2 ${
        vendorHighlight ? 'bg-sky-50/50' : ''
      }`}
    >
      <span
        aria-hidden
        className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] ${
          vendorHighlight
            ? 'border-sky-300 bg-sky-100 text-sky-900'
            : 'border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] text-[var(--color-bv-muted)]'
        }`}
      >
        {KIND_ICON[e.kind] ?? '•'}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] leading-snug text-[var(--color-bv-text)] break-words">{e.message}</p>
        <p className="mt-0.5 text-[10.5px] text-[var(--color-bv-muted)] tabular-nums">
          {new Date(e.createdAt).toLocaleTimeString(undefined, { timeStyle: 'short' })}
          {e.actorLabel ? ` · ${e.actorLabel}` : ''}
        </p>
      </div>
    </li>
  );
}
