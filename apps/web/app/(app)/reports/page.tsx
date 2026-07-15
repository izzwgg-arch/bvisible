import Link from 'next/link';
import { prisma, POStatus } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { formatMoney } from '@/lib/estimate/format';

export const metadata = { title: 'Reports' };
export const dynamic = 'force-dynamic';

const OPEN_PO_STATUSES = new Set<POStatus>([
  POStatus.DRAFT,
  POStatus.SENT,
  POStatus.ORDERED,
  POStatus.PARTIALLY_RECEIVED,
]);

export default async function ReportsPage() {
  const me = await requireTenantId();

  const [purchaseOrders, clients, catalogItems, vendors, estimates] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where: { tenantId: me.tenantId, deletedAt: null },
      select: { subtotalCents: true, status: true, updatedAt: true },
      orderBy: [{ updatedAt: 'desc' }],
      take: 500,
    }),
    prisma.client.findMany({
      where: { tenantId: me.tenantId, deletedAt: null },
      select: { id: true, companyName: true, _count: { select: { estimates: true } } },
      orderBy: [{ updatedAt: 'desc' }],
      take: 500,
    }),
    prisma.shopMaterialItem.findMany({
      where: { tenantId: me.tenantId },
      select: { isActive: true, vendorCatalogLinks: { select: { vendorId: true } } },
      take: 500,
    }),
    prisma.vendor.count({ where: { tenantId: me.tenantId, deletedAt: null } }),
    prisma.estimate.count({ where: { tenantId: me.tenantId, deletedAt: null } }),
  ]);

  const authorizedSpend = purchaseOrders.reduce((sum, po) => sum + po.subtotalCents, 0);
  const openPoCount = purchaseOrders.filter((po) => OPEN_PO_STATUSES.has(po.status)).length;
  const receivedPoCount = purchaseOrders.filter((po) => po.status === POStatus.RECEIVED).length;
  const activeCatalogCount = catalogItems.filter((item) => item.isActive).length;
  const vendorLinkedCatalogCount = catalogItems.filter((item) => item.vendorCatalogLinks.length > 0).length;
  const topCustomers = [...clients]
    .sort((a, b) => b._count.estimates - a._count.estimates)
    .slice(0, 5);

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle={`Executive workspace for ${me.tenant.name}: sales readiness, procurement health, and catalog coverage at a glance.`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/purchase-orders"
              className="inline-flex items-center justify-center rounded-[12px] border border-white/80 bg-white/90 px-4 py-2.5 text-[13.5px] font-semibold text-slate-700 shadow-sm transition-all hover:-translate-y-0.5 hover:bg-white"
            >
              View POs
            </Link>
            <Link
              href="/items"
              className="inline-flex items-center justify-center rounded-[12px] bg-[var(--color-bv-accent)] px-4 py-2.5 text-[13.5px] font-semibold text-[var(--color-bv-accent-foreground)] shadow-[0_16px_34px_rgba(47,90,243,0.24)] transition-all hover:-translate-y-0.5 hover:opacity-95"
            >
              Open catalog
            </Link>
          </div>
        }
      />

      <div className="grid gap-5">
        <section className="grid gap-3 md:grid-cols-4">
          <ReportMetric label="Authorized spend" value={formatMoney(authorizedSpend)} detail={`${purchaseOrders.length} total POs`} tone="blue" />
          <ReportMetric label="Open PO workflow" value={openPoCount.toString()} detail={`${receivedPoCount} received`} tone="amber" />
          <ReportMetric label="Customers" value={clients.length.toString()} detail={`${estimates} estimates on file`} tone="emerald" />
          <ReportMetric label="Catalog coverage" value={activeCatalogCount.toString()} detail={`${vendorLinkedCatalogCount} vendor linked`} tone="violet" />
        </section>

        <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="overflow-hidden rounded-[24px] border border-white/80 bg-white/90 shadow-[0_24px_70px_rgba(15,23,42,0.10)] backdrop-blur-xl">
            <div className="border-b border-slate-100 bg-gradient-to-r from-blue-50 via-white to-cyan-50 px-6 py-5">
              <span className="inline-flex rounded-full border border-blue-100 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-700">
                Operational snapshot
              </span>
              <h2 className="mt-4 text-[22px] font-semibold tracking-[-0.035em] text-slate-950">
                Business readiness
              </h2>
              <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-slate-500">
                A modern, read-only report surface for daily leadership review.
              </p>
            </div>
            <div className="grid gap-4 p-5 md:grid-cols-2">
              <HealthCard title="Procurement health" score={`${Math.max(0, purchaseOrders.length - openPoCount)}/${purchaseOrders.length || 0}`} text="Received or closed purchase orders compared with total procurement volume." />
              <HealthCard title="Customer activity" score={`${topCustomers.length}`} text="Top customer accounts with quote history are ready for sales follow-up." />
              <HealthCard title="Supplier network" score={vendors.toString()} text="Vendors available for purchase orders and material sourcing." />
              <HealthCard title="Catalog intelligence" score={`${vendorLinkedCatalogCount}/${catalogItems.length || 0}`} text="Catalog items with supplier links for stronger pricing confidence." />
            </div>
          </div>

          <aside className="rounded-[24px] border border-white/80 bg-white/90 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur-xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-semibold text-slate-950">Top customers</h2>
                <p className="mt-1 text-[12.5px] text-slate-500">Ranked by estimate count.</p>
              </div>
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700">
                CRM
              </span>
            </div>
            <div className="mt-4 space-y-3">
              {topCustomers.length === 0 ? (
                <p className="rounded-[16px] border border-dashed border-slate-200 bg-slate-50 p-4 text-[13px] text-slate-500">
                  Create customers and estimates to populate this report.
                </p>
              ) : (
                topCustomers.map((customer, index) => (
                  <div key={customer.id} className="flex items-center justify-between gap-3 rounded-[16px] border border-slate-100 bg-slate-50/70 p-3">
                    <div className="min-w-0">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">#{index + 1}</div>
                      <div className="truncate text-[13px] font-semibold text-slate-950">{customer.companyName}</div>
                    </div>
                    <span className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-[11.5px] font-semibold text-blue-700">
                      {customer._count.estimates} estimates
                    </span>
                  </div>
                ))
              )}
            </div>
          </aside>
        </section>
      </div>
    </>
  );
}

