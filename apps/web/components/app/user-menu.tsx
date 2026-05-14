import { logoutAction } from '@/app/(app)/settings/actions';
import Link from 'next/link';

export function UserMenu({
  email,
  name,
  workspaceLabel,
  roleLabel,
}: {
  email: string;
  name: string | null;
  workspaceLabel: string;
  roleLabel: string;
}) {
  const initials = displayInitials(name, email);

  return (
    <div className="mt-auto rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] p-3 shadow-[var(--shadow-bv-card)]">
      <div className="flex items-start gap-3">
        <div
          aria-hidden
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-bv-accent)]/14 text-[13px] font-semibold text-[var(--color-bv-accent)]"
        >
          {initials}
        </div>
        <div className="min-w-0 flex-1 leading-snug">
          <span className="block truncate text-[13px] font-medium text-[var(--color-bv-text)]">
            {name || email}
          </span>
          <span className="mt-0.5 block text-[11.5px] text-[var(--color-bv-muted)]">
            {workspaceLabel}
          </span>
          <span className="mt-1 inline-flex rounded-full border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-bv-muted)]">
            {roleLabel}
          </span>
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <Link
          href="/settings"
          className="inline-flex flex-1 items-center justify-center rounded-[10px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3 py-2 text-[12.5px] font-medium text-[var(--color-bv-text)] transition-colors hover:bg-[var(--color-bv-bg)]"
        >
          Settings
        </Link>
        <form action={logoutAction} className="flex-1">
          <button
            type="submit"
            className="inline-flex w-full items-center justify-center rounded-[10px] bg-[var(--color-bv-text)] px-3 py-2 text-[12.5px] font-medium text-white transition-opacity hover:opacity-90"
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}

function displayInitials(name: string | null, email: string): string {
  const src = (name || email).trim();
  if (!src) return '?';
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
  }
  return src.slice(0, 2).toUpperCase();
}
