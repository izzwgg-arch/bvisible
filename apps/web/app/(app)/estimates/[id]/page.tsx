import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  EstimateTimelineKind,
  EstimateStatus,
  POAttachmentKind,
  prisma,
  Role,
} from '@bvisible/db';
import { computeEstimate, type LineInput } from '@bvisible/pricing';
import { requireTenantId } from '@/lib/auth/current-user';
import { getEstimateEditorPrimaryAction } from '@/lib/estimate/estimate-editor-primary-action';
import { formatMoney } from '@/lib/estimate/format';
import { labelEstimateStatus, labelPoStatus } from '@/lib/ui/status-labels';
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
  reconciliationGuidanceLabel,
  receiptOcrOperationalHint,
  type EstimateLinkedPoBootstrap,
} from '@/lib/estimate/estimate-fulfillment';
import { EstimateEditor, type EditorBootstrap } from './editor';
import { EstimateSupportTabs } from './estimate-support-tabs';
import {
  buildEstimateOperationalRailSteps,
  deriveEstimateOperationalSteps,
} from '@/lib/estimate/estimate-invoice-fulfillment';
import { loadEstimateCatalogPickerRows } from '@/lib/shop-material/estimate-catalog-bootstrap';
import { buildEstimateFinalizeChecklist } from '@/lib/estimate/estimate-finalize-checklist';

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
        client: { select: { id: true, companyName: true, contactName: true, email: true } },
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

  const finalizeChecklist = buildEstimateFinalizeChecklist({
    estimateId: estimate.id,
    estimateStatus: estimate.status,
    quoteAccepted: quoteAcceptedEvent != null,
    linkedPos: linkedBootstrapRows.map((p) => ({
      id: p.id,
      number: p.number,
      qboPoNumber: p.qboPoNumber,
      latestReconciliationStatus: p.latestReconciliationStatus,
    })),
    linkedInvoice:
      linkedInvoiceRow == null
        ? null
        : {
            id: linkedInvoiceRow.id,
            status: linkedInvoiceRow.status,
            paidAt: linkedInvoiceRow.paidAt,
          },
  });

  const primary = getEstimateEditorPrimaryAction({
    estimateId: estimate.id,
    status: estimate.status,
    lineCount: estimate.lines.length,
    hasLinkedPo: linkedPosRaw.length > 0,
    hasLinkedInvoice: linkedInvoiceRow != null,
    quoteLinkActive: quoteUi.quotePanelProps.activeLink != null,
  });

  const headerComputed = computeEstimate({
    multiplierMilli: estimate.multiplierMilli,
    designFlatCents: estimate.designFlatCents,
    lines: estimate.lines.map(
      (line): LineInput => ({
        id: line.id,
        kind: line.kind,
        qtyMilli: line.qtyMilli,
        unitCostCents: line.unitCostCents,
      })
    ),
  });

  const fulfillmentBlock = (
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
      finalizeChecklist={finalizeChecklist}
    />
  );

  const quoteLinkPanel = (
    <EstimateQuoteLinkPanel
      estimateId={estimate.id}
      estimateStatus={estimate.status}
      quoteLinkRowsDesc={quoteUi.quoteLinkRows}
      activeLink={quoteUi.quotePanelProps.activeLink}
      phaseBadgeLabel={quoteUi.quotePanelProps.phaseBadgeLabel}
      disableRegenerate={quoteUi.quotePanelProps.disableRegenerate}
      regenerateDisabledReason={quoteUi.quotePanelProps.regenerateDisabledReason}
    />
  );

  const supportTabs = (
    <EstimateSupportTabs
      workflow={
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0">{fulfillmentBlock}</div>
          <div className="flex min-w-0 flex-col gap-4">
            <EstimateQuoteResponseSummary {...quoteUi.quoteSummaryProps} />
            {quoteLinkPanel}
          </div>
        </div>
      }
      files={<CompactEmpty title="No files attached" detail="Related quote files and customer documents will appear here when available." />}
      activity={<EstimateTimelineSection rows={quoteUi.timelineRows} />}
      purchaseOrders={<PurchaseOrderTab linkedPos={linkedBootstrapRows} />}
      reconciliation={<ReconciliationTab linkedPos={linkedBootstrapRows} />}
      notes={<NotesTab notes={estimate.notes ?? ''} estimateNumber={estimate.number} />}
      purchaseOrderCount={linkedBootstrapRows.length}
      activityCount={quoteUi.timelineRows.length}
      reconciliationCount={linkedBootstrapRows.filter((p) => p.reconciliationNeedsAttention).length}
    />
  );

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
      quoteSent: quoteSentAudit != null || estimate.status !== EstimateStatus.DRAFT,
      hasInvoice: linkedInvoiceRow != null,
      invoicePaid: linkedInvoiceRow?.paidAt != null,
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
      <EstimateCommandHeader
        estimateId={estimate.id}
        estimateNumber={estimate.number}
        title={estimate.title}
        clientName={estimate.client.companyName}
        createdBy={estimate.createdBy.name ?? estimate.createdBy.email}
        status={estimate.status}
        lineCount={estimate.lines.length}
        linkedPoCount={linkedPosRaw.length}
        finalPriceCents={headerComputed.finalPriceCents}
        rawCostCents={headerComputed.subtotalCostCents}
        updatedAt={estimate.updatedAt}
        primaryHref={primary.href}
        primaryLabel={primary.label}
        primaryHint={primary.hint}
      />
      <EstimateEditor bootstrap={bootstrap} supportTabs={supportTabs} />
    </>
  );
}

