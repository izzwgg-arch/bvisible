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
import { ReconciliationSafetyBanner } from '@/components/reconciliation/reconciliation-safety-banner';
import {
  buildReconciliationSnapshotSummary,
  ReconciliationSnapshotSummaryBar,
} from '@/components/reconciliation/reconciliation-snapshot-summary';
import { ReconciliationToolbar } from '@/components/reconciliation/reconciliation-toolbar';
import {
  SpendAlertKindChip,
  SpendAlertStatusChip,
} from '@/components/reconciliation/reconciliation-badges';
import { VarianceLineRow } from '@/components/reconciliation/variance-line-row';
import {
  RECON_EMPTY_CLEAN,
  RECON_EMPTY_NO_SNAPSHOT,
} from '@/lib/reconciliation/ui-copy';
import { fmtReconMoney } from '@/lib/reconciliation/ui-format';

export const metadata = { title: 'PO reconciliation' };
export const dynamic = 'force-dynamic';

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

  const openAlertCount = spendAlertsHistory.filter(
    (a) => a.status === SpendAlertStatus.OPEN,
  ).length;

  const staleMark = Boolean(
    po.operatorMarkedReconciledAt &&
      latest &&
      latest.createdAt > po.operatorMarkedReconciledAt,
  );

  const poCandidates =
    latest?.lines
      .filter(
        (l) =>
          l.match === POReconciliationLineMatch.UNMATCHED_PO_LINE ||
          l.match === POReconciliationLineMatch.AMBIGUOUS_PO_LINE,
      )
      .map((c) => ({
        id: c.id,
        description: c.poLineItem?.description ?? c.id,
      })) ?? [];

  const summary = latest ? buildReconciliationSnapshotSummary(latest.lines) : null;

  const showMarkReconciledPrimary = Boolean(
    summary?.isClean && openAlertCount === 0 && !po.operatorMarkedReconciledAt,
  );

  const unresolvedLines =
    latest?.lines.filter(
      (l) =>
        l.resolution === POReconciliationLineResolution.NONE &&
        l.match !== POReconciliationLineMatch.MATCHED,
    ) ?? [];
  const resolvedLines =
    latest?.lines.filter(
      (l) =>
        l.resolution !== POReconciliationLineResolution.NONE ||
        l.match === POReconciliationLineMatch.MATCHED,
    ) ?? [];

  return (
    <>
      <PageHeader
        title={`${po.number} · Reconciliation`}
        subtitle={
          po.vendor
            ? `${po.vendor.name} · cached PO subtotal ${fmtReconMoney(po.subtotalCents)}`
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

      <ReconciliationSafetyBanner compact />

      <div className="mb-4 mt-3 flex flex-wrap gap-2 text-[12.5px]">
        <span className="rounded-full border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3 py-1 text-[var(--color-bv-muted)]">
          Operator stamp:{' '}
          <span className="font-medium text-[var(--color-bv-text)]">
            {po.operatorMarkedReconciledAt
              ? po.operatorMarkedReconciledAt.toISOString().slice(0, 16).replace('T', ' ')
              : 'Not set'}
          </span>
        </span>
        {openAlertCount > 0 ? (
          <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 font-medium text-amber-950">
            {openAlertCount} open alert{openAlertCount === 1 ? '' : 's'}
          </span>
        ) : null}
      </div>

      <ReconciliationToolbar
        purchaseOrderId={po.id}
        showMarkReconciledPrimary={showMarkReconciledPrimary}
        staleMark={staleMark}
      />

      {!latest ? (
        <div className="rounded-[var(--radius-bv)] border border-dashed border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-5 py-8 shadow-[var(--shadow-bv-card)]">
          <p className="text-[13.5px] font-medium text-[var(--color-bv-text)]">No snapshot yet</p>
          <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-[var(--color-bv-muted)]">
            {RECON_EMPTY_NO_SNAPSHOT}
          </p>
        </div>
      ) : (
        <>
          <ReconciliationSnapshotSummaryBar
            status={latest.status}
            runAt={latest.createdAt}
            summary={summary!}
            openAlertCount={openAlertCount}
          />

          {summary!.isClean ? (
            <div className="mb-4 rounded-[10px] border border-emerald-200 bg-emerald-50/60 px-4 py-3 text-[13px] text-emerald-950">
              {RECON_EMPTY_CLEAN}
            </div>
          ) : null}

          {unresolvedLines.length > 0 ? (
            <section className="mb-6">
              <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--color-bv-muted)]">
                Needs review ({unresolvedLines.length})
              </h2>
              <div className="flex flex-col gap-2">
                {unresolvedLines.map((line) => (
                  <VarianceLineRow
                    key={line.id}
                    line={{
                      id: line.id,
                      match: line.match,
                      resolution: line.resolution,
                      poDescription: line.poLineItem?.description ?? null,
                      receiptName: line.vendorPriceHistory?.itemNameNormalized ?? null,
                      expectedUnitCostCents: line.expectedUnitCostCents,
                      expectedQtyMilli: line.expectedQtyMilli,
                      observedUnitPriceCents: line.observedUnitPriceCents,
                      observedQtyMilli: line.observedQtyMilli,
                      priceVarianceCents: line.priceVarianceCents,
                      qtyVarianceMilli: line.qtyVarianceMilli,
                    }}
                    poCandidates={poCandidates}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {resolvedLines.length > 0 ? (
            <section>
              <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--color-bv-muted)]">
                Matched / resolved ({resolvedLines.length})
              </h2>
              <div className="flex flex-col gap-2">
                {resolvedLines.map((line) => (
                  <VarianceLineRow
                    key={line.id}
                    line={{
                      id: line.id,
                      match: line.match,
                      resolution: line.resolution,
                      poDescription: line.poLineItem?.description ?? null,
                      receiptName: line.vendorPriceHistory?.itemNameNormalized ?? null,
                      expectedUnitCostCents: line.expectedUnitCostCents,
                      expectedQtyMilli: line.expectedQtyMilli,
                      observedUnitPriceCents: line.observedUnitPriceCents,
                      observedQtyMilli: line.observedQtyMilli,
                      priceVarianceCents: line.priceVarianceCents,
                      qtyVarianceMilli: line.qtyVarianceMilli,
                    }}
                    poCandidates={poCandidates}
                  />
                ))}
              </div>
            </section>
          ) : null}

          <p className="mt-4 text-[11.5px] leading-relaxed text-[var(--color-bv-muted)]">
            Deterministic pairing on normalized descriptions. Threshold env vars:{' '}
            <code className="rounded bg-[var(--color-bv-bg)] px-1 font-mono text-[10.5px]">
              RECON_PRICE_TOLERANCE_BPS
            </code>
            ,{' '}
            <code className="rounded bg-[var(--color-bv-bg)] px-1 font-mono text-[10.5px]">
              RECON_ABSOLUTE_PRICE_TOLERANCE_CENTS
            </code>
            ,{' '}
            <code className="rounded bg-[var(--color-bv-bg)] px-1 font-mono text-[10.5px]">
              RECON_QTY_TOLERANCE_BPS
            </code>
            .
          </p>
        </>
      )}

      <section className="mt-10">
        <h2 className="mb-1 text-[14px] font-semibold text-[var(--color-bv-text)]">
          Spend alerts (this PO)
        </h2>
        <p className="mb-3 text-[12px] text-[var(--color-bv-muted)]">
          OPEN alerts feed the dashboard. New snapshots supersede older OPEN rows (SUPERSEDED).
        </p>
        {spendAlertsHistory.length === 0 ? (
          <p className="text-[13px] text-[var(--color-bv-muted)]">
            No spend alerts recorded for this PO yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {spendAlertsHistory.map((row) => (
              <li
                key={row.id}
                className={`rounded-[10px] border px-3 py-2.5 text-[13px] ${
                  row.status === SpendAlertStatus.OPEN
                    ? 'border-amber-200 bg-amber-50/40'
                    : 'border-[var(--color-bv-border)] bg-[var(--color-bv-surface)]'
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <SpendAlertStatusChip status={row.status} />
                  <SpendAlertKindChip kind={row.kind} />
                  <span className="text-[12px] text-[var(--color-bv-muted)]">
                    {row.createdAt.toISOString().slice(0, 19).replace('T', ' ')}
                  </span>
                </div>
                <p className="mt-1 font-medium text-[var(--color-bv-text)]">{row.title}</p>
                {row.poReconciliationId ? (
                  <p className="mt-0.5 font-mono text-[10.5px] text-[var(--color-bv-muted)]">
                    Snapshot {row.poReconciliationId.slice(0, 8)}
                    {row.supersededByReconciliationId
                      ? ` · superseded by ${row.supersededByReconciliationId.slice(0, 8)}`
                      : ''}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
