import Link from 'next/link';
import { prisma } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';

export const metadata = { title: 'Clients' };
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

  return (
    <>
      <PageHeader
        title="Clients"
        subtitle={`Companies you bid for. ${clients.length} on file.`}
        actions={
          <Link
            href="/clients/new"
            className="inline-flex items-center justify-center rounded-[8px] bg-[var(--color-bv-accent)] px-3.5 py-2 text-[13.5px] font-medium text-[var(--color-bv-accent-foreground)] shadow-sm transition-colors hover:opacity-90"
          >
            New client
          </Link>
        }
      />

      {sp.created ? (
        <div className="mb-5 rounded-[var(--radius-bv)] border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-[13px] text-emerald-900">
          Created <span className="font-medium">{sp.created}</span>.
        </div>
      ) : null}

      <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] shadow-[var(--shadow-bv-card)]">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--color-bv-border)] text-left text-[11.5px] uppercase tracking-wider text-[var(--color-bv-muted)]">
                <th className="px-5 py-2 font-medium">Company</th>
                <th className="px-5 py-2 font-medium">Contact</th>
                <th className="px-5 py-2 font-medium">Email</th>
                <th className="px-5 py-2 font-medium">Phone</th>
                <th className="px-5 py-2 font-medium">Estimates</th>
                <th className="px-5 py-2 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.id} className="border-b border-[var(--color-bv-border)] last:border-b-0">
                  <td className="px-5 py-2.5 text-[var(--color-bv-text)]">{c.companyName}</td>
                  <td className="px-5 py-2.5 text-[var(--color-bv-muted)]">{c.contactName ?? '—'}</td>
                  <td className="px-5 py-2.5 text-[var(--color-bv-muted)]">{c.email ?? '—'}</td>
                  <td className="px-5 py-2.5 text-[var(--color-bv-muted)]">{c.phone ?? '—'}</td>
                  <td className="px-5 py-2.5 text-[var(--color-bv-muted)] tabular-nums">
                    {c._count.estimates}
                  </td>
                  <td className="px-5 py-2.5 text-[var(--color-bv-muted)] tabular-nums">
                    {c.updatedAt.toISOString().slice(0, 10)}
                  </td>
                </tr>
              ))}
              {clients.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-[var(--color-bv-muted)]">
                    No clients yet. Create your first one to start an estimate.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
