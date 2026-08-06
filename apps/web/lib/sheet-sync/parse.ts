// Tab parsers for the live pricing Sheet. Column indices mirror the
// production Sheet layout (verified against the owner's own reader in
// the contractor handoff — do not "fix" tab names or column order here;
// change the Sheet contract only together with the owner).

import {
  dollarsToCents,
  fetchSheetTab,
  gvizBool,
  gvizNumber,
  gvizString,
  gvizValue,
  type GvizTable,
} from './gviz';
import {
  sheetItemKey,
  type SheetAlias,
  type SheetBundle,
  type SheetBundleComponent,
  type SheetData,
  type SheetInternalMaterial,
  type SheetMachine,
  type SheetMaterial,
  type SheetRecommendation,
  type SheetSqftRate,
  type SheetVehicleWrap,
  type SheetVendorCatalogItem,
  type SheetVendorDirectoryEntry,
} from './types';

type Row = { c?: Array<{ v?: string | number | boolean | null } | null> };

function rows(table: GvizTable): Row[] {
  return table.rows ?? [];
}

/// "Meterial price" — spelling intentional. Estimate-side material catalog.
/// Cols: 0 name · 1 category · 2 name(dup) · 5 S&F · 6 Grimco · 8 Letra lit
/// (visualization col labels carry vendor names) · 10 cheapest price ·
/// 11 cheapest vendor. We read cheapest price/vendor plus every entered
/// vendor column by label.
function parseMaterials(table: GvizTable): SheetMaterial[] {
  const labels = (table.cols ?? []).map((c) => String(c.label ?? '').trim());
  const out: SheetMaterial[] = [];
  for (const row of rows(table)) {
    const name = gvizString(row, 0) || gvizString(row, 2);
    if (!name || name.toLowerCase() === 'item') continue;
    const vendorPrices: Array<{ vendor: string; priceCents: number }> = [];
    for (let i = 3; i < (row.c?.length ?? 0); i += 1) {
      const label = labels[i] ?? '';
      if (!label || /cheapest/i.test(label) || /item|category/i.test(label)) continue;
      const price = Number(gvizValue(row, i));
      if (Number.isFinite(price) && price > 0) {
        vendorPrices.push({ vendor: label, priceCents: dollarsToCents(price) });
      }
    }
    const cheapestListed = gvizNumber(row, 10);
    const cheapest =
      vendorPrices.length > 0
        ? [...vendorPrices].sort((a, b) => a.priceCents - b.priceCents)[0]
        : null;
    const priceCents =
      cheapest?.priceCents ?? (cheapestListed > 0 ? dollarsToCents(cheapestListed) : 0);
    // A row with no price used to be dropped here, which silently hid every
    // item added to the Sheet before its price was known. Carry it through
    // flagged instead; consumers that produce money filter on `unpriced`.
    out.push({
      key: sheetItemKey(name),
      name,
      category: gvizString(row, 1) || 'Uncategorized',
      priceCents,
      vendor: cheapest?.vendor || gvizString(row, 11),
      vendorPrices,
      unpriced: priceCents <= 0,
    });
  }
  // De-dupe by key, first occurrence wins (matches the owner's reader).
  const seen = new Set<string>();
  return out.filter((m) => (seen.has(m.key) ? false : (seen.add(m.key), true)));
}

/// "Machinary Price" — spelling intentional. Cols: 0 name · 1 $/hr.
function parseMachines(table: GvizTable): SheetMachine[] {
  return rows(table)
    .map((row) => ({
      key: sheetItemKey(gvizString(row, 0)),
      name: gvizString(row, 0),
      ratePerHourCents: dollarsToCents(gvizNumber(row, 1)),
    }))
    .filter((m) => m.name && m.name !== 'Machines' && m.ratePerHourCents > 0);
}

/// "Sq Ft Pricing" — final $/sq ft already includes markup (R-EST-05).
function parseSqftRates(table: GvizTable): SheetSqftRate[] {
  return rows(table)
    .map((row) => ({
      id: gvizString(row, 0),
      name: gvizString(row, 1),
      category: gvizString(row, 2) || 'Square-foot item',
      unit: gvizString(row, 3) || 'sq ft',
      materialKeyword: gvizString(row, 4),
      pricePerSqFtCents: dollarsToCents(gvizNumber(row, 5)),
      wastePercent: gvizNumber(row, 6),
      defaultMachine: gvizString(row, 7),
      shopMinutesPerSqFt: gvizNumber(row, 8),
      active: gvizBool(row, 9),
      notes: gvizString(row, 10),
    }))
    .filter((r) => r.id && r.name && r.active && r.pricePerSqFtCents > 0)
    .map(({ active: _a, ...rest }) => rest);
}

