'use server';

import {
  EstimateLineKind,
  Prisma,
  PricingEngine,
  Role,
  ShopCatalogUnit,
  VendorCostSourceMode,
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
import {
  createRepricingRequestSchema,
  updateRepricingRequestStatusSchema,
} from '@/lib/validators';

async function requireAdminScoped() {
  return requireRoleWithEffectiveCompany(Role.ADMIN, Role.SUPER_ADMIN);
}

const KIND_SET = new Set<string>(Object.values(EstimateLineKind));
const UNIT_SET = new Set<string>(Object.values(ShopCatalogUnit));
const PRICING_METHOD_SET = new Set([
  'SQUARE_FOOTAGE',
  'SHEET_GOODS',
  'ROLL_MATERIAL',
  'BANNER',
  'LABOR',
  'INSTALL',
  'MACHINE',
  'COST_PLUS',
  'CHANNEL_LETTERS',
  'BUNDLE',
  'CUSTOM',
]);
const PRICING_ENGINE_SET = new Set<string>(Object.values(PricingEngine));
const VENDOR_COST_SOURCE_MODE_SET = new Set<string>(Object.values(VendorCostSourceMode));

function parseKind(raw: string): EstimateLineKind | null {
  return KIND_SET.has(raw) ? (raw as EstimateLineKind) : null;
}

function cleanCategory(raw: string): string | null {
  const value = raw.trim().replace(/\s+/g, ' ');
  if (!value || value.length > 80) return null;
  return value;
}

function categoryPrimaryKind(categories: string[]): EstimateLineKind {
  const builtIn = categories.map((c) => parseKind(c)).find((k): k is EstimateLineKind => Boolean(k));
  return builtIn ?? EstimateLineKind.MISC;
}

function parseCategoriesFromForm(formData: FormData): string[] {
  const raw = formData.getAll('categories').map((v) => String(v));
  const legacy = String(formData.get('kind') ?? '');
  const cleaned = [...raw, legacy]
    .map(cleanCategory)
    .filter((c): c is string => Boolean(c));
  return [...new Set(cleaned)];
}

function parseCatalogUnit(raw: string): ShopCatalogUnit | null {
  return UNIT_SET.has(raw) ? (raw as ShopCatalogUnit) : null;
}

function parsePricingMethod(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  return PRICING_METHOD_SET.has(value) ? value : null;
}

function parsePricingEngine(raw: string, pricingMethod: string | null): PricingEngine {
  const value = raw.trim().toUpperCase();
  if (PRICING_ENGINE_SET.has(value)) return value as PricingEngine;
  switch (pricingMethod) {
    case 'SQUARE_FOOTAGE':
      return PricingEngine.SQ_FT;
    case 'SHEET_GOODS':
      return PricingEngine.SHEET_GOODS;
    case 'ROLL_MATERIAL':
      return PricingEngine.ROLL_MATERIAL;
    case 'BANNER':
      return PricingEngine.BANNER;
    case 'LABOR':
      return PricingEngine.LABOR;
    case 'INSTALL':
      return PricingEngine.INSTALL;
    case 'MACHINE':
      return PricingEngine.MACHINE;
    case 'COST_PLUS':
      return PricingEngine.COST_PLUS;
    case 'CHANNEL_LETTERS':
      return PricingEngine.CHANNEL_LETTERS;
    case 'BUNDLE':
      return PricingEngine.BUNDLE;
    default:
      return PricingEngine.MANUAL;
  }
}

function parseVendorCostSourceMode(raw: string): VendorCostSourceMode {
  const value = raw.trim().toUpperCase();
  return VENDOR_COST_SOURCE_MODE_SET.has(value)
    ? (value as VendorCostSourceMode)
    : VendorCostSourceMode.INTERNAL;
}

function parseOptionalNonNegativeInt(raw: string): number | null {
  const value = raw.trim();
  if (!value) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

function parsePricingInputsJson(raw: string): Prisma.InputJsonValue | null {
  const value = raw.trim();
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed === null ? null : (parsed as Prisma.InputJsonValue);
  } catch {
    return null;
  }
}

type VendorDraftRow = {
  vendorId?: string;
  newVendorName?: string;
  vendorSku?: string;
  unitCostUsd?: string;
  unit?: string;
  leadTimeDays?: string;
  notes?: string;
  preferred?: boolean;
  active?: boolean;
};

function parseVendorDraftRows(raw: string): VendorDraftRow[] {
  const value = raw.trim();
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => (row && typeof row === 'object' ? (row as VendorDraftRow) : null))
      .filter((row): row is VendorDraftRow => Boolean(row));
  } catch {
    return [];
  }
}

