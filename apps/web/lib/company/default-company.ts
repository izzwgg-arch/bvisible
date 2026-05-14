import { cache } from 'react';
import { prisma } from '@bvisible/db';

export const DEFAULT_COMPANY_SLUG = 'bvisible';
export const DEFAULT_COMPANY_NAME = 'B Visible';

/** Raised when more than one Tenant exists but none uses {@link DEFAULT_COMPANY_SLUG}. */
export class MultipleCompaniesUnresolvedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MultipleCompaniesUnresolvedError';
  }
}

export type DefaultCompanyRow = {
  id: string;
  name: string;
  slug: string;
};

/**
 * Find or create the canonical company (`Tenant`) row for single-company mode.
 * Idempotent. Safe to call multiple times per request (see cached export).
 *
 * Policy:
 * - If a row with slug `bvisible` exists → normalize display name to “B Visible”.
 * - Else if zero tenants → create it.
 * - Else if exactly one tenant → rename slug/name to the canonical values.
 * - Else multiple tenants with no `bvisible` slug → throw {@link MultipleCompaniesUnresolvedError}.
 */
export async function ensureDefaultCompanyUncached(): Promise<DefaultCompanyRow> {
  const bySlug = await prisma.tenant.findUnique({
    where: { slug: DEFAULT_COMPANY_SLUG },
    select: { id: true, name: true, slug: true },
  });
  if (bySlug) {
    if (bySlug.name !== DEFAULT_COMPANY_NAME) {
      return prisma.tenant.update({
        where: { id: bySlug.id },
        data: { name: DEFAULT_COMPANY_NAME },
        select: { id: true, name: true, slug: true },
      });
    }
    return bySlug;
  }

  const all = await prisma.tenant.findMany({
    select: { id: true, name: true, slug: true },
    orderBy: { createdAt: 'asc' },
  });

  if (all.length === 0) {
    return prisma.tenant.create({
      data: { name: DEFAULT_COMPANY_NAME, slug: DEFAULT_COMPANY_SLUG },
      select: { id: true, name: true, slug: true },
    });
  }

  if (all.length === 1) {
    const only = all[0]!;
    return prisma.tenant.update({
      where: { id: only.id },
      data: { name: DEFAULT_COMPANY_NAME, slug: DEFAULT_COMPANY_SLUG },
      select: { id: true, name: true, slug: true },
    });
  }

  throw new MultipleCompaniesUnresolvedError(
    `Multiple companies (${all.length}) exist but none use slug "${DEFAULT_COMPANY_SLUG}". ` +
      `Assign slug "${DEFAULT_COMPANY_SLUG}" to the intended company or merge tenants before continuing.`,
  );
}

/** Per-request memoization for RSC / server actions (same invocation tree). */
export const ensureDefaultCompany = cache(ensureDefaultCompanyUncached);
