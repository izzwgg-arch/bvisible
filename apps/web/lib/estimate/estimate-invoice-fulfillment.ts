import type { EstimateStatus, InvoiceStatus } from '@bvisible/db';
import { EstimateStatus as ES, InvoiceStatus as IS } from '@bvisible/db';

export type OperationalStepKey =
  | 'quote_sent'
  | 'customer_approved'
  | 'po_created'
  | 'invoice_created'
  | 'invoice_paid'
  | 'fulfilled';

const STEP_LABELS: Record<OperationalStepKey, string> = {
  quote_sent: 'Quote sent',
  customer_approved: 'Customer approved',
  po_created: 'PO created',
  invoice_created: 'Invoice created',
  invoice_paid: 'Invoice paid',
  fulfilled: 'Fulfilled',
};

export type OperationalRailStepDisplay = {
  key: OperationalStepKey;
  label: string;
  done: boolean;
  at: Date | null;
};

/** Ordered milestones for the estimate fulfillment rail (labels + calendar timestamps when persisted). */
export function buildEstimateOperationalRailSteps(input: {
  estimateStatus: EstimateStatus;
  linkedPoCount: number;
  linkedInvoice: null | {
    status: InvoiceStatus;
    paidAt: Date | null;
    createdAt: Date;
  };
  quoteSentAt: Date | null;
  quoteAcceptedAt: Date | null;
  firstPoCreatedAt: Date | null;
  finalizedAt: Date | null;
}): OperationalRailStepDisplay[] {
  const booleans = deriveEstimateOperationalSteps({
    estimateStatus: input.estimateStatus,
    linkedPoCount: input.linkedPoCount,
    linkedInvoice: input.linkedInvoice
      ? { status: input.linkedInvoice.status, paidAt: input.linkedInvoice.paidAt }
      : null,
  });

  const invoiceCreatedAt =
    input.linkedInvoice && input.linkedInvoice.status !== IS.VOIDED
      ? input.linkedInvoice.createdAt
      : null;

  const keys: OperationalStepKey[] = [
    'quote_sent',
    'customer_approved',
    'po_created',
    'invoice_created',
    'invoice_paid',
    'fulfilled',
  ];

  const atFor = (k: OperationalStepKey): Date | null => {
    switch (k) {
      case 'quote_sent':
        return input.quoteSentAt;
      case 'customer_approved':
        return input.quoteAcceptedAt;
      case 'po_created':
        return input.firstPoCreatedAt;
      case 'invoice_created':
        return invoiceCreatedAt;
      case 'invoice_paid':
        return input.linkedInvoice?.status === IS.PAID ? input.linkedInvoice.paidAt : null;
      case 'fulfilled':
        return input.finalizedAt;
      default:
        return null;
    }
  };

  return keys.map((key) => ({
    key,
    label: STEP_LABELS[key],
    done: booleans[key],
    at: atFor(key),
  }));
}

/** Steps derived strictly from persisted estimate status + relational counts + invoice status — no inferred accounting. */
export function deriveEstimateOperationalSteps(input: {
  estimateStatus: EstimateStatus;
  linkedPoCount: number;
  linkedInvoice: null | { status: InvoiceStatus; paidAt: Date | null };
}): Record<OperationalStepKey, boolean> {
  const inv = input.linkedInvoice;
  return {
    quote_sent: input.estimateStatus !== ES.DRAFT,
    customer_approved:
      input.estimateStatus === ES.APPROVED || input.estimateStatus === ES.FINALIZED,
    po_created: input.linkedPoCount > 0,
    invoice_created: inv != null && inv.status !== IS.VOIDED,
    invoice_paid: inv != null && inv.status === IS.PAID && inv.paidAt != null,
    fulfilled: input.estimateStatus === ES.FINALIZED,
  };
}

/** Approved estimates that still carry zero linked invoices (non-deleted). Mirrors dashboard predicate. */
export function isApprovedEstimateAwaitingInvoice(
  status: EstimateStatus,
  linkedInvoiceCount: number
): boolean {
  return status === ES.APPROVED && linkedInvoiceCount === 0;
}

export function invoiceNeedsPaymentAttention(status: InvoiceStatus): boolean {
  return status === IS.UNPAID;
}