function ReportMetric({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone: 'blue' | 'amber' | 'emerald' | 'violet';
}) {
  const toneClass = {
    blue: 'from-blue-600/10 to-indigo-500/10 text-blue-700 ring-blue-500/15',
    amber: 'from-amber-500/10 to-orange-400/10 text-amber-700 ring-amber-500/15',
    emerald: 'from-emerald-600/10 to-teal-500/10 text-emerald-700 ring-emerald-500/15',
    violet: 'from-violet-600/10 to-fuchsia-500/10 text-violet-700 ring-violet-500/15',
  }[tone];

  return (
    <div className={`rounded-[18px] border border-white/80 bg-gradient-to-br px-4 py-4 shadow-[0_18px_50px_rgba(15,23,42,0.08)] ring-1 backdrop-blur-xl ${toneClass}`}>
      <div className="text-[10px] font-black uppercase tracking-[0.13em] opacity-70">{label}</div>
      <div className="mt-2 text-[20px] font-black leading-none tracking-[-0.02em]">{value}</div>
      <p className="mt-2 text-[11.5px] font-semibold leading-snug opacity-70">{detail}</p>
    </div>
  );
}

function HealthCard({ title, score, text }: { title: string; score: string; text: string }) {
  return (
    <div className="rounded-[18px] border border-slate-100 bg-white px-4 py-4 shadow-sm">
      <div className="text-[10px] font-black uppercase tracking-[0.13em] text-slate-400">{title}</div>
      <div className="mt-2 text-[20px] font-black leading-none tracking-[-0.02em] text-slate-950">{score}</div>
      <p className="mt-2 text-[11.5px] leading-snug text-slate-500">{text}</p>
    </div>
  );
}