/// "Vehicle Pricing" — flat wrap price parsed from the Notes column
/// ("Price: $3,055; …"), already includes markup (R-EST-05).
function parseVehicleWraps(table: GvizTable): SheetVehicleWrap[] {
  return rows(table)
    .map((row, index) => {
      const notes = gvizString(row, 9);
      const priceRaw = notes.match(/Price:\s*\$([\d,]+(?:\.\d+)?)/i)?.[1];
      return {
        id: `vehicle-${index + 1}`,
        name: gvizString(row, 0),
        coverage: gvizString(row, 1),
        billableAreaSqFt: gvizNumber(row, 2),
        priceCents: priceRaw ? dollarsToCents(Number(priceRaw.replaceAll(',', ''))) : 0,
        active: gvizBool(row, 8),
        notes,
      };
    })
    .filter((v) => v.name && v.active && v.priceCents > 0)
    .map(({ active: _a, ...rest }) => rest);
}

/// "Estimator Packages" — saved bundles (labor profile).
function parseBundles(table: GvizTable): SheetBundle[] {
  return rows(table)
    .map((row) => ({
      id: gvizString(row, 0),
      name: gvizString(row, 1),
      signType: gvizString(row, 2),
      shopHours: gvizNumber(row, 3),
      designUnits: gvizNumber(row, 4),
      installHours: gvizNumber(row, 5),
      travelHours: gvizNumber(row, 6),
      installers: Math.max(1, gvizNumber(row, 7) || 1),
      active: gvizBool(row, 8),
      notes: gvizString(row, 9),
    }))
    .filter((p) => p.id && p.name && p.active)
    .map(({ active: _a, ...rest }) => rest);
}

/// "Package Components" — bundle lines (Material / Machine / Square Foot).
function parseBundleComponents(table: GvizTable): SheetBundleComponent[] {
  return rows(table)
    .map((row) => {
      const rawType = gvizString(row, 1);
      const componentType =
        rawType === 'Machine' ? ('Machine' as const)
        : rawType === 'Square Foot' ? ('Square Foot' as const)
        : ('Material' as const);
      return {
        packageId: gvizString(row, 0),
        componentType,
        itemName: gvizString(row, 2),
        quantity: gvizNumber(row, 3),
        optional: gvizBool(row, 4),
        notes: gvizString(row, 5),
      };
    })
    .filter((c) => c.packageId && c.itemName && c.quantity > 0);
}

/// "Estimator Recommendations" — sign type → suggested materials.
function parseRecommendations(table: GvizTable): SheetRecommendation[] {
  return rows(table)
    .map((row) => ({
      signType: gvizString(row, 0),
      materialKeyword: gvizString(row, 1).toLowerCase(),
      preferredItem: gvizString(row, 2),
      reason: gvizString(row, 3),
      priority: (gvizString(row, 4) === 'Required' ? 'Required' : 'Check') as
        | 'Required'
        | 'Check',
      active: gvizBool(row, 5),
    }))
    .filter((r) => r.signType && r.materialKeyword && r.active)
    .map(({ active: _a, ...rest }) => rest);
}

/// "Vendor Catalog" — purchasing-side catalog with per-vendor prices.
/// Cols: 0 id · 1 category · 2 subcategory · 3 name · 4 spec · 5 size ·
/// 6–9 vendor prices (labels; col 9 = "Other" priced under col 10 vendor
/// name) · 11 cheapest price · 12 cheapest vendor · 17 active ·
/// 18 product URL · 19 vendor SKU.
function parseVendorCatalog(table: GvizTable): SheetVendorCatalogItem[] {
  const labels = (table.cols ?? []).map((c) => String(c.label ?? '').trim());
  return rows(table)
    .map((row) => {
      const vendorPrices = [6, 7, 8, 9]
        .map((i) => ({
          priceCents: dollarsToCents(Number(gvizValue(row, i)) || 0),
          vendor:
            i === 9
              ? gvizString(row, 10) || labels[i] || 'Other'
              : (labels[i] ?? '').trim(),
        }))
        .filter((e) => e.priceCents > 0 && e.vendor);
      const cheapest = [...vendorPrices].sort((a, b) => a.priceCents - b.priceCents)[0];
      return {
        id: gvizString(row, 0),
        category: gvizString(row, 1) || 'Materials',
        subcategory: gvizString(row, 2),
        name: gvizString(row, 3),
        spec: gvizString(row, 4),
        size: gvizString(row, 5),
        priceCents: cheapest?.priceCents ?? dollarsToCents(gvizNumber(row, 11)),
        vendor: cheapest?.vendor || gvizString(row, 12),
        vendorPrices,
        active: gvizBool(row, 17),
        productUrl: gvizString(row, 18),
        vendorSku: gvizString(row, 19),
      };
    })
    .filter((i) => i.id && i.name && i.active && i.priceCents > 0)
    .map(({ active: _a, ...rest }) => rest);
}

