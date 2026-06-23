import { ShopMaterialItemType, type EstimateLineKind, type Prisma, type ShopCatalogUnit } from '@bvisible/db';

export type BundleRequirement = {
  bundleComponentId: string;
  estimateLineId: string;
  bundleCatalogItemId: string;
  componentCatalogItemId: string | null;
  componentName: string;
  componentType: EstimateLineKind;
  quantityMilli: number;
  unit: ShopCatalogUnit;
  internalUnitCostCents: number;
  totalCostCents: number;
  selectedVendorId: string | null;
  preferredVendorId: string | null;
  cheapestVendorId: string | null;
  vendorSnapshotJson: unknown;
  notes: string | null;
};

export async function expandBundleEstimateRequirements(
  prisma: Pick<Prisma.TransactionClient, 'estimateLineItem'>,
  args: {
    tenantId: string;
    estimateLineIds: string[];
  },
): Promise<BundleRequirement[]> {
  if (args.estimateLineIds.length === 0) return [];

  const lines = await prisma.estimateLineItem.findMany({
    where: {
      tenantId: args.tenantId,
      id: { in: args.estimateLineIds },
      catalogItem: { itemType: ShopMaterialItemType.BUNDLE },
    },
    select: {
      id: true,
      catalogItemId: true,
      catalogItem: {
        select: {
          bundleComponents: {
            orderBy: [{ sortOrder: 'asc' }],
            select: {
              id: true,
              componentCatalogItemId: true,
              componentName: true,
              componentType: true,
              quantityMilli: true,
              unit: true,
              internalUnitCostCents: true,
              totalCostCents: true,
              selectedVendorId: true,
              preferredVendorId: true,
              cheapestVendorId: true,
              vendorSnapshotJson: true,
              notes: true,
            },
          },
        },
      },
    },
  });

  return lines.flatMap((line) =>
    (line.catalogItem?.bundleComponents ?? []).map((component) => ({
      bundleComponentId: component.id,
      estimateLineId: line.id,
      bundleCatalogItemId: line.catalogItemId!,
      componentCatalogItemId: component.componentCatalogItemId,
      componentName: component.componentName,
      componentType: component.componentType,
      quantityMilli: component.quantityMilli,
      unit: component.unit,
      internalUnitCostCents: component.internalUnitCostCents,
      totalCostCents: component.totalCostCents,
      selectedVendorId: component.selectedVendorId,
      preferredVendorId: component.preferredVendorId,
      cheapestVendorId: component.cheapestVendorId,
      vendorSnapshotJson: component.vendorSnapshotJson,
      notes: component.notes,
    })),
  );
}
