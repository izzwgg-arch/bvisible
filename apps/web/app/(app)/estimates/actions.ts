'use server';

import { redirect } from 'next/navigation';
import { prisma } from '@bvisible/db';
import { createEstimateSchema } from '@/lib/validators';
import { writeAuditLog } from '@/lib/auth/audit';
import { requireTenantId } from '@/lib/auth/current-user';
import { readRequestContext } from '@/lib/request-context';
import { nextEstimateNumber } from '@/lib/estimate/number';

export interface CreateEstimateState {
  error: string | null;
}

export async function createEstimateAction(
  _prev: CreateEstimateState,
  formData: FormData
): Promise<CreateEstimateState> {
  const me = await requireTenantId();
  const ctx = await readRequestContext();

  const parsed = createEstimateSchema.safeParse({
    clientId: formData.get('clientId'),
    title: formData.get('title'),
    estimateType: formData.get('estimateType'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const { clientId, title, estimateType } = parsed.data;

  // Verify the client belongs to this tenant. Without this, any
  // tenant-A user could create an estimate referencing a tenant-B
  // client by guessing/leaking the cuid.
  const client = await prisma.client.findFirst({
    where: { id: clientId, tenantId: me.tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!client) {
    return { error: 'That client does not exist.' };
  }

  // Number allocation + insert in one transaction so the unique
  // (tenantId, number) index can never see a half-written row.
  const estimate = await prisma.$transaction(async (tx) => {
    const number = await nextEstimateNumber(tx, me.tenantId);
    return tx.estimate.create({
      data: {
        tenantId: me.tenantId,
        clientId: client.id,
        number,
        title,
        estimateType,
        createdById: me.id,
      },
      select: { id: true, number: true },
    });
  });

  await writeAuditLog({
    action: 'estimate_created',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'estimate',
    targetId: estimate.id,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { number: estimate.number, clientId: client.id, title, estimateType },
  });

  redirect(`/estimates/${estimate.id}`);
}
