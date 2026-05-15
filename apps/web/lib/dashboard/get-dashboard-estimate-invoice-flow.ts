import type { PrismaClient } from '@bvisible/db';
import {
  EstimateStatus,
  InvoiceStatus,
  prisma,
} from '@bvisible/db';

export type EstimateInvoiceFlowDb = Pick<PrismaClient, 'estimate' | 'invoice'>;

export interface EstimateMissingInvoiceRow {
  estimateId: string;
  number: string;
  title: string;
  clientCompanyName: string;
  sortAt: Date;
}

export interface UnpaidEstimateInvoiceRow {
  invoiceId: string;
  invoiceNumber: string;
  estimateId: string;
  estimateNumber: string;
  title: string;
  clientCompanyName: string;
  subtotalCents: number;
  sortAt: Date;
}

export interface PaidEstimateInvoiceRow {
  invoiceId: string;
  invoiceNumber: string;
  estimateId: string;
  estimateNumber: string;
  title: string;
  clientCompanyName: string;
  paidAt: Date;
  subtotalCents: number;
}

export interface DashboardEstimateInvoiceFlow {
  approvedAwaitingInvoice: EstimateMissingInvoiceRow[];
  unpaidInvoicesOnApprovedEstimates: UnpaidEstimateInvoiceRow[];
  recentlyPaidEstimateInvoices: PaidEstimateInvoiceRow[];
}

export async function getDashboardEstimateInvoiceFlow(
  tenantId: string,
  db: EstimateInvoiceFlowDb = prisma
): Promise<DashboardEstimateInvoiceFlow> {
  const [approvedAwaitingRaw, unpaidRaw, paidRaw] = await Promise.all([
    db.estimate.findMany({
      where: {
        tenantId,
        deletedAt: null,
        status: EstimateStatus.APPROVED,
        invoices: { none: { tenantId, deletedAt: null } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 12,
      select: {
        id: true,
        number: true,
        title: true,
        updatedAt: true,
        client: { select: { companyName: true } },
      },
    }),
    db.invoice.findMany({
      where: {
        tenantId,
        deletedAt: null,
        estimateId: { not: null },
        status: InvoiceStatus.UNPAID,
        estimate: {
          is: {
            tenantId,
            deletedAt: null,
            status: EstimateStatus.APPROVED,
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 12,
      select: {
        id: true,
        number: true,
        subtotalCents: true,
        updatedAt: true,
        estimateId: true,
        estimate: {
          select: {
            id: true,
            number: true,
            title: true,
            client: { select: { companyName: true } },
          },
        },
      },
    }),
    db.invoice.findMany({
      where: {
        tenantId,
        deletedAt: null,
        estimateId: { not: null },
        status: InvoiceStatus.PAID,
        paidAt: { not: null },
      },
      orderBy: { paidAt: 'desc' },
      take: 12,
      select: {
        id: true,
        number: true,
        paidAt: true,
        subtotalCents: true,
        estimateId: true,
        estimate: {
          select: {
            id: true,
            number: true,
            title: true,
            client: { select: { companyName: true } },
          },
        },
      },
    }),
  ]);

  const approvedAwaitingInvoice: EstimateMissingInvoiceRow[] = approvedAwaitingRaw.map((e) => ({
    estimateId: e.id,
    number: e.number,
    title: e.title,
    clientCompanyName: e.client.companyName,
    sortAt: e.updatedAt,
  }));

  const unpaidInvoicesOnApprovedEstimates: UnpaidEstimateInvoiceRow[] = unpaidRaw
    .filter(
      (inv): inv is typeof inv & { estimate: NonNullable<(typeof inv)['estimate']>; estimateId: string } =>
        Boolean(inv.estimate && inv.estimateId)
    )
    .map((inv) => ({
      invoiceId: inv.id,
      invoiceNumber: inv.number,
      estimateId: inv.estimate!.id,
      estimateNumber: inv.estimate!.number,
      title: inv.estimate!.title,
      clientCompanyName: inv.estimate!.client.companyName,
      subtotalCents: inv.subtotalCents,
      sortAt: inv.updatedAt,
    }));

  const recentlyPaidEstimateInvoices: PaidEstimateInvoiceRow[] = paidRaw
    .filter(
      (
        inv
      ): inv is typeof inv & {
        estimate: NonNullable<(typeof inv)['estimate']>;
        estimateId: string;
        paidAt: Date;
      } => Boolean(inv.estimate && inv.estimateId && inv.paidAt)
    )
    .map((inv) => ({
      invoiceId: inv.id,
      invoiceNumber: inv.number,
      estimateId: inv.estimate!.id,
      estimateNumber: inv.estimate!.number,
      title: inv.estimate!.title,
      clientCompanyName: inv.estimate!.client.companyName,
      paidAt: inv.paidAt!,
      subtotalCents: inv.subtotalCents,
    }));

  return {
    approvedAwaitingInvoice: approvedAwaitingInvoice.slice(0, 8),
    unpaidInvoicesOnApprovedEstimates: unpaidInvoicesOnApprovedEstimates.slice(0, 8),
    recentlyPaidEstimateInvoices: recentlyPaidEstimateInvoices.slice(0, 8),
  };
}
