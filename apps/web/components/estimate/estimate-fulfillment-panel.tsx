import type { ReactNode } from 'react';
import Link from 'next/link';

import type { EstimateStatus, InvoiceStatus } from '@bvisible/db';
import { EstimateStatus as ES, InvoiceStatus as InvS } from '@bvisible/db';

import { formatMoney } from '@/lib/estimate/format';
import type {
  EstimateLinkedPoBootstrap,
  FulfillmentHeadline,
} from '@/lib/estimate/estimate-fulfillment';
import {
  receiptOcrOperationalHint,
  reconciliationGuidanceLabel,
} from '@/lib/estimate/estimate-fulfillment';
import { labelInvoiceStatus, labelPoStatus } from '@/lib/ui/status-labels';

import { CreateInvoiceFromEstimateButton } from '@/components/estimate/create-invoice-from-estimate-button';
import { EstimateFinalizeChecklistPanel } from '@/components/estimate/estimate-finalize-checklist';
import type { EstimateFinalizeChecklist } from '@/lib/estimate/estimate-finalize-checklist';
import type { EstimateOperationalStepRailRow } from '@/components/estimate/estimate-operational-step-rail';
import { EstimateOperationalStepRail } from '@/components/estimate/estimate-operational-step-rail';
import {
  SectionCard,
  SectionHeading,
  IconTruck,
  IconReceipt,
  IconArrowRight,
} from '@/components/estimate/estimate-surface';

const PO_STATUS_CHIP =
  'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide';

const PO_CHIP_PALETTE: Record<string, string> = {
  DRAFT: 'border-slate-200 bg-slate-50 text-slate-800',
  SENT: 'border-sky-200 bg-sky-50 text-sky-950',
  ORDERED: 'border-indigo-200 bg-indigo-50 text-indigo-950',
  PARTIALLY_RECEIVED: 'border-amber-200 bg-amber-50 text-amber-950',
  RECEIVED: 'border-emerald-200 bg-emerald-50 text-emerald-950',
  CANCELED: 'border-rose-200 bg-rose-50 text-rose-950',
};

const INVOICE_CHIP_PALETTE: Record<string, string> = {
  UNPAID: 'border-amber-200 bg-amber-50 text-amber-950',
  PAID: 'border-emerald-200 bg-emerald-50 text-emerald-950',
  VOIDED: 'border-slate-200 bg-slate-50 text-slate-800',
};

