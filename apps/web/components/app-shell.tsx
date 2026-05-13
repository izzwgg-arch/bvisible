import type { ReactNode } from 'react';
import { Brand } from './brand';
import { cn } from '@/lib/cn';

const NAV_ITEMS: ReadonlyArray<{ label: string; hint: string }> = [
  { label: 'Dashboard', hint: 'overview' },
  { label: 'Clients', hint: 'directory' },
  { label: 'Estimates', hint: 'pipeline' },
  { label: 'Purchase Orders', hint: 'master file' },
  { label: 'Vendors', hint: 'pricing' },
  { label: 'Notifications', hint: 'manual review' },
];

export function AppShell({
  children,
  pageTitle,
  pageSubtitle,
}: {
  children: ReactNode;
  pageTitle: string;
  pageSubtitle?: string;
}) {
  return (
    <div className="grid min-h-screen grid-cols-[240px_1fr] bg-[var(--color-bv-bg)]">
      <aside className="flex flex-col border-r border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-4 py-5">
        <Brand className="px-2 pb-6" />
        <nav aria-label="Primary" className="flex flex-1 flex-col gap-0.5">
          {NAV_ITEMS.map((item, idx) => (
            <SidebarItem key={item.label} item={item} active={idx === 0} />
          ))}
        </nav>
        <div className="mt-auto rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] p-3 text-[12px] leading-snug text-[var(--color-bv-muted)]">
          Foundation build — features land in upcoming releases.
        </div>
      </aside>

      <div className="flex flex-col">
        <header className="flex items-center justify-between border-b border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-8 py-4">
          <div className="flex flex-col">
            <h1 className="text-lg font-semibold tracking-tight text-[var(--color-bv-text)]">
              {pageTitle}
            </h1>
            {pageSubtitle ? (
              <p className="text-sm text-[var(--color-bv-muted)]">
                {pageSubtitle}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-2 text-[12px] font-medium text-[var(--color-bv-muted)]">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-2.5 py-1">
              <span
                aria-hidden
                className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500"
              />
              healthy
            </span>
          </div>
        </header>
        <main className="flex-1 px-8 py-8">{children}</main>
      </div>
    </div>
  );
}

function SidebarItem({
  item,
  active,
}: {
  item: { label: string; hint: string };
  active?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between rounded-[10px] px-3 py-2 text-[13.5px] font-medium transition-colors',
        active
          ? 'bg-[var(--color-bv-accent)]/10 text-[var(--color-bv-accent)]'
          : 'text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]'
      )}
    >
      <span>{item.label}</span>
      <span className="text-[11px] uppercase tracking-wider text-[var(--color-bv-muted)]">
        {item.hint}
      </span>
    </div>
  );
}
