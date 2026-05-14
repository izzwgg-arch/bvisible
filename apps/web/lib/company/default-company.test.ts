import { describe, it, expect, beforeEach, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  tenant: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock('@bvisible/db', () => ({
  prisma: prismaMock,
}));

import {
  DEFAULT_COMPANY_NAME,
  DEFAULT_COMPANY_SLUG,
  MultipleCompaniesUnresolvedError,
  ensureDefaultCompanyUncached,
} from './default-company';

describe('ensureDefaultCompanyUncached', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns existing canonical row and normalizes name', async () => {
    prismaMock.tenant.findUnique.mockResolvedValueOnce({
      id: 't1',
      name: 'Old',
      slug: DEFAULT_COMPANY_SLUG,
    });
    prismaMock.tenant.update.mockResolvedValueOnce({
      id: 't1',
      name: DEFAULT_COMPANY_NAME,
      slug: DEFAULT_COMPANY_SLUG,
    });

    const row = await ensureDefaultCompanyUncached();
    expect(row.slug).toBe(DEFAULT_COMPANY_SLUG);
    expect(row.name).toBe(DEFAULT_COMPANY_NAME);
    expect(prismaMock.tenant.update).toHaveBeenCalled();
  });

  it('creates when no tenants exist', async () => {
    prismaMock.tenant.findUnique.mockResolvedValueOnce(null);
    prismaMock.tenant.findMany.mockResolvedValueOnce([]);
    prismaMock.tenant.create.mockResolvedValueOnce({
      id: 'new',
      name: DEFAULT_COMPANY_NAME,
      slug: DEFAULT_COMPANY_SLUG,
    });

    const row = await ensureDefaultCompanyUncached();
    expect(prismaMock.tenant.create).toHaveBeenCalledWith({
      data: { name: DEFAULT_COMPANY_NAME, slug: DEFAULT_COMPANY_SLUG },
      select: { id: true, name: true, slug: true },
    });
    expect(row.id).toBe('new');
  });

  it('normalizes a single non-canonical tenant', async () => {
    prismaMock.tenant.findUnique.mockResolvedValueOnce(null);
    prismaMock.tenant.findMany.mockResolvedValueOnce([
      { id: 'only', name: 'Acme', slug: 'acme' },
    ]);
    prismaMock.tenant.update.mockResolvedValueOnce({
      id: 'only',
      name: DEFAULT_COMPANY_NAME,
      slug: DEFAULT_COMPANY_SLUG,
    });

    await ensureDefaultCompanyUncached();
    expect(prismaMock.tenant.update).toHaveBeenCalledWith({
      where: { id: 'only' },
      data: { name: DEFAULT_COMPANY_NAME, slug: DEFAULT_COMPANY_SLUG },
      select: { id: true, name: true, slug: true },
    });
  });

  it('throws when multiple tenants exist without canonical slug', async () => {
    prismaMock.tenant.findUnique.mockResolvedValueOnce(null);
    prismaMock.tenant.findMany.mockResolvedValueOnce([
      { id: 'a', name: 'A', slug: 'a' },
      { id: 'b', name: 'B', slug: 'b' },
    ]);

    await expect(ensureDefaultCompanyUncached()).rejects.toBeInstanceOf(
      MultipleCompaniesUnresolvedError,
    );
    expect(prismaMock.tenant.create).not.toHaveBeenCalled();
  });
});
