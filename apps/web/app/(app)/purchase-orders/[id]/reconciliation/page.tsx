import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  POReconciliationLineMatch,
  POReconciliationLineResolution,
  prisma,
  Role,
  SpendAlertStatus,
} from '@bvisible/db';
import { requireRoleWithEffectiveCompany } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import {
  markPoReconciledFormAction,
  mergeReconciliationLinesFormAction,
  reconciliationLineResolutionFormAction,
  refreshReconciliationFormAction,
  rejectReconciliationLineFormAction,
} from '@/lib/reconciliation/actions';
import {
  labelPoReconciliationStatus,
  labelReconciliationLineMatch,
  labelSpendAlertKind,
} from '@/lib/ui/status-labels';

export const metadata = { title: 'PO reconciliation' };
export const dynamic = 'force-dynamic';

function fmtMoney(cents: number | null): string {
  if (cents === null) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function matchBadgeClass(m: POReconciliationLineMatch): string {
  switch (m) {
    case POReconciliationLineMatch.MATCHED:
      return 'border-emerald-200 bg-emerald-50 text-emerald-900';
    case POReconciliationLineMatch.PRICE_VARIANCE:
    case POReconciliationLineMatch.QTY_VARIANCE:
    case POReconciliationLineMatch.PRICE_AND_QTY_VARIANCE:
      return 'border-amber-200 bg-amber-50 text-amber-950';
    case POReconciliationLineMatch.UNMATCHED_PO_LINE:
    case POReconciliationLineMatch.UNMATCHED_RECEIPT_LINE:
      return 'border-slate-200 bg-slate-50 text-slate-900';
    default:
      return 'border-violet-200 bg-violet-50 text-violet-950';
  }
}

function spendAlertStatusChipClass(s: SpendAlertStatus): string {
  switch (s) {
    case SpendAlertStatus.OPEN:
      return 'border-amber-200 bg-amber-50 text-amber-950';
    case SpendAlertStatus.SUPERSEDED:
      return 'border-slate-200 bg-slate-100 text-slate-800';
    case SpendAlertStatus.DISMISSED:
      return 'border-neutral-200 bg-neutral-50 text-neutral-600';
    default:
      return 'border-slate-200 bg-slate-50 text-slate-900';
  }
}

export default async function PurchaseOrderReconciliationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireRoleWithEffectiveCompany(Role.ADMIN, Role.SUPER_ADMIN);
  const tenantId = me.tenantId;
  const { id } = await params;

  const po = await prisma.purchaseOrder.findFirst({
    where: { id, tenantId, deletedAt: null },
    select: {
      id: true,
      number: true,
      subtotalCents: true,
      operatorMarkedReconciledAt: true,
      vendor: { select: { id: true, name: true } },
    },
  });
  if (!po) notFound();

  const [latest, spendAlertsHistory] = await Promise.all([
    prisma.pOReconciliation.findFirst({
      where: { tenantId, purchaseOrderId: id },
      orderBy: { createdAt: 'desc' },
      include: {
        lines: {
          orderBy: { sortOrder: 'asc' },
          include: {
            poLineItem: { select: { id: true, description: true } },
            vendorPriceHistory: {
              select: { id: true, itemNameNormalized: true },
            },
          },
        },
      },
    }),
    prisma.spendAlert.findMany({
      where: { tenantId, purchaseOrderId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        status: true,
        kind: true,
        title: true,
        createdAt: true,
        supersededAt: true,
        dismissedAt: true,
        poReconciliationId: true,
        supersededByReconciliationId: true,
      },
    }),
  ]);

  const staleMark =
    po.operatorMarkedReconciledAt &&
    latest &&
    latest.createdAt > po.operatorMarkedReconciledAt;

  const poCandidates =
    latest?.lines.filter(
      (l) =>
        l.match === POReconciliationLineMatch.UNMATCHED_PO_LINE ||
        l.match === POReconciliationLineMatch.AMBIGUOUS_PO_LINE,
    ) ?? [];

  const pairedReviewMatches = new Set<POReconciliationLineMatch>([
    POReconciliationLineMatch.MATCHED,
    POReconciliationLineMatch.PRICE_VARIANCE,
    POReconciliationLineMatch.QTY_VARIANCE,
    POReconciliationLineMatch.PRICE_AND_QTY_VARIANCE,
  ]);

  const headerStatusLine =
    latest?.lines[0]?.match ?? POReconciliationLineMatch.MATCHED;

  return (
    <>
      <PageHeader
        title={`${po.number} · Reconciliation`}
        subtitle={
          po.vendor
            ? `${po.vendor.name} · cached PO subtotal ${fmtMoney(po.subtotalCents)}`
            : 'Assign a vendor on the PO for clearer variance routing.'
        }
        actions={
          <Link
            href={`/purchase-orders/${id}`}
            className="inline-flex items-center justify-center rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3.5 py-2 text-[13.5px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
          >
            Back to PO editor
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap gap-3 text-[13px]">
        <span className="rounded-full border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3 py-1 text-[var(--color-bv-muted)]">
          Operator stamped:{' '}
          <span className="font-medium text-[var(--color-bv-text)]">
            {po.operatorMarkedReconciledAt
              ? po.operatorMarkedReconciledAt.toISOString().slice(0, 16)
              : '—'}
          </span>
        </span>
      </div>

      {staleMark ? (
        <p className="mb-4 text-[13px] text-amber-900">
          A newer snapshot exists after the operator stamp — review again before relying on the
          stamp.
        </p>
      ) : null}

      <p className="mb-4 text-[12.5px] text-[var(--color-bv-muted)]">
        Compares PO lines to <strong className="font-medium text-[var(--color-bv-text)]">OCR-approved</strong>{' '}
        vendor price history. Confirm, accept variance, or reject — PO and estimate totals are never
        auto-adjusted.
      </p>

      <div className="mb-8 flex flex-wrap gap-3">
        <form action={refreshReconciliationFormAction}>
          <input type="hidden" name="purchaseOrderId" value={po.id} />
          <button
            type="submit"
            className="rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-4 py-2 text-[13px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
          >
            Recompute snapshot
          </button>
        </form>
        <form action={markPoReconciledFormAction}>
          <input type="hidden" name="purchaseOrderId" value={po.id} />
          <button
            type="submit"
            className="rounded-[8px] bg-[var(--color-bv-accent)] px-4 py-2 text-[13px] font-medium text-white hover:opacity-95"
          >
            Mark PO reconciled (operator)
          </button>
        </form>
        <Link
          href="/admin/reconciliation"
          className="inline-flex items-center rounded-[8px] border border-[var(--color-bv-border)] px-4 py-2 text-[13px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
        >
          Inbox
        </Link>
      </div>

      {!latest ? (
        <p className="text-[13.5px] text-[var(--color-bv-muted)]">
          No reconciliation snapshot yet. Approve OCR receipt lines on this PO, or
          press <strong>Recompute snapshot</strong> after edits.
        </p>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3 text-[13px]">
            <span
              className={`rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-wide ${matchBadgeClass(
                headerStatusLine,
              )}`}
            >
              {labelPoReconciliationStatus(latest.status)}
            </span>
            <span className="text-[var(--color-bv-muted)]">
              Run {latest.createdAt.toISOString().slice(0, 19).replace('T', ' ')}
            </span>
          </div>

          <div className="overflow-x-auto rounded-[var(--radius-bv)] border border-[var(--color-bv-border)]">
            <table className="w-full min-w-[920px] border-collapse text-left text-[13px]">
              <thead className="border-b border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] text-[11px] font-semibold uppercase tracking-wide text-[var(--color-bv-muted)]">
                <tr>
                  <th className="px-3 py-2.5">Match</th>
                  <th className="px-3 py-2.5">PO line</th>
                  <th className="px-3 py-2.5">Receipt (normalized)</th>
                  <th className="px-3 py-2.5">Expected unit</th>
                  <th className="px-3 py-2.5">Observed unit</th>
                  <th className="px-3 py-2.5">Δ price</th>
                  <th className="px-3 py-2.5">Δ qty (milli)</th>
                  <th className="px-3 py-2.5">Review</th>
                </tr>
              </thead>
              <tbody>
                {latest.lines.map((line) => {
                  const receiptNeedsMerge =
                    line.match === POReconciliationLineMatch.UNMATCHED_RECEIPT_LINE ||
                    line.match === POReconciliationLineMatch.AMBIGUOUS_RECEIPT_LINE;

                  return (
                    <tr
                      key={line.id}
                      className="border-b border-[var(--color-bv-border)] align-top last:border-0"
                    >
                      <td className="px-3 py-2.5">
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${matchBadgeClass(line.match)}`}
                        >
                          {labelReconciliationLineMatch(line.match)}
                        </span>
                        {line.resolution !== POReconciliationLineResolution.NONE ? (
                          <div className="mt-1 text-[10px] font-medium text-[var(--color-bv-muted)]">
                            Op: {line.resolution.replaceAll('_', ' ')}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 text-[12px]">
                        {line.poLineItem?.description ?? '—'}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[11px] text-[var(--color-bv-muted)]">
                        {line.vendorPriceHistory?.itemNameNormalized ?? '—'}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums">
                        {fmtMoney(line.expectedUnitCostCents)}{' '}
                        <span className="text-[11px] text-[var(--color-bv-muted)]">
                          ×{(line.expectedQtyMilli ?? 0) / 1000}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 tabular-nums">
                        {line.observedUnitPriceCents === null
                          ? '—'
                          : fmtMoney(line.observedUnitPriceCents)}{' '}
                        <span className="text-[11px] text-[var(--color-bv-muted)]">
                          ×
                          {line.observedQtyMilli === null
                            ? '—'
                            : line.observedQtyMilli / 1000}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 tabular-nums">
                        {line.priceVarianceCents === null
                          ? '—'
                          : fmtMoney(line.priceVarianceCents)}
                      </td>
                      <td className="px-3 py-2.5 tabular-nums">
                        {line.qtyVarianceMilli === null
                          ? '—'
                          : line.qtyVarianceMilli}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-col gap-1.5">
                          {pairedReviewMatches.has(line.match) ? (
                            <>
                              <form action={reconciliationLineResolutionFormAction}>
                                <input type="hidden" name="lineId" value={line.id} />
                                <input
                                  type="hidden"
                                  name="resolution"
                                  value={POReconciliationLineResolution.CONFIRMED_PAIR}
                                />
                                <button
                                  type="submit"
                                  className="w-full rounded-[6px] border border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-950 hover:bg-emerald-100"
                                >
                                  Confirm pair
                                </button>
                              </form>
                              <form action={reconciliationLineResolutionFormAction}>
                                <input type="hidden" name="lineId" value={line.id} />
                                <input
                                  type="hidden"
                                  name="resolution"
                                  value={
                                    POReconciliationLineResolution.ACCEPTED_VARIANCE
                                  }
                                />
                                <button
                                  type="submit"
                                  className="w-full rounded-[6px] border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-950 hover:bg-amber-100"
                                >
                                  Accept variance
                                </button>
                              </form>
                              <form action={rejectReconciliationLineFormAction}>
                                <input type="hidden" name="lineId" value={line.id} />
                                <button
                                  type="submit"
                                  className="w-full rounded-[6px] border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] font-medium text-rose-950 hover:bg-rose-100"
                                >
                                  Reject mapping
                                </button>
                              </form>
                            </>
                          ) : null}

                          {receiptNeedsMerge && poCandidates.length > 0 ? (
                            <form action={mergeReconciliationLinesFormAction}>
                              <input
                                type="hidden"
                                name="receiptSideLineId"
                                value={line.id}
                              />
                              <select
                                name="poSideLineId"
                                required
                                className="mb-1 w-full rounded-[6px] border border-[var(--color-bv-border)] bg-white px-2 py-1 text-[11px]"
                              >
                                <option value="">Map to PO-side row…</option>
                                {poCandidates.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {(c.poLineItem?.description ?? c.id).slice(0, 60)}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="submit"
                                className="w-full rounded-[6px] bg-[var(--color-bv-accent)] px-2 py-1 text-[11px] font-medium text-white hover:opacity-95"
                              >
                                Merge manual map
                              </button>
                            </form>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-[12px] leading-relaxed text-[var(--color-bv-muted)]">
            Matching is deterministic on normalized descriptions (same engine as vendor
            pricing). Ambiguous counts route to review — never auto-merge.
            Thresholds:{' '}
            <code className="rounded bg-[var(--color-bv-bg)] px-1 py-0.5 font-mono text-[11px]">
              RECON_PRICE_TOLERANCE_BPS
            </code>
            ,{' '}
            <code className="rounded bg-[var(--color-bv-bg)] px-1 py-0.5 font-mono text-[11px]">
              RECON_ABSOLUTE_PRICE_TOLERANCE_CENTS
            </code>
            ,{' '}
            <code className="rounded bg-[var(--color-bv-bg)] px-1 py-0.5 font-mono text-[11px]">
              RECON_QTY_TOLERANCE_BPS
            </code>
            .
          </p>
        </>
      )}

      <section className="mt-10">
        <h2 className="mb-3 text-[15px] font-semibold text-[var(--color-bv-text)]">
          Spend alerts (this PO)
        </h2>
        <p className="mb-4 text-[13px] text-[var(--color-bv-muted)]">
          Historical rows stay visible for audit. Dashboard counts use{' '}
          <span className="font-medium text-[var(--color-bv-text)]">OPEN</span> only;
          new reconciliation snapshots supersede prior OPEN alerts tied to an older run (
          <span className="font-medium text-[var(--color-bv-text)]">SUPERSEDED</span>
          ).
        </p>
        {spendAlertsHistory.length === 0 ? (
          <p className="text-[13px] text-[var(--color-bv-muted)]">
            No spend alerts recorded for this PO yet.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-[var(--radius-bv)] border border-[var(--color-bv-border)]">
            <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
              <thead className="border-b border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] text-[11px] font-semibold uppercase tracking-wide text-[var(--color-bv-muted)]">
                <tr>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">Kind</th>
                  <th className="px-3 py-2.5">Title</th>
                  <th className="px-3 py-2.5">Created</th>
                  <th className="px-3 py-2.5">Snapshot</th>
                </tr>
              </thead>
              <tbody>
                {spendAlertsHistory.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-[var(--color-bv-border)] last:border-b-0"
                  >
                    <td className="px-3 py-2 align-middle">
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${spendAlertStatusChipClass(
                          row.status,
                        )}`}
                      >
                        {row.status.replaceAll('_', ' ')}
                      </span>
                    </td>
                    <td className="px-3 py-2 align-middle font-mono text-[11px] text-[var(--color-bv-muted)]">
                      {labelSpendAlertKind(row.kind)}
                    </td>
                    <td className="max-w-[280px] px-3 py-2 align-middle text-[12px]">
                      {row.title}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 align-middle text-[12px] text-[var(--color-bv-muted)]">
                      {row.createdAt.toISOString().slice(0, 19).replace('T', ' ')}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 align-middle font-mono text-[11px] text-[var(--color-bv-muted)]">
                      {row.poReconciliationId ? row.poReconciliationId.slice(0, 8) : '—'}
                      {row.supersededByReconciliationId ? (
                        <span className="block text-[10px] normal-case text-[var(--color-bv-muted)]">
                          superseded by{' '}
                          {row.supersededByReconciliationId.slice(0, 8)}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