function parseOptionalLeadTimeDays(raw: string | undefined): number | null {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 3650) return null;
  return n;
}

async function resolveVendorIdForDraft(args: {
  tenantId: string;
  vendorId?: string;
  newVendorName?: string;
}): Promise<string | null> {
  const existingId = String(args.vendorId ?? '').trim();
  if (existingId && existingId !== '__new__') {
    const vendor = await prisma.vendor.findFirst({
      where: { id: existingId, tenantId: args.tenantId, deletedAt: null },
      select: { id: true },
    });
    return vendor?.id ?? null;
  }

  const name = String(args.newVendorName ?? '').trim().replace(/\s+/g, ' ');
  if (name.length < 2) return null;

  const existing = await prisma.vendor.findFirst({
    where: { tenantId: args.tenantId, deletedAt: null, name: { equals: name, mode: 'insensitive' } },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await prisma.vendor.create({
    data: { tenantId: args.tenantId, name: name.slice(0, 160), emails: [], phones: [] },
    select: { id: true },
  });
  return created.id;
}

async function appendVendorDraftRows(args: {
  tenantId: string;
  shopMaterialItemId: string;
  rows: VendorDraftRow[];
}): Promise<string | null> {
  let preferredVendorId: string | null = null;

  for (const row of args.rows) {
    if (row.active === false) continue;
    const vendorId = await resolveVendorIdForDraft({
      tenantId: args.tenantId,
      vendorId: row.vendorId,
      newVendorName: row.newVendorName,
    });
    if (!vendorId) continue;

    const priceCents = parseUsdToCents(String(row.unitCostUsd ?? ''));
    if (priceCents === null || priceCents < 0) continue;

    const inserted = await appendManualVendorPriceForShopItem(prisma, {
      tenantId: args.tenantId,
      shopMaterialItemId: args.shopMaterialItemId,
      vendorId,
      priceCents,
      unit: String(row.unit ?? '').trim().slice(0, 40) || null,
      note: String(row.notes ?? '').trim().slice(0, 500) || null,
      effectiveAt: null,
      vendorSku: String(row.vendorSku ?? '').trim() || null,
      leadTimeDays: parseOptionalLeadTimeDays(row.leadTimeDays),
    });
    if (inserted.ok && row.preferred) preferredVendorId = vendorId;
  }

  return preferredVendorId;
}

export type ShopMaterialActionState = { error: string | null; redirectTo?: string };

export async function createShopMaterialItemAction(
  _prev: ShopMaterialActionState,
  formData: FormData,
): Promise<ShopMaterialActionState> {
  const me = await requireAdminScoped();
  const ctx = await readRequestContext();

  const name = String(formData.get('name') ?? '').trim();
  const itemCode = String(formData.get('itemCode') ?? '').trim() || null;
  const categories = parseCategoriesFromForm(formData);
  const kind = categoryPrimaryKind(categories);
  const catalogUnit = parseCatalogUnit(String(formData.get('catalogUnit') ?? ''));
  const customUnitLabel = String(formData.get('customUnitLabel') ?? '').trim() || null;
  const notes = String(formData.get('notes') ?? '').trim() || null;

  const internalUsd = String(formData.get('internalCostUsd') ?? '');
  const markupRaw = String(formData.get('markupPercent') ?? '');
  const sellUsdRaw = String(formData.get('defaultSellUsd') ?? '').trim();
  const defaultQtyRaw = String(formData.get('defaultQty') ?? '');
  const machineIdRaw = String(formData.get('machineId') ?? '').trim() || null;
  const customerDescription = String(formData.get('customerDescription') ?? '').trim() || null;
  const isActive = String(formData.get('isActive') ?? 'true') !== 'false';
  const pricingMethod = parsePricingMethod(String(formData.get('pricingMethod') ?? ''));
  const pricingEngine = parsePricingEngine(String(formData.get('pricingEngine') ?? ''), pricingMethod);
  const pricingInputsJson = parsePricingInputsJson(String(formData.get('pricingInputsJson') ?? ''));
  const pricingOutputJson = parsePricingInputsJson(String(formData.get('pricingOutputJson') ?? ''));
  const formulaVersion = String(formData.get('formulaVersion') ?? '').trim() || null;
  const selectedVendorIdRaw = String(formData.get('selectedVendorId') ?? '').trim() || null;
  const selectedVendorMode = parseVendorCostSourceMode(String(formData.get('selectedVendorMode') ?? ''));
  const vendorDraftRows = parseVendorDraftRows(String(formData.get('vendorDraftRowsJson') ?? ''));
  const calculatedCostCents = parseOptionalNonNegativeInt(
    String(formData.get('calculatedCostCents') ?? ''),
  );
  const calculatedSellCents = parseOptionalNonNegativeInt(
    String(formData.get('calculatedSellCents') ?? ''),
  );
  const pricingNotes = String(formData.get('pricingNotes') ?? '').trim() || null;

  const nameNormalized = normalizeVendorItemName(name);
  if (nameNormalized.length < 2) {
    return { error: 'Enter an item name (at least two meaningful characters).' };
  }
  if (categories.length === 0) {
    return { error: 'Choose or save a category.' };
  }
  if (!catalogUnit) {
    return { error: 'Choose a unit.' };
  }
  const storedCustomUnitLabel =
    catalogUnit === ShopCatalogUnit.CUSTOM ? (customUnitLabel ?? 'custom') : null;

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
  if (machineIdRaw) {
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

  let selectedVendorId: string | null = null;
  if (selectedVendorIdRaw && selectedVendorIdRaw !== '__new__') {
    const vendor = await prisma.vendor.findFirst({
      where: { id: selectedVendorIdRaw, tenantId: me.tenantId, deletedAt: null },
      select: { id: true },
    });
    selectedVendorId = vendor?.id ?? null;
  }

  try {
    const row = await prisma.shopMaterialItem.create({
      data: {
        tenantId: me.tenantId,
        name: name.slice(0, 400),
        nameNormalized,
        itemCode: itemCode?.slice(0, 120) ?? null,
        kind,
        categories,
        catalogUnit,
        customUnitLabel: storedCustomUnitLabel?.slice(0, 40) ?? null,
        internalCostCents,
        markupPercentMilli,
        defaultSellPriceCents,
        defaultQtyMilli,
        pricingMethod,
        pricingEngine,
        pricingInputsJson: pricingInputsJson ?? Prisma.DbNull,
        pricingOutputJson: pricingOutputJson ?? Prisma.DbNull,
        formulaVersion: formulaVersion?.slice(0, 40) ?? null,
        calculatedCostCents,
        calculatedSellCents,
        pricingNotes: pricingNotes?.slice(0, 1000) ?? null,
        machineId,
        customerDescription: customerDescription?.slice(0, 2000) ?? null,
        notes: notes?.slice(0, 2000) ?? null,
        selectedVendorId,
        selectedVendorMode,
        pricingCalculatedAt: pricingOutputJson ? new Date() : null,
        pricingCalculatedById: pricingOutputJson ? me.id : null,
        isActive,
      },
      select: { id: true },
    });

    const preferredVendorId = await appendVendorDraftRows({
      tenantId: me.tenantId,
      shopMaterialItemId: row.id,
      rows: vendorDraftRows,
    });
    if (preferredVendorId) {
      await prisma.shopMaterialItem.update({
        where: { id: row.id },
        data: { preferredVendorId },
      });
    }

    await writeAuditLog({
      action: 'shop_material_item_created',
      userId: me.id,
      tenantId: me.tenantId,
      targetType: 'shop_material_item',
      targetId: row.id,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { nameNormalized, kind, categories },
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
  const name = String(formData.get('name') ?? '').trim();
  const nameNormalized = normalizeVendorItemName(name);
  const itemCode = String(formData.get('itemCode') ?? '').trim() || null;

  const categories = parseCategoriesFromForm(formData);
  const kind = categories.length > 0 ? categoryPrimaryKind(categories) : null;

  const catalogUnit = parseCatalogUnit(String(formData.get('catalogUnit') ?? ''));
  const customUnitLabel = String(formData.get('customUnitLabel') ?? '').trim() || null;
  const notes = String(formData.get('notes') ?? '').trim() || null;

  const internalUsd = String(formData.get('internalCostUsd') ?? '');
  const markupRaw = String(formData.get('markupPercent') ?? '');
  const sellUsdRaw = String(formData.get('defaultSellUsd') ?? '').trim();
  const defaultQtyRaw = String(formData.get('defaultQty') ?? '');
  const machineIdRaw = String(formData.get('machineId') ?? '').trim() || null;
  const customerDescription = String(formData.get('customerDescription') ?? '').trim() || null;
  const isActive = String(formData.get('isActive') ?? 'true') !== 'false';
  const preferredVendorIdRaw = String(formData.get('preferredVendorId') ?? '').trim() || null;
  const pricingMethod = parsePricingMethod(String(formData.get('pricingMethod') ?? ''));
  const pricingEngine = parsePricingEngine(String(formData.get('pricingEngine') ?? ''), pricingMethod);
  const pricingInputsJson = parsePricingInputsJson(String(formData.get('pricingInputsJson') ?? ''));
  const pricingOutputJson = parsePricingInputsJson(String(formData.get('pricingOutputJson') ?? ''));
  const formulaVersion = String(formData.get('formulaVersion') ?? '').trim() || null;
  const selectedVendorIdRaw = String(formData.get('selectedVendorId') ?? '').trim() || null;
  const selectedVendorMode = parseVendorCostSourceMode(String(formData.get('selectedVendorMode') ?? ''));
  const vendorDraftRows = parseVendorDraftRows(String(formData.get('vendorDraftRowsJson') ?? ''));
  const calculatedCostCents = parseOptionalNonNegativeInt(
    String(formData.get('calculatedCostCents') ?? ''),
  );
  const calculatedSellCents = parseOptionalNonNegativeInt(
    String(formData.get('calculatedSellCents') ?? ''),
  );
  const pricingNotes = String(formData.get('pricingNotes') ?? '').trim() || null;

  const existing = await prisma.shopMaterialItem.findFirst({
    where: { id, tenantId: me.tenantId },
    select: { id: true },
  });
  if (!existing || !kind || !catalogUnit || categories.length === 0 || nameNormalized.length < 2) return;

  const storedCustomUnitLabel =
    catalogUnit === ShopCatalogUnit.CUSTOM ? (customUnitLabel ?? 'custom') : null;

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
  if (machineIdRaw) {
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

  let preferredVendorId: string | null = preferredVendorIdRaw;
  if (preferredVendorId) {
    const vendor = await prisma.vendor.findFirst({
      where: { id: preferredVendorId, tenantId: me.tenantId, deletedAt: null },
      select: { id: true },
    });
    preferredVendorId = vendor?.id ?? null;
  }

  let selectedVendorId: string | null = null;
  if (selectedVendorIdRaw && selectedVendorIdRaw !== '__new__') {
    const vendor = await prisma.vendor.findFirst({
      where: { id: selectedVendorIdRaw, tenantId: me.tenantId, deletedAt: null },
      select: { id: true },
    });
    selectedVendorId = vendor?.id ?? null;
  }

  await prisma.shopMaterialItem.update({
    where: { id },
    data: {
      kind,
      name: name.slice(0, 400),
      nameNormalized,
      itemCode: itemCode?.slice(0, 120) ?? null,
      categories,
      catalogUnit,
      customUnitLabel: storedCustomUnitLabel?.slice(0, 40) ?? null,
      internalCostCents,
      markupPercentMilli,
      defaultSellPriceCents,
      defaultQtyMilli,
      pricingMethod,
      pricingEngine,
      pricingInputsJson: pricingInputsJson ?? Prisma.DbNull,
      pricingOutputJson: pricingOutputJson ?? Prisma.DbNull,
      formulaVersion: formulaVersion?.slice(0, 40) ?? null,
      calculatedCostCents,
      calculatedSellCents,
      pricingNotes: pricingNotes?.slice(0, 1000) ?? null,
      machineId,
      customerDescription: customerDescription?.slice(0, 2000) ?? null,
      notes: notes?.slice(0, 2000) ?? null,
      isActive,
      preferredVendorId,
      selectedVendorId,
      selectedVendorMode,
      pricingCalculatedAt: pricingOutputJson ? new Date() : null,
      pricingCalculatedById: pricingOutputJson ? me.id : null,
    },
  });

  const draftPreferredVendorId = await appendVendorDraftRows({
    tenantId: me.tenantId,
    shopMaterialItemId: id,
    rows: vendorDraftRows,
  });
  if (draftPreferredVendorId) {
    await prisma.shopMaterialItem.update({
      where: { id },
      data: { preferredVendorId: draftPreferredVendorId },
    });
  }

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
        'name',
        'itemCode',
        'categories',
        'catalogUnit',
        'internalCostCents',
        'markupPercentMilli',
        'defaultSellPriceCents',
        'defaultQtyMilli',
        'pricingMethod',
        'pricingEngine',
        'pricingInputsJson',
        'pricingOutputJson',
        'formulaVersion',
        'calculatedCostCents',
        'calculatedSellCents',
        'pricingNotes',
        'machineId',
        'customerDescription',
        'notes',
        'isActive',
        'preferredVendorId',
        'selectedVendorId',
        'selectedVendorMode',
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

export interface AddCategoryState {
  error: string | null;
  category?: string;
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

export async function addShopItemCategoryAction(
  _prev: AddCategoryState,
  formData: FormData,
): Promise<AddCategoryState> {
  const me = await requireAdminScoped();
  const ctx = await readRequestContext();

  const name = cleanCategory(String(formData.get('categoryName') ?? ''));
  if (!name) {
    return { error: 'Enter a category name, up to 80 characters.' };
  }

  const saved = await prisma.shopItemCategory.upsert({
    where: { tenantId_name: { tenantId: me.tenantId, name } },
    create: { tenantId: me.tenantId, name },
    update: {},
    select: { id: true, name: true },
  });

  await writeAuditLog({
    action: 'shop_item_category_saved',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'shop_item_category',
    targetId: saved.id,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { name },
  });

  revalidatePath('/items');
  revalidatePath('/items/new');

  return { error: null, category: saved.name };
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

export async function bulkDeleteShopMaterialItemsAction(formData: FormData): Promise<void> {
  const me = await requireAdminScoped();
  const ctx = await readRequestContext();
  const ids = formData.getAll('ids').map((value) => String(value)).filter(Boolean);
  if (ids.length === 0) return;

  const result = await prisma.shopMaterialItem.updateMany({
    where: {
      id: { in: ids },
      tenantId: me.tenantId,
    },
    data: { isActive: false },
  });

  await writeAuditLog({
    action: 'shop_material_items_bulk_deactivated',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'shop_material_item',
    targetId: 'bulk',
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { requestedCount: ids.length, deactivatedCount: result.count },
  });

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

export async function createRepricingRequestAction(
  _prev: ShopMaterialActionState,
  formData: FormData,
): Promise<ShopMaterialActionState> {
  const me = await requireAdminScoped();
  const ctx = await readRequestContext();

  const parsed = createRepricingRequestSchema.safeParse({
    shopMaterialItemId: formData.get('shopMaterialItemId'),
    vendorId: formData.get('vendorId'),
    oldCostCents:
      String(formData.get('oldCostCents') ?? '').trim() === ''
        ? null
        : Number(formData.get('oldCostCents')),
    reason: formData.get('reason'),
    notes: formData.get('notes'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid repricing request.' };
  }
  const data = parsed.data;

  const item = await prisma.shopMaterialItem.findFirst({
    where: { id: data.shopMaterialItemId, tenantId: me.tenantId },
    select: { id: true, name: true },
  });
  if (!item) return { error: 'Catalog item not found.' };

  await prisma.repricingRequest.create({
    data: {
      tenantId: me.tenantId,
      shopMaterialItemId: data.shopMaterialItemId,
      vendorId: data.vendorId,
      oldCostCents: data.oldCostCents,
      reason: data.reason,
      notes: data.notes,
      requestedById: me.id,
    },
  });

  await writeAuditLog({
    action: 'repricing_request_created',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'shop_material_item',
    targetId: item.id,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: {
      itemName: item.name,
      vendorId: data.vendorId,
      oldCostCents: data.oldCostCents,
      reason: data.reason,
    },
  });

  revalidatePath(`/items/${item.id}`);
  revalidatePath('/repricing');
  return { error: null };
}

export async function updateRepricingRequestStatusAction(formData: FormData): Promise<void> {
  const me = await requireAdminScoped();
  const ctx = await readRequestContext();
  const parsed = updateRepricingRequestStatusSchema.safeParse({
    requestId: formData.get('requestId'),
    status: formData.get('status'),
    notes: formData.get('notes'),
  });
  if (!parsed.success) return;
  const data = parsed.data;

  const request = await prisma.repricingRequest.findFirst({
    where: { id: data.requestId, tenantId: me.tenantId },
    select: { id: true, shopMaterialItemId: true },
  });
  if (!request) return;

  await prisma.repricingRequest.update({
    where: { id: request.id },
    data: {
      status: data.status,
      notes: data.notes ?? undefined,
      completedById:
        data.status === 'UPDATED' || data.status === 'IGNORED' ? me.id : null,
      completedAt:
        data.status === 'UPDATED' || data.status === 'IGNORED' ? new Date() : null,
    },
  });

  await writeAuditLog({
    action: 'repricing_request_status_changed',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'repricing_request',
    targetId: request.id,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { status: data.status },
  });

  revalidatePath('/repricing');
  revalidatePath(`/items/${request.shopMaterialItemId}`);
}
