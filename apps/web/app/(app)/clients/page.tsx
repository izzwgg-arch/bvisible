import Link from 'next/link';
import { prisma } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { EmptyState } from '@/components/app/empty-state';

export const metadata = { title: 'Customers' };
export const dynamic = 'force-dynamic';

interface SearchParams {
  created?: string;
}

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const me = await requireTenantId();
  const sp = await searchParams;

  const clients = await prisma.client.findMany({
    where: { tenantId: me.tenantId, deletedAt: null },
    orderBy: [{ companyName: 'asc' }],
    select: {
      id: true,
      companyName: true,
      contactName: true,
      email: true,
      phone: true,
      _count: { select: { estimates: true } },
      updatedAt: true,
    },
    take: 500,
  });

  const estimateTotal = clients.reduce((sum, client) => sum + client._count.estimates, 0);
  const contactsReady = clients.filter((client) => client.email || client.phone).length;
  const activeClients = clients.filter((client) => client._count.estimates > 0).length;

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle={`Customer command center for ${me.tenant.name}. Keep contacts, quote history, and account readiness easy to scan.`}
        actions={
          <Link
            href="/clients/new"
            className="inline-flex items-center justify-center rounded-[12px] bg-[var(--color-bv-accent)] px-4 py-2.5 text-[13.5px] font-semibold text-[var(--color-bv-accent-foreground)] shadow-[0_16px_34px_rgba(47,90,243,0.24)] transition-all hover:-translate-y-0.5 hover:opacity-95"
          >
            Create customer
          </Link>
        }
      />

      {sp.created ? (
        <div className="mb-5 rounded-[var(--radius-bv)] border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-[13px] text-emerald-900">
          Created <span className="font-medium">{sp.created}</span>.
        </div>
      ) : null}

      {clients.length === 0 ? (
        <EmptyState
          title="No customers yet"
          description="Clients are the customers you quote. Add one to create estimates and keep jobs organized."
          primaryAction={{ label: 'Create customer', href: '/clients/new' }}
        />
      ) : (
        <div className="grid gap-5">
          <section className="grid gap-3 md:grid-cols-3">
            <CustomerStat label="Total customers" value={clients.length.toString()} detail={`${activeClients} with estimate activity`} />
            <CustomerStat label="Quote history" value={estimateTotal.toString()} detail="Total estimates connected to customers" />
            <CustomerStat label="Contact ready" value={contactsReady.toString()} detail="Have email or phone on file" />
          </section>

          <section className="overflow-hidden rounded-[22px] border border-white/80 bg-white/90 shadow-[0_22px_70px_rgba(15,23,42,0.10)] backdrop-blur-xl">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="text-[15px] font-semibold text-slate-950">Customer portfolio</h2>
                <p className="mt-1 text-[12.5px] text-slate-500">Account details formatted for quick quoting and follow-up.</p>
              </div>
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700">
                CRM ready
              </span>
            </div>
            <div className="grid gap-3 p-4">
              {clients.map((c) => (
                <article
                  key={c.id}
                  className="grid gap-4 rounded-[18px] border border-slate-100 bg-white px-4 py-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-100 hover:shadow-[0_18px_42px_rgba(15,23,42,0.08)] md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_160px_120px]"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-3">
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-blue-50 text-[13px] font-semibold text-blue-700 ring-1 ring-blue-100">
                        {initials(c.companyName)}
                      </div>
                      <div className="min-w-0">
                        <h3 className="truncate text-[14px] font-semibold text-slate-950">{c.companyName}</h3>
                        <p className="truncate text-[12.5px] text-slate-500">{c.contactName ?? 'No primary contact yet'}</p>
                      </div>
                    </div>
                  </div>
                  <div className="grid gap-1 text-[12.5px] text-slate-500">
                    <span className="truncate">{c.email ?? 'Email not set'}</span>
                    <span className="truncate">{c.phone ?? 'Phone not set'}</span>
                  </div>
                  <div>
                    <span className="inline-flex rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-[11.5px] font-semibold text-blue-700">
                      {c._count.estimates} estimates
                    </span>
                  </div>
                  <div className="text-[12px] text-slate-500 tabular-nums">
                    Updated {c.updatedAt.toISOString().slice(0, 10)}
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function CustomerStat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-[20px] border border-white/80 bg-white/90 p-4 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur-xl">
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</div>
      <div className="mt-3 text-[28px] font-semibold tracking-[-0.04em] text-slate-950">{value}</div>
      <p className="mt-1 text-[12.5px] text-slate-500">{detail}</p>
    </div>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
