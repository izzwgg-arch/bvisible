'use server';

import { redirect } from 'next/navigation';
import { Prisma, Role, prisma } from '@bvisible/db';
import { revalidatePath } from 'next/cache';
import { writeAuditLog } from '@/lib/auth/audit';
import { requireRoleWithEffectiveCompany } from '@/lib/auth/current-user';
import { readRequestContext } from '@/lib/request-context';
import { normalizeVendorItemName } from '@/lib/vendor-pricing/normalize';
import { appendManualVendorPriceForShopItem } from '@/lib/shop-material/append-manual-price';
import { parseUsdToCents } from '@/lib/shop-material/money';

async function requireAdminScoped() {
  return requireRoleWithEffectiveCompany(Role.ADMIN, Role.SUPER_ADMIN);
}

export type ShopMaterialActionState = { error: string | null };

export async function createShopMaterialItemAction(
  _prev: ShopMaterialActionState,
  formData: FormData,
): Promise<ShopMaterialActionState> {
  const me = await requireAdminScoped();
  const ctx = await readRequestContext();

  const name = String(formData.get('name') ?? '').trim();
  const category = String(formData.get('category') ?? '').trim() || null;
  const defaultUnit = String(formData.get('defaultUnit') ?? '').trim() || null;
  const notes = String(formData.get('notes') ?? '').trim() || null;

  const nameNormalized = normalizeVendorItemName(name);
  if (nameNormalized.length < 2) {
    return { error: 'Enter a material name (at least two meaningful characters).' };
  }

  try {
    const row = await prisma.shopMaterialItem.create({
      data: {
        tenantId: me.tenantId,
        name: name.slice(0, 400),
        nameNormalized,
        category: category?.slice(0, 120) ?? null,
        defaultUnit: defaultUnit?.slice(0, 40) ?? null,
        notes: notes?.slice(0, 2000) ?? null,
      },
      select: { id: true },
    });

    await writeAuditLog({
      action: 'shop_material_item_created',
      userId: me.id,
      tenantId: me.tenantId,
      targetType: 'shop_material_item',
      targetId: row.id,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { nameNormalized },
    });

    redirect(`/items/${row.id}`);
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return { error: 'An item with this normalized name already exists.' };
    }
    throw e;
  }
}

export async function updateShopMaterialItemAttributesAction(formData: FormData): Promise<void> {
  const me = await requireAdminScoped();
  const ctx = await readRequestContext();

  const id = String(formData.get('id') ?? '').trim();
  const category = String(formData.get('category') ?? '').trim() || null;
  const defaultUnit = String(formData.get('defaultUnit') ?? '').trim() || null;
  const notes = String(formData.get('notes') ?? '').trim() || null;

  const existing = await prisma.shopMaterialItem.findFirst({
    where: { id, tenantId: me.tenantId },
    select: { id: true },
  });
  if (!existing) return;

  await prisma.shopMaterialItem.update({
    where: { id },
    data: {
      category: category?.slice(0, 120) ?? null,
      defaultUnit: defaultUnit?.slice(0, 40) ?? null,
      notes: notes?.slice(0, 2000) ?? null,
    },
  });

  await writeAuditLog({
    action: 'shop_material_item_saved',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'shop_material_item',
    targetId: id,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { fields: ['category', 'defaultUnit', 'notes'] },
  });

  revalidatePath(`/items/${id}`);
  revalidatePath('/items');
}

export async function setShopMaterialPreferredVendorAction(formData: FormData): Promise<void> {
  const me = await requireAdminScoped();
  const ctx = await readRequestContext();

  const id = String(formData.get('id') ?? '').trim();
  const vendorIdRaw = String(formData.get('preferredVendorId') ?? '').trim();

  const existing = await prisma.shopMaterialItem.findFirst({
    where: { id, tenantId: me.tenantId },
    select: { id: true },
  });
  if (!existing) return;

  let preferredVendorId: string | null = vendorIdRaw || null;
  if (preferredVendorId) {
    const v = await prisma.vendor.findFirst({
      where: { id: preferredVendorId, tenantId: me.tenantId, deletedAt: null },
      select: { id: true },
    });
    if (!v) preferredVendorId = null;
  }

  await prisma.shopMaterialItem.update({
    where: { id },
    data: { preferredVendorId },
  });

  await writeAuditLog({
    action: 'shop_material_item_saved',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'shop_material_item',
    targetId: id,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { preferredVendorId },
  });

  revalidatePath(`/items/${id}`);
}

export async function setShopMaterialActiveAction(formData: FormData): Promise<void> {
  const me = await requireAdminScoped();
  const ctx = await readRequestContext();

  const id = String(formData.get('id') ?? '').trim();
  const next = String(formData.get('isActive') ?? '') === 'true';

  const existing = await prisma.shopMaterialItem.findFirst({
    where: { id, tenantId: me.tenantId },
    select: { id: true },
  });
  if (!existing) return;

  await prisma.shopMaterialItem.update({
    where: { id },
    data: { isActive: next },
  });

  await writeAuditLog({
    action: 'shop_material_item_saved',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'shop_material_item',
    targetId: id,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { isActive: next },
  });

  revalidatePath(`/items/${id}`);
  revalidatePath('/items');
}

