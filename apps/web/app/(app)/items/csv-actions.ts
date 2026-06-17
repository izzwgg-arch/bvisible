'use server';

import { EstimateLineKind, Prisma, Role, ShopCatalogUnit, prisma } from '@bvisible/db';
import { writeAuditLog } from '@/lib/auth/audit';
import { requireRoleWithEffectiveCompany } from '@/lib/auth/current-user';
import { readRequestContext } from '@/lib/request-context';
import { normalizeVendorItemName } from '@/lib/vendor-pricing/normalize';
import { parseUsdToCents } from '@/lib/shop-material/money';
import { parseMarkupPercentToMilli } from '@/lib/shop-material/markup';
import { parseCSV } from '@/lib/csv';

async function requireAdminScoped() {
  return requireRoleWithEffectiveCompany(Role.ADMIN, Role.SUPER_ADMIN);
}

// Map QBO "Type" column values to our EstimateLineKind.
// QBO types: Service, NonInventory, Inventory, Bundle, Other Charge, etc.
function mapQboTypeToKind(raw: string): EstimateLineKind {
  const t = raw.trim().toLowerCase();
  if (t === 'service') return EstimateLineKind.LABOR;
  if (t === 'inventory' || t === 'non inventory' || t === 'noninventory') return EstimateLineKind.MATERIAL;
  if (t === 'material') return EstimateLineKind.MATERIAL;
  if (t === 'labor') return EstimateLineKind.LABOR;
  if (t === 'design') return EstimateLineKind.DESIGN;
  if (t === 'install' || t === 'installation') return EstimateLineKind.INSTALL;
  if (t === 'machine') return EstimateLineKind.MACHINE;
  if (t === 'misc' || t === 'other charge' || t === 'bundle') return EstimateLineKind.MISC;
  return EstimateLineKind.MATERIAL;
}

// Map QBO "Unit" / "UM" column to our ShopCatalogUnit.
function mapQboUnitToUnit(raw: string): ShopCatalogUnit {
  const u = raw.trim().toLowerCase().replace(/\s+/g, '');
  if (u === 'ea' || u === 'each' || u === 'pc' || u === 'pcs' || u === 'piece') return ShopCatalogUnit.EACH;
  if (u === 'hr' || u === 'hour' || u === 'hours' || u === 'h') return ShopCatalogUnit.HOUR;
  if (u === 'sqft' || u === 'sq.ft' || u === 'sqft.' || u === 'sf') return ShopCatalogUnit.SQ_FT;
  if (u === 'lft' || u === 'linearft' || u === 'linearfoot' || u === 'lf') return ShopCatalogUnit.LINEAR_FT;
  if (u === 'roll' || u === 'rl') return ShopCatalogUnit.ROLL;
  if (u === 'sheet' || u === 'sh') return ShopCatalogUnit.SHEET;
  return ShopCatalogUnit.EACH;
}

function rowToItem(row: Record<string, string>): {
  name: string;
  nameNormalized: string;
  kind: EstimateLineKind;
  catalogUnit: ShopCatalogUnit;
  internalCostCents: number;
  markupPercentMilli: number;
  defaultSellPriceCents: number | null;
  isActive: boolean;
  notes: string | null;
} | null {
  // Name: "item name", "name", "product/service" (QBO export)
  const rawName = (
    row['item name'] ||
    row['product/service'] ||
    row['product / service'] ||
    row['name'] ||
    ''
  ).trim();

  if (!rawName) return null;

  const nameNormalized = normalizeVendorItemName(rawName);
  if (nameNormalized.length < 2) return null;

  // Type → Kind
  const typeRaw = row['type'] || row['item type'] || '';
  const kind = mapQboTypeToKind(typeRaw);

  // Unit
  const unitRaw = row['unit'] || row['um'] || row['unit of measure'] || '';
  const catalogUnit = unitRaw.trim() ? mapQboUnitToUnit(unitRaw) : ShopCatalogUnit.EACH;

  // Internal cost: "cost" column
  const costRaw = (row['cost'] || row['purchase cost'] || '0').replace(/[$,\s]/g, '');
  const internalCostCents = parseUsdToCents(costRaw) ?? 0;

  // Default sell price: "price", "sales price/rate", "rate"
  const sellRaw = (
    row['price'] ||
    row['sales price/rate'] ||
    row['sales price'] ||
    row['rate'] ||
    ''
  ).replace(/[$,\s]/g, '');
  const defaultSellPriceCents = sellRaw ? (parseUsdToCents(sellRaw) ?? null) : null;

  // Markup: "markup %" or "markup"
  const markupRaw = (row['markup %'] || row['markup'] || '200').replace(/%/g, '').trim();
  const markupPercentMilli = parseMarkupPercentToMilli(markupRaw) ?? 200_000;

  // Active: "is active" column ("true", "yes", "1", "active" → true)
  const activeRaw = (row['is active'] || row['active'] || 'true').trim().toLowerCase();
  const isActive = activeRaw !== 'false' && activeRaw !== 'no' && activeRaw !== '0' && activeRaw !== 'inactive';

  // Notes: "description", "notes"
  const notes = (row['description'] || row['notes'] || '').trim() || null;

  return {
    name: rawName.slice(0, 400),
    nameNormalized,
    kind,
    catalogUnit,
    internalCostCents,
    markupPercentMilli,
    defaultSellPriceCents,
    isActive,
    notes: notes ? notes.slice(0, 2000) : null,
  };
}

export interface ImportItemsResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export async function importItemsAction(csvText: string): Promise<ImportItemsResult> {
  const me = await requireAdminScoped();
  const ctx = await readRequestContext();

  let rows: Array<Record<string, string>>;
  try {
    rows = parseCSV(csvText);
  } catch {
    return { imported: 0, skipped: 0, errors: ['Could not parse CSV — check the file format.'] };
  }

  if (rows.length === 0) {
    return { imported: 0, skipped: 0, errors: ['CSV file is empty or has no data rows.'] };
  }

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const row of rows) {
    const data = rowToItem(row);
    if (!data) {
      skipped++;
      continue;
    }

    try {
      await prisma.shopMaterialItem.create({
        data: {
          tenantId: me.tenantId,
          name: data.name,
          nameNormalized: data.nameNormalized,
          kind: data.kind,
          catalogUnit: data.catalogUnit,
          internalCostCents: data.internalCostCents,
          markupPercentMilli: data.markupPercentMilli,
          defaultSellPriceCents: data.defaultSellPriceCents,
          isActive: data.isActive,
          notes: data.notes,
        },
        select: { id: true },
      });
      imported++;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        // Duplicate name — skip silently
        skipped++;
      } else {
        errors.push(`"${data.name}": unexpected error.`);
        skipped++;
      }
    }
  }

  if (imported > 0) {
    await writeAuditLog({
      action: 'shop_material_csv_imported',
      userId: me.id,
      tenantId: me.tenantId,
      targetType: 'shop_material_item',
      targetId: 'bulk',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { imported, skipped, totalRows: rows.length },
    });
  }

  return { imported, skipped, errors: errors.slice(0, 10) };
}
