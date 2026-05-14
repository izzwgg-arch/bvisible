'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

export interface NavItem {
  href: string;
  label: string;
}

export interface NavSection {
  label?: string;
  items: ReadonlyArray<NavItem>;
}

export function NavLinks({ sections }: { sections: ReadonlyArray<NavSection> }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="flex flex-1 flex-col gap-5 overflow-y-auto pr-1">
      {sections.map((sec, si) => (
        <div key={si}>
          {sec.label ? (
            <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--color-bv-muted)]">
              {sec.label}
            </p>
          ) : null}
          <div className="flex flex-col gap-0.5">
            {sec.items.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href as never}
                  className={cn(
                    'rounded-[10px] px-3 py-2 text-[13.5px] font-medium transition-colors',
                    active
                      ? 'border border-[var(--color-bv-accent)]/25 bg-[var(--color-bv-accent)]/12 text-[var(--color-bv-accent)] shadow-[var(--shadow-bv-card)]'
                      : 'border border-transparent text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]'
                  )}
                >
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === '/dashboard') {
    return pathname === '/dashboard' || pathname === '/';
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
