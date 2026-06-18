import Link from 'next/link';
import { prisma, Role } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { CreateShopMaterialItemForm } from './create-item-form';

export const metadata = { title: 'Create catalog item' };
export const dynamic = 'force-dynamic';

export default async function NewItemPage() {
  const me = await requireTenantId();
  const canManage = me.role === Role.ADMIN || me.role === Role.SUPER_ADMIN;

  const [machines, savedCategories] = await Promise.all([
    prisma.machine.findMany({
      where: { tenantId: me.tenantId, isActive: true },
      orderBy: [{ name: 'asc' }],
      select: { id: true, name: true, ratePerHourCents: true },
      take: 200,
    }),
    prisma.shopItemCategory.findMany({
      where: { tenantId: me.tenantId },
      orderBy: [{ name: 'asc' }],
      select: { name: true },
      take: 200,
    }),
  ]);

  if (!canManage) {
    return (
      <>
        <PageHeader title="New item" subtitle="Admin access required." />
        <p className="text-[13px] text-[var(--color-bv-muted)]">
          Ask an administrator to create catalog items.
        </p>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Create catalog item"
        subtitle="Publish a polished estimating line with cost basis, markup guidance, units, and optional machine defaults."
        actions={
          <Link
            href="/items"
            className="inline-flex items-center justify-center rounded-[12px] border border-white/80 bg-white/90 px-4 py-2.5 text-[13.5px] font-semibold text-slate-700 shadow-sm transition-all hover:-translate-y-0.5 hover:bg-white"
          >
            All items
          </Link>
        }
      />
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="overflow-hidden rounded-[24px] border border-white/80 bg-white/90 shadow-[0_24px_70px_rgba(15,23,42,0.10)] backdrop-blur-xl">
          <div className="border-b border-slate-100 bg-gradient-to-r from-blue-50 via-white to-violet-50 px-6 py-5">
            <span className="inline-flex rounded-full border border-blue-100 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-700">
              Catalog builder
            </span>
            <h2 className="mt-4 text-[22px] font-semibold tracking-[-0.035em] text-slate-950">
              Pricing-ready item details
            </h2>
            <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-slate-500">
              Create a line your estimators can trust, with clear defaults and sell-price guidance.
            </p>
          </div>
          <div className="p-6">
            <CreateShopMaterialItemForm
              machines={machines}
              savedCategories={savedCategories.map((c) => c.name)}
            />
          </div>
        </div>

        <aside className="grid gap-4 self-start">
          <div className="rounded-[22px] border border-white/80 bg-white/90 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur-xl">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Catalog standards</div>
            <div className="mt-4 space-y-3">
              <Guide title="Materials" text="Use vendor pricing when the cost should follow supplier history." />
              <Guide title="Labor and install" text="Use internal unit cost and markup for repeatable estimating." />
              <Guide title="Machine rows" text="Pick a default machine when the item represents production time." />
            </div>
          </div>
          <div className="rounded-[22px] border border-violet-100 bg-violet-50/80 p-5 text-[13px] leading-relaxed text-violet-900 shadow-sm">
            Sell hints guide estimates. The final quote can still be adjusted on the estimate workspace.
          </div>
        </aside>
      </section>
    </>
  );
}

function Guide({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-[16px] border border-slate-100 bg-slate-50/70 p-3">
      <div className="text-[13px] font-semibold text-slate-950">{title}</div>
      <p className="mt-1 text-[12.5px] leading-snug text-slate-500">{text}</p>
    </div>
  );
}
