'use client';

// Floating assistant dock — a ✦ pill in the bottom-right corner of every
// page. Opens a chat drawer that automatically sees what the operator is
// working on (via the assistant context store) so they never have to
// explain the screen. Voice notes are transcribed server-side with the
// tenant's OpenAI key. The conversation follows the operator across pages.

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  applyEstimatePrefill,
  applyProposedLines,
  getAssistantContext,
  getAssistantContextServer,
  parkPendingPrefill,
  subscribeAssistantContext,
  type EstimatePrefill,
  type ProposedLine,
} from '@/lib/assistant/context-store';
import { sendAssistantMessage } from '@/lib/assistant/stream-client';

interface DockMsg {
  role: 'user' | 'assistant';
  content: string;
  toolEvents?: Array<{ tool: string; summary: string }>;
  createdEstimate?: { id: string; number: string } | null;
  proposedLines?: ProposedLine[] | null;
  proposalNote?: string | null;
  linesApplied?: boolean;
  prefill?: EstimatePrefill | null;
  prefillApplied?: boolean;
}

const STORAGE_KEY = 'bv-assistant-dock-v1';

/// Friendly page label when the page didn't publish its own context.
function pageLabelFor(pathname: string): string {
  const map: Array<[RegExp, string]> = [
    [/^\/home/, 'Home'],
    [/^\/dashboard/, 'Overview'],
    [/^\/estimates\/new/, 'New estimate'],
    [/^\/estimates\/[^/]+\/qbme/, 'QBME export'],
    [/^\/estimates\/[^/]+/, 'Estimate editor'],
    [/^\/estimates/, 'Estimates list'],
    [/^\/purchase-orders\/shop-order/, 'Order materials'],
    [/^\/purchase-orders/, 'Purchase orders'],
    [/^\/clients/, 'Customers'],
    [/^\/vendors/, 'Vendors'],
    [/^\/items/, 'Catalog'],
    [/^\/vehicles/, 'Vehicles'],
    [/^\/reports/, 'Reports'],
    [/^\/pricing-backend/, 'Pricing backend'],
  ];
  for (const [re, label] of map) if (re.test(pathname)) return label;
  return pathname;
}

function loadStored(): { messages: DockMsg[]; open: boolean } {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { messages?: DockMsg[]; open?: boolean };
      return { messages: parsed.messages ?? [], open: Boolean(parsed.open) };
    }
  } catch {
    /* fresh start */
  }
  return { messages: [], open: false };
}

