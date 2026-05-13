'use client';

import { useActionState } from 'react';
import { sendTestEmailAction, type TestEmailState } from './actions';
import { FormError, FormNotice } from '@/components/auth/form-error';

const INITIAL: TestEmailState = {
  ok: false,
  error: null,
  diagnostics: null,
  detail: null,
  messageId: null,
  recipient: null,
};

export function TestEmailForm({ defaultRecipient }: { defaultRecipient?: string }) {
  const [state, formAction, pending] = useActionState(sendTestEmailAction, INITIAL);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-[12.5px] font-medium text-[var(--color-bv-muted)]">
          Send to
        </span>
        <input
          name="recipient"
          type="email"
          required
          defaultValue={defaultRecipient ?? ''}
          placeholder="someone@example.com"
          className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3 py-2 text-[14px] text-[var(--color-bv-text)] outline-none focus:border-[var(--color-bv-accent)] focus:bg-[var(--color-bv-surface)]"
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className="self-start inline-flex items-center justify-center rounded-[8px] bg-[var(--color-bv-accent)] px-3.5 py-2 text-[14px] font-medium text-[var(--color-bv-accent-foreground)] shadow-sm transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? 'Sending…' : 'Send test email'}
      </button>

      {state.ok && state.recipient ? (
        <FormNotice tone="success">
          Test email accepted by SMTP for {state.recipient}.
          {state.messageId ? (
            <>
              {' '}
              Message ID: <code className="font-mono text-[12px]">{state.messageId}</code>
            </>
          ) : null}
        </FormNotice>
      ) : null}

      {state.error ? (
        <div className="flex flex-col gap-2">
          <FormError message={state.error} />
          {state.detail && (state.detail.code || state.detail.responseCode) ? (
            <p className="text-[12px] text-[var(--color-bv-muted)]">
              SMTP error code:{' '}
              <code className="font-mono">
                {state.detail.code ?? '—'}
                {state.detail.responseCode ? ` (response ${state.detail.responseCode})` : ''}
              </code>
            </p>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
