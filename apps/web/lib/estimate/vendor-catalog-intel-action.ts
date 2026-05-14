'use server';

import { prisma } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { normalizeVendorItemName } from '@/lib/vendor-pricing/normalize';
import { lookupVendorCatalogIntelligence } from '@/lib/vendor-pricing/catalog-lookup';
import type { VendorCatalogLookupResult } from '@/lib/vendor-pricing/catalog-intel-types';

export async function lookupVendorCatalogForEstimateAction(payload: {
  rawDescription: string;
  dimensionsNormalized?: string | null;
  machineId?: string | null;
}): Promise<{ ok: true; data: VendorCatalogLookupResult } | { ok: false; error: string }> {
  try {
    const me = await requireTenantId();
    const normalizedQuery = normalizeVendorItemName(payload.rawDescription ?? '');
    const data = await lookupVendorCatalogIntelligence(prisma, {
      tenantId: me.tenantId,
      normalizedQuery,
      dimensionsNormalized: payload.dimensionsNormalized ?? undefined,
      machineId: payload.machineId ?? undefined,
    });
    return { ok: true, data };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Lookup failed.',
    };
  }
}
