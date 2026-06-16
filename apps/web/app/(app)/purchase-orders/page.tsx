import Link from 'next/link';
import type { ReactNode } from 'react';
import { prisma, POStatus } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { EmptyState } from '@/components/app/empty-state';
import { formatMoney } from '@/lib/estimate/format';
import { labelPoStatus } from '@/lib/ui/status-labels';

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

const OPEN_PO_STATUSES = new Set<POStatus>([
  POStatus.DRAFT,
  POStatus.SENT,
  POStatus.ORDERED,
  POStatus.PARTIALLY_RECEIVED,
]);

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

  const totalAuthorizedCents = pos.reduce((sum, po) => sum + po.subtotalCents, 0);
  const openCount = pos.filter((po) => OPEN_PO_STATUSES.has(po.status)).length;
  const receivedCount = pos.filter((po) => po.status === POStatus.RECEIVED).length;
  const linkedEstimateCount = pos.filter((po) => po.estimate).length;

  return (
    <>
      <PageHeader
        title="Purchase orders"
        subtitle={`Vendor spend command center for ${me.tenant.name}. Track authorization, receiving, and estimate coverage.`}
        actions={
          <Link
            href="/purchase-orders/new"
            className="inline-flex items-center justify-center rounded-[12px] bg-[var(--color-bv-accent)] px-4 py-2.5 text-[13.5px] font-semibold text-[var(--color-bv-accent-foreground)] shadow-[0_16px_34px_rgba(47,90,243,0.24)] transition-all hover:-translate-y-0.5 hover:opacity-95"
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
        <div className="grid gap-5">
          <section className="grid gap-3 md:grid-cols-4">
            <MetricCard label="Authorized spend" value={formatMoney(totalAuthorizedCents)} detail={`${pos.length} purchase orders`} tone="blue" />
            <MetricCard label="Open workflow" value={openCount.toString()} detail="Needs vendor or receiving action" tone="amber" />
            <MetricCard label="Received" value={receivedCount.toString()} detail="Closed procurement loops" tone="emerald" />
            <MetricCard label="Estimate linked" value={linkedEstimateCount.toString()} detail="Traceable to approved work" tone="violet" />
          </section>

          <section className="overflow-hidden rounded-[22px] border border-white/80 bg-white/90 shadow-[0_22px_70px_rgba(15,23,42,0.10)] backdrop-blur-xl">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="grid h-10 w-10 place-items-center rounded-[14px] bg-blue-50 text-blue-600 ring-1 ring-blue-100">
                  <ClipboardIcon />
                </div>
                <div>
                  <h2 className="text-[15px] font-semibold text-slate-950">Procurement queue</h2>
                  <p className="text-[12.5px] text-slate-500">Every PO, vendor, status, and source estimate in one clean review surface.</p>
                </div>
              </div>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Live spend
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-[13px]">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/70 text-left text-[11px] uppercase tracking-[0.18em] text-slate-400">
                    <th className="px-5 py-3 font-semibold">PO</th>
                    <th className="px-5 py-3 font-semibold">Vendor</th>
                    <th className="px-5 py-3 font-semibold">Source</th>
                    <th className="px-5 py-3 font-semibold">QBO</th>
                    <th className="px-5 py-3 font-semibold">Status</th>
                    <th className="px-5 py-3 text-right font-semibold">Subtotal</th>
                    <th className="px-5 py-3 font-semibold">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {pos.map((p) => (
                    <tr
                      key={p.id}
                      className="group border-b border-slate-100 last:border-b-0 hover:bg-blue-50/35"
                    >
                      <td className="px-5 py-4 align-middle">
                        <Link
                          href={`/purchase-orders/${p.id}` as never}
                          className="font-mono text-[12px] font-semibold text-slate-950 transition-colors group-hover:text-blue-700"
                        >
                          {p.number}
                        </Link>
                        <div className="mt-1 text-[11.5px] text-slate-400">Open workspace</div>
                      </td>
                      <td className="px-5 py-4 align-middle">
                        <div className="font-medium text-slate-900">
                          {p.vendor?.name ?? <span className="text-slate-400">Vendor unassigned</span>}
                        </div>
                      </td>
                      <td className="px-5 py-4 align-middle text-slate-500">
                        {p.estimate ? (
                          <Link
                            href={`/estimates/${p.estimate.id}` as never}
                            className="inline-flex rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 font-mono text-[11.5px] font-semibold text-blue-700"
                          >
                            {p.estimate.number}
                          </Link>
                        ) : (
                          <span className="text-slate-400">Manual PO</span>
                        )}
                      </td>
                      <td className="px-5 py-4 align-middle font-mono text-[12px] text-slate-500">
                        {p.qboPoNumber ?? <span className="text-slate-400">Pending</span>}
                      </td>
                      <td className="px-5 py-4 align-middle">
                        <StatusPill status={p.status} />
                      </td>
                      <td className="px-5 py-4 text-right align-middle text-[14px] font-semibold text-slate-950 tabular-nums">
                        {formatMoney(p.subtotalCents)}
                      </td>
                      <td className="px-5 py-4 align-middle text-[12px] text-slate-500 tabular-nums">
                        {p.updatedAt.toISOString().slice(0, 10)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid gap-3 border-t border-slate-100 bg-gradient-to-r from-blue-50/70 to-cyan-50/60 px-5 py-4 text-[12.5px] text-slate-600 md:grid-cols-3">
              <Insight label="Review cadence" value="Check ordered and partially received POs daily." />
              <Insight label="Best practice" value="Link POs back to estimates for quote-to-spend visibility." />
              <Insight label="Ready state" value="Received POs are clean handoffs for reconciliation." />
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function MetricCard({
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
    blue: 'from-blue-500/12 to-cyan-400/10 text-blue-700 ring-blue-100',
    amber: 'from-amber-400/16 to-orange-300/10 text-amber-700 ring-amber-100',
    emerald: 'from-emerald-400/16 to-teal-300/10 text-emerald-700 ring-emerald-100',
    violet: 'from-violet-400/16 to-blue-300/10 text-violet-700 ring-violet-100',
  }[tone];

  return (
    <div className="rounded-[20px] border border-white/80 bg-white/90 p-4 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur-xl">
      <div className={`mb-4 inline-flex rounded-full bg-gradient-to-br px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ring-1 ${toneClass}`}>
        {label}
      </div>
      <div className="text-[26px] font-semibold tracking-[-0.04em] text-slate-950">{value}</div>
      <p className="mt-1 text-[12.5px] leading-snug text-slate-500">{detail}</p>
    </div>
  );
}

function Insight({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">{label}</div>
      <div className="mt-1 font-medium text-slate-700">{value}</div>
    </div>
  );
}

function StatusPill({ status }: { status: POStatus }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold ${STATUS_TONE[status]}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {labelPoStatus(status)}
    </span>
  );
}

function ClipboardIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M9 5h6" />
      <path d="M9 12h6" />
      <path d="M9 16h4" />
      <path d="M8 3h8l1 3h3v15H4V6h3l1-3Z" />
    </svg>
  );
}
