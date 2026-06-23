'use client';

import { useActionState, useMemo, useState } from 'react';
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
  warnings: {
    missingCustomer: boolean;
    zeroSellPrice: boolean;
    negativeMargin: boolean;
    missingEmail: boolean;
    unsavedChanges: boolean;
    missingLineDescriptions: boolean;
  };
}) {
  const [state, action, pending] = useActionState(sendEstimateEmailAction, INITIAL);
  const [reviewOpen, setReviewOpen] = useState(false);

  const blockedFinal = props.status === EstimateStatus.FINALIZED;
  const blockedNoEmail = !(props.clientEmail?.trim() ?? '');
  const disabled = blockedFinal || blockedNoEmail || pending;
  const warningRows = useMemo(
    () => [
      ['Missing customer', props.warnings.missingCustomer],
      ['Zero sell price', props.warnings.zeroSellPrice],
      ['Negative margin', props.warnings.negativeMargin],
      ['Missing email', props.warnings.missingEmail],
      ['Unsaved changes', props.warnings.unsavedChanges],
      ['Missing required line descriptions', props.warnings.missingLineDescriptions],
    ] as const,
    [props.warnings],
  );

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

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setReviewOpen(true)}
          className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-4 py-2.5 text-[13.5px] font-medium text-[var(--color-bv-text)] shadow-sm disabled:opacity-50"
        >
          Final review before send
        </button>
      </div>

      {reviewOpen ? (
        <div className="mt-4 rounded-[10px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] p-4">
          <h3 className="text-[14px] font-semibold text-[var(--color-bv-text)]">Final review</h3>
          <ul className="mt-2 space-y-1 text-[12.5px] text-[var(--color-bv-muted)]">
            {warningRows.map(([label, flagged]) => (
              <li key={label} className={flagged ? 'text-amber-800' : ''}>
                {flagged ? 'Warning: ' : 'OK: '}
                {label}
              </li>
            ))}
          </ul>
          <form action={action} className="mt-4 flex flex-wrap items-center gap-3">
            <input type="hidden" name="estimateId" value={props.estimateId} />
            <input type="hidden" name="reviewConfirmed" value="true" />
            <button
              type="submit"
              disabled={disabled}
              className="rounded-[8px] bg-[var(--color-bv-accent)] px-4 py-2.5 text-[13.5px] font-medium text-[var(--color-bv-accent-foreground)] shadow-sm disabled:opacity-50"
            >
              {pending ? 'Sending…' : 'Confirm and send'}
            </button>
            <button
              type="button"
              onClick={() => setReviewOpen(false)}
              className="rounded-[8px] border border-[var(--color-bv-border)] bg-white px-4 py-2.5 text-[13px] font-medium text-[var(--color-bv-text)]"
            >
              Go back and edit
            </button>
          </form>
        </div>
      ) : null}
      {props.clientEmail?.trim() ? (
        <span className="mt-3 inline-block text-[13px] text-[var(--color-bv-muted)]">
          To: <span className="text-[var(--color-bv-text)]">{props.clientEmail.trim()}</span>
        </span>
      ) : null}
    </div>
  );
}
