import Link from 'next/link';
import { prisma } from '@bvisible/db';
import { requireSuperAdmin } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { CreateTenantForm } from './create-tenant-form';

export const metadata = { title: 'Tenants' };
export const dynamic = 'force-dynamic';

export default async function AdminTenantsPage({
  searchParams,
}: {
  searchParams: Promise<{ created?: string }>;
}) {
  await requireSuperAdmin();
  const sp = await searchParams;

  const tenants = await prisma.tenant.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      slug: true,
      createdAt: true,
      _count: { select: { users: true } },
      emailInbox: { select: { enabled: true, lastErrorMessage: true } },
    },
    take: 200,
  });

  return (
    <>
      <PageHeader
        title="Tenants"
        subtitle="System-wide. Each tenant has its own users, data, and isolation boundary."
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] shadow-[var(--shadow-bv-card)]">
          <div className="border-b border-[var(--color-bv-border)] px-5 py-3">
            <h2 className="text-[15px] font-semibold tracking-tight text-[var(--color-bv-text)]">
              All tenants
            </h2>
            <p className="mt-0.5 text-[12.5px] text-[var(--color-bv-muted)]">
              {tenants.length} {tenants.length === 1 ? 'tenant' : 'tenants'}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[var(--color-bv-border)] text-left text-[11.5px] uppercase tracking-wider text-[var(--color-bv-muted)]">
                  <th className="px-5 py-2 font-medium">Name</th>
                  <th className="px-5 py-2 font-medium">Slug</th>
                  <th className="px-5 py-2 font-medium">Users</th>
                  <th className="px-5 py-2 font-medium">Inbox</th>
                  <th className="px-5 py-2 font-medium">Created</th>
                  <th className="px-5 py-2 font-medium" />
                </tr>
              </thead>
              <tbody>
                {tenants.map((t) => {
                  const inboxLabel = !t.emailInbox
                    ? 'not configured'
                    : !t.emailInbox.enabled
                      ? 'disabled'
                      : t.emailInbox.lastErrorMessage
                        ? 'errored'
                        : 'healthy';
                  const inboxCls = !t.emailInbox
                    ? 'border-slate-200 bg-slate-50 text-slate-500'
                    : !t.emailInbox.enabled
                      ? 'border-slate-200 bg-slate-50 text-slate-600'
                      : t.emailInbox.lastErrorMessage
                        ? 'border-amber-200 bg-amber-50 text-amber-800'
                        : 'border-emerald-200 bg-emerald-50 text-emerald-700';
                  return (
                    <tr key={t.id} className="border-b border-[var(--color-bv-border)] last:border-b-0">
                      <td className="px-5 py-2.5 text-[var(--color-bv-text)]">{t.name}</td>
                      <td className="px-5 py-2.5 font-mono text-[12px] text-[var(--color-bv-muted)]">
                        {t.slug}
                      </td>
                      <td className="px-5 py-2.5 text-[var(--color-bv-muted)]">
                        {t._count.users}
                      </td>
                      <td className="px-5 py-2.5">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${inboxCls}`}
                        >
                          {inboxLabel}
                        </span>
                      </td>
                      <td className="px-5 py-2.5 text-[var(--color-bv-muted)]">
                        {t.createdAt.toISOString().slice(0, 10)}
                      </td>
                      <td className="px-5 py-2.5 text-right">
                        <Link
                          href={`/admin/tenants/${t.id}/email-inbox`}
                          className="inline-flex items-center justify-center rounded-[6px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-2.5 py-1 text-[12px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-surface)]"
                        >
                          Email inbox
                        </Link>
                      </td>
                    </tr>
                  );
                })}
                {tenants.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-[var(--color-bv-muted)]">
                      No tenants yet. Create one from the right.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-5 shadow-[var(--shadow-bv-card)]">
          <h2 className="text-[15px] font-semibold tracking-tight text-[var(--color-bv-text)]">
            Create a tenant
          </h2>
          <p className="mt-1 text-[12.5px] text-[var(--color-bv-muted)]">
            After creating, invite the tenant&apos;s admin via the Users page.
          </p>
          <div className="mt-4">
            <CreateTenantForm />
          </div>
          {sp.created ? (
            <div className="mt-4 rounded-[8px] border border-emerald-200 bg-emerald-50 p-3 text-[12.5px] text-emerald-900">
              Tenant <span className="font-mono">{sp.created}</span> created.
            </div>
          ) : null}
        </section>
      </div>
    </>
  );
}
