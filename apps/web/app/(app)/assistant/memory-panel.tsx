'use client';

import { useActionState } from 'react';
import {
  forgetAssistantMemoryAction,
  teachAssistantAction,
  type AssistantMemoryState,
} from './memory-actions';

export interface AssistantLesson {
  id: string;
  content: string;
  category: string | null;
  createdAt: string;
}

/// Admin-only view of what the assistant has been taught. Everything here
/// is also reachable from chat ("remember: …" / "forget: …") — the panel
/// exists so an admin can audit the training and pull a bad lesson.
export function AssistantMemoryPanel({ lessons }: { lessons: AssistantLesson[] }) {
  const [teachState, teachAction, teaching] = useActionState<AssistantMemoryState, FormData>(
    teachAssistantAction,
    { error: null }
  );
  const [forgetState, forgetAction, forgetting] = useActionState<AssistantMemoryState, FormData>(
    forgetAssistantMemoryAction,
    { error: null }
  );

  return (
    <details className="mb-4 max-w-[1000px] shrink-0 rounded-[var(--radius-bv)] bg-[var(--color-bv-surface)] shadow-[var(--shadow-bv-card)]">
      <summary className="cursor-pointer list-none px-5 py-3 text-[13px] font-bold text-[var(--color-bv-text)]">
        🧠 Training — what the assistant has learned{' '}
        <span className="text-[var(--color-bv-muted)]">
          · {lessons.length} {lessons.length === 1 ? 'lesson' : 'lessons'}
        </span>
      </summary>

      <div className="border-t border-[var(--color-bv-border)] p-5">
        <p className="mb-3 text-[11.5px] leading-relaxed text-[var(--color-bv-muted)]">
          Correct the assistant in chat and it learns permanently — for every user in the shop. Type{' '}
          <b>remember: install is always a final price</b> for a guaranteed save, or{' '}
          <b>forget: …</b> to drop a lesson. Only admins can train it; everyone else gets a
          conversation-only fix.
        </p>

        <form action={teachAction} className="grid gap-3 md:grid-cols-[3fr_1fr_auto] md:items-end">
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-bv-text)] opacity-75">
              Teach a lesson
            </span>
            <input
              name="lesson"
              placeholder="e.g. Lightbox faces: always Dura-Bond Black 4x8 matt"
              className="w-full rounded-[10px] border border-[var(--color-bv-border)] bg-white px-3 py-2 text-[13px] text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)]"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-bv-text)] opacity-75">
              Category
            </span>
            <input
              name="category"
              placeholder="pricing"
              className="w-full rounded-[10px] border border-[var(--color-bv-border)] bg-white px-3 py-2 text-[13px] text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)]"
            />
          </label>
          <button
            type="submit"
            disabled={teaching}
            className="rounded-[10px] bg-[var(--color-bv-accent)] px-5 py-2.5 text-[13px] font-bold text-white hover:opacity-95 disabled:opacity-50"
          >
            {teaching ? 'Saving…' : 'Teach'}
          </button>
        </form>

        {teachState.error ? (
          <p className="mt-2 text-[12px] font-medium text-rose-600">{teachState.error}</p>
        ) : teachState.saved ? (
          <p className="mt-2 text-[12px] font-medium text-emerald-700">Learned ✓ {teachState.saved}</p>
        ) : null}
        {forgetState.error ? (
          <p className="mt-2 text-[12px] font-medium text-rose-600">{forgetState.error}</p>
        ) : forgetState.forgot ? (
          <p className="mt-2 text-[12px] font-medium text-emerald-700">Forgotten ✓ {forgetState.forgot}</p>
        ) : null}

        <ul className="mt-4 divide-y divide-[var(--color-bv-border)] border-t border-[var(--color-bv-border)]">
          {lessons.length === 0 ? (
            <li className="py-3 text-[12.5px] text-[var(--color-bv-muted)]">
              Nothing learned yet — correct the assistant in chat and it will show up here.
            </li>
          ) : (
            lessons.map((l) => (
              <li key={l.id} className="flex items-start gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] leading-relaxed text-[var(--color-bv-text)]">{l.content}</p>
                  <p className="mt-0.5 text-[10.5px] text-[var(--color-bv-muted)]">
                    {l.category ? `${l.category} · ` : ''}
                    {l.createdAt}
                  </p>
                </div>
                <form action={forgetAction}>
                  <input type="hidden" name="id" value={l.id} />
                  <button
                    type="submit"
                    disabled={forgetting}
                    className="rounded-[8px] border border-[var(--color-bv-border)] px-3 py-1.5 text-[11px] font-bold text-[var(--color-bv-muted)] hover:text-red-600 disabled:opacity-50"
                  >
                    Forget
                  </button>
                </form>
              </li>
            ))
          )}
        </ul>
      </div>
    </details>
  );
}
