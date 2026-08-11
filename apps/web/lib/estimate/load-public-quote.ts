import { EstimateStatus, type PrismaClient } from '@bvisible/db';

import { hashQuoteToken, isPlausibleQuoteToken } from '@/lib/estimate/quote-link-crypto';
import { buildCustomerQuoteLines } from '@/lib/estimate/customer-quote-view';
import { getTenantInvoiceProfile, type TenantInvoiceProfile } from '@/lib/company/tenant-invoice-profile';

export type PublicQuoteCustomerResponseView = {
  respondedAtIso: string | null;
  acceptedAtIso: string | null;
  declinedAtIso: string | null;
  acceptedByName: string | null;
  acceptedNote: string | null;
  declinedByName: string | null;
  declinedNote: string | null;
};

export type PublicQuotePayload = {
  linkId: string;
  tenantId: string;
  estimateId: string;
  company: TenantInvoiceProfile;
  estimateNumber: string;
  title: string;
  quoteDateLabel: string;
  billTo: {
    companyName: string;
    contactName: string | null;
    email: string | null;
    phone: string | null;
  };
  lines: ReturnType<typeof buildCustomerQuoteLines>;
  totalSellCents: number;
  notes: string | null;
  customerResponse: PublicQuoteCustomerResponseView;
  /** Customer may submit accept/decline (token valid, not revoked/expired, no prior response, estimate not finalized). */
  canRespond: boolean;
  /** Estimate finalized before any customer response — responses stay closed. */
  responsesClosedFinalized: boolean;
};

function formatQuoteDate(d: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
  }).format(d);
}

/** Resolve quote for display; returns null if token invalid, revoked, or expired. */
export async function resolvePublicQuoteByRawToken(
  prisma: PrismaClient,
  rawToken: string
): Promise<PublicQuotePayload | null> {
  if (!isPlausibleQuoteToken(rawToken)) return null;

  const tokenHash = hashQuoteToken(rawToken);
  const now = new Date();

  const link = await prisma.estimateQuoteLink.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      tenantId: true,
      estimateId: true,
      revokedAt: true,
      expiresAt: true,
      respondedAt: true,
      acceptedAt: true,
      declinedAt: true,
      acceptedByName: true,
      acceptedNote: true,
      declinedByName: true,
      declinedNote: true,
      estimate: {
        select: {
          deletedAt: true,
          status: true,
          number: true,
          title: true,
          notes: true,
          subtotalCostCents: true,
          finalPriceCents: true,
          updatedAt: true,
          tenant: { select: { id: true, name: true } },
          client: {
            select: {
              companyName: true,
              contactName: true,
              email: true,
              phone: true,
            },
          },
          lines: {
            orderBy: [{ sortOrder: 'asc' }],
            select: {
              id: true,
              description: true,
              qtyMilli: true,
              kind: true,
              computedCostCents: true,
              lineGroupId: true,
              lineGroupLabel: true,
            },
          },
        },
      },
    },
  });

  if (!link) return null;
  if (link.revokedAt !== null) return null;
  if (link.expiresAt !== null && link.expiresAt <= now) return null;
  if (!link.estimate || link.estimate.deletedAt !== null) return null;

  const e = link.estimate;
  const quoteLines = buildCustomerQuoteLines(e.lines, e.subtotalCostCents, e.finalPriceCents);

  const responded = link.respondedAt !== null;
  const finalized = e.status === EstimateStatus.FINALIZED;

  return {
    linkId: link.id,
    tenantId: link.tenantId,
    estimateId: link.estimateId,
    company: await getTenantInvoiceProfile(prisma, e.tenant),
    estimateNumber: e.number,
    title: e.title,
    quoteDateLabel: `Updated ${formatQuoteDate(e.updatedAt)}`,
    billTo: {
      companyName: e.client.companyName,
      contactName: e.client.contactName,
      email: e.client.email,
      phone: e.client.phone,
    },
    lines: quoteLines,
    totalSellCents: e.finalPriceCents,
    notes: e.notes,
    customerResponse: {
      respondedAtIso: link.respondedAt?.toISOString() ?? null,
      acceptedAtIso: link.acceptedAt?.toISOString() ?? null,
      declinedAtIso: link.declinedAt?.toISOString() ?? null,
      acceptedByName: link.acceptedByName,
      acceptedNote: link.acceptedNote,
      declinedByName: link.declinedByName,
      declinedNote: link.declinedNote,
    },
    canRespond: !responded && !finalized,
    responsesClosedFinalized: finalized && !responded,
  };
}

export async function recordPublicQuoteView(params: {
  prisma: PrismaClient;
  linkId: string;
  tenantId: string;
  estimateId: string;
}): Promise<void> {
  await params.prisma.estimateQuoteLink.updateMany({
    where: {
      id: params.linkId,
      tenantId: params.tenantId,
      estimateId: params.estimateId,
    },
    data: { lastViewedAt: new Date() },
  });
}