export function EstimateFulfillmentPanel(props: {
  estimateId: string;
  estimateStatus: EstimateStatus;
  headline: FulfillmentHeadline;
  hints: string[];
  operationalSteps: ReadonlyArray<EstimateOperationalStepRailRow>;
  relationshipStrip: ReactNode;
  linkedInvoice: null | {
    id: string;
    number: string;
    status: InvoiceStatus;
    paidAtIso: string | null;
    createdAtIso: string;
    subtotalCents: number;
  };
  linkedPos: ReadonlyArray<EstimateLinkedPoBootstrap>;
  finalizeChecklist?: EstimateFinalizeChecklist | null;
}) {
  const {
    estimateId,
    estimateStatus,
    headline,
    hints,
    operationalSteps,
    relationshipStrip,
    linkedInvoice,
    linkedPos,
    finalizeChecklist,
  } = props;
  const showApprovedPrimary =
    estimateStatus === ES.APPROVED && linkedPos.length === 0;

  const showInvoiceCta = estimateStatus === ES.APPROVED && linkedInvoice == null;

  return (
    <SectionCard className={`p-5 ${headline.muted ? 'opacity-90' : ''}`}>
      <SectionHeading
        icon={<IconTruck />}
        tone="emerald"
        title={headline.title}
        subtitle={headline.subtitle ?? undefined}
        badge={
          estimateStatus === ES.APPROVED ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
              Accepted quote
            </span>
          ) : null
        }
      />

      <EstimateOperationalStepRail steps={operationalSteps} />
      {relationshipStrip}

      {finalizeChecklist &&
      (estimateStatus === ES.APPROVED || estimateStatus === ES.FINALIZED) ? (
        <EstimateFinalizeChecklistPanel checklist={finalizeChecklist} />
      ) : null}

      {hints.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-1.5 text-[12.5px] leading-snug text-slate-500">
          {hints.map((h, idx) => (
            <li key={`${idx}-${h.slice(0, 48)}`} className="flex gap-2">
              <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-slate-300" />
              <span>{h}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {showInvoiceCta ? (
        <div className="mt-4 overflow-hidden rounded-[14px] border border-indigo-200/70 bg-gradient-to-br from-indigo-50 to-blue-50 px-4 py-3.5">
          <p className="flex items-center gap-2 text-[13px] font-semibold text-indigo-900">
            <IconReceipt width={16} height={16} />
            Bill the customer
          </p>
          <p className="mt-1 text-[12px] leading-snug text-indigo-900/80">
            Creates an unpaid invoice from this estimate (same customer, lines, and sell total). Nothing posts automatically — record payment when funds arrive.
          </p>
          <div className="mt-3">
            <CreateInvoiceFromEstimateButton estimateId={estimateId} />
          </div>
        </div>
      ) : null}

      {showApprovedPrimary ? (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <Link
            href={`/purchase-orders/new?estimateId=${estimateId}`}
            className="inline-flex flex-1 items-center justify-center rounded-[10px] border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-semibold text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 sm:flex-none"
          >
            Link existing purchase order
          </Link>
          <Link
            href="#estimate-create-po"
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-gradient-to-br from-blue-600 to-indigo-600 px-4 py-2.5 text-[13px] font-semibold text-white shadow-[0_8px_20px_-8px_rgba(47,90,243,0.6)] transition hover:from-blue-500 hover:to-indigo-500 sm:flex-none"
          >
            Create purchase order from estimate
            <IconArrowRight width={15} height={15} />
          </Link>
        </div>
      ) : null}

      {estimateStatus === ES.APPROVED && linkedPos.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={`/purchase-orders/new?estimateId=${estimateId}`}
            className="inline-flex items-center justify-center rounded-[10px] border border-slate-200 bg-white px-3 py-2 text-[12.5px] font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            Link another PO
          </Link>
          <Link
            href="#estimate-create-po"
            className="inline-flex items-center justify-center rounded-[10px] bg-gradient-to-br from-blue-600 to-indigo-600 px-3 py-2 text-[12.5px] font-semibold text-white shadow-sm transition hover:from-blue-500 hover:to-indigo-500"
          >
            Create another PO from estimate
          </Link>
        </div>
      ) : null}

      {linkedInvoice ? (
        <div className="mt-5 border-t border-slate-100 pt-4">
          <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-slate-400">
            Linked invoice
          </h3>
          <div className="mt-2 rounded-[12px] border border-slate-200 bg-white px-3 py-3 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <Link
                  href={`/invoices/${linkedInvoice.id}`}
                  className="font-mono text-[13px] font-semibold text-blue-600 hover:underline"
                >
                  {linkedInvoice.number}
                </Link>
                <div className="mt-0.5 text-[11.5px] text-slate-400">
                  Sell total {formatMoney(linkedInvoice.subtotalCents)} · issued{' '}
                  <time dateTime={linkedInvoice.createdAtIso}>
                    {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
                      new Date(linkedInvoice.createdAtIso)
                    )}
                  </time>
                </div>
              </div>
              <span
                className={`${PO_STATUS_CHIP} ${INVOICE_CHIP_PALETTE[linkedInvoice.status] ?? 'border-slate-200 bg-white text-slate-700'}`}
              >
                {labelInvoiceStatus(linkedInvoice.status)}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {linkedInvoice.status === InvS.PAID && linkedInvoice.paidAtIso ? (
                <span className="rounded-full border border-emerald-300 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-950">
                  Paid{' '}
                  <time dateTime={linkedInvoice.paidAtIso}>
                    {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
                      new Date(linkedInvoice.paidAtIso)
                    )}
                  </time>
                </span>
              ) : linkedInvoice.status === InvS.UNPAID ? (
                <span className="rounded-full border border-amber-300 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-950">
                  Payment outstanding
                </span>
              ) : null}
            </div>
            <div className="mt-2">
              <Link
                href={`/invoices/${linkedInvoice.id}`}
                className="inline-flex items-center gap-1 text-[12px] font-semibold text-blue-600 hover:underline"
              >
                Open invoice <IconArrowRight width={13} height={13} />
              </Link>
            </div>
          </div>
        </div>
      ) : null}

      {linkedPos.length > 0 ? (
        <div className="mt-5 border-t border-slate-100 pt-4">
          <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-slate-400">
            Linked purchase orders
          </h3>
          <ul className="mt-2 flex flex-col gap-2">
            {linkedPos.map((p) => {
              const reconPhrase = reconciliationGuidanceLabel(p.latestReconciliationStatus);
              const ocrPhrase = receiptOcrOperationalHint({
                receiptishAttachmentCount: p.receiptishAttachmentCount,
                ocrPendingOrProcessingCount: p.ocrPendingOrProcessingCount,
                ocrNeedsReviewCount: p.ocrNeedsReviewCount,
              });
              const chipClass =
                PO_CHIP_PALETTE[p.status] ??
                'border-slate-200 bg-white text-slate-700';
              return (
                <li
                  key={p.id}
                  className="rounded-[12px] border border-slate-200 bg-white px-3 py-3 shadow-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <Link
                        href={`/purchase-orders/${p.id}`}
                        className="font-mono text-[13px] font-semibold text-blue-600 hover:underline"
                      >
                        {p.number}
                      </Link>
                      <div className="mt-0.5 truncate text-[11.5px] text-slate-400">
                        {p.vendor?.name ?? 'No vendor'} · {formatMoney(p.subtotalCents)} PO total · created{' '}
                        <time dateTime={p.createdAtIso}>
                          {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
                            new Date(p.createdAtIso)
                          )}
                        </time>
                      </div>
                    </div>
                    <span className={`${PO_STATUS_CHIP} ${chipClass}`}>{labelPoStatus(p.status)}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {p.reconciliationNeedsAttention ? (
                      <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-950">
                        Reconciliation attention
                      </span>
                    ) : null}
                    {reconPhrase ? (
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                        {reconPhrase}
                      </span>
                    ) : null}
                    {ocrPhrase ? (
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                        {ocrPhrase}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-2">
                    <Link
                      href={`/purchase-orders/${p.id}`}
                      className="inline-flex items-center gap-1 text-[12px] font-semibold text-blue-600 hover:underline"
                    >
                      Open purchase order <IconArrowRight width={13} height={13} />
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </SectionCard>
  );
}
