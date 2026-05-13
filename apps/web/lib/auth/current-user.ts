import { cache } from 'react';
import { redirect } from 'next/navigation';
import { prisma, Role } from '@bvisible/db';
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

// For tenant-scoped pages: the user must have a tenantId. SUPER_ADMIN
// without a tenant is rejected — they should use admin pages instead.
export async function requireTenantId(): Promise<
  CurrentUser & { tenantId: string; tenant: NonNullable<CurrentUser['tenant']> }
> {
  const user = await requireUser();
  if (!user.tenantId || !user.tenant) {
    redirect('/dashboard?error=no-tenant');
  }
  return user as CurrentUser & {
    tenantId: string;
    tenant: NonNullable<CurrentUser['tenant']>;
  };
}
