import { Prisma, VendorPriceConfidence, VendorPriceExtractionMethod } from '@bvisible/db';
import type { PrismaClient } from '@bvisible/db';
import { buildDedupeKey } from '@/lib/vendor-pricing/persist';
import { randomUUID } from 'node:crypto';

export async function appendManualVendorPriceForShopItem(
  prisma: PrismaClient,
  args: {
    tenantId: string;
    shopMaterialItemId: string;
    vendorId: string;
    priceCents: number;
    unit: string | null;
    note: string | null;
    effectiveAt: Date | null;
  },
): Promise<
  | { ok: true; vendorCatalogItemId: string; vendorPriceHistoryId: string }
  | { ok: false; code: 'NOT_FOUND' | 'CONFLICT' | 'INVALID'; message: string }
> {
  if (!Number.isFinite(args.priceCents) || args.priceCents < 0) {
    return { ok: false, code: 'INVALID', message: 'Price must be zero or positive.' };
  }

  const shop = await prisma.shopMaterialItem.findFirst({
    where: { id: args.shopMaterialItemId, tenantId: args.tenantId },
    select: { id: true, name: true, nameNormalized: true, isActive: true },
  });
  if (!shop) return { ok: false, code: 'NOT_FOUND', message: 'Item not found.' };
  if (!shop.isActive) return { ok: false, code: 'INVALID', message: 'Item is inactive.' };

  const vendor = await prisma.vendor.findFirst({
    where: { id: args.vendorId, tenantId: args.tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!vendor) return { ok: false, code: 'NOT_FOUND', message: 'Vendor not found.' };

  const normalized = shop.nameNormalized;

  const existing = await prisma.vendorCatalogItem.findUnique({
    where: {
      tenantId_vendorId_nameNormalized: {
        tenantId: args.tenantId,
        vendorId: args.vendorId,
        nameNormalized: normalized,
      },
    },
    select: { id: true, shopMaterialItemId: true },
  });

  if (existing?.shopMaterialItemId && existing.shopMaterialItemId !== shop.id) {
    return {
      ok: false,
      code: 'CONFLICT',
      message:
        'This vendor already has pricing under the same catalog key linked to a different item. Resolve in Items before adding manual pricing.',
    };
  }

  let catalogId = existing?.id;
  if (!catalogId) {
    const row = await prisma.vendorCatalogItem.create({
      data: {
        tenantId: args.tenantId,
        vendorId: args.vendorId,
        nameNormalized: normalized,
        shopMaterialItemId: shop.id,
      },
      select: { id: true },
    });
    catalogId = row.id;
  } else if (!existing!.shopMaterialItemId) {
    await prisma.vendorCatalogItem.update({
      where: { id: catalogId },
      data: { shopMaterialItemId: shop.id },
    });
  }

  const dedupeKey = buildDedupeKey({
    kind: 'manual_shop_price',
    tenantId: args.tenantId,
    shopMaterialItemId: shop.id,
    vendorId: args.vendorId,
    nonce: randomUUID(),
  });

  const itemRawBase = (args.note?.trim() ? args.note.trim() : shop.name).slice(0, 500);

  try {
    const hist = await prisma.vendorPriceHistory.create({
      data: {
        tenantId: args.tenantId,
        vendorId: args.vendorId,
        vendorCatalogItemId: catalogId,
        itemNameRaw: itemRawBase,
        itemNameNormalized: normalized.slice(0, 400),
        priceCents: args.priceCents,
        unit: args.unit,
        quantityMilli: null,
        confidence: VendorPriceConfidence.HIGH,
        extractionMethod: VendorPriceExtractionMethod.MANUAL,
        dedupeKey,
        effectiveAt: args.effectiveAt,
        sourceEmailId: null,
        sourceAttachmentId: null,
        sourcePoAttachmentId: null,
        ocrLineItemId: null,
      },
      select: { id: true },
    });
    return { ok: true, vendorCatalogItemId: catalogId, vendorPriceHistoryId: hist.id };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return {
        ok: false,
        code: 'CONFLICT',
        message: 'Duplicate price observation — try again.',
      };
    }
    throw err;
  }
}
