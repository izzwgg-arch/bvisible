import {
  EstimateLineKind,
  POEventKind,
  POLineKind,
  ShopCatalogUnit,
  VendorCostSourceMode,
  type Prisma,
} from '@bvisible/db';
import { nextPoNumber } from '@/lib/po/number';
import { expandBundleEstimateRequirements } from '@/lib/purchase-orders/expand-bundle-requirements';

type Db = Prisma.TransactionClient;

/** Why no PO came out. `nothing_to_purchase` is a normal outcome for an
 *  all-labor / all-misc estimate, not a failure — finalize treats it as
 *  "finalize anyway, just without a PO". */
export type CreateInternalMaterialsPoFailure = 'estimate_not_found' | 'nothing_to_purchase';

export type CreateInternalMaterialsPoResult =
  | { ok: true; purchaseOrderId: string; purchaseOrderNumber: string; created: boolean; lineCount: number; vendorCount: number; subtotalCents: number }
  | { ok: false; reason: CreateInternalMaterialsPoFailure; error: string };

type PoSeedLine = {
  kind: POLineKind;
  description: string;
  qtyMilli: number;
  unitCostCents: number;
  computedCostCents: number;
  notes: string | null;
  estimateLineId: string;
  catalogItemId: string | null;
  bundleComponentId: string | null;
  vendorId: string | null;
  selectedVendorMode: VendorCostSourceMode | null;
  vendorSku: string | null;
  unit: ShopCatalogUnit;
};

