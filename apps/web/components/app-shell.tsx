import type { ReactNode } from 'react';
import { Brand } from './brand';
import { NavLinks, type NavItem } from './app/nav-links';
import { UserMenu } from './app/user-menu';
import { SidebarFrame } from './app/sidebar-frame';
import { AssistantDock } from './assistant/assistant-dock';
import { Role } from '@bvisible/db';

const BASE_NAV: ReadonlyArray<NavItem> = [
  { href: '/home', label: 'Home' },
  { href: '/dashboard', label: 'Overview' },
  { href: '/estimates', label: 'Estimates' },
  { href: '/purchase-orders', label: 'Purchase Orders' },
  { href: '/assistant', label: 'Assistant' },
  { href: '/clients', label: 'Customers' },
  { href: '/vendors', label: 'Vendors' },
  { href: '/items', label: 'Catalog' },
  { href: '/vehicles', label: 'Vehicles' },
  { href: '/reports', label: 'Reports' },
];

const ADMIN_NAV: ReadonlyArray<NavItem> = [
  { href: '/pricing-backend', label: 'Pricing backend' },
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
    <SidebarFrame
      brand={<Brand className="relative shrink-0 justify-center px-1 pb-3" />}
      nav={<NavLinks sections={navSections} />}
      userMenu={
        <UserMenu
          email={user.email}
          name={user.name}
          workspaceLabel={workspaceTitle}
          roleLabel={roleLabel(user.role)}
        />
      }
    >
      {children}
      <AssistantDock />
    </SidebarFrame>
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
    <div className="mb-6 flex min-w-0 flex-wrap items-start justify-between gap-4 min-[1500px]:mb-7">
      <div className="min-w-0 flex-1">
        <h1 className="break-words text-[clamp(1.75rem,3vw,2.125rem)] font-semibold tracking-[-0.04em] text-[var(--color-bv-text)]">
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-slate-500 min-[1500px]:text-[14px]">
            {subtitle}
          </p>
        ) : null}
      </div>
      {actions ? <div className="flex min-w-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
