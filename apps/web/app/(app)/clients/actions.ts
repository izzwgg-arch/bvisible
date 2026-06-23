'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { prisma, Role } from '@bvisible/db';
import { createClientSchema } from '@/lib/validators';
import { writeAuditLog } from '@/lib/auth/audit';
import { requireRoleWithEffectiveCompany, requireTenantId } from '@/lib/auth/current-user';
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

export async function bulkDeleteClientsAction(formData: FormData): Promise<void> {
  const me = await requireRoleWithEffectiveCompany(Role.ADMIN, Role.SUPER_ADMIN);
  const ctx = await readRequestContext();
  const ids = formData.getAll('ids').map((value) => String(value)).filter(Boolean);
  if (ids.length === 0) return;

  const result = await prisma.client.updateMany({
    where: {
      id: { in: ids },
      tenantId: me.tenantId,
      deletedAt: null,
    },
    data: { deletedAt: new Date() },
  });

  await writeAuditLog({
    action: 'clients_bulk_deleted',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'client',
    targetId: 'bulk',
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { requestedCount: ids.length, deletedCount: result.count },
  });

  revalidatePath('/clients');
}
