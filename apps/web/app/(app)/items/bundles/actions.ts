'use server';

import {
  EstimateLineKind,
  Prisma,
  PricingEngine,
  Role,
  ShopCatalogUnit,
  ShopMaterialItemType,
  prisma,
} from '@bvisible/db';
import { revalidatePath } from 'next/cache';
import { parseQty } from '@bvisible/pricing';
import { writeAuditLog } from '@/lib/auth/audit';
import { requireRoleWithEffectiveCompany } from '@/lib/auth/current-user';
import { readRequestContext } from '@/lib/request-context';
import { normalizeVendorItemName } from '@/lib/vendor-pricing/normalize';
import { parseUsdToCents } from '@/lib/shop-material/money';
import { parseMarkupPercentToMilli } from '@/lib/shop-material/markup';
import {
  calculateBundleTotals,
  normalizeBundleComponent,
  type BundleComponentInput,
  type NormalizedBundleComponent,
} from '@/lib/shop-material/bundles';
import {
  buildCatalogPricingOutputSnapshot,
  PRICING_FORMULA_VERSION,
} from '@/lib/shop-material/pricing-engine';

export type BundleActionState = { error: string | null; redirectTo?: string };

const KIND_SET = new Set<string>(Object.values(EstimateLineKind));
const UNIT_SET = new Set<string>(Object.values(ShopCatalogUnit));

function parseKind(raw: string): EstimateLineKind | null {
  return KIND_SET.has(raw) ? (raw as EstimateLineKind) : null;
}

function parseCatalogUnit(raw: string): ShopCatalogUnit | null {
  return UNIT_SET.has(raw) ? (raw as ShopCatalogUnit) : null;
}

function cleanCategory(raw: string): string | null {
  const value = raw.trim().replace(/\s+/g, ' ');
  if (!value || value.length > 80) return null;
  return value;
}

function parseCategoriesFromForm(formData: FormData): string[] {
  const cleaned = formData
    .getAll('categories')
    .map((value) => cleanCategory(String(value)))
    .filter((value): value is string => Boolean(value));
  return [...new Set(cleaned)];
}

function categoryPrimaryKind(categories: string[]): EstimateLineKind {
  const builtIn = categories.map((category) => parseKind(category)).find((kind): kind is EstimateLineKind => Boolean(kind));
  return builtIn ?? EstimateLineKind.MISC;
}

function parseComponents(raw: string): NormalizedBundleComponent[] | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: 'Bundle components could not be parsed.' };
  }
  if (!Array.isArray(parsed)) return { error: 'Bundle needs component rows.' };

  const normalized: NormalizedBundleComponent[] = [];
  for (const entry of parsed) {
    const component = entry as Partial<BundleComponentInput>;
    const kind = parseKind(String(component.componentType ?? ''));
    const unit = parseCatalogUnit(String(component.unit ?? ''));
    if (!kind) return { error: 'One or more components has an invalid category.' };
    if (!unit) return { error: 'One or more components has an invalid unit.' };
    const next = normalizeBundleComponent({
      componentCatalogItemId: component.componentCatalogItemId ? String(component.componentCatalogItemId) : null,
      componentName: String(component.componentName ?? ''),
      componentType: kind,
      categories: Array.isArray(component.categories)
        ? component.categories.map((c) => cleanCategory(String(c))).filter((c): c is string => Boolean(c))
        : [kind],
      quantity: String(component.quantity ?? '1'),
      unit,
      customUnitLabel: component.customUnitLabel ? String(component.customUnitLabel) : null,
      internalUnitCostCents: Number(component.internalUnitCostCents ?? 0),
      markupPercentMilli: Number(component.markupPercentMilli ?? 0),
      defaultSellCents:
        component.defaultSellCents === null || component.defaultSellCents === undefined
          ? null
          : Number(component.defaultSellCents),
      preferredVendorId: component.preferredVendorId ? String(component.preferredVendorId) : null,
      cheapestVendorId: component.cheapestVendorId ? String(component.cheapestVendorId) : null,
      selectedVendorId: component.selectedVendorId ? String(component.selectedVendorId) : null,
      vendorSnapshot: Array.isArray(component.vendorSnapshot) ? component.vendorSnapshot : [],
      pricingMethod: component.pricingMethod ? String(component.pricingMethod) : null,
      pricingInputsJson: component.pricingInputsJson ?? null,
      notes: component.notes ? String(component.notes) : null,
    });
    if ('error' in next) return next;
    normalized.push(next);
  }

  if (normalized.length < 2) return { error: 'Create a bundle with at least two components.' };
  return normalized;
}

