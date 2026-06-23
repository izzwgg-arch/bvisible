'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { Prisma, prisma, Role } from '@bvisible/db';
import { createVendorSchema } from '@/lib/validators';
import { writeAuditLog } from '@/lib/auth/audit';
import { requireRoleWithEffectiveCompany, requireTenantId } from '@/lib/auth/current-user';
import { readRequestContext } from '@/lib/request-context';

export interface CreateVendorState {
  error: string | null;
}

export async function createVendorAction(
  _prev: CreateVendorState,
  formData: FormData
): Promise<CreateVendorState> {
  const me = await requireTenantId();
  const ctx = await readRequestContext();

  const emailEntries = formData.getAll('emails').map((v) => String(v).trim()).filter(Boolean);
  const phoneEntries = formData.getAll('phones').map((v) => String(v).trim()).filter(Boolean);

  const parsed = createVendorSchema.safeParse({
    name: formData.get('name'),
    emails: emailEntries,
    phones: phoneEntries,
    notes: formData.get('notes'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const { name, emails, phones, notes } = parsed.data;

  let created;
  try {
    created = await prisma.vendor.create({
      data: {
        tenantId: me.tenantId,
        name,
        emails,
        phones,
        email: emails[0] ?? null,
        phone: phones[0] ?? null,
        notes,
      },
      select: { id: true },
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
    action: 'vendor_created',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'vendor',
    targetId: created.id,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { name },
  });

  redirect(`/vendors/${created.id}`);
}

export async function bulkDeleteVendorsAction(formData: FormData): Promise<void> {
  const me = await requireRoleWithEffectiveCompany(Role.ADMIN, Role.SUPER_ADMIN);
  const ctx = await readRequestContext();
  const ids = formData.getAll('ids').map((value) => String(value)).filter(Boolean);
  if (ids.length === 0) return;

  const result = await prisma.vendor.updateMany({
    where: {
      id: { in: ids },
      tenantId: me.tenantId,
      deletedAt: null,
    },
    data: { deletedAt: new Date() },
  });

  await writeAuditLog({
    action: 'vendors_bulk_deleted',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'vendor',
    targetId: 'bulk',
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { requestedCount: ids.length, deletedCount: result.count },
  });

  revalidatePath('/vendors');
}
