#!/usr/bin/env tsx
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadLocalEnv(appDir);

const { prisma } = await import('@bvisible/db');
const { parseVehicleImportText, importVehicleRows } = await import('../lib/vehicles/import');

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

const fileArg = argValue('file') ?? path.join(appDir, 'scripts', 'vehicle-seed.sample.json');
const tenantSlug = argValue('tenant') ?? 'bvisible';
const make = argValue('make') ?? undefined;
const recentYears = argValue('recent-years');
const dryRun = process.argv.includes('--dry-run');
const format = fileArg.toLowerCase().endsWith('.json') ? 'json' : 'csv';

const tenant = await prisma.tenant.findUnique({
  where: { slug: tenantSlug },
  select: { id: true, slug: true, name: true },
});

if (!tenant) {
  console.error(`Tenant "${tenantSlug}" not found. Pass --tenant=<slug>.`);
  process.exit(1);
}

const text = readFileSync(fileArg, 'utf8');
const parsed = parseVehicleImportText(text, format);
if (parsed.errors.length > 0) {
  console.error('Import validation errors:');
  for (const error of parsed.errors.slice(0, 20)) console.error(`- ${error}`);
  process.exit(1);
}

const result = await importVehicleRows(parsed.rows, {
  tenantId: tenant.id,
  dryRun,
  make,
  recentYears: recentYears ? Number(recentYears) : undefined,
});

console.log(`Vehicle import ${dryRun ? 'dry run' : 'complete'} for ${tenant.name} (${tenant.slug})`);
console.log(`Rows considered: ${result.totalRows}`);
console.log(`Makes created: ${result.makesCreated}`);
console.log(`Models created: ${result.modelsCreated}`);
console.log(`Trims created: ${result.trimsCreated}`);
console.log(`Dimensions created/updated: ${result.dimensionsCreated}/${result.dimensionsUpdated}`);
console.log(`Photos created/updated: ${result.photosCreated}/${result.photosUpdated}`);
console.log(`Skipped rows: ${result.skippedRows}`);
if (result.errors.length > 0) {
  console.log('Errors:');
  for (const error of result.errors) console.log(`- ${error}`);
}

await prisma.$disconnect();
