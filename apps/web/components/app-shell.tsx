import type { ReactNode } from 'react';
import { Brand } from './brand';
import { NavLinks, type NavItem } from './app/nav-links';
import { UserMenu } from './app/user-menu';
import { Role } from '@bvisible/db';

const BASE_NAV: ReadonlyArray<NavItem> = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/estimates', label: 'Estimates' },
  { href: '/purchase-orders', label: 'Purchase Orders' },
  { href: '/invoices', label: 'Invoices' },
  { href: '/clients', label: 'Customers' },
  { href: '/vendors', label: 'Vendors' },
  { href: '/items', label: 'Catalog' },
  { href: '/reports', label: 'Reports' },
];

const ADMIN_NAV: ReadonlyArray<NavItem> = [
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/email-ingestion', label: 'Email ingestion' },
  { href: '/admin/ocr-review', label: 'Receipt OCR' },
  { href: '/admin/reconciliation', label: 'PO reconciliation' },
];

const SUPER_ADMIN_NAV: ReadonlyArray<NavItem> = [
  { href: '/admin/tenants', label: 'Company settings' },
  { href: '/admin/email-ingestion/inboxes', label: 'Inboxes' },
  { href: '/settings/email-test', label: 'Email test' },
];

function sectionsForRole(role: Role) {
  const workspace = [{ label: 'Workspace', items: BASE_NAV }] as const;
  if (role === Role.SUPER_ADMIN) {
    return [
      ...workspace,
      {
        label: 'Administration',
        items: [...ADMIN_NAV, ...SUPER_ADMIN_NAV],
      },
    ];
  }
  if (role === Role.ADMIN) {
    return [...workspace, { label: 'Administration', items: [...ADMIN_NAV] }];
  }
  return [...workspace];
}

function workspaceHeaderLabel(role: Role, workspaceName: string | null): string {
  if (role === Role.SUPER_ADMIN && !workspaceName) return 'Select workspace';
  return workspaceName ?? 'Workspace';
}

function roleLabel(role: Role): string {
  switch (role) {
    case Role.SUPER_ADMIN:
      return 'Super admin';
    case Role.ADMIN:
      return 'Admin';
    case Role.USER:
      return 'User';
  }
}

export function AppShell({
  children,
  user,
}: {
  children: ReactNode;
  user: {
    email: string;
    name: string | null;
    role: Role;
    tenant: { name: string } | null;
  };
}) {
  const navSections = sectionsForRole(user.role);
  const workspaceTitle = workspaceHeaderLabel(user.role, user.tenant?.name ?? null);

  return (
    <div className="grid h-screen grid-cols-[292px_1fr] overflow-hidden bg-[radial-gradient(circle_at_top_left,#dbeafe_0,transparent_32%),radial-gradient(circle_at_top_right,#ccfbf1_0,transparent_26%),linear-gradient(135deg,#f8fafc_0%,#eef4ff_46%,#f9fafb_100%)] print:block print:h-auto print:overflow-visible">
      <aside className="relative flex h-screen flex-col overflow-hidden border-r border-white/80 bg-white/[0.76] px-4 py-5 shadow-[12px_0_44px_rgba(15,23,42,0.08)] backdrop-blur-2xl [--color-bv-bg:#f8fafc] [--color-bv-border:#e2e8f0] [--color-bv-muted:#64748b] [--color-bv-surface:#ffffff] [--color-bv-text:#0f172a] print:hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute -left-28 top-0 h-64 w-64 rounded-full bg-blue-200/60 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-20 right-[-7rem] h-72 w-72 rounded-full bg-cyan-100/80 blur-3xl"
        />
        <Brand className="relative shrink-0 px-2 pb-7" />
        <NavLinks sections={navSections} />
        <div className="relative">
          <UserMenu
            email={user.email}
            name={user.name}
            workspaceLabel={workspaceTitle}
            roleLabel={roleLabel(user.role)}
          />
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-col overflow-y-auto">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-white/70 bg-white/[0.72] px-8 py-4 shadow-[0_16px_42px_rgba(15,23,42,0.06)] backdrop-blur-xl print:hidden">
          <div className="flex min-w-0 items-center gap-3">
            <div
              aria-hidden
              className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_0_6px_rgba(52,211,153,0.16)]"
            />
            <div className="min-w-0">
              <span className="block truncate text-[14px] font-semibold tracking-tight text-slate-950">
                {workspaceTitle}
              </span>
              <span className="text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">
                Command workspace
              </span>
            </div>
          </div>
          <div className="rounded-full border border-slate-200 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 shadow-sm">
            Live
          </div>
        </header>
        <main className="flex-1 px-8 py-8 print:px-0 print:py-0">{children}</main>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-7 flex items-start justify-between gap-4">
      <div className="flex flex-col">
        <h1 className="text-[34px] font-semibold tracking-[-0.04em] text-slate-950">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-slate-500">
            {subtitle}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
