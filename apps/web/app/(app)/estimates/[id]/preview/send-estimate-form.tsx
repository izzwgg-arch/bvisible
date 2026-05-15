'use client';

import { useActionState } from 'react';
import { EstimateStatus } from '@bvisible/db';
import { FormError } from '@/components/auth/form-error';
import {
  sendEstimateEmailAction,
  type SendEstimateEmailState,
} from './actions';

const INITIAL: SendEstimateEmailState = { ok: false, error: null, messageId: null };

export function SendEstimateEmailForm(props: {
  estimateId: string;
  clientEmail: string | null;
  status: EstimateStatus;
}) {
  const [state, action, pending] = useActionState(sendEstimateEmailAction, INITIAL);

  const blockedFinal = props.status === EstimateStatus.FINALIZED;
  const blockedNoEmail = !(props.clientEmail?.trim() ?? '');
  const disabled = blockedFinal || blockedNoEmail || pending;

  return (
    <div
      id="customer-send"
      className="scroll-mt-24 rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-6 shadow-[var(--shadow-bv-card)] print:hidden"
    >
      <h2 className="text-[16px] font-semibold text-[var(--color-bv-text)]">Send to customer</h2>
      <p className="mt-1 text-[13px] text-[var(--color-bv-muted)]">
        Emails the client at their saved address with a link to this quote (sign-in required). The
        estimate moves to <strong>Sent</strong> after the server accepts the message — only from{' '}
        <strong>Draft</strong>.
      </p>

      {blockedFinal ? (
        <p className="mt-4 text-[13px] text-amber-800">
          Finalized estimates cannot be sent from this flow.
        </p>
      ) : null}
      {blockedNoEmail && !blockedFinal ? (
        <p className="mt-4 text-[13px] text-amber-800">
          Add an email address on the client record before sending.
        </p>
      ) : null}

      <FormError message={state.error} />

      {state.ok && state.messageId ? (
        <p className="mt-4 text-[13px] text-emerald-800">
          Sent successfully. SMTP message id:{' '}
          <span className="font-mono text-[12px]">{state.messageId}</span>
        </p>
      ) : null}

      <form action={action} className="mt-4 flex flex-wrap items-center gap-3">
        <input type="hidden" name="estimateId" value={props.estimateId} />
        <button
          type="submit"
          disabled={disabled}
          className="rounded-[8px] bg-[var(--color-bv-accent)] px-4 py-2.5 text-[13.5px] font-medium text-[var(--color-bv-accent-foreground)] shadow-sm disabled:opacity-50"
        >
          {pending ? 'Sending…' : 'Send estimate email'}
        </button>
        {props.clientEmail?.trim() ? (
          <span className="text-[13px] text-[var(--color-bv-muted)]">
            To: <span className="text-[var(--color-bv-text)]">{props.clientEmail.trim()}</span>
          </span>
        ) : null}
      </form>
    </div>
  );
}
