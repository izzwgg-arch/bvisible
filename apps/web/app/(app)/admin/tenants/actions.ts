'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { Prisma, prisma } from '@bvisible/db';
import { createTenantSchema, updateTenantInvoiceProfileSchema } from '@/lib/validators';
import { writeAuditLog } from '@/lib/auth/audit';
import { requireSuperAdmin } from '@/lib/auth/current-user';
import { updateTenantInvoiceProfile } from '@/lib/company/tenant-invoice-profile';
import { readRequestContext } from '@/lib/request-context';
import { ensureDefaultMachines } from '@/lib/estimate/seed-machines';

export interface CreateTenantState {
  error: string | null;
}

export interface TenantInvoiceProfileState {
  error: string | null;
  ok?: boolean;
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

  // Seed the default machine catalog so estimators immediately have
  // the standard machine rates from ESTIMATE_ENGINE.md available in
  // the line-item picker. Idempotent — safe even if a future code
  // path also seeds.
  try {
    await ensureDefaultMachines(tenantId);
  } catch (err) {
    // Don't block tenant creation if seeding fails; the admin can
    // re-seed by adding machines manually later. Surface in stderr.
    // eslint-disable-next-line no-console
    console.error('seed_default_machines_failed', {
      tenantId,
      err: err instanceof Error ? err.message : String(err),
    });
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

export async function updateTenantInvoiceProfileAction(
  _prev: TenantInvoiceProfileState,
  formData: FormData
): Promise<TenantInvoiceProfileState> {
  const me = await requireSuperAdmin();
  const ctx = await readRequestContext();

  const parsed = updateTenantInvoiceProfileSchema.safeParse({
    tenantId: formData.get('tenantId'),
    name: formData.get('name'),
    phone: formData.get('phone'),
    email: formData.get('email'),
    address: formData.get('address'),
    slogan: formData.get('slogan'),
    logoDataUrl: formData.get('logoDataUrl'),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid company profile.' };
  }

  const { tenantId, name, phone, email, address, slogan, logoDataUrl } = parsed.data;
  const existing = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true },
  });

  if (!existing) {
    return { error: 'Company not found.' };
  }

  try {
    await updateTenantInvoiceProfile(prisma, {
      id: tenantId,
      name,
      phone,
      email,
      address,
      slogan,
      logoDataUrl,
    });
  } catch {
    return {
      error:
        'Company invoice fields are not available in the database yet. Run the tenant invoice profile migration, then try again.',
    };
  }

  await writeAuditLog({
    action: 'tenant_invoice_profile_saved',
    userId: me.id,
    tenantId,
    targetType: 'tenant',
    targetId: tenantId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { name, hasLogo: logoDataUrl != null },
  });

  revalidatePath('/admin/tenants');
  revalidatePath('/estimates');
  revalidatePath('/quote/[token]', 'page');
  return { error: null, ok: true };
}
