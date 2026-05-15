import type { PrismaClient } from '@bvisible/db';

import { hashQuoteToken, isPlausibleQuoteToken } from '@/lib/estimate/quote-link-crypto';
import { buildCustomerQuoteLines } from '@/lib/estimate/customer-quote-view';

export type PublicQuotePayload = {
  linkId: string;
  tenantId: string;
  estimateId: string;
  companyName: string;
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
      estimate: {
        select: {
          deletedAt: true,
          number: true,
          title: true,
          notes: true,
          subtotalCostCents: true,
          finalPriceCents: true,
          updatedAt: true,
          tenant: { select: { name: true } },
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

  return {
    linkId: link.id,
    tenantId: link.tenantId,
    estimateId: link.estimateId,
    companyName: e.tenant.name,
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
