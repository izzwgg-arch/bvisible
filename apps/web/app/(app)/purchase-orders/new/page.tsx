import Link from 'next/link';
import { prisma } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { NewPoForm } from './new-po-form';

export const metadata = { title: 'New PO' };
export const dynamic = 'force-dynamic';

interface SearchParams {
  estimateId?: string;
}

export default async function NewPurchaseOrderPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const me = await requireTenantId();
  const sp = await searchParams;

  const [vendors, estimates] = await Promise.all([
    prisma.vendor.findMany({
      where: { tenantId: me.tenantId, deletedAt: null },
      orderBy: [{ name: 'asc' }],
      select: { id: true, name: true },
      take: 500,
    }),
    prisma.estimate.findMany({
      where: { tenantId: me.tenantId, deletedAt: null },
      orderBy: [{ updatedAt: 'desc' }],
      select: { id: true, number: true, title: true },
      take: 200,
    }),
  ]);

  return (
    <>
      <PageHeader
        title="New purchase order"
        subtitle="Start a clean vendor spend record. Lines, receiving, and reconciliation happen after creation."
        actions={
          <Link
            href="/purchase-orders"
            className="inline-flex items-center justify-center rounded-[12px] border border-white/80 bg-white/90 px-4 py-2.5 text-[13.5px] font-semibold text-slate-700 shadow-sm transition-all hover:-translate-y-0.5 hover:bg-white"
          >
            Cancel
          </Link>
        }
      />
      <div className="grid min-w-0 gap-5 min-[1500px]:grid-cols-[minmax(0,1fr)_340px]">
        <section className="overflow-hidden rounded-[24px] border border-white/80 bg-white/90 shadow-[0_24px_70px_rgba(15,23,42,0.10)] backdrop-blur-xl">
          <div className="border-b border-slate-100 bg-blue-50 px-6 py-5">
            <div className="inline-flex rounded-full border border-blue-100 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-700">
              Procurement setup
            </div>
            <h2 className="mt-4 text-[22px] font-semibold tracking-[-0.035em] text-slate-950">
              Create the PO shell
            </h2>
            <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-slate-500">
              Choose the supplier, optionally connect the estimate, and leave purchasing notes for the team.
            </p>
          </div>
          <div className="p-6">
            <NewPoForm
              vendors={vendors}
              estimates={estimates}
              defaultEstimateId={sp.estimateId ?? null}
            />
          </div>
        </section>

        <aside className="grid min-w-0 gap-4 self-start">
          <div className="rounded-[22px] border border-white/80 bg-white/90 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur-xl">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">What happens next</div>
            <div className="mt-4 space-y-3">
              <Step number="1" title="Create PO" text="The record is saved as a draft procurement workspace." />
              <Step number="2" title="Add lines" text="Open the PO to add vendor line items and costs." />
              <Step number="3" title="Receive and reconcile" text="Use the PO lifecycle and reconciliation views to close the loop." />
            </div>
          </div>
          <div className="rounded-[22px] border border-blue-100 bg-blue-50/80 p-5 text-[13px] leading-relaxed text-blue-900 shadow-sm">
            <span className="font-semibold">Tip:</span> Linking an estimate keeps approved customer work connected to vendor spend.
          </div>
        </aside>
      </div>
    </>
  );
}

function Step({ number, title, text }: { number: string; title: string; text: string }) {
  return (
    <div className="flex gap-3">
      <div className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-blue-600 text-[12px] font-semibold text-white shadow-[0_10px_24px_rgba(37,99,235,0.24)]">
        {number}
      </div>
      <div>
        <div className="text-[13px] font-semibold text-slate-950">{title}</div>
        <p className="mt-0.5 text-[12.5px] leading-snug text-slate-500">{text}</p>
      </div>
    </div>
  );
}
