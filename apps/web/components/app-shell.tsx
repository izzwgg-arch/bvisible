import type { ReactNode } from 'react';
import { Brand } from './brand';
import { NavLinks, type NavItem } from './app/nav-links';
import { UserMenu } from './app/user-menu';
import { Role } from '@bvisible/db';

const BASE_NAV: ReadonlyArray<NavItem> = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/estimates', label: 'Estimates' },
  { href: '/purchase-orders', label: 'Purchase orders' },
  { href: '/invoices', label: 'Invoices' },
  { href: '/clients', label: 'Clients' },
  { href: '/vendors', label: 'Vendors' },
  { href: '/items', label: 'Items' },
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
    <div className="grid min-h-screen grid-cols-[268px_1fr] bg-[var(--color-bv-bg)] print:block">
      <aside className="flex flex-col border-r border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-4 py-6 shadow-[2px_0_24px_rgba(15,23,42,0.04)] print:hidden">
        <Brand className="px-2 pb-8" />
        <NavLinks sections={navSections} />
        <UserMenu
          email={user.email}
          name={user.name}
          workspaceLabel={workspaceTitle}
          roleLabel={roleLabel(user.role)}
        />
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="flex items-center justify-between border-b border-[var(--color-bv-border)] bg-[var(--color-bv-surface)]/95 px-8 py-4 backdrop-blur-sm print:hidden">
          <div className="flex flex-col gap-0.5">
            <span className="text-[15px] font-semibold tracking-tight text-[var(--color-bv-text)]">
              B Visible
            </span>
            <span className="text-[12.5px] text-[var(--color-bv-muted)]">{workspaceTitle}</span>
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
    <div className="mb-8 flex items-start justify-between gap-4">
      <div className="flex flex-col">
        <h1 className="text-[22px] font-semibold tracking-tight text-[var(--color-bv-text)]">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-[var(--color-bv-muted)]">
            {subtitle}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
