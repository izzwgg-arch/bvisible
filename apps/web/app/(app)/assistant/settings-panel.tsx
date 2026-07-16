'use client';

import { useActionState } from 'react';
import { saveAssistantSettingsAction, type AssistantSettingsState } from './settings-actions';

export function AssistantSettingsPanel({
  keyConfigured,
  model,
}: {
  keyConfigured: boolean;
  model: string;
}) {
  const [state, formAction, pending] = useActionState<AssistantSettingsState, FormData>(
    saveAssistantSettingsAction,
    { error: null }
  );

  return (
    <details className="mb-4 max-w-[1000px] shrink-0 rounded-[var(--radius-bv)] bg-[var(--color-bv-surface)] shadow-[var(--shadow-bv-card)]">
      <summary className="cursor-pointer list-none px-5 py-3 text-[13px] font-bold text-[var(--color-bv-text)]">
        ⚙ Assistant settings — API key{' '}
        <span className={keyConfigured ? 'text-emerald-700' : 'text-amber-700'}>
          {keyConfigured ? '· configured ✓' : '· not set'}
        </span>
      </summary>
      <form action={formAction} className="grid gap-3 border-t border-[var(--color-bv-border)] p-5 md:grid-cols-[2fr_1fr_auto_auto] md:items-end">
        <label className="block">
          <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-bv-text)] opacity-75">
            OpenAI API key {keyConfigured ? '(leave blank to keep the current key)' : ''}
          </span>
          <input
            name="apiKey"
            type="password"
            autoComplete="off"
            placeholder={keyConfigured ? '•••••••••••••••• (saved)' : 'sk-…'}
            className="w-full rounded-[10px] border border-[var(--color-bv-border)] bg-white px-3 py-2 text-[13px] text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)]"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-bv-text)] opacity-75">
            Model
          </span>
          <input
            name="model"
            defaultValue={model}
            className="w-full rounded-[10px] border border-[var(--color-bv-border)] bg-white px-3 py-2 text-[13px] text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)]"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-[10px] bg-[var(--color-bv-accent)] px-5 py-2.5 text-[13px] font-bold text-white hover:opacity-95 disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
        <button
          type="submit"
          name="clear"
          value="1"
          disabled={pending || !keyConfigured}
          className="rounded-[10px] border border-[var(--color-bv-border)] px-4 py-2.5 text-[12.5px] font-bold text-[var(--color-bv-muted)] hover:text-red-600 disabled:opacity-50"
        >
          Remove key
        </button>
        <p className="md:col-span-4 text-[10.5px] text-[var(--color-bv-muted)]">
          The key is encrypted (AES-256-GCM) before it is stored and is never shown again or sent
          to the browser. Change it here any time.
        </p>
        {state.error ? (
          <p className="md:col-span-4 text-[12px] font-medium text-rose-600">{state.error}</p>
        ) : state.saved ? (
          <p className="md:col-span-4 text-[12px] font-medium text-emerald-700">Saved ✓</p>
        ) : null}
      </form>
    </details>
  );
}
