'use client';

import { useActionState } from 'react';

import type { PublicQuoteCustomerResponseView } from '@/lib/estimate/load-public-quote';

import {
  initialPublicQuoteActionState,
  submitPublicQuoteResponseAction,
} from './actions';

function formatWhen(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function PublicQuoteResponsePanel(props: {
  rawToken: string;
  canRespond: boolean;
  responsesClosedFinalized: boolean;
  customerResponse: PublicQuoteCustomerResponseView;
}) {
  const [state, formAction, pending] = useActionState(
    submitPublicQuoteResponseAction,
    initialPublicQuoteActionState
  );

  const accepted = Boolean(props.customerResponse.acceptedAtIso);
  const declined = Boolean(props.customerResponse.declinedAtIso);

  const hasDecisionUi =
    props.canRespond || props.responsesClosedFinalized || accepted || declined;
  const hasFeedback = state.message !== null || state.ok !== null;
  if (!hasDecisionUi && !hasFeedback) {
    return null;
  }

  return (
    <div className="print:hidden">
      <section className="mx-auto mb-8 max-w-[880px] rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-6 shadow-[var(--shadow-bv-card)]">
        {state.message ? (
          <div
            className={`mb-5 rounded-[10px] px-4 py-3 text-[14px] leading-relaxed ${
              state.ok === false
                ? 'border border-red-200 bg-red-50 text-red-900'
                : 'border border-emerald-200 bg-emerald-50 text-emerald-950'
            }`}
          >
            {state.message}
          </div>
        ) : null}

        {accepted ? (
          <div className="rounded-[12px] border border-emerald-200 bg-emerald-50/90 px-5 py-6 text-center sm:text-left">
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-emerald-800">
              Quote accepted
            </p>
            <h2 className="mt-2 text-[22px] font-semibold text-emerald-950">Thank you!</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-emerald-900">
              We recorded your acceptance
              {props.customerResponse.acceptedAtIso
                ? ` on ${formatWhen(props.customerResponse.acceptedAtIso)}`
                : ''}
              . We&apos;ll follow up with next steps.
            </p>
            {props.customerResponse.acceptedByName ? (
              <p className="mt-3 text-[13px] text-emerald-900">
                <span className="font-medium text-emerald-950">Name:</span>{' '}
                {props.customerResponse.acceptedByName}
              </p>
            ) : null}
            {(props.customerResponse.acceptedNote ?? '').trim().length > 0 ? (
              <div className="mt-4 rounded-[8px] border border-emerald-100 bg-white/70 px-4 py-3 text-left">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-emerald-800">
                  Your note
                </p>
                <p className="mt-1 whitespace-pre-wrap text-[13px] text-emerald-950">
                  {props.customerResponse.acceptedNote!.trim()}
                </p>
              </div>
            ) : null}
          </div>
        ) : declined ? (
          <div className="rounded-[12px] border border-amber-200 bg-amber-50/90 px-5 py-6 text-center sm:text-left">
            <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-amber-900">
              Quote declined
            </p>
            <h2 className="mt-2 text-[22px] font-semibold text-amber-950">Thanks for letting us know</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-amber-950">
              We recorded your decision
              {props.customerResponse.declinedAtIso
                ? ` on ${formatWhen(props.customerResponse.declinedAtIso)}`
                : ''}
              .
            </p>
            {props.customerResponse.declinedByName ? (
              <p className="mt-3 text-[13px] text-amber-950">
                <span className="font-medium text-amber-950">Name:</span>{' '}
                {props.customerResponse.declinedByName}
              </p>
            ) : null}
            {(props.customerResponse.declinedNote ?? '').trim().length > 0 ? (
              <div className="mt-4 rounded-[8px] border border-amber-100 bg-white/70 px-4 py-3 text-left">
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-amber-900">
                  Your note
                </p>
                <p className="mt-1 whitespace-pre-wrap text-[13px] text-amber-950">
                  {props.customerResponse.declinedNote!.trim()}
                </p>
              </div>
            ) : null}
          </div>
        ) : props.responsesClosedFinalized ? (
          <div className="rounded-[12px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-5 py-5">
            <p className="text-[13px] font-semibold text-[var(--color-bv-text)]">Responses closed</p>
            <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--color-bv-muted)]">
              This estimate has been finalized. If you have questions, reach out to your contact at our shop.
            </p>
          </div>
        ) : props.canRespond ? (
          <form action={formAction} className="flex flex-col gap-5">
            <input type="hidden" name="rawToken" value={props.rawToken} />
            <div>
              <h2 className="text-[15px] font-semibold text-[var(--color-bv-text)]">
                Your decision
              </h2>
              <p className="mt-1 text-[13px] leading-relaxed text-[var(--color-bv-muted)]">
                Accept or decline this quote below. You don&apos;t need an account — your choice is recorded
                securely against this link only.
              </p>
            </div>

            <label className="flex flex-col gap-1.5 text-[13px] text-[var(--color-bv-muted)]">
              Your name (optional)
              <input
                name="customerName"
                type="text"
                autoComplete="name"
                maxLength={120}
                disabled={pending}
                className="rounded-[10px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3 py-2.5 text-[14px] text-[var(--color-bv-text)] outline-none focus:ring-2 focus:ring-[var(--color-bv-accent)]/35"
              />
            </label>

            <label className="flex flex-col gap-1.5 text-[13px] text-[var(--color-bv-muted)]">
              Note for our team (optional)
              <textarea
                name="customerNote"
                rows={4}
                maxLength={2000}
                disabled={pending}
                className="rounded-[10px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3 py-2.5 text-[14px] text-[var(--color-bv-text)] outline-none focus:ring-2 focus:ring-[var(--color-bv-accent)]/35"
              />
            </label>

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <button
                type="submit"
                name="intent"
                value="accept"
                disabled={pending}
                className="inline-flex flex-1 items-center justify-center rounded-[10px] bg-emerald-600 px-5 py-3 text-[14px] font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-55 sm:min-w-[180px]"
              >
                Accept quote
              </button>
              <button
                type="submit"
                name="intent"
                value="decline"
                disabled={pending}
                className="inline-flex flex-1 items-center justify-center rounded-[10px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-5 py-3 text-[14px] font-semibold text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)] disabled:opacity-55 sm:min-w-[180px]"
              >
                Decline quote
              </button>
            </div>
          </form>
        ) : null}
      </section>
    </div>
  );
}
