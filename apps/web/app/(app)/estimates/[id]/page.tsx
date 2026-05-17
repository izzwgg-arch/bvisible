import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  EstimateTimelineKind,
  EstimateStatus,
  POAttachmentKind,
  prisma,
  Role,
} from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { EstimateDailyWorkflowStrip } from '@/components/estimate/estimate-daily-workflow-strip';
import { getEstimateEditorPrimaryAction } from '@/lib/estimate/estimate-editor-primary-action';
import { EstimateQuoteLinkPanel } from '@/components/estimate/estimate-quote-link-panel';
import { EstimateQuoteResponseSummary } from '@/components/estimate/estimate-quote-response-summary';
import { EstimateFulfillmentPanel } from '@/components/estimate/estimate-fulfillment-panel';
import { EstimateRelationshipFlowStrip } from '@/components/estimate/estimate-relationship-flow-strip';
import { EstimateTimelineSection } from '@/components/estimate/estimate-timeline-section';
import { loadEstimateQuoteStaffUi } from '@/lib/estimate/load-estimate-quote-staff-ui';
import {
  countReceiptOcrBuckets,
  fulfillmentHeadlineForEstimateStatus,
  fulfillmentOperationalHints,
  mapLinkedPoToEstimateBootstrap,
} from '@/lib/estimate/estimate-fulfillment';
import { EstimateEditor, type EditorBootstrap } from './editor';
import {
  buildEstimateOperationalRailSteps,
  deriveEstimateOperationalSteps,
} from '@/lib/estimate/estimate-invoice-fulfillment';
import { loadEstimateCatalogPickerRows } from '@/lib/shop-material/estimate-catalog-bootstrap';

export const metadata = { title: 'Estimate' };
export const dynamic = 'force-dynamic';

