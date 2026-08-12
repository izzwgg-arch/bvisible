'use client';

import { useEffect, useMemo } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
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
  const router = useRouter();
  const prefetchHrefs = useMemo(
    () => Array.from(new Set(sections.flatMap((sec) => sec.items.map((item) => item.href)))),
    [sections],
  );

  useEffect(() => {
    let cancelled = false;
    const timeoutIds: Array<ReturnType<typeof setTimeout>> = [];

    const warmRoutes = () => {
      prefetchHrefs.forEach((href, index) => {
        const timeoutId = setTimeout(() => {
          if (!cancelled && href !== pathname) {
            router.prefetch(href);
          }
        }, index * 75);
        timeoutIds.push(timeoutId);
      });
    };

    const idleId = window.requestIdleCallback
      ? window.requestIdleCallback(warmRoutes, { timeout: 1200 })
      : null;
    const fallbackId = idleId === null ? setTimeout(warmRoutes, 250) : null;

    return () => {
      cancelled = true;
      if (idleId !== null) window.cancelIdleCallback(idleId);
      if (fallbackId !== null) clearTimeout(fallbackId);
      timeoutIds.forEach(clearTimeout);
    };
  }, [pathname, prefetchHrefs, router]);

  return (
    <nav aria-label="Primary" className="relative flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto pr-1">
      {sections.map((sec, si) => (
        <div key={si}>
          {sec.label ? (
            <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--color-bv-muted)] group-data-[collapsed]:hidden">
              {sec.label}
            </p>
          ) : null}
          <div className="flex flex-col gap-1">
            {sec.items.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href as never}
                  prefetch
                  title={item.label}
                  onFocus={() => router.prefetch(item.href)}
                  onMouseEnter={() => router.prefetch(item.href)}
                  className={cn(
                    'group/link relative flex items-center gap-3 rounded-[14px] border px-3 py-2.5 text-[13px] font-medium transition-all group-data-[collapsed]:justify-center group-data-[collapsed]:px-1.5',
                    active
                      ? 'border-[#F28744]/28 bg-[#fff0e5] text-[#1C4972] shadow-[0_14px_34px_rgba(242,135,68,0.13)]'
                      : 'border-transparent text-[#53606d] hover:border-[#eadfd3] hover:bg-white/80 hover:text-[#1C4972]'
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'grid h-8 w-8 shrink-0 place-items-center rounded-[11px] transition-colors',
                      active
                        ? 'bg-[#F28744] text-white shadow-[0_14px_28px_rgba(242,135,68,0.30)]'
                        : 'bg-[#eef3f7] text-[#6f8799] group-hover/link:bg-[#fff0e5] group-hover/link:text-[#F28744]',
                    )}
                  >
                    <NavIcon label={item.label} />
                  </span>
                  <span className="group-data-[collapsed]:hidden">{item.label}</span>
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

function NavIcon({ label }: { label: string }) {
  const common = {
    className: 'h-4 w-4',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.9,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    viewBox: '0 0 24 24',
  };

  switch (label) {
    case 'Home':
      return (
        <svg {...common}>
          <path d="M3 11.5 12 4l9 7.5" />
          <path d="M5 10v10h14V10" />
          <path d="M10 20v-6h4v6" />
        </svg>
      );
    case 'Dashboard':
    case 'Overview':
      return (
        <svg {...common}>
          <path d="M4 13h6V4H4v9Z" />
          <path d="M14 20h6V4h-6v16Z" />
          <path d="M4 20h6v-3H4v3Z" />
        </svg>
      );
    case 'Assistant':
      return (
        <svg {...common}>
          <path d="M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4L12 3Z" />
          <path d="M18.5 14.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1Z" />
        </svg>
      );
    case 'Pricing backend':
      return (
        <svg {...common}>
          <path d="M12 2v20" />
          <path d="M16.5 6.5a4 4 0 0 0-4.5-2 3.4 3.4 0 0 0-3 3.3c0 1.8 1.4 2.6 3.6 3.2 2.6.7 4.4 1.5 4.4 3.7a3.7 3.7 0 0 1-3.9 3.5 4.6 4.6 0 0 1-4.6-2.4" />
        </svg>
      );
    case 'Estimates':
      return (
        <svg {...common}>
          <path d="M7 3h7l4 4v14H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" />
          <path d="M14 3v5h5" />
          <path d="M8 13h8" />
          <path d="M8 17h5" />
        </svg>
      );
    case 'Purchase orders':
    case 'Purchase Orders':
      return (
        <svg {...common}>
          <path d="M6 7h12" />
          <path d="M6 12h12" />
          <path d="M6 17h8" />
          <path d="M4 4h16v16H4V4Z" />
        </svg>
      );
    case 'Clients':
    case 'Customers':
      return (
        <svg {...common}>
          <path d="M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
          <path d="M8 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
          <path d="M3 21a5 5 0 0 1 10 0" />
          <path d="M13 18a5 5 0 0 1 8 3" />
        </svg>
      );
    case 'Vendors':
      return (
        <svg {...common}>
          <path d="M1 3h15v13H1z" />
          <path d="M16 8h4l3 3v5h-7V8Z" />
          <circle cx="5.5" cy="18.5" r="2.5" />
          <circle cx="18.5" cy="18.5" r="2.5" />
        </svg>
      );
    case 'Reports':
      return (
        <svg {...common}>
          <path d="M4 10h16" />
          <path d="M5 10l1-5h12l1 5" />
          <path d="M6 10v10h12V10" />
          <path d="M9 20v-5h6v5" />
        </svg>
      );
    case 'Items':
    case 'Catalog':
      return (
        <svg {...common}>
          <path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
          <path d="m4.5 7.5 7.5 4.3 7.5-4.3" />
          <path d="M12 12v9" />
        </svg>
      );
    case 'Vehicles':
      return (
        <svg {...common}>
          <path d="M4 13h2l2.5-5h7l2.5 5h2v4H4v-4Z" />
          <circle cx="8" cy="17" r="2" />
          <circle cx="16" cy="17" r="2" />
          <path d="M9 8h6" />
        </svg>
      );
    case 'Users':
      return (
        <svg {...common}>
          <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
          <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
        </svg>
      );
    case 'Email ingestion':
      return (
        <svg {...common}>
          <path d="M4 6h16v12H4V6Z" />
          <path d="m4 7 8 6 8-6" />
        </svg>
      );
    case 'Receipt OCR':
      return (
        <svg {...common}>
          <path d="M7 3h10v18l-2-1-2 1-2-1-2 1-2-1V3Z" />
          <path d="M9 8h6" />
          <path d="M9 12h6" />
          <path d="M9 16h3" />
        </svg>
      );
    case 'PO reconciliation':
      return (
        <svg {...common}>
          <path d="M4 7h11" />
          <path d="m12 4 3 3-3 3" />
          <path d="M20 17H9" />
          <path d="m12 14-3 3 3 3" />
        </svg>
      );
    case 'Company settings':
      return (
        <svg {...common}>
          <path d="M4 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16" />
          <path d="M8 7h2" />
          <path d="M14 7h2" />
          <path d="M8 11h2" />
          <path d="M14 11h2" />
          <path d="M10 21v-5h4v5" />
        </svg>
      );
    case 'Inboxes':
      return (
        <svg {...common}>
          <path d="M4 4h16v10h-4l-2 3h-4l-2-3H4V4Z" />
          <path d="M4 14v6h16v-6" />
        </svg>
      );
    case 'Email test':
      return (
        <svg {...common}>
          <path d="M4 6h16v12H4V6Z" />
          <path d="m4 7 8 6 8-6" />
          <path d="M16 3v4" />
          <path d="M14 5h4" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <path d="M5 12h14" />
          <path d="M12 5v14" />
        </svg>
      );
  }
}
