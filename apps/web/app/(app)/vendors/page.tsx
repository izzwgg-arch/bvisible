import Link from 'next/link';
import { prisma } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { EmptyState } from '@/components/app/empty-state';

export const metadata = { title: 'Vendors' };
export const dynamic = 'force-dynamic';

interface SearchParams {
  created?: string;
}

export default async function VendorsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const me = await requireTenantId();
  const sp = await searchParams;

  const vendors = await prisma.vendor.findMany({
    where: { tenantId: me.tenantId, deletedAt: null },
    orderBy: [{ name: 'asc' }],
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      notes: true,
      _count: { select: { purchaseOrders: true } },
      updatedAt: true,
    },
    take: 500,
  });

  const activeVendors = vendors.filter((v) => v._count.purchaseOrders > 0).length;
  const contactReady = vendors.filter((v) => v.email || v.phone).length;
  const totalPOs = vendors.reduce((sum, v) => sum + v._count.purchaseOrders, 0);

  return (
    <>
      <PageHeader
        title="Vendors"
        subtitle={`Supplier directory for ${me.tenant.name}. Track contacts, PO history, and pricing intelligence across all suppliers.`}
        actions={
          <Link
            href="/vendors/new"
            className="inline-flex items-center justify-center rounded-[12px] bg-[var(--color-bv-accent)] px-4 py-2.5 text-[13.5px] font-semibold text-[var(--color-bv-accent-foreground)] shadow-[0_16px_34px_rgba(47,90,243,0.24)] transition-all hover:-translate-y-0.5 hover:opacity-95"
          >
            Add vendor
          </Link>
        }
      />

      {sp.created ? (
        <div className="mb-5 rounded-[var(--radius-bv)] border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-[13px] text-emerald-900">
          Created <span className="font-medium">{sp.created}</span>.
        </div>
      ) : null}

      {vendors.length === 0 ? (
        <EmptyState
          title="No vendors yet"
          description="Vendors are suppliers you issue POs to. Add one before creating purchase orders."
          primaryAction={{ label: 'Add vendor', href: '/vendors/new' }}
        />
      ) : (
        <div className="grid gap-5">
          <section className="grid gap-3 md:grid-cols-3">
            <VendorStat label="Total vendors" value={vendors.length.toString()} detail={`${activeVendors} with PO activity`} />
            <VendorStat label="Total POs issued" value={totalPOs.toString()} detail="Purchase orders across all vendors" />
            <VendorStat label="Contact ready" value={contactReady.toString()} detail="Have email or phone on file" />
          </section>

          <section className="overflow-hidden rounded-[22px] border border-white/80 bg-white/90 shadow-[0_22px_70px_rgba(15,23,42,0.10)] backdrop-blur-xl">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="text-[15px] font-semibold text-slate-950">Supplier directory</h2>
                <p className="mt-1 text-[12.5px] text-slate-500">All active vendors with contact details and PO activity.</p>
              </div>
              <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-violet-700">
                {vendors.length} suppliers
              </span>
            </div>
            <div className="grid gap-3 p-4">
              {vendors.map((v) => (
                <article
                  key={v.id}
                  className="grid gap-4 rounded-[18px] border border-slate-100 bg-white px-4 py-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-violet-100 hover:shadow-[0_18px_42px_rgba(15,23,42,0.08)] md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_160px_120px]"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-3">
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-violet-50 text-[13px] font-semibold text-violet-700 ring-1 ring-violet-100">
                        {initials(v.name)}
                      </div>
                      <div className="min-w-0">
                        <Link
                          href={`/vendors/${v.id}`}
                          className="truncate text-[14px] font-semibold text-slate-950 hover:text-[var(--color-bv-accent)]"
                        >
                          {v.name}
                        </Link>
                        <p className="truncate text-[12.5px] text-slate-500">{v.notes ?? 'No notes'}</p>
                      </div>
                    </div>
                  </div>
                  <div className="grid gap-1 text-[12.5px] text-slate-500">
                    <span className="truncate">{v.email ?? 'Email not set'}</span>
                    <span className="truncate">{v.phone ?? 'Phone not set'}</span>
                  </div>
                  <div>
                    <span className="inline-flex rounded-full border border-violet-100 bg-violet-50 px-2.5 py-1 text-[11.5px] font-semibold text-violet-700">
                      {v._count.purchaseOrders} POs
                    </span>
                  </div>
                  <div className="text-[12px] text-slate-500 tabular-nums">
                    Updated {v.updatedAt.toISOString().slice(0, 10)}
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

function VendorStat({ label, value, detail }: { label: string; value: string; detail: string }) {
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
