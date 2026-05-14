export const runtime = 'nodejs';

import { prisma } from '@bvisible/db';
import { jsonOk } from '@/lib/api/v1/envelope';
import { requireMobileBearer } from '@/lib/mobile/require-mobile-bearer';

export async function GET(req: Request) {
  const auth = await requireMobileBearer(req);
  if (!auth.ok) return auth.response;

  const pos = await prisma.purchaseOrder.findMany({
    where: { tenantId: auth.ctx.tenantId, deletedAt: null },
    orderBy: [{ updatedAt: 'desc' }],
    select: {
      id: true,
      number: true,
      status: true,
      qboPoNumber: true,
      subtotalCents: true,
      updatedAt: true,
      vendor: { select: { id: true, name: true } },
      estimate: { select: { id: true, number: true } },
    },
    take: 200,
  });

  return jsonOk({
    purchaseOrders: pos.map((p) => ({
      ...p,
      updatedAt: p.updatedAt.toISOString(),
    })),
  });
}
