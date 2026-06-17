'use server';

import {
  EstimateLineKind,
  Prisma,
  Role,
  ShopCatalogUnit,
  prisma,
} from '@bvisible/db';
import { revalidatePath } from 'next/cache';
import { parseQty } from '@bvisible/pricing';
import { writeAuditLog } from '@/lib/auth/audit';
import { requireRoleWithEffectiveCompany } from '@/lib/auth/current-user';
import { readRequestContext } from '@/lib/request-context';
import { normalizeVendorItemName } from '@/lib/vendor-pricing/normalize';
import { appendManualVendorPriceForShopItem } from '@/lib/shop-material/append-manual-price';
import { parseUsdToCents } from '@/lib/shop-material/money';
import { parseMarkupPercentToMilli } from '@/lib/shop-material/markup';

async function requireAdminScoped() {
  return requireRoleWithEffectiveCompany(Role.ADMIN, Role.SUPER_ADMIN);
}

const KIND_SET = new Set<string>(Object.values(EstimateLineKind));
const UNIT_SET = new Set<string>(Object.values(ShopCatalogUnit));

function parseKind(raw: string): EstimateLineKind | null {
  return KIND_SET.has(raw) ? (raw as EstimateLineKind) : null;
}

function parseCatalogUnit(raw: string): ShopCatalogUnit | null {
  return UNIT_SET.has(raw) ? (raw as ShopCatalogUnit) : null;
}

export type ShopMaterialActionState = { error: string | null; redirectTo?: string };

