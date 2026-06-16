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
    <nav aria-label="Primary" className="relative flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto pr-1">
      {sections.map((sec, si) => (
        <div key={si}>
          {sec.label ? (
            <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--color-bv-muted)]">
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
                  className={cn(
                    'group relative flex items-center gap-3 rounded-[14px] border px-3 py-2.5 text-[13px] font-medium transition-all',
                    active
                      ? 'border-blue-100 bg-blue-50/90 text-blue-700 shadow-[0_12px_30px_rgba(37,99,235,0.10)]'
                      : 'border-transparent text-slate-600 hover:border-slate-200 hover:bg-white/80 hover:text-slate-950'
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'grid h-8 w-8 place-items-center rounded-[11px] transition-colors',
                      active
                        ? 'bg-blue-600 text-white shadow-[0_14px_28px_rgba(37,99,235,0.22)]'
                        : 'bg-slate-100 text-slate-500 group-hover:bg-blue-50 group-hover:text-blue-600',
                    )}
                  >
                    <NavIcon label={item.label} />
                  </span>
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
    case 'Dashboard':
      return (
        <svg {...common}>
          <path d="M4 13h6V4H4v9Z" />
          <path d="M14 20h6V4h-6v16Z" />
          <path d="M4 20h6v-3H4v3Z" />
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
    case 'Invoices':
      return (
        <svg {...common}>
          <path d="M7 3h10v18l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2V3Z" />
          <path d="M9 8h6" />
          <path d="M9 12h6" />
          <path d="M9 16h4" />
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
