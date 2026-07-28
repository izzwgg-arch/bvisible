'use client';

import { useActionState } from 'react';
import { saveAssistantSettingsAction, type AssistantSettingsState } from './settings-actions';

export function AssistantSettingsPanel({
  keyConfigured,
  ylKeyConfigured,
  model,
}: {
  keyConfigured: boolean;
  ylKeyConfigured: boolean;
  model: string;
}) {
  const [state, formAction, pending] = useActionState<AssistantSettingsState, FormData>(
    saveAssistantSettingsAction,
    { error: null }
  );

  return (
    <details className="mb-4 max-w-[1000px] shrink-0 rounded-[var(--radius-bv)] bg-[var(--color-bv-surface)] shadow-[var(--shadow-bv-card)]">
      <summary className="cursor-pointer list-none px-5 py-3 text-[13px] font-bold text-[var(--color-bv-text)]">
        ⚙ Assistant settings — API keys{' '}
        <span className={keyConfigured ? 'text-emerald-700' : 'text-amber-700'}>
          {keyConfigured ? '· OpenAI ✓' : '· OpenAI not set'}
        </span>{' '}
        <span className={ylKeyConfigured ? 'text-emerald-700' : 'text-[var(--color-bv-muted)]'}>
          {ylKeyConfigured ? '· Yiddish Labs ✓' : '· Yiddish Labs not set'}
        </span>
      </summary>
      <form action={formAction} className="grid gap-3 border-t border-[var(--color-bv-border)] p-5 md:grid-cols-[2fr_2fr_1fr_auto_auto] md:items-end">
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
            Yiddish Labs API key {ylKeyConfigured ? '(saved)' : ''}
          </span>
          <input
            name="ylApiKey"
            type="password"
            autoComplete="off"
            placeholder={ylKeyConfigured ? '•••••••••••••••• (saved)' : 'yl_live_…'}
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
          disabled={pending || (!keyConfigured && !ylKeyConfigured)}
          className="rounded-[10px] border border-[var(--color-bv-border)] px-4 py-2.5 text-[12.5px] font-bold text-[var(--color-bv-muted)] hover:text-red-600 disabled:opacity-50"
        >
          Remove keys
        </button>
        <p className="md:col-span-5 text-[10.5px] text-[var(--color-bv-muted)]">
          Keys are encrypted (AES-256-GCM) before they are stored and are never shown again or sent
          to the browser. One Yiddish Labs key covers both their transcription and translation APIs
          — it powers the Y (Yiddish) mode on the assistant mic.
        </p>
        {state.error ? (
          <p className="md:col-span-5 text-[12px] font-medium text-rose-600">{state.error}</p>
        ) : state.saved ? (
          <p className="md:col-span-5 text-[12px] font-medium text-emerald-700">Saved ✓</p>
        ) : null}
      </form>
    </details>
  );
}
