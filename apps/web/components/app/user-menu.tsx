import { logoutAction } from '@/app/(app)/settings/actions';
import Link from 'next/link';

// Server component (no 'use client'). Renders the user/tenant label and a
// real <form> posting to logoutAction — no JS needed for sign-out.
export function UserMenu({
  email,
  name,
  tenantLabel,
  roleLabel,
}: {
  email: string;
  name: string | null;
  tenantLabel: string;
  roleLabel: string;
}) {
  return (
    <div className="mt-auto rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] p-3">
      <div className="flex flex-col gap-0.5 text-[12.5px] leading-snug">
        <span className="font-medium text-[var(--color-bv-text)]">
          {name || email}
        </span>
        <span className="text-[11.5px] text-[var(--color-bv-muted)]">
          {tenantLabel} · {roleLabel}
        </span>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Link
          href="/settings"
          className="inline-flex items-center rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-2.5 py-1 text-[12px] font-medium text-[var(--color-bv-text)] transition-colors hover:bg-[var(--color-bv-bg)]"
        >
          Settings
        </Link>
        <form action={logoutAction} className="inline">
          <button
            type="submit"
            className="inline-flex items-center rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-2.5 py-1 text-[12px] font-medium text-[var(--color-bv-text)] transition-colors hover:bg-[var(--color-bv-bg)]"
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
