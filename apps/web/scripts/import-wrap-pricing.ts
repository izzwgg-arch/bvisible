#!/usr/bin/env tsx
/**
 * Import vehicle wrap rapid-pricing data (pricing_data.csv from the wrap
 * pricing app) into the Vehicle Library.
 *
 * For every distinct Make it upserts a VehicleMake (+ brand logo); for every
 * Make/Model it upserts a VehicleModel (+ vehicleType, hero photo, and any
 * relevant reference guide photos) and a single year-agnostic VehicleTrim so
 * the pair shows up in the /vehicles library; and for every CSV row it writes
 * one VehicleWrapPricing record carrying the full variant + pricing detail
 * (charge, SKU, square footage, rate/SF, pricing rule, export note, etc.).
 *
 * Idempotent: makes/models/trims/photos are matched before insert, and wrap
 * pricing rows for the tenant are replaced on each run.
 *
 * Usage:
 *   pnpm --filter @bvisible/web exec tsx scripts/import-wrap-pricing.ts \
 *     --file=scripts/data/wrap-pricing.csv --tenant=bvisible
 *   Flags: --dry-run, --assets-base=/vehicle-library
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadLocalEnv(appDir);

const { prisma, VehiclePhotoType } = await import('@bvisible/db');
const { parseCSV } = await import('../lib/csv');
const { slugifyVehiclePart } = await import('../lib/vehicles/normalize');

function loadLocalEnv(dir: string): void {
  for (const filename of ['.env.local', '.env']) {
    const filepath = path.join(dir, filename);
    if (!existsSync(filepath)) continue;
    for (const rawLine of readFileSync(filepath, 'utf8').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const equalsAt = line.indexOf('=');
      if (equalsAt <= 0) continue;
      const key = line.slice(0, equalsAt).trim();
      let value = line.slice(equalsAt + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[key] ??= value;
    }
  }
}

function argValue(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}
const hasFlag = (name: string): boolean => process.argv.includes(`--${name}`);

const fileArg = argValue('file') ?? path.join(appDir, 'scripts', 'data', 'wrap-pricing.csv');
const tenantArg = argValue('tenant') ?? 'bvisible';
const assetsBase = (argValue('assets-base') ?? '/vehicle-library').replace(/\/$/, '');
const dryRun = hasFlag('dry-run');

// --- Static asset maps (files live in apps/web/public/vehicle-library) ------
const MAKE_LOGO: Record<string, string> = {
  chevrolet: 'chevrolet.jpg',
  crysler: 'chrysler.png',
  dodge: 'dodge.png',
  ford: 'ford.png',
  gmc: 'gmc.png',
  honda: 'honda.png',
  kenworth: 'kenworth.png',
  kia: 'kia.jpg',
  'mercedes / dodge': 'mercedes.png',
  nissan: 'nissan.jpg',
  tesla: 'tesla.png',
  toyota: 'toyota.png',
};

// keyed by `${make}|${model}` lowercased
const MODEL_PHOTO: Record<string, string> = {
  'chevrolet|express': 'chevrolet_express.png',
  'chevrolet|silverado': 'chevrolet_silverado.png',
  'crysler|pacifica': 'chrysler_pacifica.png',
  'dodge|promaster': 'dodge_promaster.png',
  'dodge|ram': 'dodge_ram.png',
  'ford|e-series': 'ford_e_series.jpg',
  'ford|exploder': 'ford_exploder.png',
  'ford|pickup': 'ford_pickup.jpg',
  'ford|transit': 'ford_transit.jpg',
  'ford|transit connect': 'ford_transit_connect.png',
  'gmc|savana': 'gmc_savana.jpg',
  'gmc|sierra': 'gmc_sierra.png',
  'honda|ridgeline': 'honda_ridgeline.png',
  'hyundai|santa cruz': 'hyundai_santa_cruz.png',
  'kenworth|t880': 'kenworth_t880.png',
  'kia|soul': 'kia_soul.jpg',
  'mercedes / dodge|sprinter': 'mercedes_dodge_sprinter.png',
  'nissan|nv cargo van': 'nissan_nv_cargo_van.png',
  'nissan|sentra': 'nissan_sentra.jpg',
  'tesla|cybertruck': 'tesla_cybertruck.jpg',
  'tesla|model y': 'tesla_model_y.png',
  'toyota|camry': 'toyota_camry.png',
  'toyota|rav4': 'toyota_rav4.png',
};

// extra reference/guide images keyed by `${make}|${model}`
const MODEL_GUIDE_PHOTOS: Record<string, string[]> = {
  'dodge|promaster': [
    'dodge_promaster_city.jpg',
    'promaster_city_size_guide.jpg',
    'promaster_city_l1_compact.jpg',
    'promaster_city_l2_standard.jpg',
    'promaster_city_l3_long.jpg',
  ],
};

const ROOF_WRAP_GUIDES = ['roof_wrap_options_guide.jpg', 'roof_wrap_full.jpg', 'roof_wrap_top_front.jpg', 'roof_wrap_none.jpg'];
const PICKUP_CAB_GUIDE = ['pickup_cab_size_guide.png'];

const VEHICLE_TYPE: Record<string, string> = {
  'chevrolet|city express': 'Cargo Van',
  'chevrolet|express': 'Cargo Van',
  'chevrolet|silverado': 'Pickup Truck',
  'crysler|pacifica': 'Minivan',
  'dodge|promaster': 'Cargo Van',
  'dodge|ram': 'Pickup Truck',
  'ford|e-series': 'Cargo Van',
  'ford|exploder': 'SUV',
  'ford|pickup': 'Pickup Truck',
  'ford|transit': 'Cargo Van',
  'ford|transit connect': 'Cargo Van',
  'gmc|savana': 'Cargo Van',
  'gmc|sierra': 'Pickup Truck',
  'honda|ridgeline': 'Pickup Truck',
  'hyundai|santa cruz': 'Pickup Truck',
  'kenworth|t880': 'Semi Truck',
  'kia|soul': 'SUV',
  'mercedes / dodge|sprinter': 'Cargo Van',
  'nissan|nv cargo van': 'Cargo Van',
  'nissan|sentra': 'Sedan',
  'tesla|cybertruck': 'Pickup Truck',
  'tesla|model y': 'SUV',
  'toyota|camry': 'Sedan',
  'toyota|rav4': 'SUV',
};

const asset = (file: string): string => `${assetsBase}/${file}`;
const clean = (v: string | undefined): string | null => {
  const t = (v ?? '').replace(/\s+/g, ' ').trim();
  return t.length ? t : null;
};
const num = (v: string | undefined): number | null => {
  const t = (v ?? '').replace(/[,"$]/g, '').trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
const intOrNull = (v: string | undefined): number | null => {
  const n = num(v);
  return n === null ? null : Math.trunc(n);
};

async function resolveTenantId(arg: string): Promise<string> {
  // Accept either a tenant id (cuid-ish) or a slug.
  const byId = await prisma.tenant.findUnique({ where: { id: arg } }).catch(() => null);
  if (byId) return byId.id;
  const bySlug = await prisma.tenant.findFirst({ where: { slug: arg } }).catch(() => null);
  if (bySlug) return bySlug.id;
  const byName = await prisma.tenant.findFirst({ where: { name: { equals: arg, mode: 'insensitive' } } });
  if (byName) return byName.id;
  throw new Error(`Tenant not found for "${arg}"`);
}

async function main() {
  const filepath = path.isAbsolute(fileArg) ? fileArg : path.join(appDir, fileArg);
  if (!existsSync(filepath)) throw new Error(`CSV not found: ${filepath}`);
  const rows = parseCSV(readFileSync(filepath, 'utf8'));
  if (rows.length === 0) throw new Error('CSV had no data rows.');

  const tenantId = await resolveTenantId(tenantArg);
  console.log(`Tenant: ${tenantId}  ·  rows: ${rows.length}  ·  dryRun: ${dryRun}`);

  // Group rows by make|model, preserving order.
  const modelKeys: string[] = [];
  const grouped = new Map<string, Array<Record<string, string>>>();
  for (const r of rows) {
    const make = clean(r['make']) ?? 'Unknown';
    const model = clean(r['model']) ?? 'Unknown';
    const key = `${make}|${model}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
      modelKeys.push(key);
    }
    grouped.get(key)!.push(r);
  }

  let makeCount = 0;
  let modelCount = 0;
  let photoCount = 0;
  let pricingCount = 0;
  let sortOrder = 0;

  const makeIdBySlug = new Map<string, string>();

  for (const key of modelKeys) {
    const [make, model] = key.split('|');
    const makeSlug = slugifyVehiclePart(make!);
    const modelSlug = slugifyVehiclePart(model!);
    const lowerKey = `${make!.toLowerCase()}|${model!.toLowerCase()}`;
    const modelRows = grouped.get(key)!;

    // --- Make ---------------------------------------------------------------
    let makeId = makeIdBySlug.get(makeSlug);
    if (!makeId) {
      const logo = MAKE_LOGO[make!.toLowerCase()] ? asset(MAKE_LOGO[make!.toLowerCase()]!) : null;
      if (dryRun) {
        makeId = `dry-${makeSlug}`;
      } else {
        const existing = await prisma.vehicleMake.findUnique({ where: { tenantId_slug: { tenantId, slug: makeSlug } } });
        const mk = existing
          ? await prisma.vehicleMake.update({ where: { id: existing.id }, data: { name: make!, logoUrl: logo ?? existing.logoUrl } })
          : await prisma.vehicleMake.create({ data: { tenantId, name: make!, slug: makeSlug, logoUrl: logo } });
        makeId = mk.id;
        // brand logo as a make-level photo (deduped by url)
        if (logo) {
          const has = await prisma.vehiclePhoto.findFirst({ where: { tenantId, makeId, url: logo } });
          if (!has) {
            await prisma.vehiclePhoto.create({ data: { tenantId, makeId, url: logo, altText: `${make} logo`, photoType: VehiclePhotoType.HERO, sourceName: 'Wrap pricing app assets', isPrimary: false } });
            photoCount++;
          }
        }
      }
      makeIdBySlug.set(makeSlug, makeId!);
      makeCount++;
    }

    // --- Model --------------------------------------------------------------
    const vehicleType = VEHICLE_TYPE[lowerKey] ?? null;
    let modelId: string;
    if (dryRun) {
      modelId = `dry-${makeSlug}-${modelSlug}`;
    } else {
      const existingModel = await prisma.vehicleModel.findUnique({ where: { tenantId_makeId_slug: { tenantId, makeId: makeId!, slug: modelSlug } } });
      const md = existingModel
        ? await prisma.vehicleModel.update({ where: { id: existingModel.id }, data: { name: model!, vehicleType: vehicleType ?? existingModel.vehicleType } })
        : await prisma.vehicleModel.create({ data: { tenantId, makeId: makeId!, name: model!, slug: modelSlug, vehicleType } });
      modelId = md.id;
    }
    modelCount++;

    // --- Trim (single, year-agnostic = 0) ----------------------------------
    let trimId: string;
    if (dryRun) {
      trimId = `dry-trim-${modelSlug}`;
    } else {
      const existingTrim = await prisma.vehicleTrim.findFirst({ where: { tenantId, modelId, year: 0, deletedAt: null } });
      const tr = existingTrim
        ? await prisma.vehicleTrim.update({ where: { id: existingTrim.id }, data: { bodyStyle: vehicleType } })
        : await prisma.vehicleTrim.create({ data: { tenantId, modelId, year: 0, trimName: 'All variants', bodyStyle: vehicleType } });
      trimId = tr.id;
    }

    // --- Photos (hero + guides), deduped by url ----------------------------
    const heroFile = MODEL_PHOTO[lowerKey] ?? null;
    const roofOptions = new Set(modelRows.map((r) => clean(r['roof wrap option'])).filter(Boolean));
    const guideFiles = [
      ...(MODEL_GUIDE_PHOTOS[lowerKey] ?? []),
      ...(roofOptions.size > 0 ? ROOF_WRAP_GUIDES : []),
      ...(vehicleType === 'Pickup Truck' ? PICKUP_CAB_GUIDE : []),
    ];
    if (!dryRun) {
      if (heroFile) {
        const url = asset(heroFile);
        const has = await prisma.vehiclePhoto.findFirst({ where: { tenantId, modelId, url } });
        if (!has) {
          await prisma.vehiclePhoto.create({ data: { tenantId, modelId, trimId, url, altText: `${make} ${model}`, photoType: VehiclePhotoType.HERO, sourceName: 'Wrap pricing app assets', isPrimary: true } });
          photoCount++;
        }
      }
      for (const g of guideFiles) {
        const url = asset(g);
        const has = await prisma.vehiclePhoto.findFirst({ where: { tenantId, modelId, url } });
        if (!has) {
          await prisma.vehiclePhoto.create({ data: { tenantId, modelId, trimId, url, altText: `${model} reference guide`, photoType: VehiclePhotoType.SIDE, sourceName: 'Wrap pricing app assets', isPrimary: false } });
          photoCount++;
        }
      }
    } else {
      photoCount += (heroFile ? 1 : 0) + guideFiles.length;
    }

    // --- Wrap pricing rows --------------------------------------------------
    if (!dryRun) {
      await prisma.vehicleWrapPricing.deleteMany({ where: { tenantId, modelId } });
    }
    for (const r of modelRows) {
      const exportNote = clean(r['export note']);
      const data = {
        tenantId,
        modelId,
        trimId,
        productName: clean(r['product name']),
        variant: clean(r['variant']),
        wheelbase: clean(r['wheelbase']),
        height: clean(r['height']),
        roofWrapOption: clean(r['roof wrap option']),
        extraVersion1: clean(r['extra version 1']),
        extraOption1: clean(r['extra option 1']),
        extraOption2: clean(r['extra option 2']),
        charge: num(r['charge']),
        sku: clean(r['sku']),
        squareFootage: intOrNull(r['square footage']),
        ratePerSf: num(r['rate per sf']),
        pricingRule: clean(r['pricing rule']),
        exportNote,
        isActive: !(exportNote ?? '').toLowerCase().includes('inactive'),
        sortOrder: sortOrder++,
      };
      if (!dryRun) await prisma.vehicleWrapPricing.create({ data });
      pricingCount++;
    }
  }

  console.log(JSON.stringify({ makes: makeCount, models: modelCount, photos: photoCount, wrapPricingRows: pricingCount, dryRun }, null, 2));
}

main()
  .then(async () => { await prisma.$disconnect(); })
  .catch(async (err) => { console.error(err); await prisma.$disconnect(); process.exit(1); });
