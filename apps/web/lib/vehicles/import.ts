import {
  prisma,
  VehicleDimensionConfidenceLevel,
  VehiclePhotoType,
  type PrismaClient,
} from '@bvisible/db';
import { parseCSV } from '@/lib/csv';
import {
  normalizeVehicleText,
  parseOptionalInt,
  parseOptionalNumber,
  slugifyVehiclePart,
} from './normalize';

export type VehicleImportFormat = 'csv' | 'json';

export interface VehicleImportRow {
  year: number;
  make: string;
  model: string;
  trim: string | null;
  bodyStyle: string | null;
  bodyClass: string | null;
  vehicleType: string | null;
  doors: number | null;
  drivetrain: string | null;
  fuelType: string | null;
  engine: string | null;
  transmission: string | null;
  lengthIn: number | null;
  widthIn: number | null;
  heightIn: number | null;
  wheelbaseIn: number | null;
  curbWeightLb: number | null;
  grossWeightLb: number | null;
  cargoLengthIn: number | null;
  cargoWidthIn: number | null;
  cargoHeightIn: number | null;
  bedLengthIn: number | null;
  roofLengthIn: number | null;
  roofWidthIn: number | null;
  hoodLengthIn: number | null;
  hoodWidthIn: number | null;
  sideApproxSqFt: number | null;
  roofApproxSqFt: number | null;
  hoodApproxSqFt: number | null;
  rearApproxSqFt: number | null;
  frontApproxSqFt: number | null;
  totalApproxWrapSqFt: number | null;
  sourceName: string | null;
  sourceUrl: string | null;
  confidenceLevel: VehicleDimensionConfidenceLevel;
  photoUrl: string | null;
  photoSourceName: string | null;
  photoSourceUrl: string | null;
  photoLicenseNote: string | null;
  notes: string | null;
}

export interface VehicleImportOptions {
  tenantId: string;
  dryRun?: boolean;
  recentYears?: number;
  make?: string;
  db?: PrismaClient;
}

export interface VehicleImportResult {
  dryRun: boolean;
  totalRows: number;
  makesCreated: number;
  modelsCreated: number;
  trimsCreated: number;
  dimensionsCreated: number;
  dimensionsUpdated: number;
  photosCreated: number;
  photosUpdated: number;
  skippedRows: number;
  errors: string[];
  preview: VehicleImportRow[];
}

const CURRENT_YEAR = new Date().getFullYear();

function rowValue(row: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    const direct = row[key];
    if (direct !== undefined) return direct;
    const lower = row[key.toLowerCase()];
    if (lower !== undefined) return lower;
  }
  return undefined;
}

function mapConfidence(value: unknown): VehicleDimensionConfidenceLevel {
  const text = String(value ?? '').trim().toUpperCase();
  if (text === 'MANUAL') return VehicleDimensionConfidenceLevel.MANUAL;
  if (text === 'ESTIMATED') return VehicleDimensionConfidenceLevel.ESTIMATED;
  if (text === 'VERIFIED') return VehicleDimensionConfidenceLevel.VERIFIED;
  return VehicleDimensionConfidenceLevel.IMPORTED;
}

