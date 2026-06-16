import Link from 'next/link';
import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { CreateClientForm } from './client-form';

export const metadata = { title: 'New customer' };
export const dynamic = 'force-dynamic';

export default async function NewClientPage() {
  await requireTenantId();
  return (
    <>
      <PageHeader
        title="New customer"
        subtitle="Create the customer profile your estimates, approvals, and follow-ups will use."
        actions={
          <Link
            href="/clients"
            className="inline-flex items-center justify-center rounded-[12px] border border-white/80 bg-white/90 px-4 py-2.5 text-[13.5px] font-semibold text-slate-700 shadow-sm transition-all hover:-translate-y-0.5 hover:bg-white"
          >
            Cancel
          </Link>
        }
      />
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="overflow-hidden rounded-[24px] border border-white/80 bg-white/90 shadow-[0_24px_70px_rgba(15,23,42,0.10)] backdrop-blur-xl">
          <div className="border-b border-slate-100 bg-gradient-to-r from-blue-50 via-white to-emerald-50 px-6 py-5">
            <span className="inline-flex rounded-full border border-blue-100 bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-700">
              Customer setup
            </span>
            <h2 className="mt-4 text-[22px] font-semibold tracking-[-0.035em] text-slate-950">
              Contact and account details
            </h2>
            <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-slate-500">
              Add enough information for quoting, customer communication, and future job history.
            </p>
          </div>
          <div className="p-6">
            <CreateClientForm />
          </div>
        </div>

        <aside className="rounded-[22px] border border-white/80 bg-white/90 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur-xl">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Profile quality</div>
          <div className="mt-4 space-y-3">
            <ChecklistItem text="Company name is required for every estimate." />
            <ChecklistItem text="Email helps when sending public quote links." />
            <ChecklistItem text="Notes stay internal for sales and production context." />
          </div>
        </aside>
      </section>
    </>
  );
}

function ChecklistItem({ text }: { text: string }) {
  return (
    <div className="flex gap-3 rounded-[16px] border border-slate-100 bg-slate-50/70 p-3">
      <span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_0_5px_rgba(52,211,153,0.14)]" />
      <p className="text-[12.5px] leading-snug text-slate-600">{text}</p>
    </div>
  );
}
