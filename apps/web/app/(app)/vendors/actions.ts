'use server';

import { redirect } from 'next/navigation';
import { Prisma, prisma } from '@bvisible/db';
import { createVendorSchema } from '@/lib/validators';
import { writeAuditLog } from '@/lib/auth/audit';
import { requireTenantId } from '@/lib/auth/current-user';
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