async function validateComponentRefs(tenantId: string, components: NormalizedBundleComponent[]): Promise<boolean> {
  const sourceIds = [...new Set(components.map((c) => c.componentCatalogItemId).filter((id): id is string => Boolean(id)))];
  const vendorIds = [
    ...new Set(
      components
        .flatMap((c) => [c.preferredVendorId, c.cheapestVendorId, c.selectedVendorId])
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const [sourceCount, vendorCount] = await Promise.all([
    sourceIds.length === 0
      ? Promise.resolve(0)
      : prisma.shopMaterialItem.count({ where: { tenantId, id: { in: sourceIds } } }),
    vendorIds.length === 0
      ? Promise.resolve(0)
      : prisma.vendor.count({ where: { tenantId, id: { in: vendorIds }, deletedAt: null } }),
  ]);

  return sourceCount === sourceIds.length && vendorCount === vendorIds.length;
}

function componentCreateData(
  tenantId: string,
  bundleCatalogItemId: string,
  component: NormalizedBundleComponent,
  sortOrder: number,
): Prisma.BundleComponentCreateManyInput {
  return {
    tenantId,
    bundleCatalogItemId,
    componentCatalogItemId: component.componentCatalogItemId,
    componentName: component.componentName,
    componentType: component.componentType,
    categories: component.categories,
    quantityMilli: component.quantityMilli,
    unit: component.unit,
    customUnitLabel: component.customUnitLabel,
    internalUnitCostCents: component.internalUnitCostCents,
    markupPercentMilli: component.markupPercentMilli,
    defaultSellCents: component.defaultSellCents,
    totalCostCents: component.totalCostCents,
    totalSellCents: component.totalSellCents,
    preferredVendorId: component.preferredVendorId,
    cheapestVendorId: component.cheapestVendorId,
    selectedVendorId: component.selectedVendorId,
    vendorSnapshotJson:
      component.vendorSnapshotJson.length > 0
        ? (component.vendorSnapshotJson as Prisma.InputJsonValue)
        : Prisma.DbNull,
    pricingMethod: component.pricingMethod,
    pricingInputsJson:
      component.pricingInputsJson == null
        ? Prisma.DbNull
        : (component.pricingInputsJson as Prisma.InputJsonValue),
    hiddenFromCustomer: true,
    sortOrder,
    notes: component.notes,
  };
}

export async function createBundleAction(
  _prev: BundleActionState,
  formData: FormData,
): Promise<BundleActionState> {
  const me = await requireRoleWithEffectiveCompany(Role.ADMIN, Role.SUPER_ADMIN);
  const ctx = await readRequestContext();

  const name = String(formData.get('name') ?? '').trim();
  const nameNormalized = normalizeVendorItemName(name);
  if (nameNormalized.length < 2) return { error: 'Enter a bundle name.' };

  const categories = parseCategoriesFromForm(formData);
  if (categories.length === 0) return { error: 'Choose a category.' };
  const kind = categoryPrimaryKind(categories);
  const catalogUnit = parseCatalogUnit(String(formData.get('catalogUnit') ?? ''));
  if (!catalogUnit) return { error: 'Choose a unit.' };

  const defaultQtyMilli = parseQty(String(formData.get('defaultQty') ?? '1'));
  if (defaultQtyMilli === null || defaultQtyMilli <= 0) return { error: 'Enter a positive default quantity.' };

  const markupPercentMilli = parseMarkupPercentToMilli(String(formData.get('markupPercent') ?? '0'));
  if (markupPercentMilli === null) return { error: 'Enter a valid overall markup percent.' };

  const defaultSellRaw = String(formData.get('defaultSellUsd') ?? '').trim();
  const defaultSellOverrideCents = defaultSellRaw ? parseUsdToCents(defaultSellRaw) : null;
  if (defaultSellRaw && defaultSellOverrideCents === null) {
    return { error: 'Enter a valid default sell override or leave it blank.' };
  }

  const components = parseComponents(String(formData.get('componentsJson') ?? '[]'));
  if ('error' in components) return components;
  if (!(await validateComponentRefs(me.tenantId, components))) {
    return { error: 'One or more selected catalog items or vendors is not available.' };
  }

  const totals = calculateBundleTotals({ components, overallMarkupPercentMilli: markupPercentMilli, defaultSellOverrideCents });
  const pricingOutputJson = buildCatalogPricingOutputSnapshot({
    pricingMethod: 'BUNDLE',
    pricingEngine: 'BUNDLE',
    internalUnitCostCents: totals.totalCostCents,
    sellHintCents: totals.totalSellCents,
    defaultQuantity: 1,
    unit: catalogUnit,
    markupPercent: markupPercentMilli / 1000,
    selectedVendorMode: 'INTERNAL',
    details: {
      componentCount: components.length,
      totalCostCents: totals.totalCostCents,
      totalSellCents: totals.totalSellCents,
      derivedSellCents: totals.derivedSellCents,
    },
  });
  const customerDescription = String(formData.get('customerDescription') ?? '').trim() || null;
  const notes = String(formData.get('notes') ?? '').trim() || null;
  const isActive = String(formData.get('isActive') ?? 'true') === 'true';

  try {
    const bundle = await prisma.$transaction(async (tx) => {
      const created = await tx.shopMaterialItem.create({
        data: {
          tenantId: me.tenantId,
          name: name.slice(0, 400),
          nameNormalized,
          itemType: ShopMaterialItemType.BUNDLE,
          kind,
          categories,
          catalogUnit,
          internalCostCents: totals.totalCostCents,
          markupPercentMilli,
          defaultSellPriceCents: totals.totalSellCents,
          defaultQtyMilli,
          calculatedCostCents: totals.totalCostCents,
          calculatedSellCents: totals.totalSellCents,
          pricingMethod: 'BUNDLE',
          pricingEngine: PricingEngine.BUNDLE,
          pricingOutputJson: pricingOutputJson as Prisma.InputJsonValue,
          formulaVersion: PRICING_FORMULA_VERSION,
          selectedVendorMode: 'INTERNAL',
          pricingCalculatedAt: new Date(),
          pricingCalculatedById: me.id,
          customerDescription: customerDescription?.slice(0, 2000) ?? null,
          notes: notes?.slice(0, 2000) ?? null,
          isActive,
        },
        select: { id: true },
      });

      await tx.bundleComponent.createMany({
        data: components.map((component, index) => componentCreateData(me.tenantId, created.id, component, index)),
      });

      return created;
    });

    await writeAuditLog({
      action: 'shop_material_item_created',
      userId: me.id,
      tenantId: me.tenantId,
      targetType: 'shop_material_item',
      targetId: bundle.id,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { nameNormalized, componentCount: components.length, totalCostCents: totals.totalCostCents, totalSellCents: totals.totalSellCents },
    });

    revalidatePath('/items');
    return { error: null, redirectTo: `/items/${bundle.id}` };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { error: 'An item with this normalized name already exists.' };
    }
    throw error;
  }
}

export async function updateBundleAction(
  _prev: BundleActionState,
  formData: FormData,
): Promise<BundleActionState> {
  const me = await requireRoleWithEffectiveCompany(Role.ADMIN, Role.SUPER_ADMIN);
  const ctx = await readRequestContext();
  const id = String(formData.get('id') ?? '').trim();

  const existing = await prisma.shopMaterialItem.findFirst({
    where: { id, tenantId: me.tenantId, itemType: ShopMaterialItemType.BUNDLE },
    select: { id: true, nameNormalized: true },
  });
  if (!existing) return { error: 'Bundle not found.' };

  const name = String(formData.get('name') ?? '').trim();
  const nameNormalized = normalizeVendorItemName(name);
  if (nameNormalized.length < 2) return { error: 'Enter a bundle name.' };

  const categories = parseCategoriesFromForm(formData);
  if (categories.length === 0) return { error: 'Choose a category.' };
  const kind = categoryPrimaryKind(categories);
  const catalogUnit = parseCatalogUnit(String(formData.get('catalogUnit') ?? ''));
  if (!catalogUnit) return { error: 'Choose a unit.' };

  const defaultQtyMilli = parseQty(String(formData.get('defaultQty') ?? '1'));
  if (defaultQtyMilli === null || defaultQtyMilli <= 0) return { error: 'Enter a positive default quantity.' };

  const markupPercentMilli = parseMarkupPercentToMilli(String(formData.get('markupPercent') ?? '0'));
  if (markupPercentMilli === null) return { error: 'Enter a valid overall markup percent.' };

  const defaultSellRaw = String(formData.get('defaultSellUsd') ?? '').trim();
  const defaultSellOverrideCents = defaultSellRaw ? parseUsdToCents(defaultSellRaw) : null;
  if (defaultSellRaw && defaultSellOverrideCents === null) {
    return { error: 'Enter a valid default sell override or leave it blank.' };
  }

  const components = parseComponents(String(formData.get('componentsJson') ?? '[]'));
  if ('error' in components) return components;
  if (!(await validateComponentRefs(me.tenantId, components))) {
    return { error: 'One or more selected catalog items or vendors is not available.' };
  }

  const totals = calculateBundleTotals({ components, overallMarkupPercentMilli: markupPercentMilli, defaultSellOverrideCents });
  const pricingOutputJson = buildCatalogPricingOutputSnapshot({
    pricingMethod: 'BUNDLE',
    pricingEngine: 'BUNDLE',
    internalUnitCostCents: totals.totalCostCents,
    sellHintCents: totals.totalSellCents,
    defaultQuantity: 1,
    unit: catalogUnit,
    markupPercent: markupPercentMilli / 1000,
    selectedVendorMode: 'INTERNAL',
    details: {
      componentCount: components.length,
      totalCostCents: totals.totalCostCents,
      totalSellCents: totals.totalSellCents,
      derivedSellCents: totals.derivedSellCents,
    },
  });
  const customerDescription = String(formData.get('customerDescription') ?? '').trim() || null;
  const notes = String(formData.get('notes') ?? '').trim() || null;
  const isActive = String(formData.get('isActive') ?? 'true') === 'true';

  try {
    await prisma.$transaction(async (tx) => {
      await tx.shopMaterialItem.update({
        where: { id },
        data: {
          name: name.slice(0, 400),
          nameNormalized,
          kind,
          categories,
          catalogUnit,
          internalCostCents: totals.totalCostCents,
          markupPercentMilli,
          defaultSellPriceCents: totals.totalSellCents,
          defaultQtyMilli,
          calculatedCostCents: totals.totalCostCents,
          calculatedSellCents: totals.totalSellCents,
          pricingMethod: 'BUNDLE',
          pricingEngine: PricingEngine.BUNDLE,
          pricingOutputJson: pricingOutputJson as Prisma.InputJsonValue,
          formulaVersion: PRICING_FORMULA_VERSION,
          selectedVendorMode: 'INTERNAL',
          pricingCalculatedAt: new Date(),
          pricingCalculatedById: me.id,
          customerDescription: customerDescription?.slice(0, 2000) ?? null,
          notes: notes?.slice(0, 2000) ?? null,
          isActive,
        },
      });
      await tx.bundleComponent.deleteMany({ where: { tenantId: me.tenantId, bundleCatalogItemId: id } });
      await tx.bundleComponent.createMany({
        data: components.map((component, index) => componentCreateData(me.tenantId, id, component, index)),
      });
    });

    await writeAuditLog({
      action: 'shop_material_item_saved',
      userId: me.id,
      tenantId: me.tenantId,
      targetType: 'shop_material_item',
      targetId: id,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { nameNormalized, componentCount: components.length, totalCostCents: totals.totalCostCents, totalSellCents: totals.totalSellCents },
    });

    revalidatePath('/items');
    revalidatePath(`/items/${id}`);
    return { error: null, redirectTo: `/items/${id}` };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { error: 'An item with this normalized name already exists.' };
    }
    throw error;
  }
}
