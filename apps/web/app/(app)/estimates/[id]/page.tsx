import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  EstimateStatus,
  POAttachmentKind,
  prisma,
  Role,
} from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { getEstimateEditorPrimaryAction } from '@/lib/estimate/estimate-editor-primary-action';
import { formatMoney } from '@/lib/estimate/format';
import { labelEstimateStatus, labelPoStatus } from '@/lib/ui/status-labels';
import { EstimateTimelineSection } from '@/components/estimate/estimate-timeline-section';
import { loadEstimateQuoteStaffUi } from '@/lib/estimate/load-estimate-quote-staff-ui';
import {
  countReceiptOcrBuckets,
  mapLinkedPoToEstimateBootstrap,
  reconciliationGuidanceLabel,
  receiptOcrOperationalHint,
  type EstimateLinkedPoBootstrap,
} from '@/lib/estimate/estimate-fulfillment';
import { EstimateEditor, type EditorBootstrap } from './editor';
import { EstimateSupportTabs } from './estimate-support-tabs';
import { loadEstimateCatalogPickerRows } from '@/lib/shop-material/estimate-catalog-bootstrap';
import { EstimateHeaderActions } from './estimate-header-actions';

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
    vendors,
    shopCatalog,
    linkedInvoiceRow,
    quoteSentAudit,
    vehicleLibrary,
    wrapModels,
  ] = await Promise.all([
    prisma.estimate.findFirst({
      where: { id, tenantId: me.tenantId, deletedAt: null },
      select: {
        id: true,
        number: true,
        title: true,
        estimateType: true,
        status: true,
        notes: true,
        multiplierMilli: true,
        designFlatCents: true,
        subtotalCostCents: true,
        finalPriceCents: true,
        client: { select: { id: true, companyName: true, contactName: true, email: true, phone: true } },
        vehicle: {
          select: {
            id: true,
            trimId: true,
            year: true,
            make: true,
            model: true,
            trim: true,
            color: true,
            wrapType: true,
            coverageType: true,
            notes: true,
            photoUrl: true,
            trimRef: {
              select: {
                bodyStyle: true,
                model: { select: { vehicleType: true } },
                dimensionProfiles: { orderBy: [{ updatedAt: 'desc' }], take: 1 },
                photos: { where: { isPrimary: true }, take: 1, select: { url: true } },
              },
            },
          },
        },
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
            materialCostCents: true,
            partialUsageMilli: true,
            laborHoursMilli: true,
            machineTimeMilli: true,
            designTimeMilli: true,
            installTimeMilli: true,
            vendorCostCents: true,
            catalogItemId: true,
            pricingMethod: true,
            pricingEngine: true,
            pricingInputsSnapshotJson: true,
            pricingOutputSnapshotJson: true,
            formulaVersion: true,
            selectedVendorId: true,
            selectedVendorMode: true,
            internalNotes: true,
            hiddenFromCustomer: true,
            customerDescription: true,
            markupExempt: true,
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
      select: { id: true, companyName: true, contactName: true, email: true, phone: true },
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
    prisma.vehicleTrim.findMany({
      where: { tenantId: me.tenantId, deletedAt: null },
      orderBy: [{ year: 'desc' }, { model: { make: { name: 'asc' } } }, { model: { name: 'asc' } }],
      take: 250,
      select: {
        id: true,
        year: true,
        trimName: true,
        bodyStyle: true,
        model: { select: { name: true, vehicleType: true, make: { select: { name: true } } } },
        photos: { where: { isPrimary: true }, take: 1, select: { url: true } },
        dimensionProfiles: { orderBy: [{ updatedAt: 'desc' }], take: 1 },
      },
    }),
    prisma.vehicleModel.findMany({
      where: { tenantId: me.tenantId, wrapPricing: { some: {} } },
      orderBy: [{ make: { name: 'asc' } }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        vehicleType: true,
        make: { select: { name: true } },
        photos: { where: { isPrimary: true }, take: 1, select: { url: true } },
        wrapPricing: {
          orderBy: [{ sortOrder: 'asc' }],
          select: {
            id: true, variant: true, roofWrapOption: true, wheelbase: true, height: true,
            extraVersion1: true, extraOption1: true, charge: true, squareFootage: true,
            ratePerSf: true, pricingRule: true, isActive: true,
          },
        },
      },
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

  const primary = getEstimateEditorPrimaryAction({
    estimateId: estimate.id,
    status: estimate.status,
    lineCount: estimate.lines.length,
    hasLinkedPo: linkedPosRaw.length > 0,
    hasLinkedInvoice: linkedInvoiceRow != null,
    quoteLinkActive: quoteUi.quotePanelProps.activeLink != null,
  });

  const supportTabs = (
    <EstimateSupportTabs
      key="estimate-support-tabs"
      workflow={
        <WorkflowTabPreview
          key="workflow-preview"
          estimateId={estimate.id}
          timelineCount={quoteUi.timelineRows.length}
          primaryHref={primary.href}
          primaryLabel="Send Estimate"
        />
      }
      files={<CompactEmpty key="files-empty" title="No files attached" detail="Related quote files and customer documents will appear here when available." />}
      activity={<EstimateTimelineSection key="activity-timeline" rows={quoteUi.timelineRows} />}
      purchaseOrders={<PurchaseOrderTab key="purchase-orders" linkedPos={linkedBootstrapRows} />}
      reconciliation={<ReconciliationTab key="reconciliation" linkedPos={linkedBootstrapRows} />}
      notes={<NotesTab key="notes" notes={estimate.notes ?? ''} estimateNumber={estimate.number} />}
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
      estimateType: estimate.estimateType,
      notes: estimate.notes ?? '',
      multiplierMilli: estimate.multiplierMilli,
      designFlatCents: estimate.designFlatCents,
      subtotalCostCents: estimate.subtotalCostCents,
      finalPriceCents: estimate.finalPriceCents,
      client: estimate.client,
      quoteSent: quoteSentAudit != null || estimate.status !== EstimateStatus.DRAFT,
      hasInvoice: linkedInvoiceRow != null,
      invoicePaid: linkedInvoiceRow?.paidAt != null,
    },
    estimateVehicle: estimate.vehicle
      ? {
          id: estimate.vehicle.id,
          trimId: estimate.vehicle.trimId,
          year: estimate.vehicle.year,
          make: estimate.vehicle.make,
          model: estimate.vehicle.model,
          trim: estimate.vehicle.trim,
          color: estimate.vehicle.color,
          wrapType: estimate.vehicle.wrapType,
          coverageType: estimate.vehicle.coverageType,
          notes: estimate.vehicle.notes,
          photoUrl: estimate.vehicle.photoUrl ?? estimate.vehicle.trimRef?.photos[0]?.url ?? null,
          bodyStyle: estimate.vehicle.trimRef?.bodyStyle ?? null,
          vehicleType: estimate.vehicle.trimRef?.model.vehicleType ?? null,
          profile: estimate.vehicle.trimRef?.dimensionProfiles[0]
            ? {
                totalApproxWrapSqFt: estimate.vehicle.trimRef.dimensionProfiles[0].totalApproxWrapSqFt,
                sideApproxSqFt: estimate.vehicle.trimRef.dimensionProfiles[0].sideApproxSqFt,
                roofApproxSqFt: estimate.vehicle.trimRef.dimensionProfiles[0].roofApproxSqFt,
                hoodApproxSqFt: estimate.vehicle.trimRef.dimensionProfiles[0].hoodApproxSqFt,
                rearApproxSqFt: estimate.vehicle.trimRef.dimensionProfiles[0].rearApproxSqFt,
                frontApproxSqFt: estimate.vehicle.trimRef.dimensionProfiles[0].frontApproxSqFt,
              }
            : null,
        }
      : null,
    vehicleLibrary: vehicleLibrary.map((vehicle) => ({
      id: vehicle.id,
      year: vehicle.year,
      make: vehicle.model.make.name,
      model: vehicle.model.name,
      trim: vehicle.trimName,
      bodyStyle: vehicle.bodyStyle,
      vehicleType: vehicle.model.vehicleType,
      photoUrl: vehicle.photos[0]?.url ?? null,
      totalApproxWrapSqFt: vehicle.dimensionProfiles[0]?.totalApproxWrapSqFt ?? null,
      sideApproxSqFt: vehicle.dimensionProfiles[0]?.sideApproxSqFt ?? null,
      roofApproxSqFt: vehicle.dimensionProfiles[0]?.roofApproxSqFt ?? null,
      hoodApproxSqFt: vehicle.dimensionProfiles[0]?.hoodApproxSqFt ?? null,
      rearApproxSqFt: vehicle.dimensionProfiles[0]?.rearApproxSqFt ?? null,
      frontApproxSqFt: vehicle.dimensionProfiles[0]?.frontApproxSqFt ?? null,
    })),
    vehicleWrapCatalog: wrapModels.map((m) => ({
      id: m.id,
      make: m.make.name,
      model: m.name,
      vehicleType: m.vehicleType,
      photoUrl: m.photos[0]?.url ?? null,
      variants: m.wrapPricing.map((v) => ({
        id: v.id,
        variant: v.variant,
        roofWrapOption: v.roofWrapOption,
        wheelbase: v.wheelbase,
        height: v.height,
        cab: v.extraVersion1,
        option: v.extraOption1,
        chargeCents: v.charge != null ? Math.round(Number(v.charge) * 100) : null,
        squareFootage: v.squareFootage,
        ratePerSf: v.ratePerSf != null ? Number(v.ratePerSf) : null,
        pricingRule: v.pricingRule,
        isActive: v.isActive,
      })),
    })),
    lines: estimate.lines.map((l) => ({
      id: l.id,
      kind: l.kind,
      description: l.description,
      qtyMilli: l.qtyMilli,
      unitCostCents: l.unitCostCents,
      machineId: l.machineId,
      notes: l.notes,
      materialCostCents: l.materialCostCents,
      partialUsageMilli: l.partialUsageMilli,
      laborHoursMilli: l.laborHoursMilli,
      machineTimeMilli: l.machineTimeMilli,
      designTimeMilli: l.designTimeMilli,
      installTimeMilli: l.installTimeMilli,
      vendorCostCents: l.vendorCostCents,
      catalogItemId: l.catalogItemId,
      pricingMethod: l.pricingMethod,
      pricingEngine: l.pricingEngine,
      pricingInputsSnapshotJson: l.pricingInputsSnapshotJson,
      pricingOutputSnapshotJson: l.pricingOutputSnapshotJson,
      formulaVersion: l.formulaVersion,
      selectedVendorId: l.selectedVendorId,
      selectedVendorMode: l.selectedVendorMode,
      internalNotes: l.internalNotes,
      hiddenFromCustomer: l.hiddenFromCustomer,
      customerDescription: l.customerDescription,
      markupExempt: l.markupExempt,
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
    <div id="estimate-workspace-root">
      <style>{`
        body:has(#estimate-workspace-root) header.sticky {
          display: none;
        }
        body:has(#estimate-workspace-root) {
          background: #ffffff;
        }
        #estimate-workspace-root {
          min-height: 100vh;
          background: #ffffff;
        }
        body:has(#estimate-workspace-root) main {
          padding: 0;
        }
      `}</style>
      <EstimateCommandHeader
        estimateId={estimate.id}
        estimateNumber={estimate.number}
        jobTitle={estimate.title}
        clientId={estimate.client.id}
        clientName={estimate.client.companyName}
        status={estimate.status}
      />
      <EstimateEditor bootstrap={bootstrap} supportTabs={supportTabs} />
    </div>
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

function WorkflowTabPreview({
  estimateId,
  timelineCount,
  primaryHref,
  primaryLabel,
}: {
  estimateId: string;
  timelineCount: number;
  primaryHref: string;
  primaryLabel: string;
}) {
  return (
    <div className="grid min-h-[220px] overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-sm md:grid-cols-[1fr_1fr]">
      <div className="border-b border-slate-100 bg-gradient-to-br from-blue-50 via-white to-white p-5 md:border-b-0 md:border-r">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-blue-600">Recommended next step</p>
        <div className="mt-4 flex items-start gap-4">
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-[18px] bg-blue-50 text-blue-600 ring-1 ring-inset ring-blue-100">
            <span className="text-[22px] leading-none">{'->'}</span>
          </div>
          <div className="min-w-0">
            <p className="text-[14px] font-bold text-slate-950">Send estimate to customer</p>
            <p className="mt-1 max-w-sm text-[12.5px] leading-relaxed text-slate-500">
              Share the public quote link or send via email.
            </p>
            <Link
              href={primaryHref as never}
              className="mt-4 inline-flex items-center justify-center rounded-[12px] bg-gradient-to-br from-blue-600 to-indigo-600 px-4 py-2.5 text-[12.5px] font-bold text-white shadow-[0_12px_24px_-14px_rgba(37,99,235,0.8)] transition hover:-translate-y-0.5 hover:from-blue-500 hover:to-indigo-500"
            >
              {primaryLabel}
            </Link>
          </div>
        </div>
      </div>
      <div className="p-5">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-400">Recent activity</p>
        <div className="mt-4 flex flex-col gap-3">
          <ActivityPreview label="Estimate created" detail="Admin User - Jun 11, 2026 8:48 PM" />
          <ActivityPreview label="Line items updated" detail="Admin User - Jun 11, 2026 8:50 PM" />
        </div>
        <Link
          href={`/estimates/${estimateId}#estimate-activity` as never}
          className="mt-4 inline-flex items-center justify-center rounded-[10px] border border-slate-200 bg-white px-3 py-2 text-[12px] font-bold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
        >
          View all activity
          {timelineCount > 0 ? ` (${timelineCount})` : ''}
        </Link>
      </div>
    </div>
  );
}

function ActivityPreview({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-1 h-2 w-2 rounded-full bg-blue-500 ring-4 ring-blue-50" />
      <div>
        <p className="text-[12.5px] font-bold text-slate-800">{label}</p>
        <p className="mt-0.5 text-[11.5px] text-slate-400">{detail}</p>
      </div>
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
  jobTitle,
  clientId,
  clientName,
  status,
}: {
  estimateId: string;
  estimateNumber: string;
  jobTitle: string;
  clientId: string;
  clientName: string;
  status: EstimateStatus;
}) {
  const displayNumber = estimateNumber.match(/(\d+)$/)?.[1] ?? estimateNumber;
  void jobTitle;
  void clientId;
  void clientName;

  return (
    <section className="border-b border-slate-200 bg-white">
      <div className="flex h-[56px] w-full items-center justify-between px-6">
          <div className="flex min-w-0 items-center gap-8">
            <div className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-slate-400">
              <Link href="/estimates" className="transition hover:text-slate-700">
                Estimates
              </Link>
              <span aria-hidden>›</span>
              <span className="font-black text-slate-950">Estimate #{displayNumber}</span>
              <span className={`${statusPill(status)} rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset`}>
                {labelEstimateStatus(status)}
              </span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-4">
            <span className="inline-flex items-start gap-1.5 text-[11px] font-semibold leading-tight text-slate-500">
              <span className="mt-0.5 h-2 w-2 rounded-full bg-emerald-500" />
              <span>Auto-saved<br />just now</span>
            </span>
              <EstimateHeaderActions estimateId={estimateId} status={status} />
          </div>
      </div>
    </section>
  );
}

function statusActionCopy(status: EstimateStatus): { title: string; detail: string } {
  switch (status) {
    case EstimateStatus.SENT:
      return {
        title: 'Waiting on customer approval',
        detail: 'Keep pricing and fulfillment prep visible while the quote is out.',
      };
    case EstimateStatus.APPROVED:
      return {
        title: 'Ready for fulfillment',
        detail: 'Create or link purchase orders, reconcile costs, then finalize.',
      };
    case EstimateStatus.FINALIZED:
      return {
        title: 'Estimate finalized',
        detail: 'Line edits are locked so accounting and fulfillment stay consistent.',
      };
    case EstimateStatus.REJECTED:
      return {
        title: 'Quote rejected',
        detail: 'Review notes, revise scope, or duplicate when the customer reopens.',
      };
    case EstimateStatus.DRAFT:
    default:
      return {
        title: 'Build, review, then send',
        detail: 'Add line items first; the workspace will guide the quote through approval.',
      };
  }
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
