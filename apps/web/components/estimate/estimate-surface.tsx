import type { ReactNode, SVGProps } from 'react';

/**
 * Shared presentational primitives for the estimate editor surfaces.
 * These are purely visual — no business logic lives here. They keep the
 * 2026 SaaS look consistent across the line grid, catalog, pricing helper,
 * totals rail and workflow strip without duplicating Tailwind soup.
 */

export function SectionCard({
  children,
  className = '',
  as: Tag = 'section',
  id,
}: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'aside' | 'div';
  id?: string;
}) {
  return (
    <Tag
      id={id}
      className={`rounded-[10px] border border-slate-200 bg-white shadow-sm ${className}`}
    >
      {children}
    </Tag>
  );
}

export function SectionHeading({
  icon,
  title,
  subtitle,
  badge,
  action,
  tone = 'blue',
}: {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  badge?: ReactNode;
  action?: ReactNode;
  tone?: 'blue' | 'emerald' | 'violet' | 'amber' | 'slate';
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        {icon ? <IconBadge tone={tone}>{icon}</IconBadge> : null}
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[12px] font-black uppercase tracking-[0.08em] text-slate-950">{title}</h2>
            {badge}
          </div>
          {subtitle ? (
            <p className="mt-0.5 max-w-xl text-[10.5px] leading-relaxed text-slate-500">{subtitle}</p>
          ) : null}
        </div>
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  );
}

const TONE_BADGE: Record<string, string> = {
  blue: 'from-blue-500/15 to-indigo-500/15 text-blue-600 ring-blue-500/20',
  emerald: 'from-emerald-500/15 to-teal-500/15 text-emerald-600 ring-emerald-500/20',
  violet: 'from-violet-500/15 to-fuchsia-500/15 text-violet-600 ring-violet-500/20',
  amber: 'from-amber-500/15 to-orange-500/15 text-amber-600 ring-amber-500/20',
  slate: 'from-slate-500/10 to-slate-400/10 text-slate-600 ring-slate-400/20',
};

export function IconBadge({
  children,
  tone = 'blue',
}: {
  children: ReactNode;
  tone?: 'blue' | 'emerald' | 'violet' | 'amber' | 'slate';
}) {
  return (
    <span
      aria-hidden
      className={`grid h-7 w-7 shrink-0 place-items-center rounded-[7px] bg-gradient-to-br ring-1 ring-inset ${TONE_BADGE[tone] ?? TONE_BADGE.blue}`}
    >
      {children}
    </span>
  );
}

export function EyebrowLabel({ children }: { children: ReactNode }) {
  return (
    <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-400">
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------
// Inline icons (no icon dependency in this workspace).
// ---------------------------------------------------------------------

function Icon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    />
  );
}

export function IconRows(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M3 14h18M9 4v16" />
    </Icon>
  );
}

export function IconCatalog(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4 4h10a2 2 0 0 1 2 2v14l-7-3-7 3V6a2 2 0 0 1 2-2Z" />
      <path d="M20 4v13" />
    </Icon>
  );
}

export function IconCalculator(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <rect x="4" y="2" width="16" height="20" rx="2" />
      <path d="M8 6h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h4" />
    </Icon>
  );
}

export function IconDoc(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </Icon>
  );
}

export function IconReceipt(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M5 3v18l2-1 2 1 2-1 2 1 2-1 2 1V3l-2 1-2-1-2 1-2-1-2 1Z" />
      <path d="M9 8h6M9 12h6" />
    </Icon>
  );
}

export function IconTruck(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M3 6h11v9H3zM14 9h4l3 3v3h-7z" />
      <circle cx="7" cy="18" r="1.6" />
      <circle cx="17" cy="18" r="1.6" />
    </Icon>
  );
}

export function IconFlag(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M5 21V4M5 4h12l-2 4 2 4H5" />
    </Icon>
  );
}

export function IconCheck(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M20 6 9 17l-5-5" />
    </Icon>
  );
}

export function IconLink(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1" />
    </Icon>
  );
}

export function IconChat(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M21 12a8 8 0 0 1-11.3 7.3L3 21l1.7-6.7A8 8 0 1 1 21 12Z" />
    </Icon>
  );
}

export function IconClock(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Icon>
  );
}

export function IconArrowRight(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Icon>
  );
}
