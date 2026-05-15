'use server';

import { revalidatePath } from 'next/cache';

import {
  EstimateStatus,
  EstimateTimelineKind,
  InvoiceStatus,
  prisma,
} from '@bvisible/db';

import { writeAuditLog } from '@/lib/auth/audit';
import { requireTenantId } from '@/lib/auth/current-user';
import { allocateEstimateSellToInvoiceLines } from '@/lib/invoices/allocate-estimate-sell-to-invoice-lines';
import { nextInvoiceNumber } from '@/lib/invoices/next-invoice-number';
import { readRequestContext } from '@/lib/request-context';
import {
  createInvoiceFromEstimateSchema,
  markInvoicePaidSchema,
  type CreateInvoiceFromEstimateInput,
  type MarkInvoicePaidInput,
} from '@/lib/validators';

export async function createInvoiceFromEstimateAction(
  payload: CreateInvoiceFromEstimateInput
): Promise<{ error: string | null; invoiceId?: string }> {
  const me = await requireTenantId();
  const ctx = await readRequestContext();

  const parsed = createInvoiceFromEstimateSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const { estimateId } = parsed.data;

  const estimate = await prisma.estimate.findFirst({
    where: { id: estimateId, tenantId: me.tenantId, deletedAt: null },
    select: {
      id: true,
      number: true,
      status: true,
      clientId: true,
      finalPriceCents: true,
      notes: true,
      lines: {
        orderBy: [{ sortOrder: 'asc' }],
        select: {
          kind: true,
          description: true,
          qtyMilli: true,
          computedCostCents: true,
          notes: true,
        },
      },
    },
  });

  if (!estimate) {
    return { error: 'Estimate not found.' };
  }

  if (estimate.status !== EstimateStatus.APPROVED) {
    return {
      error:
        'Only approved estimates can convert to an invoice. Wait for customer acceptance or set status to Approved.',
    };
  }

  const existing = await prisma.invoice.findFirst({
    where: { tenantId: me.tenantId, estimateId: estimate.id, deletedAt: null },
    select: { id: true },
  });
  if (existing) {
    return { error: 'An invoice is already linked to this estimate.' };
  }

  const allocations = allocateEstimateSellToInvoiceLines({
    finalPriceCents: estimate.finalPriceCents,
    lines: estimate.lines,
  });

  const sumAlloc = allocations.reduce((a, b) => a + b, 0);
  if (sumAlloc !== estimate.finalPriceCents) {
    return { error: 'Could not allocate invoice totals — save the estimate and try again.' };
  }

  const invoiceNotes =
    estimate.notes && estimate.notes.trim() ? estimate.notes.trim().slice(0, 4000) : null;

  try {
    const invoice = await prisma.$transaction(async (tx) => {
      const number = await nextInvoiceNumber(tx, me.tenantId);
      const created = await tx.invoice.create({
        data: {
          tenantId: me.tenantId,
          estimateId: estimate.id,
          clientId: estimate.clientId,
          number,
          status: InvoiceStatus.UNPAID,
          subtotalCents: estimate.finalPriceCents,
          notes: invoiceNotes,
          createdById: me.id,
          lines: {
            createMany: {
              data: estimate.lines.map((l, i) => ({
                tenantId: me.tenantId,
                sortOrder: i,
                kind: l.kind,
                description: l.description,
                qtyMilli: l.qtyMilli,
                lineTotalCents: allocations[i] ?? 0,
                notes: l.notes ?? null,
              })),
            },
          },
        },
        select: { id: true, number: true },
      });

      await tx.estimateTimelineEvent.create({
        data: {
          tenantId: me.tenantId,
          estimateId: estimate.id,
          kind: EstimateTimelineKind.INVOICE_CREATED_FROM_ESTIMATE,
          metadata: {
            invoiceId: created.id,
            invoiceNumber: created.number,
          },
        },
      });

      return created;
    });

    await writeAuditLog({
      action: 'invoice_created_from_estimate',
      userId: me.id,
      tenantId: me.tenantId,
      targetType: 'invoice',
      targetId: invoice.id,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: {
        estimateId: estimate.id,
        estimateNumber: estimate.number,
        invoiceNumber: invoice.number,
        lineCount: estimate.lines.length,
        subtotalCents: estimate.finalPriceCents,
      },
    });

    revalidatePath(`/estimates/${estimate.id}`);
    revalidatePath(`/invoices/${invoice.id}`);
    revalidatePath('/invoices');
    revalidatePath('/dashboard');

    return { error: null, invoiceId: invoice.id };
  } catch {
    return { error: 'Could not create invoice. Try again.' };
  }
}

export async function markInvoicePaidAction(
  payload: MarkInvoicePaidInput
): Promise<{ error: string | null }> {
  const me = await requireTenantId();
  const ctx = await readRequestContext();

  const parsed = markInvoicePaidSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const { invoiceId } = parsed.data;

  const inv = await prisma.invoice.findFirst({
    where: { id: invoiceId, tenantId: me.tenantId, deletedAt: null },
    select: { id: true, status: true, estimateId: true, number: true },
  });
  if (!inv) {
    return { error: 'Invoice not found.' };
  }
  if (inv.status !== InvoiceStatus.UNPAID) {
    return { error: 'Only unpaid invoices can be marked paid.' };
  }

  const paidAt = new Date();
  await prisma.invoice.update({
    where: { id: inv.id },
    data: { status: InvoiceStatus.PAID, paidAt },
  });

  await writeAuditLog({
    action: 'invoice_marked_paid',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'invoice',
    targetId: inv.id,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { invoiceNumber: inv.number, estimateId: inv.estimateId },
  });

  revalidatePath(`/invoices/${inv.id}`);
  if (inv.estimateId) {
    revalidatePath(`/estimates/${inv.estimateId}`);
  }
  revalidatePath('/dashboard');

  return { error: null };
}
