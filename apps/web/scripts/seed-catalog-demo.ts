#!/usr/bin/env tsx
// Populates demo Clients, Vendors, and Items (ShopMaterialItem) for a
// tenant so the workspace can be explored and tested with realistic
// sign/print-shop data. Idempotent: re-running upserts the same rows
// (matched on their natural unique keys) instead of duplicating them.
//
// Run:
//   pnpm --filter @bvisible/web exec tsx scripts/seed-catalog-demo.ts
//
// Reads DATABASE_URL from apps/web/.env.local (or .env) automatically.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import { normalizeVendorItemName } from '../lib/vendor-pricing/normalize';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadLocalEnv(appDir);

const {
  prisma,
  EstimateLineKind,
  Role,
  ShopCatalogUnit,
  VendorPriceConfidence,
  VendorPriceExtractionMethod,
} = await import('@bvisible/db');

const tenantSlug = 'bvisible';
const now = new Date();

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
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      process.env[key] ??= value;
    }
  }
}

function daysAgo(days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function seedKey(value: string): string {
  return createHash('sha256').update(`catalog-demo:${value}`).digest('hex');
}

// ---------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------

const CLIENTS: ReadonlyArray<{
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  notes?: string;
}> = [
  { companyName: 'Harborview Dental', contactName: 'Dr. Lena Cho', email: 'frontdesk@harborviewdental.example', phone: '(503) 555-0142', notes: 'Repeat customer — lobby + exterior signage.' },
  { companyName: 'Cascade Fitness Club', contactName: 'Marcus Webb', email: 'marcus@cascadefit.example', phone: '(503) 555-0188' },
  { companyName: 'Riverside Coffee Co.', contactName: 'Dana Ellison', email: 'dana@riversidecoffee.example', phone: '(971) 555-0110', notes: 'Window graphics + A-frame boards.' },
  { companyName: 'Summit Auto Group', contactName: 'Priya Nair', email: 'priya@summitauto.example', phone: '(503) 555-0166', notes: 'Fleet wraps, ongoing program.' },
  { companyName: 'Bloom & Vine Events', contactName: 'Sofia Marin', email: 'hello@bloomvine.example', phone: '(360) 555-0173' },
  { companyName: 'Northgate Property Mgmt', contactName: 'Trevor Haas', email: 'trevor@northgatepm.example', phone: '(503) 555-0129', notes: 'Building directories + ADA signage.' },
  { companyName: 'Pioneer Brewing', contactName: 'Gabe Foster', email: 'gabe@pioneerbrewing.example', phone: '(503) 555-0155' },
  { companyName: 'Lakeside Medical Center', contactName: 'Rachel Donovan', email: 'r.donovan@lakesidemed.example', phone: '(503) 555-0198', notes: 'Wayfinding refresh across 3 floors.' },
];

const VENDORS: ReadonlyArray<{ name: string; email: string; phone: string; notes?: string }> = [
  { name: 'Grimco', email: 'orders@grimco.example', phone: '(800) 555-0101', notes: 'Vinyl, substrates, hardware.' },
  { name: 'Fellers', email: 'sales@fellers.example', phone: '(800) 555-0102', notes: 'Wrap film + laminate.' },
  { name: 'N. Glantz & Son', email: 'service@nglantz.example', phone: '(800) 555-0103' },
  { name: 'Laird Plastics', email: 'quotes@lairdplastics.example', phone: '(800) 555-0104', notes: 'Acrylic, ACM, Coroplast.' },
  { name: 'SignWarehouse', email: 'support@signwarehouse.example', phone: '(800) 555-0105' },
  { name: 'Denco Sales', email: 'orders@dencosales.example', phone: '(800) 555-0106', notes: 'Mounting + install hardware.' },
];

type Unit = 'EACH' | 'SHEET' | 'SQ_FT' | 'HOUR' | 'LINEAR_FT' | 'ROLL' | 'CUSTOM';

interface ItemSeed {
  name: string;
  kind: keyof typeof EstimateLineKind;
  unit: Unit;
  customUnitLabel?: string;
  internalCostUsd: number;
  markupPercent?: number; // default 200 (=> 3x)
  defaultSellUsd?: number;
  defaultQty?: number;
  machineName?: string; // for MACHINE kind
  /** Vendor prices (USD per unit) keyed by vendor name; first listed becomes preferred. */
  vendorPricesUsd?: ReadonlyArray<{ vendor: string; usd: number }>;
}

const ITEMS: ReadonlyArray<ItemSeed> = [
  // Materials (with vendor pricing intelligence)
  {
    name: '3M IJ180Cv3 Cast Wrap Film 54in',
    kind: 'MATERIAL',
    unit: 'SQ_FT',
    internalCostUsd: 1.85,
    vendorPricesUsd: [
      { vendor: 'Fellers', usd: 1.79 },
      { vendor: 'Grimco', usd: 1.92 },
    ],
  },
  {
    name: 'Avery MPI 1105 Vinyl 54in',
    kind: 'MATERIAL',
    unit: 'SQ_FT',
    internalCostUsd: 1.42,
    vendorPricesUsd: [
      { vendor: 'Grimco', usd: 1.38 },
      { vendor: 'N. Glantz & Son', usd: 1.49 },
    ],
  },
  {
    name: 'Oracal 3551 Cut Vinyl 24in',
    kind: 'MATERIAL',
    unit: 'SQ_FT',
    internalCostUsd: 0.78,
    vendorPricesUsd: [{ vendor: 'SignWarehouse', usd: 0.74 }],
  },
  {
    name: 'ACM Panel 3mm 4x8 White',
    kind: 'MATERIAL',
    unit: 'SHEET',
    internalCostUsd: 38.5,
    vendorPricesUsd: [
      { vendor: 'Laird Plastics', usd: 36.9 },
      { vendor: 'Grimco', usd: 41.0 },
    ],
  },
  {
    name: 'Coroplast 4mm 4x8',
    kind: 'MATERIAL',
    unit: 'SHEET',
    internalCostUsd: 11.25,
    vendorPricesUsd: [{ vendor: 'Laird Plastics', usd: 10.8 }],
  },
  {
    name: 'Acrylic Sheet 1/4in Clear 4x8',
    kind: 'MATERIAL',
    unit: 'SHEET',
    internalCostUsd: 96.0,
    vendorPricesUsd: [
      { vendor: 'Laird Plastics', usd: 92.5 },
      { vendor: 'Grimco', usd: 101.0 },
    ],
  },
  {
    name: 'Matte Overlaminate 54in',
    kind: 'MATERIAL',
    unit: 'ROLL',
    internalCostUsd: 268.0,
    vendorPricesUsd: [
      { vendor: 'Fellers', usd: 259.0 },
      { vendor: 'N. Glantz & Son', usd: 275.0 },
    ],
  },
  {
    name: '13oz Scrim Vinyl Banner',
    kind: 'MATERIAL',
    unit: 'SQ_FT',
    internalCostUsd: 0.95,
    vendorPricesUsd: [{ vendor: 'Grimco', usd: 0.89 }],
  },
  {
    name: 'Dibond 3mm 4x10 Brushed',
    kind: 'MATERIAL',
    unit: 'SHEET',
    internalCostUsd: 72.0,
    vendorPricesUsd: [{ vendor: 'Laird Plastics', usd: 69.0 }],
  },

  // Machines (linked to the seeded machine catalog where possible)
  { name: 'Flatbed Print Time', kind: 'MACHINE', unit: 'HOUR', internalCostUsd: 33.45, machineName: 'Flatbed printer', defaultQty: 1 },
  { name: 'Roll-to-Roll Print Time', kind: 'MACHINE', unit: 'HOUR', internalCostUsd: 44.21, machineName: 'Roll-to-roll printer', defaultQty: 1 },
  { name: 'CNC Router Cut Time', kind: 'MACHINE', unit: 'HOUR', internalCostUsd: 90.78, machineName: 'Colex Sharp Cut Cutter — CNC', defaultQty: 1 },

  // Labor / Design / Install
  { name: 'Production Labor', kind: 'LABOR', unit: 'HOUR', internalCostUsd: 28.0, markupPercent: 150, defaultQty: 1 },
  { name: 'Weeding & Masking', kind: 'LABOR', unit: 'HOUR', internalCostUsd: 26.0, markupPercent: 150, defaultQty: 1 },
  { name: 'Graphic Design', kind: 'DESIGN', unit: 'HOUR', internalCostUsd: 45.0, markupPercent: 100, defaultSellUsd: 95.0, defaultQty: 1 },
  { name: 'On-Site Install Crew', kind: 'INSTALL', unit: 'HOUR', internalCostUsd: 55.0, markupPercent: 100, defaultQty: 2 },

  // Misc
  { name: 'Grommets', kind: 'MISC', unit: 'EACH', internalCostUsd: 0.18, defaultQty: 8 },
  { name: 'Mounting Standoffs 1in', kind: 'MISC', unit: 'EACH', internalCostUsd: 2.4, defaultQty: 4 },
  { name: 'Shipping & Freight', kind: 'MISC', unit: 'CUSTOM', customUnitLabel: 'job', internalCostUsd: 0, markupPercent: 0, defaultQty: 1 },
];

function usdToCents(usd: number): number {
  return Math.round(usd * 100);
}

async function upsertClient(
  tenantId: string,
  data: { companyName: string; contactName: string; email: string; phone: string; notes?: string },
) {
  const existing = await prisma.client.findFirst({
    where: { tenantId, companyName: data.companyName },
    select: { id: true },
  });
  if (existing) {
    return prisma.client.update({
      where: { id: existing.id },
      data: {
        contactName: data.contactName,
        email: data.email,
        phone: data.phone,
        notes: data.notes ?? null,
        deletedAt: null,
      },
    });
  }
  return prisma.client.create({ data: { tenantId, ...data, notes: data.notes ?? null } });
}

async function main(): Promise<void> {
  const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
  if (!tenant) {
    throw new Error(`Tenant with slug "${tenantSlug}" not found. Bootstrap a tenant first.`);
  }

  const user = await prisma.user.findFirst({
    where: {
      OR: [
        { tenantId: tenant.id, role: { in: [Role.ADMIN, Role.SUPER_ADMIN] } },
        { role: Role.SUPER_ADMIN },
      ],
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });

  // Clients
  let clientCount = 0;
  for (const c of CLIENTS) {
    await upsertClient(tenant.id, c);
    clientCount += 1;
  }

  // Vendors (unique on [tenantId, name])
  const vendorByName = new Map<string, string>();
  for (const v of VENDORS) {
    const row = await prisma.vendor.upsert({
      where: { tenantId_name: { tenantId: tenant.id, name: v.name } },
      update: { email: v.email, phone: v.phone, notes: v.notes ?? null, deletedAt: null },
      create: {
        tenantId: tenant.id,
        name: v.name,
        email: v.email,
        phone: v.phone,
        notes: v.notes ?? null,
      },
      select: { id: true, name: true },
    });
    vendorByName.set(row.name, row.id);
  }

  // Machine lookup for MACHINE-kind items.
  const machines = await prisma.machine.findMany({
    where: { tenantId: tenant.id },
    select: { id: true, name: true },
  });
  const machineByName = new Map(machines.map((m) => [m.name, m.id]));

  // Items (ShopMaterialItem, unique on [tenantId, nameNormalized])
  let itemCount = 0;
  let priceCount = 0;
  for (const it of ITEMS) {
    const nameNormalized = normalizeVendorItemName(it.name);
    const kind = EstimateLineKind[it.kind];
    const catalogUnit = ShopCatalogUnit[it.unit];
    const machineId =
      it.kind === 'MACHINE' && it.machineName ? machineByName.get(it.machineName) ?? null : null;

    const preferredVendorName = it.vendorPricesUsd?.[0]?.vendor ?? null;
    const preferredVendorId = preferredVendorName
      ? vendorByName.get(preferredVendorName) ?? null
      : null;

    const item = await prisma.shopMaterialItem.upsert({
      where: { tenantId_nameNormalized: { tenantId: tenant.id, nameNormalized } },
      update: {
        name: it.name.slice(0, 400),
        kind,
        catalogUnit,
        customUnitLabel: it.unit === 'CUSTOM' ? it.customUnitLabel ?? 'unit' : null,
        internalCostCents: usdToCents(it.internalCostUsd),
        markupPercentMilli: Math.round((it.markupPercent ?? 200) * 1000),
        defaultSellPriceCents: it.defaultSellUsd != null ? usdToCents(it.defaultSellUsd) : null,
        defaultQtyMilli: Math.round((it.defaultQty ?? 1) * 1000),
        machineId,
        preferredVendorId,
        isActive: true,
      },
      create: {
        tenantId: tenant.id,
        name: it.name.slice(0, 400),
        nameNormalized,
        kind,
        catalogUnit,
        customUnitLabel: it.unit === 'CUSTOM' ? it.customUnitLabel ?? 'unit' : null,
        internalCostCents: usdToCents(it.internalCostUsd),
        markupPercentMilli: Math.round((it.markupPercent ?? 200) * 1000),
        defaultSellPriceCents: it.defaultSellUsd != null ? usdToCents(it.defaultSellUsd) : null,
        defaultQtyMilli: Math.round((it.defaultQty ?? 1) * 1000),
        machineId,
        preferredVendorId,
      },
      select: { id: true },
    });
    itemCount += 1;

    // Vendor catalog links + price history so the estimate catalog shows
    // cheapest / preferred vendor intelligence for materials.
    if (it.vendorPricesUsd && it.vendorPricesUsd.length > 0) {
      for (const vp of it.vendorPricesUsd) {
        const vendorId = vendorByName.get(vp.vendor);
        if (!vendorId) continue;

        const catalog = await prisma.vendorCatalogItem.upsert({
          where: {
            tenantId_vendorId_nameNormalized: {
              tenantId: tenant.id,
              vendorId,
              nameNormalized,
            },
          },
          update: { shopMaterialItemId: item.id },
          create: {
            tenantId: tenant.id,
            vendorId,
            nameNormalized,
            shopMaterialItemId: item.id,
          },
          select: { id: true },
        });

        const dedupeKey = seedKey(`${tenant.id}:${catalog.id}:price`);
        await prisma.vendorPriceHistory.upsert({
          where: { tenantId_dedupeKey: { tenantId: tenant.id, dedupeKey } },
          update: { priceCents: usdToCents(vp.usd) },
          create: {
            tenantId: tenant.id,
            vendorId,
            vendorCatalogItemId: catalog.id,
            itemNameRaw: it.name,
            itemNameNormalized: nameNormalized,
            priceCents: usdToCents(vp.usd),
            unit: it.unit.toLowerCase(),
            quantityMilli: 1000,
            confidence: VendorPriceConfidence.HIGH,
            extractionMethod: VendorPriceExtractionMethod.MANUAL,
            dedupeKey,
            effectiveAt: daysAgo(7),
            createdAt: daysAgo(7),
          },
        });
        priceCount += 1;
      }
    }
  }

  console.log('Catalog demo data populated.');
  console.log(`tenant=${tenant.name} (${tenant.slug})`);
  console.log(`clients=${clientCount}`);
  console.log(`vendors=${vendorByName.size}`);
  console.log(`items=${itemCount}`);
  console.log(`vendorPrices=${priceCount}`);
  if (!user) {
    console.log('note: no admin/super-admin user found (not required for catalog data).');
  }
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