export async function createShopMaterialItemAction(
  _prev: ShopMaterialActionState,
  formData: FormData,
): Promise<ShopMaterialActionState> {
  const me = await requireAdminScoped();
  const ctx = await readRequestContext();

  const name = String(formData.get('name') ?? '').trim();
  const kind = parseKind(String(formData.get('kind') ?? ''));
  const catalogUnit = parseCatalogUnit(String(formData.get('catalogUnit') ?? ''));
  const customUnitLabel = String(formData.get('customUnitLabel') ?? '').trim() || null;
  const notes = String(formData.get('notes') ?? '').trim() || null;

  const internalUsd = String(formData.get('internalCostUsd') ?? '');
  const markupRaw = String(formData.get('markupPercent') ?? '');
  const sellUsdRaw = String(formData.get('defaultSellUsd') ?? '').trim();
  const defaultQtyRaw = String(formData.get('defaultQty') ?? '');
  const machineIdRaw = String(formData.get('machineId') ?? '').trim() || null;

  const nameNormalized = normalizeVendorItemName(name);
  if (nameNormalized.length < 2) {
    return { error: 'Enter an item name (at least two meaningful characters).' };
  }
  if (!kind) {
    return { error: 'Choose a valid line type.' };
  }
  if (!catalogUnit) {
    return { error: 'Choose a unit.' };
  }
  if (catalogUnit === ShopCatalogUnit.CUSTOM && !(customUnitLabel && customUnitLabel.length > 0)) {
    return { error: 'Add a custom unit label when unit is Custom.' };
  }

  const internalCostCents = parseUsdToCents(internalUsd);
  if (internalCostCents === null || internalCostCents < 0) {
    return { error: 'Enter a valid internal cost (USD).' };
  }

  const markupPercentMilli = parseMarkupPercentToMilli(markupRaw);
  if (markupPercentMilli === null) {
    return { error: 'Enter a valid markup percent.' };
  }

  let defaultSellPriceCents: number | null = null;
  if (sellUsdRaw !== '') {
    const sc = parseUsdToCents(sellUsdRaw);
    if (sc === null || sc < 0) {
      return { error: 'Enter a valid default sell price or leave blank.' };
    }
    defaultSellPriceCents = sc;
  }

  const defaultQtyMilli = parseQty(defaultQtyRaw === '' ? '1' : defaultQtyRaw);
  if (defaultQtyMilli === null || defaultQtyMilli <= 0) {
    return { error: 'Enter a positive default quantity.' };
  }

  let machineId: string | null = null;
  if (kind === EstimateLineKind.MACHINE && machineIdRaw) {
    if (machineIdRaw === '__new__') {
      const machineName = String(formData.get('machineName') ?? '').trim();
      const machineRateUsd = String(formData.get('machineRateUsd') ?? '').trim();
      if (!machineName) {
        return { error: 'Enter a name for the new machine.' };
      }
      const ratePerHourCents = Math.round(parseFloat(machineRateUsd || '0') * 100);
      const created = await prisma.machine.upsert({
        where: { tenantId_name: { tenantId: me.tenantId, name: machineName } },
        create: { tenantId: me.tenantId, name: machineName, ratePerHourCents },
        update: { ratePerHourCents },
        select: { id: true },
      });
      machineId = created.id;
    } else {
      const m = await prisma.machine.findFirst({
        where: { id: machineIdRaw, tenantId: me.tenantId, isActive: true },
        select: { id: true },
      });
      machineId = m?.id ?? null;
    }
  }

  try {
    const row = await prisma.shopMaterialItem.create({
      data: {
        tenantId: me.tenantId,
        name: name.slice(0, 400),
        nameNormalized,
        kind,
        catalogUnit,
        customUnitLabel:
          catalogUnit === ShopCatalogUnit.CUSTOM ? customUnitLabel?.slice(0, 40) ?? null : null,
        internalCostCents,
        markupPercentMilli,
        defaultSellPriceCents,
        defaultQtyMilli,
        machineId,
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
      metadata: { nameNormalized, kind },
    });

    return { error: null, redirectTo: `/items/${row.id}` };
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

  // categories[] is the new multi-select; fall back to legacy kind field
  const rawCategories = formData.getAll('categories').map((v) => String(v).trim()).filter(Boolean);
  const validCategories = rawCategories.filter((c) => KIND_SET.has(c)) as EstimateLineKind[];
  // Primary kind = first selected category, or fall back to what was already there
  const kind = validCategories[0] ? validCategories[0] : parseKind(String(formData.get('kind') ?? ''));

  const catalogUnit = parseCatalogUnit(String(formData.get('catalogUnit') ?? ''));
  const customUnitLabel = String(formData.get('customUnitLabel') ?? '').trim() || null;
  const notes = String(formData.get('notes') ?? '').trim() || null;

  const internalUsd = String(formData.get('internalCostUsd') ?? '');
  const markupRaw = String(formData.get('markupPercent') ?? '');
  const sellUsdRaw = String(formData.get('defaultSellUsd') ?? '').trim();
  const defaultQtyRaw = String(formData.get('defaultQty') ?? '');
  const machineIdRaw = String(formData.get('machineId') ?? '').trim() || null;

  const existing = await prisma.shopMaterialItem.findFirst({
    where: { id, tenantId: me.tenantId },
    select: { id: true },
  });
  if (!existing || !kind || !catalogUnit) return;

  if (catalogUnit === ShopCatalogUnit.CUSTOM && !(customUnitLabel && customUnitLabel.length > 0)) {
    return;
  }

  const internalCostCents = parseUsdToCents(internalUsd);
  if (internalCostCents === null || internalCostCents < 0) return;

  const markupPercentMilli = parseMarkupPercentToMilli(markupRaw);
  if (markupPercentMilli === null) return;

  let defaultSellPriceCents: number | null = null;
  if (sellUsdRaw !== '') {
    const sc = parseUsdToCents(sellUsdRaw);
    if (sc === null || sc < 0) return;
    defaultSellPriceCents = sc;
  }

  const defaultQtyMilli = parseQty(defaultQtyRaw === '' ? '1' : defaultQtyRaw);
  if (defaultQtyMilli === null || defaultQtyMilli <= 0) return;

  let machineId: string | null = null;
  if (kind === EstimateLineKind.MACHINE && machineIdRaw) {
    if (machineIdRaw === '__new__') {
      const machineName = String(formData.get('machineName') ?? '').trim();
      const machineRateUsd = String(formData.get('machineRateUsd') ?? '').trim();
      if (machineName) {
        const ratePerHourCents = Math.round(parseFloat(machineRateUsd || '0') * 100);
        const created = await prisma.machine.upsert({
          where: { tenantId_name: { tenantId: me.tenantId, name: machineName } },
          create: { tenantId: me.tenantId, name: machineName, ratePerHourCents },
          update: { ratePerHourCents },
          select: { id: true },
        });
        machineId = created.id;
      }
    } else {
      const m = await prisma.machine.findFirst({
        where: { id: machineIdRaw, tenantId: me.tenantId, isActive: true },
        select: { id: true },
      });
      machineId = m?.id ?? null;
    }
  }

  await prisma.shopMaterialItem.update({
    where: { id },
    data: {
      kind: kind ?? EstimateLineKind.MATERIAL,
      categories: validCategories.length > 0 ? validCategories : (kind ? [kind] : ['MATERIAL']),
      catalogUnit,
      customUnitLabel:
        catalogUnit === ShopCatalogUnit.CUSTOM ? customUnitLabel?.slice(0, 40) ?? null : null,
      internalCostCents,
      markupPercentMilli,
      defaultSellPriceCents,
      defaultQtyMilli,
      machineId: (validCategories.includes(EstimateLineKind.MACHINE) || kind === EstimateLineKind.MACHINE) ? machineId : null,
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
    metadata: {
      fields: [
        'kind',
        'catalogUnit',
        'internalCostCents',
        'markupPercentMilli',
        'defaultSellPriceCents',
        'defaultQtyMilli',
        'machineId',
        'notes',
      ],
    },
  });

  revalidatePath(`/items/${id}`);
  revalidatePath('/items');
}

export interface AddMachineState {
  error: string | null;
  machineId?: string;
  machineName?: string;
}

/**
 * Standalone: creates or updates a machine (name + hourly rate) without
 * touching the item form. Returns the saved machine id so the client can
 * select it in the machine dropdown.
 */
export async function addMachineAction(
  _prev: AddMachineState,
  formData: FormData,
): Promise<AddMachineState> {
  const me = await requireAdminScoped();
  const ctx = await readRequestContext();

  const name = String(formData.get('machineName') ?? '').trim();
  const rateUsd = String(formData.get('machineRateUsd') ?? '').trim();

  if (!name) return { error: 'Machine name is required.' };
  if (name.length > 120) return { error: 'Machine name must be 120 characters or less.' };

  const ratePerHourCents = Math.round(parseFloat(rateUsd || '0') * 100);
  if (isNaN(ratePerHourCents) || ratePerHourCents < 0) {
    return { error: 'Enter a valid hourly rate (e.g. 45.00).' };
  }

  const saved = await prisma.machine.upsert({
    where: { tenantId_name: { tenantId: me.tenantId, name } },
    create: { tenantId: me.tenantId, name, ratePerHourCents },
    update: { ratePerHourCents },
    select: { id: true, name: true },
  });

  await writeAuditLog({
    action: 'machine_saved',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'machine',
    targetId: saved.id,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { name, ratePerHourCents },
  });

  revalidatePath('/items');

  return { error: null, machineId: saved.id, machineName: saved.name };
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
  const vendorSku = String(formData.get('vendorSku') ?? '').trim() || null;

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
    vendorSku,
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
    select: { id: true, nameNormalized: true, kind: true },
  });
  if (!shop || shop.kind !== EstimateLineKind.MATERIAL) return;

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