function CompactEmpty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-[16px] border border-dashed border-slate-200 bg-slate-50/60 px-4 py-5">
      <p className="text-[13px] font-semibold text-slate-800">{title}</p>
      <p className="mt-1 text-[12.5px] leading-relaxed text-slate-500">{detail}</p>
    </div>
  );
}

function PurchaseOrderTab({ linkedPos }: { linkedPos: ReadonlyArray<EstimateLinkedPoBootstrap> }) {
  if (linkedPos.length === 0) {
    return (
      <CompactEmpty
        title="No purchase orders linked"
        detail="Approved estimates can be linked to existing POs or used to create a new PO from the right rail."
      />
    );
  }

  return (
    <div className="overflow-hidden rounded-[16px] border border-slate-200 bg-white">
      <div className="grid grid-cols-[1fr_auto] border-b border-slate-100 bg-slate-50/70 px-4 py-2.5 text-[10.5px] font-bold uppercase tracking-[0.1em] text-slate-400">
        <span>Purchase order</span>
        <span>Status</span>
      </div>
      <ul className="divide-y divide-slate-100">
        {linkedPos.map((po) => (
          <li key={po.id} className="grid gap-3 px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="min-w-0">
              <Link
                href={`/purchase-orders/${po.id}` as never}
                className="font-mono text-[13px] font-bold text-blue-600 underline-offset-2 hover:underline"
              >
                {po.number}
              </Link>
              <p className="mt-0.5 truncate text-[12px] text-slate-500">
                {po.vendor?.name ?? 'No vendor'} · {formatMoney(po.subtotalCents)} PO total ·{' '}
                <time dateTime={po.createdAtIso}>
                  {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
                    new Date(po.createdAtIso)
                  )}
                </time>
              </p>
            </div>
            <span className="inline-flex justify-self-start rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wide text-slate-600 sm:justify-self-end">
              {labelPoStatus(po.status)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReconciliationTab({ linkedPos }: { linkedPos: ReadonlyArray<EstimateLinkedPoBootstrap> }) {
  const rows = linkedPos
    .map((po) => {
      const recon = reconciliationGuidanceLabel(po.latestReconciliationStatus);
      const ocr = receiptOcrOperationalHint({
        receiptishAttachmentCount: po.receiptishAttachmentCount,
        ocrPendingOrProcessingCount: po.ocrPendingOrProcessingCount,
        ocrNeedsReviewCount: po.ocrNeedsReviewCount,
      });
      return { po, recon, ocr };
    })
    .filter((row) => row.po.reconciliationNeedsAttention || row.recon || row.ocr);

  if (rows.length === 0) {
    return (
      <CompactEmpty
        title="No reconciliation attention"
        detail="Linked purchase orders do not currently show reconciliation or receipt OCR blockers."
      />
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {rows.map(({ po, recon, ocr }) => (
        <li key={po.id} className="rounded-[14px] border border-amber-200 bg-amber-50/45 px-4 py-3">
          <Link
            href={`/purchase-orders/${po.id}` as never}
            className="font-mono text-[13px] font-bold text-amber-900 underline-offset-2 hover:underline"
          >
            {po.number}
          </Link>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {po.reconciliationNeedsAttention ? (
              <span className="rounded-full border border-amber-300 bg-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-950">
                Reconciliation attention
              </span>
            ) : null}
            {recon ? (
              <span className="rounded-full border border-amber-200 bg-white px-2 py-0.5 text-[10px] font-medium text-amber-900">
                {recon}
              </span>
            ) : null}
            {ocr ? (
              <span className="rounded-full border border-amber-200 bg-white px-2 py-0.5 text-[10px] font-medium text-amber-900">
                {ocr}
              </span>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function NotesTab({ notes, estimateNumber }: { notes: string; estimateNumber: string }) {
  return (
    <div className="rounded-[16px] border border-slate-200 bg-white px-4 py-4">
      <p className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-400">
        {estimateNumber} internal notes
      </p>
      <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-slate-600">
        {notes.trim() || 'No internal notes saved yet. Use the estimate details editor above to add notes.'}
      </p>
    </div>
  );
}

function EstimateCommandHeader({
  estimateId,
  estimateNumber,
  title,
  clientName,
  createdBy,
  status,
  lineCount,
  linkedPoCount,
  finalPriceCents,
  rawCostCents,
  updatedAt,
  primaryHref,
  primaryLabel,
  primaryHint,
}: {
  estimateId: string;
  estimateNumber: string;
  title: string;
  clientName: string;
  createdBy: string;
  status: EstimateStatus;
  lineCount: number;
  linkedPoCount: number;
  finalPriceCents: number;
  rawCostCents: number;
  updatedAt: Date;
  primaryHref: string;
  primaryLabel: string;
  primaryHint: string;
}) {
  return (
    <section className="mx-auto max-w-[1440px] px-1">
      <div className="flex flex-col gap-4 border-b border-slate-200/70 pb-5 pt-1 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[12px] font-medium text-slate-400">
            <Link href="/estimates" className="transition hover:text-slate-700">
              Estimates
            </Link>
            <span aria-hidden>/</span>
            <span className="font-semibold text-slate-600">{estimateNumber}</span>
          </div>
          <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-end">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`${statusPill(status)} rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ring-1 ring-inset`}>
                {labelEstimateStatus(status)}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Saved
              </span>
            </div>
            <h1 className="mt-3 max-w-4xl text-[32px] font-bold leading-[1.04] tracking-[-0.045em] text-slate-950 md:text-[40px]">
              {title}
            </h1>
            <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] leading-relaxed text-slate-500">
              <span className="font-semibold text-blue-700">{clientName}</span>
              <span>Created by {createdBy}</span>
              <span>
                Updated{' '}
              <time dateTime={updatedAt.toISOString()}>
                {new Intl.DateTimeFormat(undefined, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                }).format(updatedAt)}
              </time>
              </span>
            </p>
          </div>
            <div className="flex flex-wrap gap-2 lg:pb-1">
              <HeaderMetric label="Sell" value={formatMoney(finalPriceCents)} />
              <HeaderMetric label="Cost" value={formatMoney(rawCostCents)} />
              <HeaderMetric label="Rows / POs" value={`${lineCount} / ${linkedPoCount}`} />
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 xl:pt-8">
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-[12px] border border-slate-200 bg-white text-[18px] font-bold leading-none text-slate-500 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
            title="More estimate actions are available in the right rail."
          >
            ...
          </button>
          <Link
            href={`/estimates/${estimateId}/preview` as never}
            className="inline-flex items-center justify-center rounded-[12px] border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-semibold text-slate-600 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
          >
            Preview
          </Link>
          <Link
            href={primaryHref as never}
            title={primaryHint}
            className="inline-flex items-center justify-center rounded-[12px] border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
          >
            {primaryLabel}
          </Link>
          <Link
            href="#estimate-status-controls"
            className="inline-flex items-center justify-center gap-2 rounded-[12px] bg-gradient-to-br from-blue-600 to-indigo-600 px-4 py-2.5 text-[13px] font-bold text-white shadow-[0_14px_30px_-16px_rgba(37,99,235,0.75)] transition hover:from-blue-500 hover:to-indigo-500"
          >
            Approve
          </Link>
        </div>
      </div>
    </section>
  );
}

function HeaderMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[12px] border border-slate-200 bg-white px-3 py-2 shadow-sm">
      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{label}</p>
      <p className="mt-0.5 text-[15px] font-bold leading-none tabular-nums text-slate-950">{value}</p>
    </div>
  );
}

function statusPill(status: EstimateStatus): string {
  switch (status) {
    case EstimateStatus.APPROVED:
      return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
    case EstimateStatus.SENT:
      return 'bg-blue-50 text-blue-700 ring-blue-200';
    case EstimateStatus.REJECTED:
      return 'bg-rose-50 text-rose-700 ring-rose-200';
    case EstimateStatus.FINALIZED:
      return 'bg-violet-50 text-violet-700 ring-violet-200';
    case EstimateStatus.DRAFT:
    default:
      return 'bg-slate-50 text-slate-600 ring-slate-200';
  }
}
