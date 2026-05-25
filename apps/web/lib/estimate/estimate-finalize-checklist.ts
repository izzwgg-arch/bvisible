import type { InvoiceStatus, POReconciliationStatus } from '@bvisible/db';
import { EstimateStatus, InvoiceStatus as InvS } from '@bvisible/db';
import { reconciliationNeedsAttention } from '@/lib/estimate/estimate-fulfillment';
import { evaluateEstimateFinalizeGates } from '@/lib/estimate/estimate-finalization';

export type FinalizeChecklistItem = {
  key: string;
  label: string;
  done: boolean;
  detail: string | null;
  href: string | null;
};

export type EstimateFinalizeChecklist = {
  items: FinalizeChecklistItem[];
  /** Display-only: all closeout gates satisfied (does not auto-finalize). */
  readyToFinalize: boolean;
  blockedSummary: string | null;
};

export function buildEstimateFinalizeChecklist(input: {
  estimateId: string;
  estimateStatus: EstimateStatus;
  quoteAccepted: boolean;
  linkedPos: ReadonlyArray<{
    id: string;
    number: string;
    qboPoNumber: string | null;
    latestReconciliationStatus: POReconciliationStatus | null;
  }>;
  linkedInvoice: null | {
    id: string;
    status: InvoiceStatus;
    paidAt: Date | null;
  };
}): EstimateFinalizeChecklist {
  const base = `/estimates/${input.estimateId}`;
  const isFinalized = input.estimateStatus === EstimateStatus.FINALIZED;
  const isApproved =
    input.estimateStatus === EstimateStatus.APPROVED || isFinalized;

  const quoteDone =
    input.quoteAccepted ||
    input.estimateStatus === EstimateStatus.APPROVED ||
    isFinalized;

  const hasPo = input.linkedPos.length > 0;
  const allQbo =
    hasPo && input.linkedPos.every((p) => Boolean(p.qboPoNumber?.trim()));
  const allReconClean =
    hasPo &&
    input.linkedPos.every(
      (p) => !reconciliationNeedsAttention(p.latestReconciliationStatus),
    );

  const hasInvoice = input.linkedInvoice != null;
  const invoicePaid =
    input.linkedInvoice?.status === InvS.PAID &&
    input.linkedInvoice.paidAt != null;

  const missingQbo = input.linkedPos.filter((p) => !p.qboPoNumber?.trim());
  const reconAttention = input.linkedPos.filter((p) =>
    reconciliationNeedsAttention(p.latestReconciliationStatus),
  );

  const items: FinalizeChecklistItem[] = [
    {
      key: 'quote',
      label: 'Customer quote approved',
      done: quoteDone,
      detail: quoteDone
        ? null
        : 'Mark Approved after the customer accepts, or record acceptance on the public quote.',
      href: `${base}/preview`,
    },
    {
      key: 'po',
      label: 'Purchase order linked',
      done: hasPo,
      detail: hasPo
        ? `${input.linkedPos.length} PO${input.linkedPos.length === 1 ? '' : 's'} on file`
        : 'Create or link a PO from this estimate before closeout.',
      href: `${base}#estimate-create-po`,
    },
    {
      key: 'qbo',
      label: 'QuickBooks PO numbers recorded',
      done: allQbo,
      detail:
        !hasPo
          ? 'Requires at least one linked PO.'
          : allQbo
            ? 'Finance-issued buy numbers are on every linked PO.'
            : missingQbo.length === 1
              ? `${missingQbo[0]!.number} is missing a QBO # — open the PO and save the QuickBooks reference.`
              : `${missingQbo.length} linked POs still need a QBO #.`,
      href: missingQbo[0]
        ? `/purchase-orders/${missingQbo[0]!.id}`
        : hasPo
          ? `/purchase-orders/${input.linkedPos[0]!.id}`
          : `${base}#estimate-create-po`,
    },
    {
      key: 'recon',
      label: 'Receipts reconciled',
      done: hasPo && allReconClean,
      detail:
        !hasPo
          ? 'Reconciliation applies after POs exist.'
          : allReconClean
            ? 'Latest reconciliation snapshots are clean.'
            : reconAttention.length === 1
              ? `${reconAttention[0]!.number} has open reconciliation work.`
              : `${reconAttention.length} POs need reconciliation review.`,
      href: reconAttention[0]
        ? `/purchase-orders/${reconAttention[0]!.id}/reconciliation`
        : hasPo
          ? `/purchase-orders/${input.linkedPos[0]!.id}/reconciliation`
          : null,
    },
    {
      key: 'invoice',
      label: 'Customer invoice paid',
      done: invoicePaid,
      detail: invoicePaid
        ? 'Payment recorded on the linked invoice.'
        : hasInvoice
          ? 'Invoice exists but is not marked paid — optional before finalize.'
          : 'No invoice yet — billing is optional before finalize.',
      href: input.linkedInvoice
        ? `/invoices/${input.linkedInvoice.id}`
        : `${base}#estimate-linked-invoice`,
    },
  ];

  const gates = evaluateEstimateFinalizeGates({
    estimateStatus: input.estimateStatus,
    linkedPos: input.linkedPos,
  });
  const readyToFinalize = gates.canFinalize;
  const blockedSummary =
    isFinalized || readyToFinalize ? null : gates.blockedReason;

  return { items, readyToFinalize, blockedSummary };
}