export async function addShopMaterialAliasAction(
  _prev: ShopMaterialActionState,
  formData: FormData,
): Promise<ShopMaterialActionState> {
  const me = await requireAdminScoped();
  const ctx = await readRequestContext();

  const shopMaterialItemId = String(formData.get('shopMaterialItemId') ?? '').trim();
  const aliasRaw = String(formData.get('alias') ?? '').trim();
  const aliasNormalized = normalizeVendorItemName(aliasRaw);

  if (aliasNormalized.length < 2) {
    return { error: 'Alias too short after normalization.' };
  }

  const item = await prisma.shopMaterialItem.findFirst({
    where: { id: shopMaterialItemId, tenantId: me.tenantId },
    select: { id: true, nameNormalized: true },
  });
  if (!item) return { error: 'Item not found.' };

  if (aliasNormalized === item.nameNormalized) {
    return { error: 'Alias matches the primary catalog key — nothing to add.' };
  }

  const clashesItemName = await prisma.shopMaterialItem.findFirst({
    where: {
      tenantId: me.tenantId,
      nameNormalized: aliasNormalized,
      NOT: { id: item.id },
    },
    select: { id: true },
  });
  if (clashesItemName) {
    return { error: 'That alias matches another item name.' };
  }

  try {
    await prisma.shopMaterialItemAlias.create({
      data: {
        tenantId: me.tenantId,
        shopMaterialItemId: item.id,
        aliasNormalized,
      },
    });

    await writeAuditLog({
      action: 'shop_material_item_saved',
      userId: me.id,
      tenantId: me.tenantId,
      targetType: 'shop_material_item',
      targetId: item.id,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { aliasAdded: aliasNormalized },
    });

    revalidatePath(`/items/${item.id}`);
    return { error: null };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return { error: 'That alias is already used on another item.' };
    }
    throw e;
  }
}

export async function removeShopMaterialAliasAction(formData: FormData): Promise<void> {
  const me = await requireAdminScoped();

  const aliasId = String(formData.get('aliasId') ?? '').trim();
  const alias = await prisma.shopMaterialItemAlias.findFirst({
    where: { id: aliasId, tenantId: me.tenantId },
    select: { id: true, shopMaterialItemId: true },
  });
  if (!alias) return;

  await prisma.shopMaterialItemAlias.delete({ where: { id: alias.id } });

  revalidatePath(`/items/${alias.shopMaterialItemId}`);
}

export async function appendManualShopMaterialPriceAction(
  _prev: ShopMaterialActionState,
  formData: FormData,
): Promise<ShopMaterialActionState> {
  const me = await requireAdminScoped();
  const ctx = await readRequestContext();

  const shopMaterialItemId = String(formData.get('shopMaterialItemId') ?? '').trim();
  const vendorId = String(formData.get('vendorId') ?? '').trim();
  const priceRaw = String(formData.get('priceUsd') ?? '');
  const unit = String(formData.get('unit') ?? '').trim() || null;
  const note = String(formData.get('note') ?? '').trim() || null;
  const effectiveRaw = String(formData.get('effectiveAt') ?? '').trim();

  const priceCents = parseUsdToCents(priceRaw);
  if (priceCents === null) {
    return { error: 'Enter a valid USD amount.' };
  }

  let effectiveAt: Date | null = null;
  if (effectiveRaw) {
    const d = new Date(effectiveRaw);
    if (Number.isNaN(d.getTime())) {
      return { error: 'Invalid effective date.' };
    }
    effectiveAt = d;
  }

  const ins = await appendManualVendorPriceForShopItem(prisma, {
    tenantId: me.tenantId,
    shopMaterialItemId,
    vendorId,
    priceCents,
    unit: unit?.slice(0, 40) ?? null,
    note: note?.slice(0, 500) ?? null,
    effectiveAt,
  });

  if (!ins.ok) {
    return { error: ins.message };
  }

  await writeAuditLog({
    action: 'shop_material_manual_price_recorded',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'vendor_price_history',
    targetId: ins.vendorPriceHistoryId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: {
      shopMaterialItemId,
      vendorCatalogItemId: ins.vendorCatalogItemId,
      priceCents,
    },
  });

  revalidatePath(`/items/${shopMaterialItemId}`);
  revalidatePath('/items');
  return { error: null };
}

export async function linkVendorCatalogToShopItemAction(formData: FormData): Promise<void> {
  const me = await requireAdminScoped();
  const ctx = await readRequestContext();

  const shopMaterialItemId = String(formData.get('shopMaterialItemId') ?? '').trim();
  const vendorCatalogItemId = String(formData.get('vendorCatalogItemId') ?? '').trim();

  const shop = await prisma.shopMaterialItem.findFirst({
    where: { id: shopMaterialItemId, tenantId: me.tenantId },
    select: { id: true, nameNormalized: true },
  });
  if (!shop) return;

  const cat = await prisma.vendorCatalogItem.findFirst({
    where: { id: vendorCatalogItemId, tenantId: me.tenantId },
    select: { id: true, nameNormalized: true, shopMaterialItemId: true },
  });
  if (!cat) return;

  if (cat.nameNormalized !== shop.nameNormalized) return;

  if (cat.shopMaterialItemId && cat.shopMaterialItemId !== shop.id) return;

  await prisma.vendorCatalogItem.update({
    where: { id: cat.id },
    data: { shopMaterialItemId: shop.id },
  });

  await writeAuditLog({
    action: 'shop_material_catalog_linked',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'vendor_catalog_item',
    targetId: cat.id,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { shopMaterialItemId: shop.id },
  });

  revalidatePath(`/items/${shop.id}`);
}
