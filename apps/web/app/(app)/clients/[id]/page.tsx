import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { formatMoney } from '@/lib/estimate/format';
import { ClientEditForm } from './client-edit-form';

export const metadata = { title: 'Customer profile' };
export const dynamic = 'force-dynamic';

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireTenantId();
  const { id } = await params;

  const client = await prisma.client.findFirst({
    where: { id, tenantId: me.tenantId, deletedAt: null },
    select: {
      id: true,
      companyName: true,
      contactName: true,
      email: true,
      secondaryEmail: true,
      phone: true,
      alternatePhone: true,
      address: true,
      notes: true,
      estimates: {
        where: { deletedAt: null },
        orderBy: { updatedAt: 'desc' },
        take: 50,
        select: {
          id: true,
          number: true,
          title: true,
          status: true,
          finalPriceCents: true,
          updatedAt: true,
        },
      },
    },
  });
  if (!client) notFound();

  const clientInitials = client.companyName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <>
      <PageHeader
        title={client.companyName}
        subtitle="Customer profile, contact details, and quote history."
        actions={
          <Link
            href="/clients"
            className="inline-flex items-center justify-center rounded-[12px] border border-slate-200 bg-white/90 px-4 py-2.5 text-[13.5px] font-semibold text-slate-700 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:bg-white"
          >
            All customers
          </Link>
        }
      />

      <section className="mb-5 overflow-hidden rounded-[22px] border border-white/80 bg-white/90 shadow-[0_22px_70px_rgba(15,23,42,0.10)] backdrop-blur-xl">
        <div className="flex items-center gap-4 border-b border-slate-100 px-5 py-4">
          <div className="grid h-12 w-12 shrink-0 place-items-center rounded-[16px] bg-violet-50 text-[15px] font-bold text-violet-700 ring-1 ring-violet-100">
            {clientInitials}
          </div>
          <div>
            <h2 className="text-[15px] font-semibold text-slate-950">Contact details</h2>
            <p className="text-[12px] text-slate-400">
              Edit company name, contacts, emails, phones, and billing address.
            </p>
          </div>
        </div>
        <div className="p-5">
          <ClientEditForm
            clientId={client.id}
            initialCompanyName={client.companyName}
            initialContactName={client.contactName}
            initialEmail={client.email}
            initialSecondaryEmail={client.secondaryEmail}
            initialPhone={client.phone}
            initialAlternatePhone={client.alternatePhone}
            initialAddress={client.address}
            initialNotes={client.notes}
          />
        </div>
      </section>

      <section className="overflow-hidden rounded-[22px] border border-white/80 bg-white/90 shadow-[0_22px_70px_rgba(15,23,42,0.10)] backdrop-blur-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-[15px] font-semibold text-slate-950">Estimates</h2>
            <p className="mt-0.5 text-[12px] text-slate-500">
              Quotes and jobs linked to this customer.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {client.estimates.length > 0 ? (
              <span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-violet-700">
                {client.estimates.length} estimate{client.estimates.length === 1 ? '' : 's'}
              </span>
            ) : null}
            <Link
              href={`/estimates/new?clientId=${client.id}`}
              className="inline-flex items-center justify-center rounded-[10px] border border-violet-200 bg-violet-50 px-3 py-1.5 text-[12px] font-semibold text-violet-700 transition hover:bg-violet-100"
            >
              New estimate
            </Link>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                <th className="px-5 py-3">Number</th>
                <th className="px-5 py-3">Job</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3 text-right">Sell price</th>
                <th className="px-5 py-3">Updated</th>
              </tr>
            </thead>
            <tbody>
              {client.estimates.map((estimate) => (
                <tr
                  key={estimate.id}
                  className="border-b border-slate-50 last:border-b-0 hover:bg-slate-50/60"
                >
                  <td className="px-5 py-3">
                    <Link
                      href={`/estimates/${estimate.id}`}
                      className="font-mono text-[12px] font-semibold text-[var(--color-bv-accent)] hover:underline underline-offset-2"
                    >
                      {estimate.number}
                    </Link>
                  </td>
                  <td className="max-w-[280px] px-5 py-3">
                    <Link
                      href={`/estimates/${estimate.id}`}
                      className="truncate font-medium text-slate-800 hover:text-[var(--color-bv-accent)] block"
                    >
                      {estimate.title}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-[12px] capitalize text-slate-500">
                    {estimate.status.toLowerCase()}
                  </td>
                  <td className="px-5 py-3 text-right font-semibold tabular-nums text-slate-900">
                    {formatMoney(estimate.finalPriceCents)}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-[11px] text-slate-400 tabular-nums">
                    {estimate.updatedAt.toISOString().slice(0, 10)}
                  </td>
                </tr>
              ))}
              {client.estimates.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-12 text-center text-[13px] text-slate-400">
                    No estimates yet for this customer.{' '}
                    <Link
                      href={`/estimates/new?clientId=${client.id}`}
                      className="font-semibold text-[var(--color-bv-accent)] hover:underline underline-offset-2"
                    >
                      Create one
                    </Link>
                    .
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
