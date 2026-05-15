import { describe, expect, it } from 'vitest';
import { EstimateStatus, InvoiceStatus } from '@bvisible/db';

import {
  buildEstimateOperationalRailSteps,
  deriveEstimateOperationalSteps,
  isApprovedEstimateAwaitingInvoice,
} from '@/lib/estimate/estimate-invoice-fulfillment';

describe('estimate invoice fulfillment derivation', () => {
  it('requires APPROVED + approved timeline semantics for customer approval', () => {
    const rejected = deriveEstimateOperationalSteps({
      estimateStatus: EstimateStatus.REJECTED,
      linkedPoCount: 1,
      linkedInvoice: { status: InvoiceStatus.UNPAID, paidAt: null },
    });
    expect(rejected.customer_approved).toBe(false);

    const approved = deriveEstimateOperationalSteps({
      estimateStatus: EstimateStatus.APPROVED,
      linkedPoCount: 0,
      linkedInvoice: null,
    });
    expect(approved.customer_approved).toBe(true);
    expect(approved.quote_sent).toBe(true);

    const finalized = deriveEstimateOperationalSteps({
      estimateStatus: EstimateStatus.FINALIZED,
      linkedPoCount: 0,
      linkedInvoice: null,
    });
    expect(finalized.customer_approved).toBe(true);
    expect(finalized.fulfilled).toBe(true);
  });

  it('treats voided invoices as not invoice_created for milestones', () => {
    const rows = deriveEstimateOperationalSteps({
      estimateStatus: EstimateStatus.APPROVED,
      linkedPoCount: 0,
      linkedInvoice: { status: InvoiceStatus.VOIDED, paidAt: null },
    });
    expect(rows.invoice_created).toBe(false);
    expect(rows.invoice_paid).toBe(false);
  });

  it('requires PAID + paidAt for invoice_paid', () => {
    const unpaid = deriveEstimateOperationalSteps({
      estimateStatus: EstimateStatus.APPROVED,
      linkedPoCount: 0,
      linkedInvoice: { status: InvoiceStatus.UNPAID, paidAt: null },
    });
    expect(unpaid.invoice_paid).toBe(false);

    const paid = deriveEstimateOperationalSteps({
      estimateStatus: EstimateStatus.APPROVED,
      linkedPoCount: 0,
      linkedInvoice: { status: InvoiceStatus.PAID, paidAt: new Date('2026-05-10T12:00:00Z') },
    });
    expect(paid.invoice_paid).toBe(true);
  });

  it('mirrors dashboard predicate for approved estimates awaiting invoices', () => {
    expect(isApprovedEstimateAwaitingInvoice(EstimateStatus.APPROVED, 0)).toBe(true);
    expect(isApprovedEstimateAwaitingInvoice(EstimateStatus.APPROVED, 1)).toBe(false);
    expect(isApprovedEstimateAwaitingInvoice(EstimateStatus.FINALIZED, 0)).toBe(false);
  });

  it('buildEstimateOperationalRailSteps threads timestamps without inferring paid dates', () => {
    const ts = new Date('2026-05-04T15:00:00Z');
    const rail = buildEstimateOperationalRailSteps({
      estimateStatus: EstimateStatus.APPROVED,
      linkedPoCount: 1,
      linkedInvoice: {
        status: InvoiceStatus.UNPAID,
        paidAt: null,
        createdAt: ts,
      },
      quoteSentAt: new Date('2026-05-01T08:00:00Z'),
      quoteAcceptedAt: new Date('2026-05-02T09:00:00Z'),
      firstPoCreatedAt: new Date('2026-05-03T10:00:00Z'),
      finalizedAt: null,
    });
    const invoiceCreated = rail.find((s) => s.key === 'invoice_created');
    expect(invoiceCreated?.done).toBe(true);
    expect(invoiceCreated?.at?.toISOString()).toBe(ts.toISOString());

    const paidStep = rail.find((s) => s.key === 'invoice_paid');
    expect(paidStep?.done).toBe(false);
    expect(paidStep?.at).toBeNull();
  });
});
