import { requireUserForAppShell } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { Role } from '@bvisible/db';
import { VendorPriceAlerts } from './vendor-price-alerts';
import {
  ReconciliationSummaryCards,
  SpendOperationAlerts,
} from './reconciliation-widgets';

export const metadata = { title: 'Dashboard' };
export const dynamic = 'force-dynamic';

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await requireUserForAppShell();
  const { error } = await searchParams;

  return (
    <>
      <PageHeader
        title={greeting(user.name, user.email)}
        subtitle={`Company: ${user.tenant.name}`}
      />
      {error === 'forbidden' ? (
        <div className="mb-6 rounded-[var(--radius-bv)] border border-amber-200 bg-amber-50 px-4 py-3 text-[13.5px] text-amber-900">
          You don&apos;t have permission to view that page.
        </div>
      ) : null}
      {error === 'multi-company' ? (
        <div className="mb-6 rounded-[var(--radius-bv)] border border-red-200 bg-red-50 px-4 py-3 text-[13.5px] text-red-950">
          Multiple companies are configured in the database without a canonical{' '}
          <span className="font-mono">bvisible</span> slug. Resolve this in{' '}
          <strong>Company settings</strong> before continuing (single-company mode).
        </div>
      ) : null}
      {error === 'no-tenant' ? (
        <div className="mb-6 rounded-[var(--radius-bv)] border border-amber-200 bg-amber-50 px-4 py-3 text-[13.5px] text-amber-900">
          That page needs a company workspace. Open{' '}
          <strong>Company settings</strong> or contact an administrator.
        </div>
      ) : null}
      {user.tenantId ? (
        <VendorPriceAlerts tenantId={user.tenantId} />
      ) : null}
      {user.tenantId &&
      (user.role === Role.ADMIN || user.role === Role.SUPER_ADMIN) ? (
        <>
          <SpendOperationAlerts tenantId={user.tenantId} />
          <ReconciliationSummaryCards tenantId={user.tenantId} />
        </>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Account" body={`Signed in as ${user.email}`} mono={user.id} />
        <Card
          title="Role"
          body={prettyRole(user.role)}
          mono={`company: ${user.tenant.slug}`}
        />
        <Card
          title="Health"
          body="API at /api/health. Each deploy runs migrate-deploy, db-verify, and a healthcheck before going live."
          mono="GET /api/health"
        />
      </div>
    </>
  );
}

function greeting(name: string | null, email: string): string {
  const fallback = email.split('@')[0] ?? email;
  const who = (name || fallback).split(' ')[0] ?? fallback;
  const hour = new Date().getHours();
  const tod = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  return `Good ${tod}, ${who}.`;
}

function prettyRole(role: Role): string {
  switch (role) {
    case Role.SUPER_ADMIN:
      return 'Super admin';
    case Role.ADMIN:
      return 'Admin';
    case Role.USER:
      return 'User';
  }
}

function Card({
  title,
  body,
  mono,
}: {
  title: string;
  body: string;
  mono?: string;
}) {
  return (
    <article className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-5 shadow-[var(--shadow-bv-card)]">
      <h2 className="text-[15px] font-semibold tracking-tight text-[var(--color-bv-text)]">
        {title}
      </h2>
      <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--color-bv-muted)]">
        {body}
      </p>
      {mono ? (
        <div className="mt-4 inline-flex items-center rounded-md border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-2.5 py-1 font-mono text-[12px] text-[var(--color-bv-text)]">
          {mono}
        </div>
      ) : null}
    </article>
  );
}
