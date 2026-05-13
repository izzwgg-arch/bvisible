'use server';

import { redirect } from 'next/navigation';
import { Prisma, prisma } from '@bvisible/db';
import { createTenantSchema } from '@/lib/validators';
import { writeAuditLog } from '@/lib/auth/audit';
import { requireSuperAdmin } from '@/lib/auth/current-user';
import { readRequestContext } from '@/lib/request-context';

export interface CreateTenantState {
  error: string | null;
}

export async function createTenantAction(
  _prev: CreateTenantState,
  formData: FormData
): Promise<CreateTenantState> {
  const me = await requireSuperAdmin();
  const ctx = await readRequestContext();

  const parsed = createTenantSchema.safeParse({
    name: formData.get('name'),
    slug: formData.get('slug'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const { name, slug } = parsed.data;

  let tenantId: string;
  try {
    const tenant = await prisma.tenant.create({
      data: { name, slug },
      select: { id: true, slug: true },
    });
    tenantId = tenant.id;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { error: 'That slug is already taken.' };
    }
    throw err;
  }

  await writeAuditLog({
    action: 'tenant_created',
    userId: me.id,
    tenantId,
    targetType: 'tenant',
    targetId: tenantId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { name, slug },
  });

  redirect(`/admin/tenants?created=${encodeURIComponent(slug)}`);
}
