import { cache } from 'react';
import { redirect } from 'next/navigation';
import { prisma, Role } from '@bvisible/db';
import { MultipleCompaniesUnresolvedError } from '@/lib/company/default-company';
import { resolveEffectiveCompany } from './effective-company';
import { resolveSessionFromCookie } from './session';

export interface CurrentUser {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  tenantId: string | null;
  tenant: { id: string; name: string; slug: string } | null;
  sessionId: string;
}

// Cached for the lifetime of a single render — multiple components on the
// same page can call requireUser() without N round-trips.
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await resolveSessionFromCookie();
  if (!session) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      tenantId: true,
      disabledAt: true,
      tenant: {
        select: { id: true, name: true, slug: true },
      },
    },
  });
  if (!user) return null;
  if (user.disabledAt) return null;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    tenantId: user.tenantId,
    tenant: user.tenant,
    sessionId: session.sessionId,
  };
});

// Throws via Next's redirect() if not authenticated. Callers in RSC /
// server actions can rely on the returned user being non-null.
export async function requireUser(redirectTo = '/login'): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect(redirectTo);
  return user;
}

export async function requireRole(...roles: Role[]): Promise<CurrentUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) {
    // 403 path: send to /dashboard which will render in their permitted
    // scope. Avoid /login (creates a redirect loop for authenticated users).
    redirect('/dashboard?error=forbidden');
  }
  return user;
}

export async function requireSuperAdmin(): Promise<CurrentUser> {
  return requireRole(Role.SUPER_ADMIN);
}

export type TenantScopedUser = CurrentUser & {
  tenantId: string;
  tenant: NonNullable<CurrentUser['tenant']>;
};

/** Sidebar / shell: fills effective company for SUPER_ADMIN and legacy null-tenant users. */
export async function requireUserForAppShell(): Promise<TenantScopedUser> {
  const user = await requireUser();
  try {
    const eff = await resolveEffectiveCompany(user);
    return { ...user, tenantId: eff.tenantId, tenant: eff.tenant };
  } catch (e) {
    if (e instanceof MultipleCompaniesUnresolvedError) {
      redirect('/dashboard?error=multi-company');
    }
    throw e;
  }
}

/**
 * Same as {@link requireRole} but guarantees a company (`tenantId`) for scoped admin tools.
 */
export async function requireRoleWithEffectiveCompany(
  ...roles: Role[]
): Promise<TenantScopedUser> {
  const user = await requireRole(...roles);
  try {
    const eff = await resolveEffectiveCompany(user);
    return { ...user, tenantId: eff.tenantId, tenant: eff.tenant };
  } catch (e) {
    if (e instanceof MultipleCompaniesUnresolvedError) {
      redirect('/dashboard?error=multi-company');
    }
    throw e;
  }
}

// Product pages: resolve internal company scope without exposing multi-tenant SaaS UX.
export async function requireTenantId(): Promise<TenantScopedUser> {
  const user = await requireUser();
  try {
    const eff = await resolveEffectiveCompany(user);
    return { ...user, tenantId: eff.tenantId, tenant: eff.tenant };
  } catch (e) {
    if (e instanceof MultipleCompaniesUnresolvedError) {
      redirect('/dashboard?error=multi-company');
    }
    throw e;
  }
}
