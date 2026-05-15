'use client';

import Link from 'next/link';
import { Role } from '@bvisible/db';
import type { OnboardingChecklistState } from '@/lib/onboarding/checklist-data';
import { dismissOnboardingChecklistAction } from '@/lib/onboarding/dismiss-action';

export function OnboardingChecklistCard({
  state,
  role,
}: {
  state: OnboardingChecklistState;
  role: Role;
}) {
  const pct = Math.round((state.completedCount / state.totalSteps) * 100);
  const inboxHref =
    role === Role.SUPER_ADMIN
      ? '/admin/email-ingestion/inboxes'
      : '/admin/email-ingestion';

  const steps: {
    id: string;
    label: string;
    done: boolean;
    href: string;
    hint?: string;
    muted?: boolean;
  }[] = [
    {
      id: 'client',
      label: 'Create first client',
      done: state.hasClient,
      href: '/clients/new',
    },
    {
      id: 'vendor',
      label: 'Add first vendor',
      done: state.hasVendor,
      href: '/vendors/new',
    },
    {
      id: 'inbox',
      label: 'Configure email inbox',
      done: state.inboxConfigured,
      href: inboxHref,
      muted: state.inboxStepForOperatorsOnly,
      hint: state.inboxStepForOperatorsOnly
        ? 'Ask an admin to connect IMAP — operators cannot edit inbox credentials.'
        : undefined,
    },
    {
      id: 'estimate',
      label: 'Create first estimate',
      done: state.hasEstimate,
      href: '/estimates/new',
      hint: !state.hasClient ? 'Add a client before creating an estimate.' : undefined,
    },
    {
      id: 'po',
      label: 'Create first purchase order',
      done: state.hasPo,
      href: '/purchase-orders/new',
      hint: !state.hasVendor ? 'Add a vendor before placing orders.' : undefined,
    },
    {
      id: 'receipt',
      label: 'Upload first receipt or invoice',
      done: state.hasReceiptOrInvoiceUpload,
      href: '/purchase-orders',
      hint: 'Attach a receipt or invoice PDF on any PO — drives OCR and reconciliation.',
    },
  ];

  const allDone = state.completedCount >= state.totalSteps;

  return (
    <section className="mb-10 rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-6 shadow-[var(--shadow-bv-card)]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-[16px] font-semibold tracking-tight text-[var(--color-bv-text)]">
            {allDone ? 'Workspace setup complete' : 'Get your workspace operational'}
          </h2>
          <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-[var(--color-bv-muted)]">
            {allDone
              ? 'Core objects and ingestion paths are in place — keep estimates, POs, and receipts flowing through the normal pipeline.'
              : 'Complete these steps once — progress reflects live data (nothing is simulated).'}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className="text-[13px] font-semibold tabular-nums text-[var(--color-bv-text)]">
            {state.completedCount}/{state.totalSteps}
          </span>
          <div className="h-2 w-36 overflow-hidden rounded-full bg-[var(--color-bv-bg)]">
            <div
              className="h-full rounded-full bg-[var(--color-bv-accent)] transition-[width]"
              style={{ width: `${pct}%` }}
            />
          </div>
          <form action={dismissOnboardingChecklistAction}>
            <button
              type="submit"
              className="text-[12.5px] font-medium text-[var(--color-bv-muted)] underline-offset-2 hover:text-[var(--color-bv-text)] hover:underline"
            >
              Dismiss checklist
            </button>
          </form>
        </div>
      </div>

      <ul className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {steps.map((s) => (
          <li
            key={s.id}
            className={`rounded-[10px] border px-4 py-3 text-[13px] ${
              s.done
                ? 'border-emerald-200 bg-emerald-50/60'
                : 'border-[var(--color-bv-border)] bg-[var(--color-bv-bg)]'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="font-medium text-[var(--color-bv-text)]">{s.label}</span>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                  s.done ? 'bg-emerald-600 text-white' : 'bg-[var(--color-bv-surface)] text-[var(--color-bv-muted)]'
                }`}
              >
                {s.done ? 'Done' : 'Open'}
              </span>
            </div>
            {s.hint ? (
              <p className={`mt-2 text-[12px] leading-snug ${s.muted ? 'text-[var(--color-bv-muted)]' : 'text-amber-900/90'}`}>
                {s.hint}
              </p>
            ) : null}
            {!s.done ? (
              <Link
                href={s.href as never}
                className="mt-3 inline-flex text-[12.5px] font-medium text-[var(--color-bv-accent)] underline-offset-2 hover:underline"
              >
                Go →
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