function rowToVehicleImportRow(row: Record<string, unknown>, index: number): VehicleImportRow | { error: string } {
  const year = parseOptionalInt(rowValue(row, 'year'));
  const make = normalizeVehicleText(rowValue(row, 'make'), 160);
  const model = normalizeVehicleText(rowValue(row, 'model'), 180);

  if (year === null || year < 1900 || year > CURRENT_YEAR + 2) {
    return { error: `Row ${index}: year must be numeric.` };
  }
  if (!make || !model) {
    return { error: `Row ${index}: make and model are required.` };
  }

  return {
    year,
    make,
    model,
    trim: normalizeVehicleText(rowValue(row, 'trim', 'trimName'), 180),
    bodyStyle: normalizeVehicleText(rowValue(row, 'bodyStyle', 'body style'), 120),
    bodyClass: normalizeVehicleText(rowValue(row, 'bodyClass', 'body class'), 120),
    vehicleType: normalizeVehicleText(rowValue(row, 'vehicleType', 'vehicle type'), 120),
    doors: parseOptionalInt(rowValue(row, 'doors')),
    drivetrain: normalizeVehicleText(rowValue(row, 'drivetrain'), 80),
    fuelType: normalizeVehicleText(rowValue(row, 'fuelType', 'fuel type'), 80),
    engine: normalizeVehicleText(rowValue(row, 'engine'), 160),
    transmission: normalizeVehicleText(rowValue(row, 'transmission'), 120),
    lengthIn: parseOptionalNumber(rowValue(row, 'lengthIn', 'length in')),
    widthIn: parseOptionalNumber(rowValue(row, 'widthIn', 'width in')),
    heightIn: parseOptionalNumber(rowValue(row, 'heightIn', 'height in')),
    wheelbaseIn: parseOptionalNumber(rowValue(row, 'wheelbaseIn', 'wheelbase in')),
    curbWeightLb: parseOptionalNumber(rowValue(row, 'curbWeightLb', 'curb weight lb')),
    grossWeightLb: parseOptionalNumber(rowValue(row, 'grossWeightLb', 'gross weight lb')),
    cargoLengthIn: parseOptionalNumber(rowValue(row, 'cargoLengthIn', 'cargo length in')),
    cargoWidthIn: parseOptionalNumber(rowValue(row, 'cargoWidthIn', 'cargo width in')),
    cargoHeightIn: parseOptionalNumber(rowValue(row, 'cargoHeightIn', 'cargo height in')),
    bedLengthIn: parseOptionalNumber(rowValue(row, 'bedLengthIn', 'bed length in')),
    roofLengthIn: parseOptionalNumber(rowValue(row, 'roofLengthIn', 'roof length in')),
    roofWidthIn: parseOptionalNumber(rowValue(row, 'roofWidthIn', 'roof width in')),
    hoodLengthIn: parseOptionalNumber(rowValue(row, 'hoodLengthIn', 'hood length in')),
    hoodWidthIn: parseOptionalNumber(rowValue(row, 'hoodWidthIn', 'hood width in')),
    sideApproxSqFt: parseOptionalNumber(rowValue(row, 'sideApproxSqFt', 'side approx sq ft')),
    roofApproxSqFt: parseOptionalNumber(rowValue(row, 'roofApproxSqFt', 'roof approx sq ft')),
    hoodApproxSqFt: parseOptionalNumber(rowValue(row, 'hoodApproxSqFt', 'hood approx sq ft')),
    rearApproxSqFt: parseOptionalNumber(rowValue(row, 'rearApproxSqFt', 'rear approx sq ft')),
    frontApproxSqFt: parseOptionalNumber(rowValue(row, 'frontApproxSqFt', 'front approx sq ft')),
    totalApproxWrapSqFt: parseOptionalNumber(rowValue(row, 'totalApproxWrapSqFt', 'total approx wrap sq ft')),
    sourceName: normalizeVehicleText(rowValue(row, 'sourceName', 'source name'), 180),
    sourceUrl: normalizeVehicleText(rowValue(row, 'sourceUrl', 'source url'), 1000),
    confidenceLevel: mapConfidence(rowValue(row, 'confidenceLevel', 'confidence level')),
    photoUrl: normalizeVehicleText(rowValue(row, 'photoUrl', 'photo url'), 1000),
    photoSourceName: normalizeVehicleText(rowValue(row, 'photoSourceName', 'photo source name'), 180),
    photoSourceUrl: normalizeVehicleText(rowValue(row, 'photoSourceUrl', 'photo source url'), 1000),
    photoLicenseNote: normalizeVehicleText(rowValue(row, 'photoLicenseNote', 'photo license note'), 1000),
    notes: normalizeVehicleText(rowValue(row, 'notes'), 4000),
  };
}

