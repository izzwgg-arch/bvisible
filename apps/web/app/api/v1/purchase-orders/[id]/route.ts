export const runtime = 'nodejs';

import { prisma } from '@bvisible/db';
import { jsonErr, jsonOk } from '@/lib/api/v1/envelope';
import { requireMobileBearer } from '@/lib/mobile/require-mobile-bearer';

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await requireMobileBearer(req);
  if (!auth.ok) return auth.response;

  const { id } = await ctx.params;

  const po = await prisma.purchaseOrder.findFirst({
    where: { id, tenantId: auth.ctx.tenantId, deletedAt: null },
    select: {
      id: true,
      number: true,
      status: true,
      qboPoNumber: true,
      notes: true,
      subtotalCents: true,
      createdAt: true,
      updatedAt: true,
      vendor: { select: { id: true, name: true } },
      estimate: { select: { id: true, number: true, title: true } },
      lines: {
        orderBy: [{ sortOrder: 'asc' }],
        select: {
          id: true,
          kind: true,
          description: true,
          qtyMilli: true,
          unitCostCents: true,
        },
      },
      attachments: {
        orderBy: [{ createdAt: 'desc' }],
        select: {
          id: true,
          originalFilename: true,
          mimeType: true,
          sizeBytes: true,
          kind: true,
          createdAt: true,
          uploadedBy: { select: { name: true, email: true } },
        },
      },
      events: {
        orderBy: [{ createdAt: 'desc' }],
        take: 60,
        select: {
          id: true,
          kind: true,
          message: true,
          createdAt: true,
          actor: { select: { name: true, email: true } },
        },
      },
    },
  });

  if (!po) {
    return jsonErr('not_found', 'Purchase order not found.', 404);
  }

  return jsonOk({
    purchaseOrder: {
      ...po,
      notes: po.notes ?? '',
      createdAt: po.createdAt.toISOString(),
      updatedAt: po.updatedAt.toISOString(),
      attachments: po.attachments.map((a) => ({
        ...a,
        createdAt: a.createdAt.toISOString(),
      })),
      events: po.events.map((e) => ({
        ...e,
        createdAt: e.createdAt.toISOString(),
      })),
    },
  });
}
