import Link from 'next/link';
import { prisma, POStatus } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { EmptyState } from '@/components/app/empty-state';
import { formatMoney } from '@/lib/estimate/format';

export const metadata = { title: 'Purchase orders' };
export const dynamic = 'force-dynamic';

const STATUS_TONE: Record<POStatus, string> = {
  DRAFT: 'border-slate-200 bg-slate-50 text-slate-700',
  SENT: 'border-blue-200 bg-blue-50 text-blue-700',
  ORDERED: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  PARTIALLY_RECEIVED: 'border-amber-200 bg-amber-50 text-amber-800',
  RECEIVED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  CANCELED: 'border-rose-200 bg-rose-50 text-rose-700',
};

interface SearchParams {
  created?: string;
  deleted?: string;
}

export default async function PurchaseOrdersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const me = await requireTenantId();
  const sp = await searchParams;

  const pos = await prisma.purchaseOrder.findMany({
    where: { tenantId: me.tenantId, deletedAt: null },
    orderBy: [{ updatedAt: 'desc' }],
    select: {
      id: true,
      number: true,
      status: true,
      qboPoNumber: true,
      subtotalCents: true,
      updatedAt: true,
      vendor: { select: { id: true, name: true } },
      estimate: { select: { id: true, number: true } },
    },
    take: 200,
  });

  return (
    <>
      <PageHeader
        title="Purchase orders"
        subtitle={`Spending you've authorized for ${me.tenant.name}. ${pos.length} on file.`}
        actions={
          <Link
            href="/purchase-orders/new"
            className="inline-flex items-center justify-center rounded-[8px] bg-[var(--color-bv-accent)] px-3.5 py-2 text-[13.5px] font-medium text-[var(--color-bv-accent-foreground)] shadow-sm transition-colors hover:opacity-90"
          >
            Create PO
          </Link>
        }
      />

      {sp.created ? (
        <div className="mb-5 rounded-[var(--radius-bv)] border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-[13px] text-emerald-900">
          Created <span className="font-mono">{sp.created}</span>.
        </div>
      ) : null}
      {sp.deleted ? (
        <div className="mb-5 rounded-[var(--radius-bv)] border border-amber-200 bg-amber-50 px-4 py-2.5 text-[13px] text-amber-900">
          Deleted <span className="font-mono">{sp.deleted}</span>.
        </div>
      ) : null}

      {pos.length === 0 ? (
        <EmptyState
          title="No purchase orders yet"
          description={
            <>
              POs record spending against vendors. Create one manually or convert an approved
              estimate.{' '}
              <Link href="/vendors" className="font-medium text-[var(--color-bv-accent)] underline-offset-2 hover:underline">
                Vendors
              </Link>{' '}
              should exist before you place orders.
            </>
          }
          primaryAction={{ label: 'Create PO', href: '/purchase-orders/new' }}
          secondaryAction={{ label: 'Go to estimates', href: '/estimates' }}
        />
      ) : (
        <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] shadow-[var(--shadow-bv-card)]">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[var(--color-bv-border)] text-left text-[11.5px] uppercase tracking-wider text-[var(--color-bv-muted)]">
                  <th className="px-5 py-2 font-medium">Number</th>
                  <th className="px-5 py-2 font-medium">Vendor</th>
                  <th className="px-5 py-2 font-medium">Linked estimate</th>
                  <th className="px-5 py-2 font-medium">QBO #</th>
                  <th className="px-5 py-2 font-medium">Status</th>
                  <th className="px-5 py-2 font-medium text-right">Subtotal</th>
                  <th className="px-5 py-2 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {pos.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b border-[var(--color-bv-border)] last:border-b-0 hover:bg-[var(--color-bv-bg)]"
                  >
                    <td className="px-5 py-2.5 font-mono text-[12px] text-[var(--color-bv-text)]">
                      <Link
                        href={`/purchase-orders/${p.id}` as never}
                        className="hover:text-[var(--color-bv-accent)]"
                      >
                        {p.number}
                      </Link>
                    </td>
                    <td className="px-5 py-2.5 text-[var(--color-bv-text)]">
                      {p.vendor?.name ?? <span className="text-[var(--color-bv-muted)]">—</span>}
                    </td>
                    <td className="px-5 py-2.5 text-[var(--color-bv-muted)]">
                      {p.estimate ? (
                        <Link
                          href={`/estimates/${p.estimate.id}` as never}
                          className="font-mono text-[12px] hover:text-[var(--color-bv-accent)]"
                        >
                          {p.estimate.number}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-5 py-2.5 font-mono text-[12px] text-[var(--color-bv-text)]">
                      {p.qboPoNumber ?? <span className="text-[var(--color-bv-muted)]">—</span>}
                    </td>
                    <td className="px-5 py-2.5">
                      <StatusPill status={p.status} />
                    </td>
                    <td className="px-5 py-2.5 text-right text-[var(--color-bv-text)] tabular-nums">
                      {formatMoney(p.subtotalCents)}
                    </td>
                    <td className="px-5 py-2.5 text-[var(--color-bv-muted)] tabular-nums">
                      {p.updatedAt.toISOString().slice(0, 10)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

function StatusPill({ status }: { status: POStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11.5px] font-medium ${STATUS_TONE[status]}`}
    >
      {status.replace('_', ' ')}
    </span>
  );
}
