// PO line → shop catalog auto-add.
//
// Business rule: when a PO line references an item that isn't in the
// catalog yet, the item adds ITSELF to the catalog (and the pricing
// Sheet, via the existing write-back) instead of staying an orphan.
// Matching is by normalized name so re-saving a PO, or two people typing
// "3M vinyl  50ft" vs "3m Vinyl 50FT", never creates duplicates — the
// same guarantee the Sheet sync makes (@@unique(tenantId, nameNormalized)
// backstops a race).
//
// Runs AFTER the PO save transaction commits, and never throws: a catalog
// hiccup must not break saving a purchase order.

import { POLineKind, Prisma, prisma } from '@bvisible/db';
import { normalizeVendorItemName } from '@/lib/vendor-pricing/normalize';
import { sheetItemKey } from '@/lib/sheet-sync/types';
import { writebackMaterialCreate } from '@/lib/sheet-sync/writeback';
import { writeAuditLog } from '@/lib/auth/audit';

export interface CatalogAutoAddResult {
  linked: number;
  created: number;
  createdNames: string[];
}

const AUTO_CATEGORY = 'Uncategorized';

/// Look at every MATERIAL line on the PO that has no catalog link yet:
/// link it to an existing catalog item when the name matches, otherwise
/// create the catalog item (cost = the line's unit cost, unit = the
/// line's unit, vendor = the line's vendor) and push it to the Sheet.
export async function autoAddPoLinesToCatalog(input: {
  tenantId: string;
  purchaseOrderId: string;
  actorId?: string;
}): Promise<CatalogAutoAddResult> {
  const result: CatalogAutoAddResult = { linked: 0, created: 0, createdNames: [] };
  try {
    const lines = await prisma.pOLineItem.findMany({
      where: {
        tenantId: input.tenantId,
        purchaseOrderId: input.purchaseOrderId,
        kind: POLineKind.MATERIAL,
        catalogItemId: null,
      },
      select: {
        id: true,
        description: true,
        unit: true,
        unitCostCents: true,
        vendorId: true,
      },
    });

    for (const line of lines) {
      const name = line.description.trim().slice(0, 400);
      if (!name) continue;
      const nameNormalized = normalizeVendorItemName(name);
      if (!nameNormalized) continue;

      // 1) Existing item wins — by normalized name, then by Sheet key.
      let catalog = await prisma.shopMaterialItem.findFirst({
        where: {
          tenantId: input.tenantId,
          OR: [{ nameNormalized }, { sheetKey: sheetItemKey(name) }],
        },
        select: { id: true },
      });

      // 2) Otherwise the item adds itself to the catalog.
      if (!catalog) {
        try {
          catalog = await prisma.shopMaterialItem.create({
            data: {
              tenantId: input.tenantId,
              name,
              nameNormalized,
              kind: 'MATERIAL',
              catalogUnit: line.unit,
              categories: [AUTO_CATEGORY],
              internalCostCents: Math.max(0, line.unitCostCents),
              preferredVendorId: line.vendorId,
              isActive: true,
              notes: 'Added automatically from a purchase order line.',
            },
            select: { id: true },
          });
        } catch (e) {
          // Race backstop: someone created the same name concurrently.
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            catalog = await prisma.shopMaterialItem.findFirst({
              where: { tenantId: input.tenantId, nameNormalized },
              select: { id: true },
            });
          } else {
            throw e;
          }
        }
        if (catalog) {
          result.created += 1;
          result.createdNames.push(name);
          await writeAuditLog({
            action: 'po_line_catalog_autocreated',
            tenantId: input.tenantId,
            userId: input.actorId ?? null,
            targetType: 'shop_material_item',
            targetId: catalog.id,
            metadata: {
              name,
              purchaseOrderId: input.purchaseOrderId,
              internalCostCents: Math.max(0, line.unitCostCents),
            },
          });
          // Mirror into the pricing Sheet (fire-and-forget; the write-back
          // updates an existing Sheet row instead of appending a duplicate).
          void writebackMaterialCreate(name, AUTO_CATEGORY, Math.max(0, line.unitCostCents));
        }
      }

      if (catalog) {
        await prisma.pOLineItem.update({
          where: { id: line.id },
          data: { catalogItemId: catalog.id },
        });
        result.linked += 1;
      }
    }
  } catch (err) {
    console.error('[po-catalog-autoadd] failed:', err instanceof Error ? err.message : err);
  }
  return result;
}
