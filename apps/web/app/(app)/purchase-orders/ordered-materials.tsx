'use client';

// Ordered Materials — the shop-facing receiving checklist. One card per
// purchase order; big checkboxes mark materials arrived, a detail area
// handles partial deliveries and corrections, and every save is
// confirmed by the server before the UI shows it as done. Open to every
// authenticated user; drafts are visible but not receivable.

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { POStatus } from '@bvisible/db';
import {
  getReceivingHistoryAction,
  markAllArrivedAction,
  setLineReceivedAction,
  undoReceivingAction,
  type ReceivingActionResult,
  type ReceivingHistoryEntry,
  type ReceivingLineSnapshot,
} from './receiving-actions';

export interface PoLineData {
  id: string;
  description: string;
  qtyMilli: number;
  receivedQtyMilli: number;
  unit: string;
}

export interface PoCardData {
  id: string;
  number: string;
  status: POStatus;
  createdAtIso: string;
  sentAtIso: string | null;
  vendorName: string;
  createdByName: string;
  lines: PoLineData[];
}

const STORAGE_KEY = 'bv-ordered-materials-ui';

/* ------------------------------ small helpers ------------------------------ */

function formatQty(milli: number): string {
  return String(Number((milli / 1000).toFixed(3)));
}

function unitWord(unit: string): string {
  switch (unit) {
    case 'SHEET':
      return 'sheets';
    case 'ROLL':
      return 'rolls';
    case 'SQ_FT':
      return 'sq ft';
    case 'LINEAR_FT':
      return 'linear ft';
    case 'HOUR':
      return 'hours';
    default:
      return '';
  }
}

/** "Lester Teitelbaum" → "Lester T." so the header stays one line. */
function shortName(value: string): string {
  if (value.includes('@')) return value.split('@')[0] ?? value;
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return value;
  return `${parts[0]} ${parts[parts.length - 1]?.[0] ?? ''}.`;
}

function formatShortDate(iso: string): string {
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(iso));
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

function isLineReceived(l: PoLineData): boolean {
  return l.qtyMilli > 0 ? l.receivedQtyMilli >= l.qtyMilli : l.receivedQtyMilli > 0;
}

function isWaitingStatus(s: POStatus): boolean {
  return s === POStatus.SENT || s === POStatus.ORDERED || s === POStatus.PARTIALLY_RECEIVED;
}

interface UiPrefs {
  tab: 'waiting' | 'arrived';
  q: string;
  /// Explicit user expand/collapse choices, by PO id.
  expanded: Record<string, boolean>;
  scrollY: number;
}

function loadPrefs(): UiPrefs | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as UiPrefs;
  } catch {
    return null;
  }
}

/* ------------------------------ component ------------------------------ */

