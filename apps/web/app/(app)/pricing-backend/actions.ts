'use server';

// Pricing backend server actions (ADMIN+): manual Sheet refresh,
// operating rates, app price overrides (active price = override ??
// Sheet price), and one-time deactivation of legacy non-Sheet materials.

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { prisma, Role, SheetOverrideItemType } from '@bvisible/db';
import { requireRoleWithEffectiveCompany } from '@/lib/auth/current-user';
import { writeAuditLog } from '@/lib/auth/audit';
import { readRequestContext } from '@/lib/request-context';
import { runSheetSync } from '@/lib/sheet-sync/sync';

async function requireAdminWithTenant() {
  // Resolves the effective company for SUPER_ADMIN too (single-company mode).
  const me = await requireRoleWithEffectiveCompany(Role.ADMIN, Role.SUPER_ADMIN);
  if (!me.tenantId) throw new Error('No workspace selected.');
  return me as typeof me & { tenantId: string };
}

export async function refreshSheetAction(): Promise<void> {
  const me = await requireAdminWithTenant();
  const ctx = await readRequestContext();
  const result = await runSheetSync(me.tenantId);
  await writeAuditLog({
    action: 'sheet_sync_run',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'sheet_sync',
    targetId: me.tenantId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { via: 'pricing_backend_refresh', ...result },
  });
  revalidatePath('/pricing-backend');
  revalidatePath('/items');
}

const ratesSchema = z.object({
  shopLabor: z.coerce.number().min(0).max(100000),
  designFlat: z.coerce.number().min(0).max(1000000),
  installRate: z.coerce.number().min(0).max(100000),
  defaultMarkup: z.coerce.number().min(0).max(10000),
});

export async function saveOperatingRatesAction(formData: FormData): Promise<void> {
  const me = await requireAdminWithTenant();
  const ctx = await readRequestContext();
  const parsed = ratesSchema.safeParse({
    shopLabor: formData.get('shopLabor'),
    designFlat: formData.get('designFlat'),
    installRate: formData.get('installRate'),
    defaultMarkup: formData.get('defaultMarkup'),
  });
  if (!parsed.success) return;
  const data = {
    shopLaborCentsPerHour: Math.round(parsed.data.shopLabor * 100),
    designFlatCents: Math.round(parsed.data.designFlat * 100),
    installPerPersonHourCents: Math.round(parsed.data.installRate * 100),
    defaultMarkupPercentMilli: Math.round(parsed.data.defaultMarkup * 1000),
  };
  await prisma.tenantOperatingRates.upsert({
    where: { tenantId: me.tenantId },
    update: data,
    create: { tenantId: me.tenantId, ...data },
  });
  await writeAuditLog({
    action: 'operating_rates_saved',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'operating_rates',
    targetId: me.tenantId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { via: 'pricing_backend', ...data },
  });
  revalidatePath('/pricing-backend');
}

const overrideSchema = z.object({
  itemType: z.enum(['MATERIAL', 'MACHINE']),
  itemKey: z.string().trim().min(1).max(400),
  price: z.coerce.number().min(0).max(10000000),
});

export async function setOverrideAction(formData: FormData): Promise<void> {
  const me = await requireAdminWithTenant();
  const ctx = await readRequestContext();
  const parsed = overrideSchema.safeParse({
    itemType: formData.get('itemType'),
    itemKey: formData.get('itemKey'),
    price: formData.get('price'),
  });
  if (!parsed.success) return;
  const priceCents = Math.round(parsed.data.price * 100);
  const itemType =
    parsed.data.itemType === 'MATERIAL'
      ? SheetOverrideItemType.MATERIAL
      : SheetOverrideItemType.MACHINE;
  await prisma.sheetPriceOverride.upsert({
    where: {
      tenantId_itemType_itemKey: {
        tenantId: me.tenantId,
        itemType,
        itemKey: parsed.data.itemKey,
      },
    },
    update: { priceCents },
    create: {
      tenantId: me.tenantId,
      itemType,
      itemKey: parsed.data.itemKey,
      priceCents,
    },
  });
  await writeAuditLog({
    action: 'sheet_price_override_set',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'sheet_price_override',
    targetId: parsed.data.itemKey,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { itemType: parsed.data.itemType, priceCents, via: 'pricing_backend' },
  });
  revalidatePath('/pricing-backend');
  revalidatePath('/estimates/new');
}

const resetSchema = z.object({
  itemType: z.enum(['MATERIAL', 'MACHINE']),
  itemKey: z.string().trim().min(1).max(400),
});

export async function resetOverrideAction(formData: FormData): Promise<void> {
  const me = await requireAdminWithTenant();
  const ctx = await readRequestContext();
  const parsed = resetSchema.safeParse({
    itemType: formData.get('itemType'),
    itemKey: formData.get('itemKey'),
  });
  if (!parsed.success) return;
  const itemType =
    parsed.data.itemType === 'MATERIAL'
      ? SheetOverrideItemType.MATERIAL
      : SheetOverrideItemType.MACHINE;
  await prisma.sheetPriceOverride.deleteMany({
    where: { tenantId: me.tenantId, itemType, itemKey: parsed.data.itemKey },
  });
  await writeAuditLog({
    action: 'sheet_price_override_reset',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'sheet_price_override',
    targetId: parsed.data.itemKey,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { itemType: parsed.data.itemType, reset: true, via: 'pricing_backend' },
  });
  revalidatePath('/pricing-backend');
  revalidatePath('/estimates/new');
}

/// One-click cleanup: deactivate SINGLE MATERIAL catalog items that did
/// not come from the Sheet ("everything comes in from the Google Sheet").
/// Bundles, labor items, and Sheet-synced rows are untouched; rows are
/// soft-deactivated (isActive = false), never deleted.
export async function deactivateLegacyMaterialsAction(): Promise<void> {
  const me = await requireAdminWithTenant();
  const ctx = await readRequestContext();
  const result = await prisma.shopMaterialItem.updateMany({
    where: {
      tenantId: me.tenantId,
      sheetKey: null,
      itemType: 'SINGLE',
      kind: 'MATERIAL',
      isActive: true,
    },
    data: { isActive: false },
  });
  await writeAuditLog({
    action: 'shop_material_items_bulk_deactivated',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'shop_material_items',
    targetId: me.tenantId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { via: 'pricing_backend_deactivate_legacy', count: result.count },
  });
  revalidatePath('/pricing-backend');
  revalidatePath('/items');
}