export function parseVehicleImportText(text: string, format: VehicleImportFormat): {
  rows: VehicleImportRow[];
  errors: string[];
} {
  let rawRows: Array<Record<string, unknown>>;
  try {
    if (format === 'json') {
      const parsed = JSON.parse(text) as unknown;
      rawRows = Array.isArray(parsed)
        ? parsed.filter((row): row is Record<string, unknown> => row !== null && typeof row === 'object')
        : [];
    } else {
      rawRows = parseCSV(text);
    }
  } catch {
    return { rows: [], errors: [`Could not parse ${format.toUpperCase()} file.`] };
  }

  const rows: VehicleImportRow[] = [];
  const errors: string[] = [];
  rawRows.forEach((raw, i) => {
    const mapped = rowToVehicleImportRow(raw, i + 2);
    if ('error' in mapped) errors.push(mapped.error);
    else rows.push(mapped);
  });
  return { rows, errors };
}

function hasDimensionData(row: VehicleImportRow): boolean {
  return [
    row.lengthIn,
    row.widthIn,
    row.heightIn,
    row.wheelbaseIn,
    row.cargoLengthIn,
    row.bedLengthIn,
    row.totalApproxWrapSqFt,
    row.sideApproxSqFt,
    row.roofApproxSqFt,
    row.hoodApproxSqFt,
    row.rearApproxSqFt,
    row.frontApproxSqFt,
  ].some((value) => value !== null);
}

