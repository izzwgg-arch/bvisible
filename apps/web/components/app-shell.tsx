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
  { href: '/vehicles', label: 'Vehicles' },
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
    <div className="grid h-screen grid-cols-[292px_1fr] overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(242,135,68,0.18)_0,transparent_31%),radial-gradient(circle_at_top_right,rgba(18,64,100,0.14)_0,transparent_28%),linear-gradient(135deg,#fffaf4_0%,#f8f4ef_44%,#f6efe8_100%)] print:block print:h-auto print:overflow-visible">
      <aside className="relative flex h-screen flex-col overflow-hidden border-r border-[#eadfd3]/90 bg-[#fff8f0]/92 px-4 py-5 shadow-[18px_0_54px_rgba(28,73,114,0.10)] backdrop-blur-2xl [--color-bv-bg:#f8f4ef] [--color-bv-border:#eadfd3] [--color-bv-muted:#6d7480] [--color-bv-surface:#fffdfa] [--color-bv-text:#1C4972] print:hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute -left-28 top-0 h-64 w-64 rounded-full bg-[#d8e8f3]/75 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-20 right-[-7rem] h-72 w-72 rounded-full bg-[#F28744]/16 blur-3xl"
        />
        <Brand className="relative shrink-0 justify-center px-1 pb-7" />
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
        <h1 className="text-[34px] font-semibold tracking-[-0.04em] text-[var(--color-bv-text)]">
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
