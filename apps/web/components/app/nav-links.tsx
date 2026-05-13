'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

export interface NavItem {
  href: string;
  label: string;
  hint?: string;
}

export function NavLinks({ items }: { items: ReadonlyArray<NavItem> }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Primary" className="flex flex-1 flex-col gap-0.5">
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href as never}
            className={cn(
              'flex items-center justify-between rounded-[10px] px-3 py-2 text-[13.5px] font-medium transition-colors',
              active
                ? 'bg-[var(--color-bv-accent)]/10 text-[var(--color-bv-accent)]'
                : 'text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]'
            )}
          >
            <span>{item.label}</span>
            {item.hint ? (
              <span className="text-[11px] uppercase tracking-wider text-[var(--color-bv-muted)]">
                {item.hint}
              </span>
            ) : null}
          </Link>
        );
      })}
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