/// "Internal Materials" — 999-row shop-supply catalog (tapes, adhesives,
/// primers, retail items). Cols: 0 catalog id · 1 category · 2 subcategory ·
/// 3 material name · 4 spec · 5 size/unit · 6 price · 7 preferred vendor ·
/// 8 price source · 9 notes · 10 unit area sq ft · 11 unit linear ft ·
/// 12 active. When no preferred vendor is entered, a known retail vendor
/// mentioned in the price-source/notes text is used (e.g. "Amazon
/// reference: blue painter tape…") so the shop-order retail-cart flow works.
const RETAIL_VENDOR_HINTS: Array<[RegExp, string]> = [
  [/amazon/i, 'Amazon'],
  [/home\s*depot/i, 'Home Depot'],
  [/walmart/i, 'Walmart'],
  [/lowe'?s/i, "Lowe's"],
];

function parseInternalMaterials(table: GvizTable): SheetInternalMaterial[] {
  const out: SheetInternalMaterial[] = [];
  for (const row of rows(table)) {
    const id = gvizString(row, 0);
    const name = gvizString(row, 3);
    const priceCents = dollarsToCents(gvizNumber(row, 6));
    const active = gvizBool(row, 12);
    // Unpriced rows are kept (flagged) rather than dropped — same reasoning as
    // parseMaterials above. Inactive rows are still skipped: those are the
    // owner's explicit "not in use" marker, which is a different thing from
    // "priced later".
    if (!id || !name || name.toLowerCase() === 'material name' || !active) {
      continue;
    }
    let vendor = gvizString(row, 7);
    if (!vendor) {
      const hintText = `${gvizString(row, 8)} ${gvizString(row, 9)}`;
      vendor = RETAIL_VENDOR_HINTS.find(([re]) => re.test(hintText))?.[1] ?? '';
    }
    out.push({
      id,
      category: gvizString(row, 1) || 'Shop Supplies',
      subcategory: gvizString(row, 2),
      name,
      spec: gvizString(row, 4),
      size: gvizString(row, 5),
      priceCents,
      vendor,
      unitAreaSqFt: gvizNumber(row, 10),
      unitLinearFt: gvizNumber(row, 11),
      unpriced: priceCents <= 0,
    });
  }
  // De-dupe by catalog id, first occurrence wins.
  const seen = new Set<string>();
  return out.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
}

/// "Vendor Directory" — vendor → order email + contact info.
function parseVendorDirectory(table: GvizTable): SheetVendorDirectoryEntry[] {
  return rows(table)
    .map((row) => ({
      vendor: gvizString(row, 0),
      email: gvizString(row, 1),
      contactName: gvizString(row, 2),
      phone: gvizString(row, 3),
      active: gvizBool(row, 6),
      notes: gvizString(row, 7),
    }))
    .filter((v) => v.vendor && v.active)
    .map(({ active: _a, ...rest }) => rest);
}

/// "ALIASES" — misspelling / shorthand → canonical Sheet material name.
function parseAliases(table: GvizTable): SheetAlias[] {
  return rows(table)
    .map((row) => ({
      alias: gvizString(row, 0).toLowerCase(),
      canonical: gvizString(row, 1),
    }))
    .filter((a) => a.alias && a.canonical && a.alias !== 'ai name');
}

export async function fetchAndParseSheet(): Promise<SheetData> {
  const [
    materials,
    machines,
    sqft,
    vehicles,
    bundles,
    components,
    recommendations,
    vendorCatalog,
    internalMaterials,
    vendorDirectory,
    aliases,
  ] = await Promise.all([
    fetchSheetTab('Meterial price'),
    fetchSheetTab('Machinary Price'),
    fetchSheetTab('Sq Ft Pricing'),
    fetchSheetTab('Vehicle Pricing'),
    fetchSheetTab('Estimator Packages'),
    fetchSheetTab('Package Components'),
    fetchSheetTab('Estimator Recommendations'),
    fetchSheetTab('Vendor Catalog'),
    fetchSheetTab('Internal Materials'),
    fetchSheetTab('Vendor Directory'),
    fetchSheetTab('ALIASES'),
  ]);

  return {
    materials: parseMaterials(materials),
    machines: parseMachines(machines),
    sqftRates: parseSqftRates(sqft),
    vehicleWraps: parseVehicleWraps(vehicles),
    bundles: parseBundles(bundles),
    bundleComponents: parseBundleComponents(components),
    recommendations: parseRecommendations(recommendations),
    vendorCatalog: parseVendorCatalog(vendorCatalog),
    internalMaterials: parseInternalMaterials(internalMaterials),
    vendorDirectory: parseVendorDirectory(vendorDirectory),
    aliases: parseAliases(aliases),
    fetchedAt: new Date().toISOString(),
  };
}
