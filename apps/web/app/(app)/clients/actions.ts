'use server';

import { redirect } from 'next/navigation';
import { prisma } from '@bvisible/db';
import { createClientSchema } from '@/lib/validators';
import { writeAuditLog } from '@/lib/auth/audit';
import { requireTenantId } from '@/lib/auth/current-user';
import { readRequestContext } from '@/lib/request-context';

export interface CreateClientState {
  error: string | null;
}

export async function createClientAction(
  _prev: CreateClientState,
  formData: FormData
): Promise<CreateClientState> {
  const me = await requireTenantId();
  const ctx = await readRequestContext();

  const parsed = createClientSchema.safeParse({
    companyName: formData.get('companyName'),
    contactName: formData.get('contactName'),
    email: formData.get('email'),
    phone: formData.get('phone'),
    notes: formData.get('notes'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const { companyName, contactName, email, phone, notes } = parsed.data;

  const created = await prisma.client.create({
    data: {
      tenantId: me.tenantId,
      companyName,
      contactName,
      email,
      phone,
      notes,
    },
    select: { id: true },
  });

  await writeAuditLog({
    action: 'client_created',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'client',
    targetId: created.id,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { companyName },
  });

  redirect(`/clients?created=${encodeURIComponent(companyName)}`);
}
