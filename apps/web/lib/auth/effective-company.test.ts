import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/company/default-company', () => ({
  ensureDefaultCompany: vi.fn(async () => ({
    id: 'default-id',
    name: 'B Visible',
    slug: 'bvisible',
  })),
}));

import { Role } from '@bvisible/db';
import { resolveEffectiveCompany } from './effective-company';
import { ensureDefaultCompany } from '@/lib/company/default-company';

const mockedEnsure = vi.mocked(ensureDefaultCompany);

describe('resolveEffectiveCompany', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forces SUPER_ADMIN to default company even when DB tenantId is set', async () => {
    const eff = await resolveEffectiveCompany({
      role: Role.SUPER_ADMIN,
      tenantId: 'other',
      tenant: { id: 'other', name: 'X', slug: 'x' },
    });
    expect(eff.tenantId).toBe('default-id');
    expect(eff.tenant.slug).toBe('bvisible');
    expect(mockedEnsure).toHaveBeenCalledTimes(1);
  });

  it('uses assigned tenant for ADMIN', async () => {
    const eff = await resolveEffectiveCompany({
      role: Role.ADMIN,
      tenantId: 't-acme',
      tenant: { id: 't-acme', name: 'Acme', slug: 'acme' },
    });
    expect(eff.tenantId).toBe('t-acme');
    expect(eff.tenant.slug).toBe('acme');
    expect(mockedEnsure).toHaveBeenCalledTimes(1);
  });

  it('falls back USER without tenant to default company', async () => {
    const eff = await resolveEffectiveCompany({
      role: Role.USER,
      tenantId: null,
      tenant: null,
    });
    expect(eff.tenantId).toBe('default-id');
  });
});
