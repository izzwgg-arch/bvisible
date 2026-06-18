import Link from 'next/link';
import { prisma } from '@bvisible/db';
import { requireSuperAdmin } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { AdminMetric, AdminPanel, AdminPill, adminSecondaryButtonClass } from '@/components/app/admin-ui';
import { CreateTenantForm } from './create-tenant-form';
import { TenantInvoiceProfileForm } from './tenant-invoice-profile-form';
import { getTenantInvoiceProfile } from '@/lib/company/tenant-invoice-profile';

export const metadata = { title: 'Company settings' };
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
  const configuredInboxes = tenants.filter((t) => t.emailInbox).length;
  const healthyInboxes = tenants.filter(
    (t) => t.emailInbox?.enabled && !t.emailInbox.lastErrorMessage
  ).length;
  const totalUsers = tenants.reduce((sum, t) => sum + t._count.users, 0);
  const invoiceProfileTenant = tenants.find((t) => t.slug === 'bvisible') ?? tenants[0] ?? null;
  const invoiceProfile = invoiceProfileTenant
    ? await getTenantInvoiceProfile(prisma, invoiceProfileTenant)
    : null;

  return (
    <>
      <PageHeader
        title="Company settings"
        subtitle="Super-admin control center for company workspaces, user coverage, and email inbox readiness."
      />

      <div className="grid gap-5">
        <section className="grid gap-3 md:grid-cols-4">
          <AdminMetric label="Companies" value={tenants.length} detail="Workspace records" />
          <AdminMetric label="Users" value={totalUsers} detail="Across all companies" tone="violet" />
          <AdminMetric label="Inboxes" value={configuredInboxes} detail="Configured IMAP sources" tone="amber" />
          <AdminMetric label="Healthy inboxes" value={healthyInboxes} detail="Enabled without last error" tone="emerald" />
        </section>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <AdminPanel
            title="Company directory"
            eyebrow="Workspace control"
            description="Each company row controls users, isolation, and email ingestion configuration."
          >
            <div className="grid gap-3 p-4">
              {tenants.length === 0 ? (
                <div className="rounded-[18px] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-8 text-center text-[13px] text-slate-500">
                  No company rows yet. Create one from the panel on the right.
                </div>
              ) : (
                tenants.map((t) => {
                  const inboxLabel = !t.emailInbox
                    ? 'not configured'
                    : !t.emailInbox.enabled
                      ? 'disabled'
                      : t.emailInbox.lastErrorMessage
                        ? 'errored'
                        : 'healthy';
                  return (
                    <article
                      key={t.id}
                      className="grid gap-4 rounded-[18px] border border-slate-100 bg-white px-4 py-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-100 hover:shadow-[0_18px_42px_rgba(15,23,42,0.08)] md:grid-cols-[minmax(0,1fr)_130px_150px_120px]"
                    >
                      <div className="min-w-0">
                        <h3 className="truncate text-[14px] font-semibold text-slate-950">{t.name}</h3>
                        <p className="mt-1 font-mono text-[11.5px] text-slate-500">{t.slug}</p>
                      </div>
                      <div className="text-[12.5px] text-slate-500">
                        <span className="font-semibold text-slate-950">{t._count.users}</span> users
                      </div>
                      <AdminPill tone={!t.emailInbox ? 'slate' : !t.emailInbox.enabled ? 'slate' : t.emailInbox.lastErrorMessage ? 'amber' : 'emerald'}>
                        {inboxLabel}
                      </AdminPill>
                      <div className="flex flex-wrap items-center justify-between gap-3 md:justify-end">
                        <span className="text-[12px] text-slate-500 tabular-nums">{t.createdAt.toISOString().slice(0, 10)}</span>
                        <Link
                          href={`/admin/tenants/${t.id}/email-inbox`}
                          className={adminSecondaryButtonClass}
                        >
                          Email inbox
                        </Link>
                      </div>
                    </article>
                  );
                })
              )}
            </div>
          </AdminPanel>

          <div className="grid gap-5">
            <AdminPanel
              title="Invoice profile"
              eyebrow="Company documents"
              description="These details print on customer estimates and invoices."
            >
              <div className="p-5">
                {invoiceProfile ? (
                  <TenantInvoiceProfileForm tenant={invoiceProfile} />
                ) : (
                  <div className="rounded-[16px] border border-dashed border-slate-200 bg-slate-50/70 p-4 text-[12.5px] text-slate-500">
                    Create a company before adding invoice profile details.
                  </div>
                )}
              </div>
            </AdminPanel>

            <AdminPanel
              title="Add company"
              eyebrow="Advanced"
              description="B Visible normally runs as one primary company. Add another only when isolation is intentional."
            >
              <div className="p-5">
                <CreateTenantForm />
                {sp.created ? (
                  <div className="mt-4 rounded-[16px] border border-emerald-200 bg-emerald-50 p-4 text-[12.5px] text-emerald-900">
                    Company <span className="font-mono">{sp.created}</span> saved.
                  </div>
                ) : null}
              </div>
            </AdminPanel>
          </div>
        </div>
      </div>
    </>
  );
}
