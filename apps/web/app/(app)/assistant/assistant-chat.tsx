'use client';

// Chat UI for the B Visible business assistant.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { parkPendingPrefill, type EstimatePrefill } from '@/lib/assistant/context-store';
import { sendAssistantMessage } from '@/lib/assistant/stream-client';

interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
  toolEvents?: Array<{ tool: string; summary: string }>;
  createdEstimate?: { id: string; number: string } | null;
  prefill?: EstimatePrefill | null;
}

const SUGGESTIONS = [
  'Make me a stop sign estimate for a new customer',
  'Price a full wrap for a Chevy Express long wheelbase',
  'Make me a 4×8 Dura-Bond sign estimate with install',
  'Which estimates are waiting on the customer?',
  'How much open PO spend do we have right now?',
];

export function AssistantChat({ configured }: { configured: boolean }) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function send(text: string) {
    const content = text.trim();
    if (!content || busy) return;
    const next: ChatMsg[] = [...messages, { role: 'user', content }];
    setMessages(next);
    setInput('');
    setBusy(true);
    setProgress(null);
    try {
      const data = await sendAssistantMessage(
        { messages: next.slice(-16).map((m) => ({ role: m.role, content: m.content })) },
        (label) => setProgress(label)
      );
      // Draft created: open the estimate workspace with it right away.
      if (data.createdEstimate) {
        router.push(`/estimates/${data.createdEstimate.id}` as never);
      } else if (data.prefill && data.prefill.lines.length > 0) {
        // Prefill fallback: park it and open the Create-estimate page.
        parkPendingPrefill(data.prefill);
        router.push('/estimates/new');
      }
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: data.reply ?? data.error ?? 'Something went wrong.',
          toolEvents: data.toolEvents ?? [],
          createdEstimate: data.createdEstimate ?? null,
          prefill: data.prefill && data.prefill.lines.length > 0 ? data.prefill : null,
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

  return (
    <div className="flex min-h-0 w-full max-w-[1000px] flex-1 flex-col">
      <div className="flex-1 space-y-3.5 overflow-y-auto pb-4 pr-2">
        {messages.length === 0 ? (
          <div className="rounded-[14px] bg-[var(--color-bv-surface)] p-5 text-[13px] leading-relaxed text-[var(--color-bv-muted)] shadow-[var(--shadow-bv-card)]">
            Ask for an estimate (&quot;make me a stop sign for Valley Plumbing&quot;), a price
            lookup, or a business question. Everything is grounded in the live pricing Sheet and
            your data — and the assistant only ever creates <b>drafts</b>.
          </div>
        ) : null}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
            {m.role === 'assistant' && m.toolEvents && m.toolEvents.length > 0 ? (
              <div className="mb-1.5 flex max-w-[75%] flex-wrap gap-1.5">
                {m.toolEvents.map((t, j) => (
                  <span
                    key={j}
                    className="rounded-full bg-[var(--color-bv-surface)] px-2.5 py-1 text-[9.5px] font-bold text-[var(--color-bv-muted)] shadow-[var(--shadow-bv-card)]"
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
                  ? 'max-w-[75%] rounded-[14px] rounded-br-[4px] bg-[var(--color-bv-text)] px-4 py-2.5 text-[13.5px] leading-relaxed text-white'
                  : 'max-w-[75%] whitespace-pre-wrap rounded-[14px] rounded-bl-[4px] bg-[var(--color-bv-surface)] px-4 py-2.5 text-[13.5px] leading-relaxed text-[var(--color-bv-text)] shadow-[var(--shadow-bv-card)]'
              }
            >
              {m.content}
              {m.createdEstimate ? (
                <div className="mt-2.5 flex items-center gap-3 rounded-[10px] border border-[#ecc39e] bg-[#fdf6ef] px-3 py-2">
                  <div>
                    <div className="text-[12.5px] font-bold">{m.createdEstimate.number} · DRAFT</div>
                    <div className="text-[10.5px] text-[#8a5a33]">Nothing sent — review required</div>
                  </div>
                  <Link
                    href={`/estimates/${m.createdEstimate.id}`}
                    className="ml-auto rounded-[8px] bg-[var(--color-bv-accent)] px-3 py-1.5 text-[11px] font-bold text-white"
                  >
                    Open estimate →
                  </Link>
                </div>
              ) : null}
              {m.prefill ? (
                <div className="mt-2.5 flex items-center gap-3 rounded-[10px] border border-[#ecc39e] bg-[#fdf6ef] px-3 py-2">
                  <div>
                    <div className="text-[12.5px] font-bold">✦ Estimate prefilled — {m.prefill.title}</div>
                    <div className="text-[10.5px] text-[#8a5a33]">
                      {m.prefill.lines.length} lines · nothing saved — review and press Save
                    </div>
                  </div>
                  <Link
                    href="/estimates/new"
                    className="ml-auto rounded-[8px] bg-[var(--color-bv-accent)] px-3 py-1.5 text-[11px] font-bold text-white"
                  >
                    Open Create estimate →
                  </Link>
                </div>
              ) : null}
            </div>
          </div>
        ))}
        {busy ? (
          <div className="max-w-[75%] rounded-[14px] bg-[var(--color-bv-surface)] px-4 py-2.5 text-[13px] text-[var(--color-bv-muted)] shadow-[var(--shadow-bv-card)]">
            <span className="mr-2 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-bv-accent)] align-middle" />
            {progress ?? 'Working — looking things up in the Sheet…'}
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>

      {messages.length === 0 ? (
        <div className="mb-2.5 flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => send(s)}
              disabled={!configured || busy}
              className="rounded-full bg-[var(--color-bv-surface)] px-3.5 py-1.5 text-[11.5px] font-bold text-[var(--color-bv-text)] shadow-[var(--shadow-bv-card)] hover:bg-[#fdeee1] disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        className="flex items-center gap-2.5 rounded-[14px] bg-[var(--color-bv-surface)] p-2.5 pl-4 shadow-[var(--shadow-bv-card)]"
      >
        <input
          className="flex-1 bg-transparent text-[14px] text-[var(--color-bv-text)] outline-none"
          placeholder={
            configured
              ? 'Try: "Make me a 4×8 Dura-Bond sign estimate for HATOV with install"…'
              : 'Assistant not configured — add OPENAI_API_KEY on the server first.'
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={!configured || busy}
        />
        <button
          type="submit"
          disabled={!configured || busy || !input.trim()}
          className="rounded-[10px] bg-[var(--color-bv-accent)] px-5 py-2.5 text-[13px] font-bold text-white hover:opacity-95 disabled:opacity-50"
        >
          {busy ? '…' : 'Send ✦'}
        </button>
      </form>
      <p className="mt-2 text-[10.5px] text-[var(--color-bv-muted)]">
        Grounded in the live Google Sheet + your database (read-only). Drafts only — it can never
        send, email, approve, finalize, or delete anything.
      </p>
    </div>
  );
}