export function AssistantDock() {
  const pathname = usePathname() ?? '/';
  const router = useRouter();
  const ctx = useSyncExternalStore(
    subscribeAssistantContext,
    getAssistantContext,
    getAssistantContextServer
  );

  const [hydrated, setHydrated] = useState(false);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<DockMsg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [recState, setRecState] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const [micError, setMicError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);

  // Restore the conversation once on the client (avoids SSR mismatch).
  useEffect(() => {
    const stored = loadStored();
    setMessages(stored.messages);
    setOpen(stored.open);
    setHydrated(true);
  }, []);

  // Persist across page navigations within the session.
  useEffect(() => {
    if (!hydrated) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ messages: messages.slice(-40), open }));
    } catch {
      /* storage full — fine */
    }
  }, [messages, open, hydrated]);

  useEffect(() => {
    if (open) {
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'auto' }), 30);
    }
  }, [open]);

  // Stop any live recording when the dock unmounts / navigates.
  useEffect(() => {
    return () => {
      try {
        recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
      } catch {
        /* already stopped */
      }
    };
  }, []);

  // The full assistant page has its own chat — no dock there.
  if (pathname.startsWith('/assistant')) return null;

  const pageLabel = ctx?.page ?? pageLabelFor(pathname);
  const contextText = ctx
    ? `Page: ${ctx.page}\n${ctx.summary}`
    : `Page: ${pageLabelFor(pathname)} (no structured data on this screen).`;

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    const next: DockMsg[] = [...messages, { role: 'user', content }];
    setMessages(next);
    setInput('');
    setBusy(true);
    setProgress(null);
    try {
      const data = await sendAssistantMessage(
        {
          messages: next.slice(-16).map((m) => ({ role: m.role, content: m.content })),
          context: contextText,
        },
        (label) => setProgress(label)
      );

      // Draft created: open the estimate workspace with it right away —
      // the operator lands in the full editor with the draft loaded.
      if (data.createdEstimate) {
        router.push(`/estimates/${data.createdEstimate.id}` as never);
      }

      // Full-estimate prefill: fill the Create-estimate page in place, or
      // park it and route there when the operator asked from another page.
      let prefillApplied = false;
      if (data.prefill && data.prefill.lines.length > 0) {
        prefillApplied = applyEstimatePrefill(data.prefill);
        if (!prefillApplied) {
          parkPendingPrefill(data.prefill);
          router.push('/estimates/new');
          prefillApplied = true;
        }
      }

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: data.reply ?? data.error ?? 'Something went wrong.',
          toolEvents: data.toolEvents ?? [],
          createdEstimate: data.createdEstimate ?? null,
          proposedLines: data.proposedLines && data.proposedLines.length > 0 ? data.proposedLines : null,
          proposalNote: data.proposalNote ?? null,
          prefill: data.prefill && data.prefill.lines.length > 0 ? data.prefill : null,
          prefillApplied,
        },
      ]);
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === 'AbortError';
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: aborted
            ? 'That one took too long and I stopped waiting — please try again (a smaller ask helps).'
            : 'Request failed — check the connection and try again.',
        },
      ]);
    } finally {
      setBusy(false);
      setProgress(null);
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    }
  }

  function handleApplyLines(idx: number, lines: ProposedLine[]) {
    const ok = applyProposedLines(lines);
    if (ok) {
      setMessages((prev) => prev.map((m, i) => (i === idx ? { ...m, linesApplied: true } : m)));
    }
  }

  async function toggleRecording() {
    setMicError(null);
    if (recState === 'recording') {
      recorderRef.current?.stop();
      return;
    }
    if (recState !== 'idle') return;
    try {
      // If the operator previously chose "Block", Chrome rejects WITHOUT
      // showing the permission popup — no site can force it back open.
      // Detect that state and walk them through unblocking instead of a
      // dead-end error. In the "not decided yet" state, the getUserMedia
      // call below triggers the native permission popup.
      try {
        const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
        if (status.state === 'denied') {
          setMicError(
            'Chrome has the mic blocked for this site. Click the icon just left of the web address (🔒 or the sliders icon) → turn Microphone ON (Allow) → reload the page, then tap the mic again.'
          );
          return;
        }
      } catch {
        /* Permissions API unavailable — getUserMedia will prompt or fail below */
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm')
        ? 'audio/webm'
        : MediaRecorder.isTypeSupported('audio/mp4')
          ? 'audio/mp4'
          : '';
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecState('transcribing');
        try {
          const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
          if (blob.size < 1000) {
            setMicError('Too short — hold the mic and talk, tap again to stop.');
            return;
          }
          const form = new FormData();
          form.append('audio', blob, 'voice-note');
          const res = await fetch('/api/assistant/transcribe', { method: 'POST', body: form });
          const data = (await res.json()) as { text?: string; error?: string };
          if (data.error) {
            setMicError(data.error);
          } else if (data.text) {
            setInput((prev) => (prev.trim() ? `${prev.trim()} ${data.text}` : (data.text ?? '')));
            inputRef.current?.focus();
          } else {
            setMicError('Heard nothing — try again a little closer to the mic.');
          }
        } catch {
          setMicError('Transcription failed — try again.');
        } finally {
          setRecState('idle');
        }
      };
      recorderRef.current = rec;
      rec.start();
      setRecState('recording');
    } catch (e) {
      const denied =
        e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      setMicError(
        denied
          ? 'Permission not granted — when the popup appears next to the address bar, choose "Allow", then tap the mic again. If no popup appears, click the 🔒 icon by the web address → turn Microphone ON → reload.'
          : 'Could not start the microphone — check that a mic is connected and not used by another app, then try again.'
      );
    }
  }

  /* ------------------------------ collapsed ------------------------------ */

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-50 inline-flex items-center gap-2 rounded-full bg-[var(--color-bv-accent)] px-5 py-3 text-[13px] font-bold text-white shadow-[0_4px_14px_rgba(242,135,68,0.45)] hover:opacity-95"
        aria-label="Open assistant"
      >
        ✦ Assistant
        {messages.length > 0 ? (
          <span className="grid h-5 w-5 place-items-center rounded-full bg-white/25 text-[10px]">
            {Math.min(99, messages.length)}
          </span>
        ) : null}
      </button>
    );
  }

  /* -------------------------------- open -------------------------------- */

  return (
    <div className="fixed bottom-5 right-5 z-50 flex max-h-[min(640px,calc(100vh-40px))] w-[min(400px,calc(100vw-24px))] flex-col overflow-hidden rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] shadow-[0_10px_40px_rgba(28,73,114,0.22)]">
      {/* header */}
      <div className="border-b border-[var(--color-bv-border)] px-4 pb-2.5 pt-3.5">
        <div className="flex items-center gap-2 text-[13.5px] font-bold text-[var(--color-bv-text)]">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          ✦ Assistant
          <div className="ml-auto flex items-center gap-3">
            <Link
              href="/assistant"
              className="text-[10.5px] font-semibold text-[var(--color-bv-muted)] hover:text-[var(--color-bv-text)]"
            >
              Full page ↗
            </Link>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="text-[11px] font-semibold text-[var(--color-bv-muted)] hover:text-[var(--color-bv-text)]"
            >
              − minimize
            </button>
          </div>
        </div>
        <div className="mt-2 rounded-[10px] border border-[#ecc39e] bg-[#fdf6ef] px-2.5 py-1.5 text-[10.5px] leading-relaxed text-[#8a5a33]">
          <b className="text-[#b05c1e]">Sees your screen:</b>{' '}
          {ctx ? `${ctx.page} — live, no need to explain what you're working on.` : `${pageLabel} — ask about anything.`}
        </div>
      </div>

      {/* chat */}
      <div className="flex-1 space-y-2.5 overflow-y-auto p-3.5" style={{ minHeight: 180 }}>
        {messages.length === 0 ? (
          <div className="rounded-[12px] bg-[var(--color-bv-bg)] px-3.5 py-3 text-[12px] leading-relaxed text-[var(--color-bv-muted)]">
            I can see this page while you work. Ask things like <b>&quot;is my pricing right?&quot;</b>,{' '}
            <b>&quot;what am I missing for this sign?&quot;</b>, or tap the mic and just talk.
          </div>
        ) : null}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
            {m.role === 'assistant' && m.toolEvents && m.toolEvents.length > 0 ? (
              <div className="mb-1 flex max-w-[92%] flex-wrap gap-1">
                {m.toolEvents.map((t, j) => (
                  <span
                    key={j}
                    className="rounded-full bg-[var(--color-bv-bg)] px-2 py-0.5 text-[8.5px] font-bold text-[var(--color-bv-muted)]"
                    title={t.summary}
                  >
                    ✦ <span className="text-[var(--color-bv-accent)]">{t.tool}</span>
                  </span>
                ))}
              </div>
            ) : null}
            <div
              className={
                m.role === 'user'
                  ? 'max-w-[88%] rounded-[12px] rounded-br-[4px] bg-[var(--color-bv-text)] px-3 py-2 text-[12.5px] leading-relaxed text-white'
                  : 'max-w-[92%] whitespace-pre-wrap rounded-[12px] rounded-bl-[4px] bg-[var(--color-bv-bg)] px-3 py-2 text-[12.5px] leading-relaxed text-[var(--color-bv-text)]'
              }
            >
              {m.content}
              {m.createdEstimate ? (
                <div className="mt-2 flex items-center gap-2 rounded-[10px] border border-[#ecc39e] bg-[#fdf6ef] px-2.5 py-1.5">
                  <div>
                    <div className="text-[11.5px] font-bold">{m.createdEstimate.number} · DRAFT</div>
                    <div className="text-[9.5px] text-[#8a5a33]">Nothing sent — review required</div>
                  </div>
                  <Link
                    href={`/estimates/${m.createdEstimate.id}`}
                    className="ml-auto rounded-[8px] bg-[var(--color-bv-accent)] px-2.5 py-1 text-[10px] font-bold text-white"
                  >
                    Open →
                  </Link>
                </div>
              ) : null}
              {m.prefill ? (
                <div className="mt-2 rounded-[10px] border border-[#ecc39e] bg-[#fdf6ef] px-2.5 py-2">
                  <div className="text-[11.5px] font-bold">✦ Estimate prefilled — {m.prefill.title}</div>
                  <div className="text-[10px] text-[#8a5a33]">
                    {m.prefill.lines.length} lines
                    {m.prefill.customerName ? ` · ${m.prefill.customerName}` : ''} · nothing saved —
                    review it and press Save
                  </div>
                  {m.prefillApplied ? (
                    <div className="mt-1 text-[10.5px] font-bold text-emerald-700">
                      ✓ Filled into the Create-estimate page
                    </div>
                  ) : (
                    <Link
                      href="/estimates/new"
                      className="mt-1.5 inline-block rounded-[8px] bg-[var(--color-bv-accent)] px-3 py-1.5 text-[10.5px] font-bold text-white"
                    >
                      Open Create estimate →
                    </Link>
                  )}
                </div>
              ) : null}
              {m.proposedLines && m.proposedLines.length > 0 ? (
                <div className="mt-2 rounded-[10px] border border-[var(--color-bv-border)] bg-white px-2.5 py-2">
                  {m.proposalNote ? (
                    <div className="mb-1 text-[10.5px] font-semibold text-[var(--color-bv-muted)]">
                      {m.proposalNote}
                    </div>
                  ) : null}
                  {m.proposedLines.slice(0, 8).map((l, j) => (
                    <div key={j} className="flex items-baseline gap-2 py-0.5 text-[11px]">
                      <span className="rounded bg-[var(--color-bv-bg)] px-1 text-[8px] font-bold uppercase text-[var(--color-bv-muted)]">
                        {l.kind}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{l.description}</span>
                      <span className="whitespace-nowrap font-bold">
                        {l.qty} × ${(l.unitCostCents / 100).toFixed(2)}
                      </span>
                    </div>
                  ))}
                  {m.proposedLines.length > 8 ? (
                    <div className="text-[10px] text-[var(--color-bv-muted)]">
                      +{m.proposedLines.length - 8} more
                    </div>
                  ) : null}
                  {m.linesApplied ? (
                    <div className="mt-1.5 text-[11px] font-bold text-emerald-700">
                      ✓ Added to your estimate — review before saving
                    </div>
                  ) : ctx?.canApplyLines ? (
                    <button
                      type="button"
                      onClick={() => handleApplyLines(i, m.proposedLines ?? [])}
                      className="mt-1.5 rounded-[8px] bg-[var(--color-bv-accent)] px-3 py-1.5 text-[10.5px] font-bold text-white hover:opacity-95"
                    >
                      + Add {m.proposedLines.length} line{m.proposedLines.length > 1 ? 's' : ''} to this estimate
                    </button>
                  ) : (
                    <div className="mt-1.5 text-[10px] text-[var(--color-bv-muted)]">
                      Open the estimate you're building to add these with one click.
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        ))}
        {busy ? (
          <div className="max-w-[85%] rounded-[12px] bg-[var(--color-bv-bg)] px-3 py-2 text-[12px] text-[var(--color-bv-muted)]">
            <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-bv-accent)] align-middle" />
            {progress ?? 'Working — checking the Sheet and your screen…'}
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>

      {/* composer */}
      <div className="border-t border-[var(--color-bv-border)] p-2.5">
        {micError ? (
          <div className="mb-1.5 rounded-[8px] bg-rose-50 px-2.5 py-1 text-[10.5px] text-rose-700">{micError}</div>
        ) : null}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
          className="flex items-center gap-1.5 rounded-[11px] bg-white p-1.5 pl-3 shadow-[var(--shadow-bv-card)]"
        >
          <input
            ref={inputRef}
            className="min-w-0 flex-1 bg-transparent text-[12.5px] text-[var(--color-bv-text)] outline-none"
            placeholder={
              recState === 'recording'
                ? 'Listening… tap the mic to stop'
                : recState === 'transcribing'
                  ? 'Transcribing your voice note…'
                  : 'Ask about this screen — or tap the mic and talk…'
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={busy || recState === 'recording'}
          />
          <button
            type="button"
            onClick={() => void toggleRecording()}
            disabled={busy || recState === 'transcribing'}
            aria-label={recState === 'recording' ? 'Stop recording' : 'Record a voice note'}
            className={`grid h-9 w-9 shrink-0 place-items-center rounded-[9px] text-[15px] ${
              recState === 'recording'
                ? 'animate-pulse bg-rose-600 text-white'
                : recState === 'transcribing'
                  ? 'bg-[var(--color-bv-bg)] text-[var(--color-bv-muted)]'
                  : 'bg-[var(--color-bv-bg)] text-[var(--color-bv-text)] hover:bg-[#fdeee1]'
            }`}
          >
            {recState === 'recording' ? '■' : recState === 'transcribing' ? '…' : '🎤'}
          </button>
          <button
            type="submit"
            disabled={busy || !input.trim() || recState !== 'idle'}
            className="shrink-0 rounded-[9px] bg-[var(--color-bv-accent)] px-3.5 py-2 text-[12px] font-bold text-white hover:opacity-95 disabled:opacity-50"
          >
            {busy ? '…' : 'Send ✦'}
          </button>
        </form>
        <p className="mt-1.5 px-1 text-[9.5px] leading-snug text-[var(--color-bv-muted)]">
          🔒 Sees only this page + your database + the Sheet · drafts &amp; suggestions only — never
          sends, deletes, or changes anything on its own.
        </p>
      </div>
    </div>
  );
}