export async function importVehicleRows(
  inputRows: VehicleImportRow[],
  options: VehicleImportOptions
): Promise<VehicleImportResult> {
  const db = options.db ?? prisma;
  const cutoffYear = options.recentYears ? CURRENT_YEAR - options.recentYears + 1 : null;
  const makeFilter = options.make?.trim().toLowerCase();
  const rows = inputRows.filter((row) => {
    if (cutoffYear !== null && row.year < cutoffYear) return false;
    if (makeFilter && row.make.toLowerCase() !== makeFilter) return false;
    return true;
  });

  const result: VehicleImportResult = {
    dryRun: Boolean(options.dryRun),
    totalRows: rows.length,
    makesCreated: 0,
    modelsCreated: 0,
    trimsCreated: 0,
    dimensionsCreated: 0,
    dimensionsUpdated: 0,
    photosCreated: 0,
    photosUpdated: 0,
    skippedRows: inputRows.length - rows.length,
    errors: [],
    preview: rows.slice(0, 25),
  };

  if (options.dryRun) return result;

  for (const row of rows) {
    try {
      const makeSlug = slugifyVehiclePart(row.make);
      const existingMake = await db.vehicleMake.findUnique({
        where: { tenantId_slug: { tenantId: options.tenantId, slug: makeSlug } },
        select: { id: true },
      });
      const make = existingMake ?? await db.vehicleMake.create({
        data: { tenantId: options.tenantId, name: row.make, slug: makeSlug },
        select: { id: true },
      });
      if (!existingMake) result.makesCreated++;

      const modelSlug = slugifyVehiclePart(row.model);
      const existingModel = await db.vehicleModel.findUnique({
        where: { tenantId_makeId_slug: { tenantId: options.tenantId, makeId: make.id, slug: modelSlug } },
        select: { id: true },
      });
      const model = existingModel ?? await db.vehicleModel.create({
        data: {
          tenantId: options.tenantId,
          makeId: make.id,
          name: row.model,
          slug: modelSlug,
          bodyClass: row.bodyClass,
          vehicleType: row.vehicleType,
          firstYear: row.year,
          lastYear: row.year,
        },
        select: { id: true },
      });
      if (!existingModel) result.modelsCreated++;

      const existingTrim = await db.vehicleTrim.findFirst({
        where: {
          tenantId: options.tenantId,
          modelId: model.id,
          year: row.year,
          trimName: row.trim,
          bodyStyle: row.bodyStyle,
          deletedAt: null,
        },
        select: { id: true },
      });
      const trim = existingTrim ?? await db.vehicleTrim.create({
        data: {
          tenantId: options.tenantId,
          modelId: model.id,
          year: row.year,
          trimName: row.trim,
          bodyStyle: row.bodyStyle,
          doors: row.doors,
          drivetrain: row.drivetrain,
          fuelType: row.fuelType,
          engine: row.engine,
          transmission: row.transmission,
        },
        select: { id: true },
      });
      if (!existingTrim) result.trimsCreated++;

      if (hasDimensionData(row)) {
        const sourceName = row.sourceName ?? 'Vehicle import';
        const existingProfile = await db.vehicleDimensionProfile.findFirst({
          where: { tenantId: options.tenantId, trimId: trim.id, sourceName },
          select: { id: true },
        });
        const dimensionData = {
          sourceName,
          sourceUrl: row.sourceUrl,
          confidenceLevel: row.confidenceLevel,
          lengthIn: row.lengthIn,
          widthIn: row.widthIn,
          heightIn: row.heightIn,
          wheelbaseIn: row.wheelbaseIn,
          curbWeightLb: row.curbWeightLb,
          grossWeightLb: row.grossWeightLb,
          cargoLengthIn: row.cargoLengthIn,
          cargoWidthIn: row.cargoWidthIn,
          cargoHeightIn: row.cargoHeightIn,
          bedLengthIn: row.bedLengthIn,
          roofLengthIn: row.roofLengthIn,
          roofWidthIn: row.roofWidthIn,
          hoodLengthIn: row.hoodLengthIn,
          hoodWidthIn: row.hoodWidthIn,
          sideApproxSqFt: row.sideApproxSqFt,
          roofApproxSqFt: row.roofApproxSqFt,
          hoodApproxSqFt: row.hoodApproxSqFt,
          rearApproxSqFt: row.rearApproxSqFt,
          frontApproxSqFt: row.frontApproxSqFt,
          totalApproxWrapSqFt: row.totalApproxWrapSqFt,
          notes: row.notes,
        };
        if (existingProfile) {
          await db.vehicleDimensionProfile.update({ where: { id: existingProfile.id }, data: dimensionData });
          result.dimensionsUpdated++;
        } else {
          await db.vehicleDimensionProfile.create({
            data: { tenantId: options.tenantId, trimId: trim.id, ...dimensionData },
          });
          result.dimensionsCreated++;
        }
      }

      if (row.photoUrl) {
        const existingPhoto = await db.vehiclePhoto.findFirst({
          where: { tenantId: options.tenantId, trimId: trim.id, url: row.photoUrl },
          select: { id: true },
        });
        const photoData = {
          url: row.photoUrl,
          altText: `${row.year} ${row.make} ${row.model}${row.trim ? ` ${row.trim}` : ''}`,
          photoType: VehiclePhotoType.HERO,
          sourceName: row.photoSourceName ?? row.sourceName,
          sourceUrl: row.photoSourceUrl ?? row.sourceUrl,
          licenseNote: row.photoLicenseNote,
          isPrimary: true,
        };
        if (existingPhoto) {
          await db.vehiclePhoto.update({ where: { id: existingPhoto.id }, data: photoData });
          result.photosUpdated++;
        } else {
          await db.vehiclePhoto.create({
            data: { tenantId: options.tenantId, trimId: trim.id, ...photoData },
          });
          result.photosCreated++;
        }
      }
    } catch (err) {
      result.skippedRows++;
      result.errors.push(
        `${row.year} ${row.make} ${row.model}: ${err instanceof Error ? err.message : 'Unexpected import error.'}`
      );
    }
  }

  return { ...result, errors: result.errors.slice(0, 50) };
}
