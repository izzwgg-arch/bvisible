import Link from 'next/link';
import type { ReactNode } from 'react';

export function EmptyState({
  title,
  description,
  primaryAction,
  secondaryAction,
  children,
}: {
  title: string;
  description: ReactNode;
  primaryAction?: { label: string; href: string };
  secondaryAction?: { label: string; href: string };
  children?: ReactNode;
}) {
  return (
    <div className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-8 py-12 text-center shadow-[var(--shadow-bv-card)]">
      <h2 className="text-[16px] font-semibold tracking-tight text-[var(--color-bv-text)]">
        {title}
      </h2>
      <div className="mx-auto mt-2 max-w-md text-[13.5px] leading-relaxed text-[var(--color-bv-muted)]">
        {description}
      </div>
      {children ? <div className="mt-6">{children}</div> : null}
      {(primaryAction ?? secondaryAction) ? (
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {primaryAction ? (
            <Link
              href={primaryAction.href as never}
              className="inline-flex items-center justify-center rounded-[10px] bg-[var(--color-bv-accent)] px-4 py-2.5 text-[13.5px] font-medium text-[var(--color-bv-accent-foreground)] shadow-[var(--shadow-bv-card)] transition-colors hover:opacity-92"
            >
              {primaryAction.label}
            </Link>
          ) : null}
          {secondaryAction ? (
            <Link
              href={secondaryAction.href as never}
              className="inline-flex items-center justify-center rounded-[10px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-4 py-2.5 text-[13.5px] font-medium text-[var(--color-bv-text)] transition-colors hover:bg-[var(--color-bv-surface)]"
            >
              {secondaryAction.label}
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
