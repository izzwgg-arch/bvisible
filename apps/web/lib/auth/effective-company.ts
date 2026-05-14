import { Role } from '@bvisible/db';
import {
  ensureDefaultCompany,
  type DefaultCompanyRow,
} from '@/lib/company/default-company';

type TenantSummary = { id: string; name: string; slug: string };

function asTenantShape(row: DefaultCompanyRow): TenantSummary {
  return { id: row.id, name: row.name, slug: row.slug };
}

/**
 * Resolves the company (`Tenant`) scope for product surfaces.
 *
 * - `SUPER_ADMIN` always uses the default company for operational/product pages
 *   (JWT / browser). Their DB row may remain `tenantId: null`.
 * - Tenant-scoped roles use their assigned `tenantId` when set.
 * - Users without `tenantId` fall back to the default company (bootstrap / legacy rows).
 *
 * Does not weaken row-level checks: queries must still filter by the returned id.
 */
export async function resolveEffectiveCompany(user: {
  tenantId: string | null;
  tenant: TenantSummary | null;
  role: Role;
}): Promise<{ tenantId: string; tenant: TenantSummary }> {
  const defaultCompany = await ensureDefaultCompany();

  if (user.role === Role.SUPER_ADMIN) {
    return { tenantId: defaultCompany.id, tenant: asTenantShape(defaultCompany) };
  }

  if (user.tenantId && user.tenant) {
    return { tenantId: user.tenantId, tenant: user.tenant };
  }

  return { tenantId: defaultCompany.id, tenant: asTenantShape(defaultCompany) };
}
