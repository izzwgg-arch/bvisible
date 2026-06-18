import type { PrismaClient } from '@bvisible/db';

export type TenantInvoiceProfile = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  slogan: string | null;
  logoDataUrl: string | null;
};

export type TenantIdentity = {
  id: string;
  name: string;
};

export function fallbackTenantInvoiceProfile(tenant: TenantIdentity): TenantInvoiceProfile {
  return {
    id: tenant.id,
    name: tenant.name,
    phone: null,
    email: null,
    address: null,
    slogan: null,
    logoDataUrl: null,
  };
}

export async function getTenantInvoiceProfile(
  db: Pick<PrismaClient, '$queryRaw'>,
  tenant: TenantIdentity
): Promise<TenantInvoiceProfile> {
  try {
    const rows = await db.$queryRaw<TenantInvoiceProfile[]>`
      SELECT "id", "name", "phone", "email", "address", "slogan", "logoDataUrl"
      FROM "tenants"
      WHERE "id" = ${tenant.id}
      LIMIT 1
    `;
    return rows[0] ?? fallbackTenantInvoiceProfile(tenant);
  } catch {
    return fallbackTenantInvoiceProfile(tenant);
  }
}

export async function updateTenantInvoiceProfile(
  db: Pick<PrismaClient, '$executeRaw'>,
  profile: TenantInvoiceProfile
): Promise<void> {
  await db.$executeRaw`
    UPDATE "tenants"
    SET
      "name" = ${profile.name},
      "phone" = ${profile.phone},
      "email" = ${profile.email},
      "address" = ${profile.address},
      "slogan" = ${profile.slogan},
      "logoDataUrl" = ${profile.logoDataUrl},
      "updatedAt" = NOW()
    WHERE "id" = ${profile.id}
  `;
}
