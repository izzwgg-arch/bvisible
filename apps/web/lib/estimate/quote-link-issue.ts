import type { PrismaClient } from '@bvisible/db';

import { generateRawQuoteToken, hashQuoteToken } from '@/lib/estimate/quote-link-crypto';

export async function revokeActiveQuoteLinksForEstimate(
  tx: Pick<PrismaClient, 'estimateQuoteLink'>,
  tenantId: string,
  estimateId: string
): Promise<void> {
  await tx.estimateQuoteLink.updateMany({
    where: { tenantId, estimateId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * Revokes prior active links for the estimate and inserts a new row.
 * Returns the raw token once (for URLs); never persist it.
 */
export async function issueEstimateQuoteLink(params: {
  prisma: PrismaClient;
  tenantId: string;
  estimateId: string;
  createdById: string;
  expiresAt?: Date | null;
}): Promise<{ rawToken: string }> {
  const rawToken = generateRawQuoteToken();
  const tokenHash = hashQuoteToken(rawToken);

  await params.prisma.$transaction(async (tx) => {
    await revokeActiveQuoteLinksForEstimate(tx, params.tenantId, params.estimateId);
    await tx.estimateQuoteLink.create({
      data: {
        tenantId: params.tenantId,
        estimateId: params.estimateId,
        tokenHash,
        expiresAt: params.expiresAt ?? null,
        createdById: params.createdById,
      },
    });
  });

  return { rawToken };
}

/** Marks every link for the estimate revoked (idempotent). */
export async function revokeAllQuoteLinksForEstimate(params: {
  prisma: PrismaClient;
  tenantId: string;
  estimateId: string;
}): Promise<number> {
  const res = await params.prisma.estimateQuoteLink.updateMany({
    where: { tenantId: params.tenantId, estimateId: params.estimateId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return res.count;
}
