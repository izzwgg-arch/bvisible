'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@bvisible/db';
import { updateClientSchema } from '@/lib/validators';
import { writeAuditLog } from '@/lib/auth/audit';
import { requireTenantId } from '@/lib/auth/current-user';
import { readRequestContext } from '@/lib/request-context';

export interface UpdateClientState {
  error: string | null;
  success?: boolean;
}

export async function updateClientAction(
  clientId: string,
  _prev: UpdateClientState,
  formData: FormData,
): Promise<UpdateClientState> {
  const me = await requireTenantId();
  const ctx = await readRequestContext();

  const parsed = updateClientSchema.safeParse({
    companyName: formData.get('companyName'),
    contactName: formData.get('contactName'),
    email: formData.get('email'),
    secondaryEmail: formData.get('secondaryEmail'),
    phone: formData.get('phone'),
    alternatePhone: formData.get('alternatePhone'),
    address: formData.get('address'),
    notes: formData.get('notes'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const { companyName, contactName, email, secondaryEmail, phone, alternatePhone, address, notes } =
    parsed.data;

  const updated = await prisma.client.updateMany({
    where: { id: clientId, tenantId: me.tenantId, deletedAt: null },
    data: {
      companyName,
      contactName,
      email,
      secondaryEmail,
      phone,
      alternatePhone,
      address,
      notes,
    },
  });

  if (updated.count === 0) {
    return { error: 'Customer not found.' };
  }

  await writeAuditLog({
    action: 'client_updated',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'client',
    targetId: clientId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { companyName },
  });

  revalidatePath(`/clients/${clientId}`);
  revalidatePath('/clients');

  return { error: null, success: true };
}