export default async function EstimateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireTenantId();
  const { id } = await params;

  const [
    estimate,
    machines,
    clients,
    linkedPosRaw,
    quoteAcceptedEvent,
    vendors,
    shopCatalog,
    linkedInvoiceRow,
    quoteSentAudit,
    finalizedAudit,
  ] = await Promise.all([
    prisma.estimate.findFirst({
      where: { id, tenantId: me.tenantId, deletedAt: null },
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        notes: true,
        multiplierMilli: true,
        designFlatCents: true,
        subtotalCostCents: true,
        finalPriceCents: true,
        updatedAt: true,
        client: { select: { id: true, companyName: true } },
        createdBy: { select: { email: true, name: true } },
        lines: {
          orderBy: [{ sortOrder: 'asc' }],
          select: {
            id: true,
            kind: true,
            description: true,
            qtyMilli: true,
            unitCostCents: true,
            machineId: true,
            notes: true,
          },
        },
      },
    }),
    prisma.machine.findMany({
      where: { tenantId: me.tenantId, isActive: true },
      orderBy: [{ name: 'asc' }],
      select: { id: true, name: true, ratePerHourCents: true },
    }),
    prisma.client.findMany({
      where: { tenantId: me.tenantId, deletedAt: null },
      orderBy: [{ companyName: 'asc' }],
      select: { id: true, companyName: true },
      take: 500,
    }),
    prisma.purchaseOrder.findMany({
      where: { tenantId: me.tenantId, estimateId: id, deletedAt: null },
      orderBy: [{ createdAt: 'asc' }],
      select: {
        id: true,
        number: true,
        status: true,
        qboPoNumber: true,
        subtotalCents: true,
        createdAt: true,
        vendor: { select: { id: true, name: true } },
        reconciliations: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { status: true },
        },
        attachments: {
          where: {
            kind: {
              in: [
                POAttachmentKind.RECEIPT,
                POAttachmentKind.INVOICE,
                POAttachmentKind.VENDOR_INVOICE,
              ],
            },
          },
          select: {
            ocrDocument: { select: { status: true } },
          },
        },
      },
    }),
    prisma.estimateTimelineEvent.findFirst({
      where: {
        tenantId: me.tenantId,
        estimateId: id,
        kind: EstimateTimelineKind.QUOTE_ACCEPTED,
      },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    }),
    prisma.vendor.findMany({
      where: { tenantId: me.tenantId, deletedAt: null },
      orderBy: [{ name: 'asc' }],
      select: { id: true, name: true },
      take: 500,
    }),
    loadEstimateCatalogPickerRows(prisma, me.tenantId),
    prisma.invoice.findFirst({
      where: { tenantId: me.tenantId, estimateId: id, deletedAt: null },
      select: {
        id: true,
        number: true,
        status: true,
        paidAt: true,
        createdAt: true,
        subtotalCents: true,
      },
    }),
    prisma.auditLog.findFirst({
      where: {
        tenantId: me.tenantId,
        action: 'estimate_sent_to_client',
        targetType: 'estimate',
        targetId: id,
      },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    }),
    prisma.auditLog.findFirst({
      where: {
        tenantId: me.tenantId,
        action: 'estimate_finalized',
        targetType: 'estimate',
        targetId: id,
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
  ]);

  if (!estimate) {
    notFound();
  }

  const quoteUi = await loadEstimateQuoteStaffUi(
    prisma,
    me.tenantId,
    estimate.id,
    estimate.number,
    estimate.status
  );

  const now = new Date();
  const linkedBootstrapRows = linkedPosRaw.map((po) => {
    const ocrStatuses = po.attachments.map((a) => a.ocrDocument?.status);
    const { pendingOrProcessing, needsReview } = countReceiptOcrBuckets(ocrStatuses);
    return mapLinkedPoToEstimateBootstrap({
      id: po.id,
      number: po.number,
      status: po.status,
      qboPoNumber: po.qboPoNumber,
      subtotalCents: po.subtotalCents,
      createdAt: po.createdAt,
      vendor: po.vendor,
      latestReconciliationStatus: po.reconciliations[0]?.status ?? null,
      receiptishAttachmentCount: po.attachments.length,
      ocrPendingOrProcessingCount: pendingOrProcessing,
      ocrNeedsReviewCount: needsReview,
    });
  });

  const fulfillmentHeadline = fulfillmentHeadlineForEstimateStatus(estimate.status);
  const fulfillmentHints = fulfillmentOperationalHints({
    estimateStatus: estimate.status,
    linkedPoCount: linkedBootstrapRows.length,
    quoteAcceptedAt: quoteAcceptedEvent?.createdAt ?? null,
    linkedPos: linkedBootstrapRows,
    linkedInvoice:
      linkedInvoiceRow == null
        ? undefined
        : {
            number: linkedInvoiceRow.number,
            status: linkedInvoiceRow.status,
            paidAt: linkedInvoiceRow.paidAt,
          },
    now,
  });

  const operationalRail = buildEstimateOperationalRailSteps({
    estimateStatus: estimate.status,
    linkedPoCount: linkedBootstrapRows.length,
    linkedInvoice:
      linkedInvoiceRow == null
        ? null
        : {
            status: linkedInvoiceRow.status,
            paidAt: linkedInvoiceRow.paidAt,
            createdAt: linkedInvoiceRow.createdAt,
          },
    quoteSentAt: quoteSentAudit?.createdAt ?? null,
    quoteAcceptedAt: quoteAcceptedEvent?.createdAt ?? null,
    firstPoCreatedAt: linkedPosRaw[0]?.createdAt ?? null,
    finalizedAt:
      estimate.status === EstimateStatus.FINALIZED ? finalizedAudit?.createdAt ?? null : null,
  });

  const flowFlags = deriveEstimateOperationalSteps({
    estimateStatus: estimate.status,
    linkedPoCount: linkedBootstrapRows.length,
    linkedInvoice:
      linkedInvoiceRow == null
        ? null
        : { status: linkedInvoiceRow.status, paidAt: linkedInvoiceRow.paidAt },
  });

  const linkedInvoiceSnapshot =
    linkedInvoiceRow == null
      ? null
      : {
          id: linkedInvoiceRow.id,
          number: linkedInvoiceRow.number,
          status: linkedInvoiceRow.status,
          paidAtIso: linkedInvoiceRow.paidAt?.toISOString() ?? null,
          createdAtIso: linkedInvoiceRow.createdAt.toISOString(),
          subtotalCents: linkedInvoiceRow.subtotalCents,
        };

  const primary = getEstimateEditorPrimaryAction({
    estimateId: estimate.id,
    status: estimate.status,
    lineCount: estimate.lines.length,
    hasLinkedPo: linkedPosRaw.length > 0,
    hasLinkedInvoice: linkedInvoiceRow != null,
    quoteLinkActive: quoteUi.quotePanelProps.activeLink != null,
  });

  const bootstrap: EditorBootstrap = {
    estimate: {
      id: estimate.id,
      number: estimate.number,
      title: estimate.title,
      status: estimate.status,
      notes: estimate.notes ?? '',
      multiplierMilli: estimate.multiplierMilli,
      designFlatCents: estimate.designFlatCents,
      subtotalCostCents: estimate.subtotalCostCents,
      finalPriceCents: estimate.finalPriceCents,
      updatedAt: estimate.updatedAt.toISOString(),
      client: estimate.client,
    },
    lines: estimate.lines.map((l) => ({
      id: l.id,
      kind: l.kind,
      description: l.description,
      qtyMilli: l.qtyMilli,
      unitCostCents: l.unitCostCents,
      machineId: l.machineId,
      notes: l.notes,
    })),
    machines,
    clients,
    vendors,
    linkedPos: linkedBootstrapRows,
    canDelete: me.role === Role.ADMIN || me.role === Role.SUPER_ADMIN,
    canUnfinalize: me.role === Role.ADMIN || me.role === Role.SUPER_ADMIN,
    shopCatalog,
  };

  return (
    <>
      <PageHeader
        title={`${estimate.number} · ${estimate.title}`}
        subtitle={`Client: ${estimate.client.companyName} · created by ${
          estimate.createdBy.name ?? estimate.createdBy.email
        }`}
        actions={
          <>
            <Link
              href={`/estimates/${estimate.id}/preview`}
              className="inline-flex items-center justify-center rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3.5 py-2 text-[13.5px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
            >
              Preview quote
            </Link>
            <Link
              href={`/estimates/${estimate.id}/preview#customer-send`}
              className="inline-flex items-center justify-center rounded-[8px] bg-[var(--color-bv-accent)] px-3.5 py-2 text-[13.5px] font-medium text-[var(--color-bv-accent-foreground)] shadow-sm hover:opacity-95"
            >
              Send to customer
            </Link>
            <Link
              href="/estimates"
              className="inline-flex items-center justify-center rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3.5 py-2 text-[13.5px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
            >
              All estimates
            </Link>
          </>
        }
      />
      <div className="mx-auto max-w-[1200px] px-4 lg:px-6">
        <EstimateDailyWorkflowStrip
          status={estimate.status}
          quoteSent={quoteSentAudit != null || estimate.status !== EstimateStatus.DRAFT}
          hasPo={linkedPosRaw.length > 0}
          hasInvoice={linkedInvoiceRow != null}
          primaryHref={primary.href}
          primaryLabel={primary.label}
          hint={primary.hint}
        />
      </div>
      <div className="mx-auto mb-6 flex max-w-[1200px] flex-col gap-4 px-4 lg:px-6">
        <EstimateFulfillmentPanel
          estimateId={estimate.id}
          estimateStatus={estimate.status}
          headline={fulfillmentHeadline}
          hints={fulfillmentHints}
          operationalSteps={operationalRail.map((s) => ({
            key: s.key,
            label: s.label,
            done: s.done,
            atIso: s.at ? s.at.toISOString() : null,
          }))}
          relationshipStrip={
            <EstimateRelationshipFlowStrip
              estimateId={estimate.id}
              quoteDone={flowFlags.customer_approved}
              poDone={flowFlags.po_created}
              invoiceDone={flowFlags.invoice_created}
              paidDone={flowFlags.invoice_paid}
              firstPoId={linkedPosRaw[0]?.id ?? null}
              invoiceId={linkedInvoiceRow?.id ?? null}
            />
          }
          linkedInvoice={linkedInvoiceSnapshot}
          linkedPos={linkedBootstrapRows}
        />
        <EstimateQuoteResponseSummary {...quoteUi.quoteSummaryProps} />
        <EstimateTimelineSection rows={quoteUi.timelineRows} />
        <EstimateQuoteLinkPanel
          estimateId={estimate.id}
          estimateStatus={estimate.status}
          quoteLinkRowsDesc={quoteUi.quoteLinkRows}
          activeLink={quoteUi.quotePanelProps.activeLink}
          phaseBadgeLabel={quoteUi.quotePanelProps.phaseBadgeLabel}
          disableRegenerate={quoteUi.quotePanelProps.disableRegenerate}
          regenerateDisabledReason={quoteUi.quotePanelProps.regenerateDisabledReason}
        />
      </div>
      <EstimateEditor bootstrap={bootstrap} />
    </>
  );
}