export async function createPoFromInternalMaterials(
  tx: Db,
  args: {
    tenantId: string;
    estimateId: string;
    actorId: string;
  },
): Promise<CreateInternalMaterialsPoResult> {
  const existing = await tx.purchaseOrder.findFirst({
    where: {
      tenantId: args.tenantId,
      estimateId: args.estimateId,
      deletedAt: null,
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      number: true,
      subtotalCents: true,
      lines: { select: { vendorId: true } },
    },
  });

  if (existing) {
    return {
      ok: true,
      purchaseOrderId: existing.id,
      purchaseOrderNumber: existing.number,
      created: false,
      lineCount: existing.lines.length,
      vendorCount: new Set(existing.lines.map((line) => line.vendorId).filter(Boolean)).size,
      subtotalCents: existing.subtotalCents,
    };
  }

  const estimate = await tx.estimate.findFirst({
    where: { id: args.estimateId, tenantId: args.tenantId, deletedAt: null },
    select: {
      id: true,
      number: true,
      lines: {
        orderBy: [{ sortOrder: 'asc' }],
        select: {
          id: true,
          kind: true,
          description: true,
          qtyMilli: true,
          unitCostCents: true,
          computedCostCents: true,
          notes: true,
          catalogItemId: true,
          selectedVendorId: true,
          selectedVendorMode: true,
          catalogItem: {
            select: {
              itemType: true,
              catalogUnit: true,
              preferredVendorId: true,
              vendorCatalogLinks: {
                select: { id: true, vendorId: true, vendorSku: true },
              },
            },
          },
        },
      },
    },
  });

  if (!estimate) return { ok: false, reason: 'estimate_not_found', error: 'Estimate not found.' };

  const bundleRequirements = await expandBundleEstimateRequirements(tx, {
    tenantId: args.tenantId,
    estimateLineIds: estimate.lines.map((line) => line.id),
  });

  const vendorSkuByCatalogAndVendor = new Map<string, string | null>();
  const latestPriceByCatalogLink = new Map<string, number>();
  const allCatalogLinkIds = estimate.lines.flatMap((line) => line.catalogItem?.vendorCatalogLinks.map((link) => link.id) ?? []);
  if (allCatalogLinkIds.length > 0) {
    const histories = await tx.vendorPriceHistory.findMany({
      where: { tenantId: args.tenantId, vendorCatalogItemId: { in: allCatalogLinkIds } },
      orderBy: { createdAt: 'desc' },
      select: { vendorCatalogItemId: true, priceCents: true },
    });
    for (const history of histories) {
      if (!latestPriceByCatalogLink.has(history.vendorCatalogItemId)) {
        latestPriceByCatalogLink.set(history.vendorCatalogItemId, history.priceCents);
      }
    }
  }
  for (const line of estimate.lines) {
    for (const link of line.catalogItem?.vendorCatalogLinks ?? []) {
      vendorSkuByCatalogAndVendor.set(vendorSkuKey(line.catalogItemId, link.vendorId), link.vendorSku);
    }
  }

  const lines: PoSeedLine[] = [];
  for (const line of estimate.lines) {
    if (line.kind !== EstimateLineKind.MATERIAL) continue;
    if (line.catalogItem?.itemType === 'BUNDLE') continue;
    const vendorId = resolveEstimateLineVendor(line, latestPriceByCatalogLink);
    lines.push({
      kind: POLineKind.MATERIAL,
      description: line.description,
      qtyMilli: line.qtyMilli,
      unitCostCents: line.unitCostCents,
      computedCostCents: line.computedCostCents,
      notes: line.notes,
      estimateLineId: line.id,
      catalogItemId: line.catalogItemId,
      bundleComponentId: null,
      vendorId,
      selectedVendorMode: line.selectedVendorMode,
      vendorSku: vendorSkuByCatalogAndVendor.get(vendorSkuKey(line.catalogItemId, vendorId)) ?? null,
      unit: line.catalogItem?.catalogUnit ?? ShopCatalogUnit.EACH,
    });
  }

  const componentCatalogItemIds = [
    ...new Set(
      bundleRequirements
        .map((requirement) => requirement.componentCatalogItemId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const componentCatalogVendorLinks =
    componentCatalogItemIds.length > 0
      ? await tx.vendorCatalogItem.findMany({
          where: {
            tenantId: args.tenantId,
            shopMaterialItemId: { in: componentCatalogItemIds },
          },
          select: {
            shopMaterialItemId: true,
            vendorId: true,
            vendorSku: true,
          },
        })
      : [];
  for (const link of componentCatalogVendorLinks) {
    vendorSkuByCatalogAndVendor.set(vendorSkuKey(link.shopMaterialItemId, link.vendorId), link.vendorSku);
  }

  for (const requirement of bundleRequirements) {
    if (requirement.componentType !== EstimateLineKind.MATERIAL) continue;
    const vendorChoice = resolveBundleVendor(requirement);
    lines.push({
      kind: POLineKind.MATERIAL,
      description: requirement.componentName,
      qtyMilli: requirement.quantityMilli,
      unitCostCents: requirement.internalUnitCostCents,
      computedCostCents: requirement.totalCostCents,
      notes: requirement.notes,
      estimateLineId: requirement.estimateLineId,
      catalogItemId: requirement.componentCatalogItemId,
      bundleComponentId: requirement.bundleComponentId,
      vendorId: vendorChoice.vendorId,
      selectedVendorMode: vendorChoice.mode,
      vendorSku: vendorSkuByCatalogAndVendor.get(vendorSkuKey(requirement.componentCatalogItemId, vendorChoice.vendorId)) ?? null,
      unit: requirement.unit,
    });
  }

  if (lines.length === 0) {
    return {
      ok: false,
      reason: 'nothing_to_purchase',
      error:
        'Nothing to purchase on this estimate — only Material lines and bundle components become PO lines. ' +
        'Design, Install, Labor, Machine and Misc lines are not ordered from a vendor.',
    };
  }

  const subtotalCents = lines.reduce((sum, line) => sum + line.computedCostCents, 0);
  const vendorIds = [...new Set(lines.map((line) => line.vendorId).filter((id): id is string => Boolean(id)))];
  const primaryVendorId = vendorIds.length === 1 ? vendorIds[0] : null;
  const number = await nextPoNumber(tx, args.tenantId);
  const po = await tx.purchaseOrder.create({
    data: {
      tenantId: args.tenantId,
      estimateId: estimate.id,
      vendorId: primaryVendorId,
      number,
      subtotalCents,
      createdById: args.actorId,
    },
    select: { id: true, number: true },
  });

  await tx.pOLineItem.createMany({
    data: lines.map((line, index) => ({
      tenantId: args.tenantId,
      purchaseOrderId: po.id,
      sortOrder: index,
      kind: line.kind,
      description: line.description,
      qtyMilli: line.qtyMilli,
      unitCostCents: line.unitCostCents,
      computedCostCents: line.computedCostCents,
      notes: line.notes,
      estimateLineId: line.estimateLineId,
      catalogItemId: line.catalogItemId,
      bundleComponentId: line.bundleComponentId,
      vendorId: line.vendorId,
      selectedVendorMode: line.selectedVendorMode,
      vendorSku: line.vendorSku,
      unit: line.unit,
    })),
  });

  if (vendorIds.length > 0) {
    await tx.purchaseOrderVendor.createMany({
      data: vendorIds.map((vendorId) => ({
        tenantId: args.tenantId,
        purchaseOrderId: po.id,
        vendorId,
      })),
    });
  }

  await tx.pOEvent.create({
    data: {
      tenantId: args.tenantId,
      purchaseOrderId: po.id,
      kind: POEventKind.CREATED_FROM_ESTIMATE,
      message: `Auto-created from estimate ${estimate.number} with ${lines.length} internal material line${lines.length === 1 ? '' : 's'} across ${vendorIds.length} vendor${vendorIds.length === 1 ? '' : 's'}`,
      metadata: {
        estimateId: estimate.id,
        estimateNumber: estimate.number,
        lineCount: lines.length,
        vendorCount: vendorIds.length,
        subtotalCents,
      },
      actorId: args.actorId,
    },
  });

  return {
    ok: true,
    purchaseOrderId: po.id,
    purchaseOrderNumber: po.number,
    created: true,
    lineCount: lines.length,
    vendorCount: vendorIds.length,
    subtotalCents,
  };
}

function vendorSkuKey(catalogItemId: string | null, vendorId: string | null): string {
  return `${catalogItemId ?? ''}:${vendorId ?? ''}`;
}

function resolveBundleVendor(requirement: {
  selectedVendorId: string | null;
  preferredVendorId: string | null;
  cheapestVendorId: string | null;
}): { vendorId: string | null; mode: VendorCostSourceMode | null } {
  if (requirement.selectedVendorId) {
    return { vendorId: requirement.selectedVendorId, mode: VendorCostSourceMode.MANUAL };
  }
  if (requirement.preferredVendorId) {
    return { vendorId: requirement.preferredVendorId, mode: VendorCostSourceMode.PREFERRED };
  }
  if (requirement.cheapestVendorId) {
    return { vendorId: requirement.cheapestVendorId, mode: VendorCostSourceMode.CHEAPEST };
  }
  return { vendorId: null, mode: VendorCostSourceMode.INTERNAL };
}

function resolveEstimateLineVendor(line: {
  selectedVendorId: string | null;
  selectedVendorMode: VendorCostSourceMode | null;
  catalogItem: {
    preferredVendorId: string | null;
    vendorCatalogLinks: Array<{ id: string; vendorId: string }>;
  } | null;
}, latestPriceByCatalogLink: ReadonlyMap<string, number>): string | null {
  if (line.selectedVendorId) return line.selectedVendorId;
  if (line.selectedVendorMode === VendorCostSourceMode.PREFERRED && line.catalogItem?.preferredVendorId) {
    return line.catalogItem.preferredVendorId;
  }
  const links = line.catalogItem?.vendorCatalogLinks ?? [];
  if (links.length === 0) return null;
  let cheapest: { vendorId: string; priceCents: number } | null = null;
  for (const link of links) {
    const priceCents = latestPriceByCatalogLink.get(link.id);
    if (priceCents == null) continue;
    if (!cheapest || priceCents < cheapest.priceCents) {
      cheapest = { vendorId: link.vendorId, priceCents };
    }
  }
  return cheapest?.vendorId ?? links[0]?.vendorId ?? null;
}
