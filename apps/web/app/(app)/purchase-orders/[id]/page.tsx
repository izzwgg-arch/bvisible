import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { getPoLifecycleSnapshot } from '@/lib/po/get-po-lifecycle-snapshot';
import { getPoReceiptWorkflowSummary } from '@/lib/po/get-po-receipt-workflow-summary';
import { PoEstimateOriginSection } from '@/components/po/po-estimate-origin-section';
import { loadEstimateQuoteStaffUi } from '@/lib/estimate/load-estimate-quote-staff-ui';
import { loadEstimateCatalogPickerRows } from '@/lib/shop-material/estimate-catalog-bootstrap';
import { buildOrderableCatalog } from '@/lib/po/orderable-catalog';
import { amazonAssociateTag } from '@/lib/po/amazon-associate-tag';
import { loadPoCcRecipients } from '@/lib/emails/po-cc';
import { PoRedesignEditor, type PoRedesignBootstrap } from './po-redesign-editor';

export const metadata = { title: 'Purchase order' };
export const dynamic = 'force-dynamic';

export default async function PurchaseOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireTenantId();
  const { id } = await params;

  const [po, vendors, events, catalog, sheetCatalog] = await Promise.all([
    prisma.purchaseOrder.findFirst({
      where: { id, tenantId: me.tenantId, deletedAt: null },
      select: {
        id: true,
        number: true,
        status: true,
        qboPoNumber: true,
        notes: true,
        subtotalCents: true,
        updatedAt: true,
        createdAt: true,
        operatorMarkedReconciledAt: true,
        vendor: { select: { id: true, name: true, email: true, emails: true } },
        estimate: {
          select: {
            id: true,
            number: true,
            title: true,
            status: true,
            client: { select: { companyName: true } },
          },
        },
        createdBy: { select: { name: true, email: true } },
        lines: {
          orderBy: [{ sortOrder: 'asc' }],
          select: {
            id: true,
            kind: true,
            description: true,
            estimateLineId: true,
            catalogItemId: true,
            bundleComponentId: true,
            vendorId: true,
            selectedVendorMode: true,
            vendorSku: true,
            unit: true,
            qtyMilli: true,
            unitCostCents: true,
            computedCostCents: true,
            receivedQtyMilli: true,
            notes: true,
            vendor: { select: { id: true, name: true, email: true, emails: true } },
            catalogItem: { select: { name: true, itemCode: true } },
            estimateLine: { select: { sortOrder: true, description: true } },
            bundleComponent: { select: { componentName: true } },
          },
        },
        vendorSections: {
          orderBy: [{ vendor: { name: 'asc' } }],
          select: {
            id: true,
            vendorId: true,
            status: true,
            sentAt: true,
            messageId: true,
            lastError: true,
            vendor: { select: { id: true, name: true, email: true, emails: true } },
          },
        },
        attachments: {
          orderBy: [{ createdAt: 'desc' }],
          select: {
            id: true,
            originalFilename: true,
            mimeType: true,
            sizeBytes: true,
            kind: true,
            createdAt: true,
            sourceEmailId: true,
            uploadedBy: { select: { name: true, email: true } },
          },
        },
      },
    }),
    prisma.vendor.findMany({
      where: { tenantId: me.tenantId, deletedAt: null },
      orderBy: [{ name: 'asc' }],
      select: { id: true, name: true, email: true, emails: true },
      take: 500,
    }),
    prisma.pOEvent.findMany({
      where: { purchaseOrderId: id, tenantId: me.tenantId },
      orderBy: [{ createdAt: 'desc' }],
      take: 100,
      select: {
        id: true,
        kind: true,
        message: true,
        createdAt: true,
        actor: { select: { name: true, email: true } },
      },
    }),
    loadEstimateCatalogPickerRows(prisma, me.tenantId),
    // Full Sheet materials catalog — the picker searches this alongside
    // the Items catalog so every orderable material is reachable.
    buildOrderableCatalog(me.tenantId).catch(() => null),
  ]);

  if (!po) {
    notFound();
  }

  const [receiptWorkflowSummary, lifecycleSnapshot, poCcRecipients] = await Promise.all([
    getPoReceiptWorkflowSummary(me.tenantId, id),
    getPoLifecycleSnapshot(me.tenantId, id),
    // Shown in the Send PO confirm panel so the CC list is visible before
    // anything is emailed.
    loadPoCcRecipients(me.tenantId),
  ]);

  const estimateOriginQuoteUi =
    po.estimate != null
      ? await loadEstimateQuoteStaffUi(
          prisma,
          me.tenantId,
          po.estimate.id,
          po.estimate.number,
          po.estimate.status
        )
      : null;

  // First email-open per vendor (from the tracking pixel) for the
  // "Opened" stamp on each vendor section.
  const emailOpenAudits = await prisma.auditLog.findMany({
    where: {
      tenantId: me.tenantId,
      targetType: 'purchase_order',
      targetId: id,
      action: 'po_email_opened',
    },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true, metadata: true },
  });
  const emailOpensByVendor = new Map<string, Date>();
  for (const row of emailOpenAudits) {
    const meta = row.metadata as Record<string, unknown> | null;
    const name = meta && typeof meta.vendorName === 'string' ? meta.vendorName : null;
    if (name && !emailOpensByVendor.has(name)) emailOpensByVendor.set(name, row.createdAt);
  }

  const bootstrap: PoRedesignBootstrap = {
    po: {
      id: po.id,
      number: po.number,
      status: po.status,
      qboPoNumber: po.qboPoNumber,
      notes: po.notes ?? '',
      subtotalCents: po.subtotalCents,
      updatedAt: po.updatedAt.toISOString(),
      vendor: po.vendor,
      estimate: po.estimate
        ? { id: po.estimate.id, number: po.estimate.number, title: po.estimate.title }
        : null,
      createdByLabel: po.createdBy.name ?? po.createdBy.email,
    },
    lines: po.lines.map((l) => ({
      id: l.id,
      kind: l.kind,
      description: l.description,
      estimateLineId: l.estimateLineId,
      catalogItemId: l.catalogItemId,
      bundleComponentId: l.bundleComponentId,
      vendorId: l.vendorId,
      selectedVendorMode: l.selectedVendorMode,
      vendorSku: l.vendorSku,
      unit: l.unit,
      qtyMilli: l.qtyMilli,
      unitCostCents: l.unitCostCents,
      computedCostCents: l.computedCostCents,
      receivedQtyMilli: l.receivedQtyMilli,
      notes: l.notes,
      vendor: l.vendor,
      catalogItemName: l.catalogItem?.name ?? null,
      catalogItemCode: l.catalogItem?.itemCode ?? null,
      sourceEstimateLineLabel: l.estimateLine ? `Est. line ${l.estimateLine.sortOrder + 1}` : null,
      sourceBundleComponentLabel: l.bundleComponent?.componentName ?? null,
    })),
    vendors,
    vendorSections: po.vendorSections.map((section) => ({
      id: section.id,
      vendorId: section.vendorId,
      status: section.status,
      sentAt: section.sentAt?.toISOString() ?? null,
      openedAt: emailOpensByVendor.get(section.vendor.name)?.toISOString() ?? null,
      messageId: section.messageId,
      lastError: section.lastError,
      vendor: section.vendor,
    })),
    catalog,
    // Server-read: Amazon's add-to-cart endpoint requires this tag, and
    // without it a cart link silently redirects to a product page.
    amazonAssociateTag: amazonAssociateTag(),
    poCcRecipients,
    sheetCatalog: sheetCatalog?.entries ?? [],
    sheetAliases: sheetCatalog?.aliases ?? [],
    receiptSummary: receiptWorkflowSummary
      ? {
          latestOcrStatus: receiptWorkflowSummary.latestOcrStatus,
          ocrDocumentsTotal: receiptWorkflowSummary.ocrDocumentsTotal,
          latestReconciliationStatus: receiptWorkflowSummary.latestReconciliationStatus,
          openSpendAlertCount: receiptWorkflowSummary.openSpendAlertCount,
          operatorMarkedReconciledAt: receiptWorkflowSummary.operatorMarkedReconciledAt?.toISOString() ?? null,
        }
      : null,
    lifecycle: lifecycleSnapshot
      ? {
          label: lifecycleSnapshot.label,
          receiptProgressLabel: lifecycleSnapshot.receiptProgressLabel,
          vendorResponseLabel: lifecycleSnapshot.vendorResponseLabel,
        }
      : null,
    events: events.map((e) => ({
      id: e.id,
      kind: e.kind,
      message: e.message,
      createdAt: e.createdAt.toISOString(),
      actorLabel: e.actor ? e.actor.name ?? e.actor.email : null,
    })),
    attachments: po.attachments.map((a) => ({
      id: a.id,
      originalFilename: a.originalFilename,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      kind: a.kind,
      createdAt: a.createdAt.toISOString(),
      sourceEmailId: a.sourceEmailId,
      uploadedByLabel: a.uploadedBy.name ?? a.uploadedBy.email,
    })),
  };

  return (
    <>
      <div className="mx-auto max-w-[1440px] px-4 py-4 lg:px-6">
        <PoRedesignEditor bootstrap={bootstrap} />
        {estimateOriginQuoteUi != null && po.estimate != null ? (
          <PoEstimateOriginSection
            estimateId={po.estimate.id}
            estimateNumber={po.estimate.number}
            estimateTitle={po.estimate.title}
            clientCompanyName={po.estimate.client.companyName}
            estimateStatus={po.estimate.status}
            quoteSummaryProps={estimateOriginQuoteUi.quoteSummaryProps}
            defaultCollapsed
          />
        ) : null}
      </div>
    </>
  );
}