export function OrderedMaterials({ pos }: { pos: PoCardData[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<'waiting' | 'arrived'>('waiting');
  const [q, setQ] = useState('');
  const [expandedOverrides, setExpandedOverrides] = useState<Record<string, boolean>>({});
  const [data, setData] = useState<PoCardData[]>(pos);
  const [openLine, setOpenLine] = useState<string | null>(null);
  const [openMenuFor, setOpenMenuFor] = useState<string | null>(null);
  const [pendingLines, setPendingLines] = useState<Set<string>>(new Set());
  const [pendingPos, setPendingPos] = useState<Set<string>>(new Set());
  const [flashLines, setFlashLines] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{
    kind: 'undo' | 'error';
    message: string;
    undo?: { poId: string; restore: ReceivingLineSnapshot[] };
  } | null>(null);
  const [history, setHistory] = useState<Record<string, ReceivingHistoryEntry[] | 'loading'>>({});
  const [, startTransition] = useTransition();
  const restored = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fresh server data wins whenever it arrives (revalidation after our
  // own saves, or another user's changes surfacing via refresh).
  useEffect(() => setData(pos), [pos]);

  // Restore tab / search / expansion / scroll when coming back from a PO.
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    const prefs = loadPrefs();
    if (prefs) {
      setTab(prefs.tab);
      setQ(prefs.q);
      setExpandedOverrides(prefs.expanded);
      if (prefs.scrollY > 0) {
        requestAnimationFrame(() => window.scrollTo(0, prefs.scrollY));
      }
    }
  }, []);

  // Persist the UI state (including scroll) so returning restores it.
  useEffect(() => {
    if (!restored.current) return;
    const save = () => {
      try {
        const prefs: UiPrefs = { tab, q, expanded: expandedOverrides, scrollY: window.scrollY };
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
      } catch {
        // Session storage unavailable — state just won't persist.
      }
    };
    save();
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(save);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, [tab, q, expandedOverrides]);

  // Other employees' receiving shows up without a manual reload: refresh
  // the server data whenever the tab regains focus.
  useEffect(() => {
    const onFocus = () => router.refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [router]);

  function showToast(next: NonNullable<typeof toast>, ms = 8000) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(next);
    toastTimer.current = setTimeout(() => setToast(null), ms);
  }

  function flash(lineIds: string[]) {
    setFlashLines((prev) => new Set([...prev, ...lineIds]));
    setTimeout(() => {
      setFlashLines((prev) => {
        const next = new Set(prev);
        for (const id of lineIds) next.delete(id);
        return next;
      });
    }, 1600);
  }

  const applyResult = useCallback((poId: string, result: ReceivingActionResult) => {
    if (!result.lines && !result.poStatus) return;
    setData((prev) =>
      prev.map((po) => {
        if (po.id !== poId) return po;
        const receipts = new Map((result.lines ?? []).map((l) => [l.lineId, l.receivedQtyMilli]));
        return {
          ...po,
          status: result.poStatus ?? po.status,
          lines: po.lines.map((l) =>
            receipts.has(l.id) ? { ...l, receivedQtyMilli: receipts.get(l.id)! } : l
          ),
        };
      })
    );
  }, []);

  function withLinePending(lineId: string, on: boolean) {
    setPendingLines((prev) => {
      const next = new Set(prev);
      if (on) next.add(lineId);
      else next.delete(lineId);
      return next;
    });
  }

  function setLineReceived(
    po: PoCardData,
    line: PoLineData,
    nextMilli: number,
    source: 'checkbox' | 'detail'
  ) {
    if (pendingLines.has(line.id)) return;
    withLinePending(line.id, true);
    startTransition(async () => {
      try {
        const result = await setLineReceivedAction({
          poId: po.id,
          lineId: line.id,
          receivedQtyMilli: nextMilli,
          expectedReceivedQtyMilli: line.receivedQtyMilli,
          source,
        });
        if (result.error) {
          applyResult(po.id, result);
          showToast({ kind: 'error', message: result.error });
        } else {
          applyResult(po.id, result);
          flash([line.id]);
          if (result.undo) {
            const fullyReceived = nextMilli >= line.qtyMilli;
            showToast({
              kind: 'undo',
              message: fullyReceived
                ? `${line.description} marked received`
                : nextMilli === 0
                  ? `${line.description} unchecked`
                  : `${line.description} updated`,
              undo: { poId: po.id, restore: result.undo },
            });
          }
        }
      } catch {
        showToast({
          kind: 'error',
          message: 'Could not save — check your connection and try again.',
        });
      } finally {
        withLinePending(line.id, false);
      }
    });
  }

  function markAllArrived(po: PoCardData) {
    if (pendingPos.has(po.id)) return;
    setPendingPos((prev) => new Set(prev).add(po.id));
    setOpenMenuFor(null);
    startTransition(async () => {
      try {
        const result = await markAllArrivedAction({ poId: po.id });
        if (result.error) {
          applyResult(po.id, result);
          showToast({ kind: 'error', message: result.error });
        } else {
          applyResult(po.id, result);
          flash(po.lines.map((l) => l.id));
          if (result.undo && result.undo.length > 0) {
            showToast({
              kind: 'undo',
              message: `${po.number} — all materials marked arrived`,
              undo: { poId: po.id, restore: result.undo },
            });
          }
        }
      } catch {
        showToast({
          kind: 'error',
          message: 'Could not save — check your connection and try again.',
        });
      } finally {
        setPendingPos((prev) => {
          const next = new Set(prev);
          next.delete(po.id);
          return next;
        });
      }
    });
  }

  function undo(poId: string, restore: ReceivingLineSnapshot[]) {
    setToast(null);
    startTransition(async () => {
      try {
        const result = await undoReceivingAction({ poId, restore });
        if (result.error) {
          showToast({ kind: 'error', message: result.error });
        } else {
          applyResult(poId, result);
        }
      } catch {
        showToast({
          kind: 'error',
          message: 'Undo failed — check your connection and try again.',
        });
      }
    });
  }

  function loadHistory(poId: string) {
    if (history[poId]) return;
    setHistory((prev) => ({ ...prev, [poId]: 'loading' }));
    startTransition(async () => {
      try {
        const result = await getReceivingHistoryAction(poId);
        setHistory((prev) => ({ ...prev, [poId]: result.events ?? [] }));
      } catch {
        setHistory((prev) => {
          const next = { ...prev };
          delete next[poId];
          return next;
        });
      }
    });
  }

  /* ------------------------------ derived lists ------------------------------ */

  const query = q.trim().toLowerCase();

  const matches = useCallback(
    (po: PoCardData) => {
      if (!query) return true;
      if (po.number.toLowerCase().includes(query)) return true;
      if (po.vendorName.toLowerCase().includes(query)) return true;
      if (po.createdByName.toLowerCase().includes(query)) return true;
      if (shortName(po.createdByName).toLowerCase().includes(query)) return true;
      return po.lines.some((l) => l.description.toLowerCase().includes(query));
    },
    [query]
  );

  const waitingPos = useMemo(
    () => data.filter((po) => isWaitingStatus(po.status)).filter(matches),
    [data, matches]
  );
  const arrivedPos = useMemo(
    () => data.filter((po) => po.status === POStatus.RECEIVED).filter(matches),
    [data, matches]
  );
  const draftPos = useMemo(
    () => data.filter((po) => po.status === POStatus.DRAFT).filter(matches),
    [data, matches]
  );

  const waitingCount = data.filter((po) => isWaitingStatus(po.status)).length;
  const arrivedCount = data.filter((po) => po.status === POStatus.RECEIVED).length;

  function isExpanded(po: PoCardData): boolean {
    if (query) return true; // search always reveals matches
    const override = expandedOverrides[po.id];
    if (override != null) return override;
    // SENT (waiting) POs open by default; drafts and arrived stay closed.
    return isWaitingStatus(po.status);
  }

  function toggleExpanded(po: PoCardData) {
    setExpandedOverrides((prev) => ({ ...prev, [po.id]: !isExpanded(po) }));
  }

  const visiblePos = tab === 'waiting' ? waitingPos : arrivedPos;
  const showDrafts = tab === 'waiting' && draftPos.length > 0;
  const nothingMatches =
    query !== '' && visiblePos.length === 0 && (!showDrafts || draftPos.length === 0);

  /* ------------------------------ render ------------------------------ */

  return (
    <div className="pb-10">
      {/* tabs */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-full border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-1">
          {(
            [
              ['waiting', `Waiting (${waitingCount})`],
              ['arrived', `Arrived (${arrivedCount})`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`rounded-full px-4 py-1.5 text-[13px] font-bold transition-colors ${
                tab === key
                  ? 'bg-[#1C4972] text-white'
                  : 'text-[var(--color-bv-muted)] hover:text-[var(--color-bv-text)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative min-w-[240px] flex-1 md:max-w-md">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
          </span>
          <input
            className="h-10 w-full rounded-[12px] border border-[var(--color-bv-border)] bg-white pl-9 pr-3 text-[13px] text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)]"
            placeholder="Search materials or PO..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      {/* cards */}
      <div className="mt-5 space-y-4">
        {nothingMatches ? (
          <EmptyMessage>No matching materials or purchase orders.</EmptyMessage>
        ) : tab === 'waiting' && visiblePos.length === 0 && !showDrafts ? (
          <EmptyMessage>No materials are waiting to arrive.</EmptyMessage>
        ) : tab === 'arrived' && visiblePos.length === 0 ? (
          <EmptyMessage>No received orders yet.</EmptyMessage>
        ) : null}

        {visiblePos.map((po) => (
          <PoCard
            key={po.id}
            po={po}
            expanded={isExpanded(po)}
            onToggle={() => toggleExpanded(po)}
            query={query}
            openLine={openLine}
            setOpenLine={(id) => {
              setOpenLine(id);
              if (id) loadHistory(po.id);
            }}
            openMenu={openMenuFor === po.id}
            setOpenMenu={(open) => setOpenMenuFor(open ? po.id : null)}
            pendingLines={pendingLines}
            poPending={pendingPos.has(po.id)}
            flashLines={flashLines}
            history={history[po.id]}
            onCheck={(line, next) => setLineReceived(po, line, next, 'checkbox')}
            onDetailSave={(line, next) => setLineReceived(po, line, next, 'detail')}
            onMarkAll={() => markAllArrived(po)}
          />
        ))}

        {showDrafts ? (
          <div className="pt-2">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--color-bv-muted)]">
              Drafts
            </div>
            <div className="space-y-3">
              {draftPos.map((po) => (
                <PoCard
                  key={po.id}
                  po={po}
                  draft
                  expanded={isExpanded(po)}
                  onToggle={() => toggleExpanded(po)}
                  query={query}
                  openLine={null}
                  setOpenLine={() => undefined}
                  openMenu={openMenuFor === po.id}
                  setOpenMenu={(open) => setOpenMenuFor(open ? po.id : null)}
                  pendingLines={pendingLines}
                  poPending={false}
                  flashLines={flashLines}
                  history={undefined}
                  onCheck={() => undefined}
                  onDetailSave={() => undefined}
                  onMarkAll={() => undefined}
                />
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {/* toast */}
      {toast ? (
        <div className="fixed inset-x-0 bottom-5 z-50 flex justify-center px-4">
          <div
            className={`flex items-center gap-3 rounded-[14px] px-4 py-2.5 text-[13px] font-semibold text-white shadow-[0_18px_50px_rgba(15,23,42,0.35)] ${
              toast.kind === 'error' ? 'bg-rose-700' : 'bg-[#1C4972]'
            }`}
            role="status"
          >
            <span className="max-w-[70vw] truncate">{toast.message}</span>
            {toast.undo ? (
              <button
                type="button"
                className="rounded-[8px] bg-white/15 px-3 py-1 text-[12.5px] font-bold hover:bg-white/25"
                onClick={() => undo(toast.undo!.poId, toast.undo!.restore)}
              >
                Undo
              </button>
            ) : null}
            <button
              type="button"
              aria-label="Dismiss"
              className="text-white/70 hover:text-white"
              onClick={() => setToast(null)}
            >
              ✕
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------ PO card ------------------------------ */

function PoCard({
  po,
  draft = false,
  expanded,
  onToggle,
  query,
  openLine,
  setOpenLine,
  openMenu,
  setOpenMenu,
  pendingLines,
  poPending,
  flashLines,
  history,
  onCheck,
  onDetailSave,
  onMarkAll,
}: {
  po: PoCardData;
  draft?: boolean;
  expanded: boolean;
  onToggle: () => void;
  query: string;
  openLine: string | null;
  setOpenLine: (lineId: string | null) => void;
  openMenu: boolean;
  setOpenMenu: (open: boolean) => void;
  pendingLines: Set<string>;
  poPending: boolean;
  flashLines: Set<string>;
  history: ReceivingHistoryEntry[] | 'loading' | undefined;
  onCheck: (line: PoLineData, nextMilli: number) => void;
  onDetailSave: (line: PoLineData, nextMilli: number) => void;
  onMarkAll: () => void;
}) {
  const receivedCount = po.lines.filter(isLineReceived).length;
  const arrived = po.status === POStatus.RECEIVED;
  const dateIso = po.sentAtIso ?? po.createdAtIso;
  const hasIncomplete = po.lines.some((l) => !isLineReceived(l));

  return (
    <div
      className={`rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] shadow-[var(--shadow-bv-card)] ${draft ? 'opacity-70' : ''}`}
    >
      {/* header */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 sm:px-5">
        <button
          type="button"
          aria-label={expanded ? 'Collapse' : 'Expand'}
          aria-expanded={expanded}
          onClick={onToggle}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] text-slate-400 hover:bg-[var(--color-bv-bg)] hover:text-[var(--color-bv-text)]"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 20 20"
            fill="none"
            className={`transition-transform ${expanded ? 'rotate-90' : ''}`}
          >
            <path d="M7 5l6 5-6 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        <Link
          href={`/purchase-orders/${po.id}`}
          className="text-[14.5px] font-extrabold tabular-nums text-[#1C4972] underline-offset-2 hover:underline"
        >
          {po.number}
        </Link>
        <span className="text-[13px] font-semibold text-[var(--color-bv-text)]">{po.vendorName}</span>
        <span className="hidden text-slate-300 sm:inline">|</span>
        <span className="text-[12.5px] text-[var(--color-bv-muted)]">
          {shortName(po.createdByName)} • {formatShortDate(dateIso)}
        </span>

        <span className="ml-auto flex items-center gap-2">
          {draft ? (
            <>
              <span className="text-[11.5px] text-[var(--color-bv-muted)]">Not sent</span>
              <Badge tone="orange">DRAFT</Badge>
            </>
          ) : arrived ? (
            <Badge tone="green">ARRIVED</Badge>
          ) : (
            <>
              {po.lines.length > 0 ? (
                <span className="hidden text-[11.5px] text-[var(--color-bv-muted)] sm:inline">
                  {receivedCount} of {po.lines.length} received
                </span>
              ) : null}
              <Badge tone="teal">SENT</Badge>
            </>
          )}

          {/* three-dot menu */}
          <span className="relative">
            <button
              type="button"
              aria-label={`Actions for ${po.number}`}
              aria-expanded={openMenu}
              onClick={() => setOpenMenu(!openMenu)}
              className="grid h-8 w-8 place-items-center rounded-[8px] text-slate-400 hover:bg-[var(--color-bv-bg)] hover:text-[var(--color-bv-text)]"
            >
              ⋯
            </button>
            {openMenu ? (
              <>
                <span
                  className="fixed inset-0 z-30"
                  aria-hidden
                  onClick={() => setOpenMenu(false)}
                />
                <span className="absolute right-0 top-9 z-40 block w-52 overflow-hidden rounded-[12px] border border-slate-200 bg-white py-1 shadow-[0_18px_50px_rgba(15,23,42,0.16)]">
                  {!draft && hasIncomplete ? (
                    <button
                      type="button"
                      className="block w-full px-3.5 py-2 text-left text-[12.5px] font-semibold text-[var(--color-bv-text)] hover:bg-[#fff4eb] disabled:opacity-50"
                      disabled={poPending}
                      onClick={onMarkAll}
                    >
                      {poPending ? 'Saving…' : 'Mark all arrived'}
                    </button>
                  ) : null}
                  <Link
                    href={`/purchase-orders/${po.id}`}
                    className="block px-3.5 py-2 text-[12.5px] font-semibold text-[var(--color-bv-text)] hover:bg-[#fff4eb]"
                    onClick={() => setOpenMenu(false)}
                  >
                    Open PO
                  </Link>
                  <Link
                    href={`/po-print/${po.id}`}
                    target="_blank"
                    className="block px-3.5 py-2 text-[12.5px] font-semibold text-[var(--color-bv-text)] hover:bg-[#fff4eb]"
                    onClick={() => setOpenMenu(false)}
                  >
                    Print / PDF
                  </Link>
                </span>
              </>
            ) : null}
          </span>
        </span>
      </div>

      {/* materials */}
      {expanded ? (
        <div className="border-t border-[var(--color-bv-border)]">
          {po.lines.length === 0 ? (
            <div className="px-5 py-4 text-[12.5px] text-[var(--color-bv-muted)]">
              No materials on this PO.
            </div>
          ) : (
            po.lines.map((line) => (
              <MaterialRow
                key={line.id}
                line={line}
                draft={draft}
                highlight={query !== '' && line.description.toLowerCase().includes(query)}
                flash={flashLines.has(line.id)}
                pending={pendingLines.has(line.id)}
                open={openLine === line.id}
                onOpenToggle={() => setOpenLine(openLine === line.id ? null : line.id)}
                history={history}
                onCheck={onCheck}
                onDetailSave={onDetailSave}
              />
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function Badge({ tone, children }: { tone: 'teal' | 'orange' | 'green'; children: string }) {
  const cls = {
    teal: 'bg-teal-50 text-teal-700 border-teal-200',
    orange: 'bg-[#fff4eb] text-[#b05c1e] border-[#f2d9c2]',
    green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  }[tone];
  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-[10.5px] font-extrabold tracking-[0.08em] ${cls}`}>
      {children}
    </span>
  );
}

function EmptyMessage({ children }: { children: string }) {
  return (
    <div className="rounded-[var(--radius-bv)] border border-dashed border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-5 py-12 text-center text-[13.5px] text-[var(--color-bv-muted)]">
      {children}
    </div>
  );
}

/* ------------------------------ material row ------------------------------ */

function MaterialRow({
  line,
  draft,
  highlight,
  flash,
  pending,
  open,
  onOpenToggle,
  history,
  onCheck,
  onDetailSave,
}: {
  line: PoLineData;
  draft: boolean;
  highlight: boolean;
  flash: boolean;
  pending: boolean;
  open: boolean;
  onOpenToggle: () => void;
  history: ReceivingHistoryEntry[] | 'loading' | undefined;
  onCheck: (line: PoLineData, nextMilli: number) => void;
  onDetailSave: (line: PoLineData, nextMilli: number) => void;
}) {
  const received = isLineReceived(line);
  const partial = !received && line.receivedQtyMilli > 0;
  const unit = unitWord(line.unit);

  const qtyLabel = received
    ? `${formatQty(line.qtyMilli)} of ${formatQty(line.qtyMilli)}`
    : partial
      ? `${formatQty(line.receivedQtyMilli)} of ${formatQty(line.qtyMilli)} • Partial`
      : `Qty ${formatQty(line.qtyMilli)}${unit ? ` ${unit}` : ''}`;

  return (
    <div
      className={`border-b border-[var(--color-bv-border)] transition-colors last:border-0 ${
        flash ? 'bg-emerald-50' : highlight ? 'bg-[#fff8e6]' : ''
      }`}
    >
      <div className="flex items-center gap-3 px-4 py-2.5 sm:px-5">
        {/* big receiving checkbox */}
        <button
          type="button"
          role="checkbox"
          aria-checked={received}
          aria-label={`${line.description} — mark ${received ? 'not received' : 'received'}`}
          disabled={draft || pending}
          title={draft ? 'This PO is still a draft — nothing was ordered yet.' : undefined}
          onClick={(e) => {
            e.stopPropagation();
            onCheck(line, received ? 0 : line.qtyMilli);
          }}
          className={`grid h-7 w-7 shrink-0 place-items-center rounded-[9px] border-2 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            received
              ? 'border-emerald-500 bg-emerald-500 text-white'
              : partial
                ? 'border-[var(--color-bv-accent)] bg-[#fff4eb] text-[var(--color-bv-accent)]'
                : 'border-slate-300 bg-white text-transparent hover:border-[var(--color-bv-accent)]'
          }`}
        >
          {pending ? (
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : partial ? (
            <span className="text-[13px] font-black leading-none">–</span>
          ) : (
            <svg width="15" height="15" viewBox="0 0 20 20" fill="none">
              <path d="M4 10.5l4 4 8-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>

        <button
          type="button"
          onClick={draft ? undefined : onOpenToggle}
          className={`min-w-0 flex-1 text-left ${draft ? 'cursor-default' : ''}`}
        >
          <span
            className={`block truncate text-[13.5px] font-semibold ${
              received ? 'text-[var(--color-bv-muted)] line-through decoration-emerald-400' : 'text-[var(--color-bv-text)]'
            }`}
          >
            {line.description}
          </span>
        </button>

        <span
          className={`shrink-0 text-right text-[12.5px] font-bold tabular-nums ${
            received
              ? 'text-emerald-600'
              : partial
                ? 'text-[#b05c1e]'
                : 'text-[var(--color-bv-muted)]'
          }`}
        >
          {qtyLabel}
        </span>
      </div>

      {open && !draft ? (
        <ReceivingDetail
          line={line}
          pending={pending}
          history={history}
          onSave={(next) => onDetailSave(line, next)}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------ receiving detail ------------------------------ */

function ReceivingDetail({
  line,
  pending,
  history,
  onSave,
}: {
  line: PoLineData;
  pending: boolean;
  history: ReceivingHistoryEntry[] | 'loading' | undefined;
  onSave: (nextMilli: number) => void;
}) {
  const [nowQty, setNowQty] = useState('');
  const [exactMode, setExactMode] = useState(false);
  const [exactQty, setExactQty] = useState('');
  const unit = unitWord(line.unit);

  const nowMilli = Math.round((Number(nowQty) || 0) * 1000);
  const newTotalMilli = Math.min(line.qtyMilli, line.receivedQtyMilli + Math.max(0, nowMilli));
  const exactMilli = Math.round((Number(exactQty) || 0) * 1000);

  const lineEvents =
    history && history !== 'loading'
      ? history.filter((e) => e.lineId === line.id || (!e.lineId && e.description === line.description))
      : [];

  return (
    <div className="mx-4 mb-3 rounded-[12px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-4 py-3 sm:mx-14">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-[12px] text-[var(--color-bv-muted)]">
        <span>
          Ordered:{' '}
          <b className="text-[var(--color-bv-text)]">
            {formatQty(line.qtyMilli)}
            {unit ? ` ${unit}` : ''}
          </b>
        </span>
        <span>
          Received so far:{' '}
          <b className="text-[var(--color-bv-text)]">{formatQty(line.receivedQtyMilli)}</b>
        </span>
      </div>

      {line.receivedQtyMilli < line.qtyMilli && !exactMode ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <label className="text-[12px] font-semibold text-[var(--color-bv-text)]">
            Received now
            <input
              className="ml-2 w-24 rounded-[9px] border border-[var(--color-bv-border)] bg-white px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--color-bv-accent)]"
              type="number"
              min={0}
              step="any"
              value={nowQty}
              onChange={(e) => setNowQty(e.target.value)}
            />
          </label>
          {nowMilli > 0 ? (
            <span className="text-[12px] text-[var(--color-bv-muted)]">
              → new total {formatQty(newTotalMilli)} of {formatQty(line.qtyMilli)}
            </span>
          ) : null}
          <button
            type="button"
            className="rounded-[9px] bg-[var(--color-bv-text)] px-3.5 py-1.5 text-[12px] font-bold text-white hover:opacity-95 disabled:opacity-50"
            disabled={pending || nowMilli <= 0}
            onClick={() => {
              onSave(newTotalMilli);
              setNowQty('');
            }}
          >
            {pending ? 'Saving…' : 'Save'}
          </button>
        </div>
      ) : null}

      {exactMode ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <label className="text-[12px] font-semibold text-[var(--color-bv-text)]">
            Correct total received
            <input
              className="ml-2 w-24 rounded-[9px] border border-[var(--color-bv-border)] bg-white px-2.5 py-1.5 text-[13px] outline-none focus:border-[var(--color-bv-accent)]"
              type="number"
              min={0}
              step="any"
              value={exactQty}
              onChange={(e) => setExactQty(e.target.value)}
            />
          </label>
          <span className="text-[12px] text-[var(--color-bv-muted)]">of {formatQty(line.qtyMilli)}</span>
          <button
            type="button"
            className="rounded-[9px] bg-[var(--color-bv-text)] px-3.5 py-1.5 text-[12px] font-bold text-white hover:opacity-95 disabled:opacity-50"
            disabled={pending || exactQty === '' || exactMilli < 0 || exactMilli > line.qtyMilli}
            onClick={() => {
              onSave(exactMilli);
              setExactMode(false);
              setExactQty('');
            }}
          >
            {pending ? 'Saving…' : 'Save correction'}
          </button>
          <button
            type="button"
            className="text-[12px] font-semibold text-[var(--color-bv-muted)] hover:underline"
            onClick={() => setExactMode(false)}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="mt-2 text-[11.5px] font-semibold text-[#1C4972] hover:underline"
          onClick={() => {
            setExactMode(true);
            setExactQty(formatQty(line.receivedQtyMilli));
          }}
        >
          Correct the total…
        </button>
      )}

      {/* history */}
      <div className="mt-3 border-t border-[var(--color-bv-border)] pt-2">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-[var(--color-bv-muted)]">
          Receiving history
        </div>
        {history === 'loading' || history === undefined ? (
          <div className="mt-1 text-[12px] text-[var(--color-bv-muted)]">Loading…</div>
        ) : lineEvents.length === 0 ? (
          <div className="mt-1 text-[12px] text-[var(--color-bv-muted)]">
            Nothing received yet.
          </div>
        ) : (
          <ul className="mt-1 space-y-1">
            {lineEvents.slice(0, 12).map((e) => (
              <li key={e.id} className="text-[12px] text-[var(--color-bv-text)]">
                <span className="tabular-nums text-[var(--color-bv-muted)]">
                  {formatDateTime(e.createdAt)}
                </span>{' '}
                — {e.actorName}
                {e.totalReceivedMilli != null && e.orderedQtyMilli != null ? (
                  <>
                    {' '}
                    set total to{' '}
                    <b>
                      {formatQty(e.totalReceivedMilli)} of {formatQty(e.orderedQtyMilli)}
                    </b>
                    {e.action ? (
                      <span className="text-[var(--color-bv-muted)]"> ({e.action.replace('_', ' ')})</span>
                    ) : null}
                  </>
                ) : (
                  <span className="text-[var(--color-bv-muted)]"> {e.message}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
