'use server';

import { revalidatePath } from 'next/cache';
import { Prisma, prisma } from '@bvisible/db';
import { updateVendorSchema } from '@/lib/validators';
import { writeAuditLog } from '@/lib/auth/audit';
import { requireTenantId } from '@/lib/auth/current-user';
import { readRequestContext } from '@/lib/request-context';

export interface UpdateVendorState {
  error: string | null;
  success?: boolean;
}

export async function updateVendorAction(
  vendorId: string,
  _prev: UpdateVendorState,
  formData: FormData
): Promise<UpdateVendorState> {
  const me = await requireTenantId();
  const ctx = await readRequestContext();

  // Collect multi-value fields from the form
  const emailEntries = formData.getAll('emails').map((v) => String(v).trim()).filter(Boolean);
  const phoneEntries = formData.getAll('phones').map((v) => String(v).trim()).filter(Boolean);

  const parsed = updateVendorSchema.safeParse({
    name: formData.get('name'),
    emails: emailEntries,
    phones: phoneEntries,
    notes: formData.get('notes'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const { name, emails, phones, notes } = parsed.data;

  try {
    await prisma.vendor.updateMany({
      where: { id: vendorId, tenantId: me.tenantId, deletedAt: null },
      data: {
        name,
        emails,
        phones,
        // Keep legacy single-value fields in sync with the first array entry
        email: emails[0] ?? null,
        phone: phones[0] ?? null,
        notes,
      },
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      return { error: 'A vendor with that name already exists.' };
    }
    throw err;
  }

  await writeAuditLog({
    action: 'vendor_updated',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'vendor',
    targetId: vendorId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { name },
  });

  revalidatePath(`/vendors/${vendorId}`);
  revalidatePath('/vendors');

  return { error: null, success: true };
}
