import type { ReactNode } from 'react';
import { Brand } from './brand';
import { NavLinks, type NavItem } from './app/nav-links';
import { UserMenu } from './app/user-menu';
import { Role } from '@bvisible/db';

const BASE_NAV: ReadonlyArray<NavItem> = [
  { href: '/dashboard', label: 'Dashboard', hint: 'overview' },
  { href: '/estimates', label: 'Estimates', hint: 'quotes' },
  { href: '/purchase-orders', label: 'Purchase orders', hint: 'spending' },
  { href: '/clients', label: 'Clients', hint: 'companies' },
  { href: '/vendors', label: 'Vendors', hint: 'suppliers' },
];

const ADMIN_NAV: ReadonlyArray<NavItem> = [
  { href: '/admin/users', label: 'Users', hint: 'invites' },
  { href: '/admin/email-ingestion', label: 'Email ingestion', hint: 'inbound' },
];

const SUPER_ADMIN_NAV: ReadonlyArray<NavItem> = [
  { href: '/admin/tenants', label: 'Tenants', hint: 'system' },
  { href: '/settings/email-test', label: 'Email test', hint: 'smtp' },
];

function navForRole(role: Role): ReadonlyArray<NavItem> {
  if (role === Role.SUPER_ADMIN) return [...BASE_NAV, ...ADMIN_NAV, ...SUPER_ADMIN_NAV];
  if (role === Role.ADMIN) return [...BASE_NAV, ...ADMIN_NAV];
  return BASE_NAV;
}

function tenantLabel(role: Role, tenantName: string | null): string {
  if (role === Role.SUPER_ADMIN && !tenantName) return 'System';
  return tenantName ?? 'No tenant';
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
  const nav = navForRole(user.role);
  return (
    <div className="grid min-h-screen grid-cols-[240px_1fr] bg-[var(--color-bv-bg)]">
      <aside className="flex flex-col border-r border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-4 py-5">
        <Brand className="px-2 pb-6" />
        <NavLinks items={nav} />
        <UserMenu
          email={user.email}
          name={user.name}
          tenantLabel={tenantLabel(user.role, user.tenant?.name ?? null)}
          roleLabel={roleLabel(user.role)}
        />
      </aside>

      <div className="flex flex-col">
        <header className="flex items-center justify-between border-b border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-8 py-4">
          <div className="flex flex-col">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--color-bv-muted)]">
              B Visible
            </span>
            <span className="text-[14px] font-medium text-[var(--color-bv-text)]">
              {tenantLabel(user.role, user.tenant?.name ?? null)}
            </span>
          </div>
          <div className="flex items-center gap-2 text-[12px] font-medium text-[var(--color-bv-muted)]">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-2.5 py-1">
              <span
                aria-hidden
                className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500"
              />
              healthy
            </span>
          </div>
        </header>
        <main className="flex-1 px-8 py-8">{children}</main>
      </div>
    </div>
  );
}

// Reusable per-page header used inside main content area. Keeps page
// titles inside the page itself (not the topbar).
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
    <div className="mb-6 flex items-start justify-between gap-4">
      <div className="flex flex-col">
        <h1 className="text-[20px] font-semibold tracking-tight text-[var(--color-bv-text)]">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1 text-[13.5px] text-[var(--color-bv-muted)]">
            {subtitle}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}
