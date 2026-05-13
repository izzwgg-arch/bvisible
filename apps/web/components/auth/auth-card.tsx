import type { ReactNode } from 'react';
import { Brand } from '../brand';

// Centered card layout used by login / forgot / reset / invite pages.
// Kept small and visual rules consistent with the rest of the SaaS shell.
export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="grid min-h-screen place-items-center bg-[var(--color-bv-bg)] px-4 py-8">
      <div className="w-full max-w-[420px]">
        <div className="mb-6 flex justify-center">
          <Brand />
        </div>
        <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-6 shadow-[var(--shadow-bv-card)]">
          <h1 className="text-[18px] font-semibold tracking-tight text-[var(--color-bv-text)]">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-1 text-[13.5px] leading-relaxed text-[var(--color-bv-muted)]">
              {subtitle}
            </p>
          ) : null}
          <div className="mt-5 flex flex-col gap-4">{children}</div>
        </section>
        {footer ? (
          <div className="mt-4 text-center text-[13px] text-[var(--color-bv-muted)]">
            {footer}
          </div>
        ) : null}
      </div>
    </main>
  );
}
