'use server';

// Start a Bid Estimator estimate: customer (existing or new, de-duplicated
// by name), project name, sales rep (defaults to the signed-in user). The
// row is a standard Estimate (type BID) + its workflow row, then Step 1.

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { prisma } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { writeAuditLog } from '@/lib/auth/audit';
import { readRequestContext } from '@/lib/request-context';
import { createBidEstimate } from '@/lib/bid/workflow';

const schema = z.object({
  clientId: z.string().trim().max(64).nullable().optional(),
  newClientName: z.string().trim().max(200).nullable().optional(),
  projectName: z.string().trim().min(1, 'Enter the project name.').max(200),
  salesRepId: z.string().trim().max(64).nullable().optional(),
});

export interface StartBidEstimateState {
  error: string | null;
}

export async function startBidEstimateAction(_prev: StartBidEstimateState, formData: FormData): Promise<StartBidEstimateState> {
  const me = await requireTenantId();
  const ctx = await readRequestContext();
  const parsed = schema.safeParse({
    clientId: formData.get('clientId') || null,
    newClientName: formData.get('newClientName') || null,
    projectName: formData.get('projectName'),
    salesRepId: formData.get('salesRepId') || null,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  const data = parsed.data;

  let clientId: string | null = null;
  if (data.clientId && data.clientId !== '__new__') {
    const ok = await prisma.client.findFirst({ where: { id: data.clientId, tenantId: me.tenantId, deletedAt: null }, select: { id: true } });
    if (!ok) return { error: 'That customer does not exist.' };
    clientId = ok.id;
  } else {
    const name = data.newClientName?.trim();
    if (!name) return { error: 'Choose a customer or enter a new customer name.' };
    // Avoid duplicates: same company name (case-insensitive) reuses the record.
    const existing = await prisma.client.findFirst({ where: { tenantId: me.tenantId, deletedAt: null, companyName: { equals: name, mode: 'insensitive' } }, select: { id: true } });
    if (existing) {
      clientId = existing.id;
    } else {
      const created = await prisma.client.create({ data: { tenantId: me.tenantId, companyName: name }, select: { id: true } });
      clientId = created.id;
      await writeAuditLog({ action: 'client_created', userId: me.id, tenantId: me.tenantId, targetType: 'client', targetId: created.id, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent, metadata: { companyName: name, via: 'bid_estimator' } });
    }
  }

  let salesRepId: string | null = data.salesRepId ?? null;
  if (salesRepId) {
    const rep = await prisma.user.findFirst({ where: { id: salesRepId, tenantId: me.tenantId, disabledAt: null }, select: { id: true } });
    if (!rep) salesRepId = null;
  }
  if (!salesRepId) salesRepId = me.id;

  const estimate = await createBidEstimate({ tenantId: me.tenantId, actorId: me.id, clientId, projectName: data.projectName, salesRepId });
  await writeAuditLog({
    action: 'bid_estimate_created',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'estimate',
    targetId: estimate.id,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { number: estimate.number, clientId, projectName: data.projectName, salesRepId },
  });
  redirect(`/estimates/${estimate.id}/bid`);
}
