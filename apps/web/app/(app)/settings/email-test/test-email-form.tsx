'use client';

import { useActionState } from 'react';
import { sendTestEmailAction, type TestEmailState } from './actions';
import { FormError, FormNotice } from '@/components/auth/form-error';
import { adminInputClass, adminPrimaryButtonClass } from '@/components/app/admin-ui';

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
    <form action={formAction} className="grid gap-4">
      <label className="flex flex-col gap-2">
        <span className="text-[12px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          Send to
        </span>
        <input
          name="recipient"
          type="email"
          required
          defaultValue={defaultRecipient ?? ''}
          placeholder="someone@example.com"
          className={adminInputClass}
        />
      </label>

      <button
        type="submit"
        disabled={pending}
        className={adminPrimaryButtonClass}
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
            <p className="text-[12px] text-slate-500">
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
