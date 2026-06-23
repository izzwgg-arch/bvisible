'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  prisma,
  EstimateStatus,
  Role,
  VehicleDimensionConfidenceLevel,
  VehiclePhotoType,
} from '@bvisible/db';
import { writeAuditLog } from '@/lib/auth/audit';
import { requireRoleWithEffectiveCompany, requireTenantId } from '@/lib/auth/current-user';
import { readRequestContext } from '@/lib/request-context';
import {
  estimateVehicleAttachSchema,
  estimateVehicleManualSchema,
  vehicleUpsertSchema,
} from '@/lib/validators';
import { parseVehicleImportText, importVehicleRows, type VehicleImportFormat, type VehicleImportResult } from '@/lib/vehicles/import';
import { slugifyVehiclePart } from '@/lib/vehicles/normalize';

export interface VehicleFormState {
  error: string | null;
}

function formPayload(formData: FormData): Record<string, FormDataEntryValue | null> {
  return {
    year: formData.get('year'),
    make: formData.get('make'),
    model: formData.get('model'),
    trim: formData.get('trim'),
    bodyStyle: formData.get('bodyStyle'),
    vehicleType: formData.get('vehicleType'),
    doors: formData.get('doors'),
    drivetrain: formData.get('drivetrain'),
    fuelType: formData.get('fuelType'),
    engine: formData.get('engine'),
    transmission: formData.get('transmission'),
    lengthIn: formData.get('lengthIn'),
    widthIn: formData.get('widthIn'),
    heightIn: formData.get('heightIn'),
    wheelbaseIn: formData.get('wheelbaseIn'),
    curbWeightLb: formData.get('curbWeightLb'),
    grossWeightLb: formData.get('grossWeightLb'),
    cargoLengthIn: formData.get('cargoLengthIn'),
    cargoWidthIn: formData.get('cargoWidthIn'),
    cargoHeightIn: formData.get('cargoHeightIn'),
    bedLengthIn: formData.get('bedLengthIn'),
    roofLengthIn: formData.get('roofLengthIn'),
    roofWidthIn: formData.get('roofWidthIn'),
    hoodLengthIn: formData.get('hoodLengthIn'),
    hoodWidthIn: formData.get('hoodWidthIn'),
    sideApproxSqFt: formData.get('sideApproxSqFt'),
    roofApproxSqFt: formData.get('roofApproxSqFt'),
    hoodApproxSqFt: formData.get('hoodApproxSqFt'),
    rearApproxSqFt: formData.get('rearApproxSqFt'),
    frontApproxSqFt: formData.get('frontApproxSqFt'),
    totalApproxWrapSqFt: formData.get('totalApproxWrapSqFt'),
    sourceName: formData.get('sourceName'),
    sourceUrl: formData.get('sourceUrl'),
    confidenceLevel: formData.get('confidenceLevel') || VehicleDimensionConfidenceLevel.MANUAL,
    photoUrl: formData.get('photoUrl'),
    photoAltText: formData.get('photoAltText'),
    photoSourceName: formData.get('photoSourceName'),
    photoSourceUrl: formData.get('photoSourceUrl'),
    photoLicenseNote: formData.get('photoLicenseNote'),
    notes: formData.get('notes'),
  };
}

async function upsertVehicleFromForm(tenantId: string, formData: FormData, existingTrimId?: string): Promise<string | VehicleFormState> {
  const parsed = vehicleUpsertSchema.safeParse(formPayload(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid vehicle.' };
  }
  const data = parsed.data;

  const make = await prisma.vehicleMake.upsert({
    where: { tenantId_slug: { tenantId, slug: slugifyVehiclePart(data.make) } },
    update: { name: data.make },
    create: { tenantId, name: data.make, slug: slugifyVehiclePart(data.make) },
    select: { id: true },
  });

  const model = await prisma.vehicleModel.upsert({
    where: {
      tenantId_makeId_slug: {
        tenantId,
        makeId: make.id,
        slug: slugifyVehiclePart(data.model),
      },
    },
    update: {
      name: data.model,
      bodyClass: data.bodyStyle,
      vehicleType: data.vehicleType,
      firstYear: data.year ?? undefined,
      lastYear: data.year ?? undefined,
    },
    create: {
      tenantId,
      makeId: make.id,
      name: data.model,
      slug: slugifyVehiclePart(data.model),
      bodyClass: data.bodyStyle,
      vehicleType: data.vehicleType,
      firstYear: data.year,
      lastYear: data.year,
    },
    select: { id: true },
  });

  const trimData = {
    tenantId,
    modelId: model.id,
    year: data.year ?? new Date().getFullYear(),
    trimName: data.trim,
    bodyStyle: data.bodyStyle,
    doors: data.doors,
    drivetrain: data.drivetrain,
    fuelType: data.fuelType,
    engine: data.engine,
    transmission: data.transmission,
    deletedAt: null,
  };

  const trim = existingTrimId
    ? await prisma.vehicleTrim.update({
        where: { id: existingTrimId },
        data: trimData,
        select: { id: true },
      })
    : await prisma.vehicleTrim.create({
        data: trimData,
        select: { id: true },
      });

  const profileData = {
    sourceName: data.sourceName ?? 'Manual entry',
    sourceUrl: data.sourceUrl,
    confidenceLevel: data.confidenceLevel,
    lengthIn: data.lengthIn,
    widthIn: data.widthIn,
    heightIn: data.heightIn,
    wheelbaseIn: data.wheelbaseIn,
    curbWeightLb: data.curbWeightLb,
    grossWeightLb: data.grossWeightLb,
    cargoLengthIn: data.cargoLengthIn,
    cargoWidthIn: data.cargoWidthIn,
    cargoHeightIn: data.cargoHeightIn,
    bedLengthIn: data.bedLengthIn,
    roofLengthIn: data.roofLengthIn,
    roofWidthIn: data.roofWidthIn,
    hoodLengthIn: data.hoodLengthIn,
    hoodWidthIn: data.hoodWidthIn,
    sideApproxSqFt: data.sideApproxSqFt,
    roofApproxSqFt: data.roofApproxSqFt,
    hoodApproxSqFt: data.hoodApproxSqFt,
    rearApproxSqFt: data.rearApproxSqFt,
    frontApproxSqFt: data.frontApproxSqFt,
    totalApproxWrapSqFt: data.totalApproxWrapSqFt,
    notes: data.notes,
  };

  const existingProfile = await prisma.vehicleDimensionProfile.findFirst({
    where: { tenantId, trimId: trim.id, sourceName: profileData.sourceName },
    select: { id: true },
  });
  if (existingProfile) {
    await prisma.vehicleDimensionProfile.update({ where: { id: existingProfile.id }, data: profileData });
  } else {
    await prisma.vehicleDimensionProfile.create({
      data: { tenantId, trimId: trim.id, ...profileData },
    });
  }

  if (data.photoUrl) {
    await prisma.vehiclePhoto.updateMany({
      where: { tenantId, trimId: trim.id, isPrimary: true },
      data: { isPrimary: false },
    });
    const existingPhoto = await prisma.vehiclePhoto.findFirst({
      where: { tenantId, trimId: trim.id, url: data.photoUrl },
      select: { id: true },
    });
    const photoData = {
      url: data.photoUrl,
      altText: data.photoAltText ?? `${data.year ?? ''} ${data.make} ${data.model}`.trim(),
      photoType: VehiclePhotoType.HERO,
      sourceName: data.photoSourceName ?? data.sourceName,
      sourceUrl: data.photoSourceUrl ?? data.sourceUrl,
      licenseNote: data.photoLicenseNote,
      isPrimary: true,
    };
    if (existingPhoto) {
      await prisma.vehiclePhoto.update({ where: { id: existingPhoto.id }, data: photoData });
    } else {
      await prisma.vehiclePhoto.create({ data: { tenantId, trimId: trim.id, ...photoData } });
    }
  }

  return trim.id;
}

export async function createVehicleAction(_prev: VehicleFormState, formData: FormData): Promise<VehicleFormState> {
  const me = await requireRoleWithEffectiveCompany(Role.ADMIN, Role.SUPER_ADMIN);
  const ctx = await readRequestContext();
  const result = await upsertVehicleFromForm(me.tenantId, formData);
  if (typeof result !== 'string') return result;

  await writeAuditLog({
    action: 'vehicle_created',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'vehicle_trim',
    targetId: result,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });
  revalidatePath('/vehicles');
  redirect(`/vehicles/${result}`);
}

export async function updateVehicleAction(trimId: string, _prev: VehicleFormState, formData: FormData): Promise<VehicleFormState> {
  const me = await requireRoleWithEffectiveCompany(Role.ADMIN, Role.SUPER_ADMIN);
  const ctx = await readRequestContext();
  const existing = await prisma.vehicleTrim.findFirst({
    where: { id: trimId, tenantId: me.tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!existing) return { error: 'Vehicle not found.' };

  const result = await upsertVehicleFromForm(me.tenantId, formData, trimId);
  if (typeof result !== 'string') return result;

  await writeAuditLog({
    action: 'vehicle_updated',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'vehicle_trim',
    targetId: result,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });
  revalidatePath('/vehicles');
  revalidatePath(`/vehicles/${trimId}`);
  redirect(`/vehicles/${trimId}`);
}

export async function archiveVehicleAction(trimId: string): Promise<void> {
  const me = await requireRoleWithEffectiveCompany(Role.ADMIN, Role.SUPER_ADMIN);
  const ctx = await readRequestContext();
  const existing = await prisma.vehicleTrim.findFirst({
    where: { id: trimId, tenantId: me.tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!existing) redirect('/vehicles');
  await prisma.vehicleTrim.update({ where: { id: trimId }, data: { deletedAt: new Date() } });
  await writeAuditLog({
    action: 'vehicle_archived',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'vehicle_trim',
    targetId: trimId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });
  revalidatePath('/vehicles');
  redirect('/vehicles');
}

export async function bulkArchiveVehiclesAction(formData: FormData): Promise<void> {
  const me = await requireRoleWithEffectiveCompany(Role.ADMIN, Role.SUPER_ADMIN);
  const ctx = await readRequestContext();
  const ids = formData.getAll('ids').map((value) => String(value)).filter(Boolean);
  if (ids.length === 0) return;

  const result = await prisma.vehicleTrim.updateMany({
    where: {
      id: { in: ids },
      tenantId: me.tenantId,
      deletedAt: null,
    },
    data: { deletedAt: new Date() },
  });

  await writeAuditLog({
    action: 'vehicles_bulk_archived',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'vehicle_trim',
    targetId: 'bulk',
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { requestedCount: ids.length, archivedCount: result.count },
  });

  revalidatePath('/vehicles');
}

export async function importVehiclesAction(input: {
  text: string;
  format: VehicleImportFormat;
  dryRun?: boolean;
  recentYears?: number;
  make?: string;
}): Promise<VehicleImportResult> {
  const me = await requireRoleWithEffectiveCompany(Role.ADMIN, Role.SUPER_ADMIN);
  const ctx = await readRequestContext();
  const parsed = parseVehicleImportText(input.text, input.format);
  if (parsed.errors.length > 0) {
    return {
      dryRun: Boolean(input.dryRun),
      totalRows: 0,
      makesCreated: 0,
      modelsCreated: 0,
      trimsCreated: 0,
      dimensionsCreated: 0,
      dimensionsUpdated: 0,
      photosCreated: 0,
      photosUpdated: 0,
      skippedRows: parsed.errors.length,
      errors: parsed.errors,
      preview: [],
    };
  }
  const result = await importVehicleRows(parsed.rows, {
    tenantId: me.tenantId,
    dryRun: input.dryRun,
    recentYears: input.recentYears,
    make: input.make,
  });
  if (!input.dryRun) {
    await writeAuditLog({
      action: 'vehicles_imported',
      userId: me.id,
      tenantId: me.tenantId,
      targetType: 'vehicle_trim',
      targetId: 'bulk',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: {
        totalRows: result.totalRows,
        makesCreated: result.makesCreated,
        modelsCreated: result.modelsCreated,
        trimsCreated: result.trimsCreated,
        dimensionsCreated: result.dimensionsCreated,
        dimensionsUpdated: result.dimensionsUpdated,
        photosCreated: result.photosCreated,
        photosUpdated: result.photosUpdated,
        skippedRows: result.skippedRows,
        errorCount: result.errors.length,
      },
    });
    revalidatePath('/vehicles');
  }
  return result;
}

export async function attachEstimateVehicleAction(input: {
  estimateId: string;
  trimId: string;
  coverageType?: string | null;
  wrapType?: string | null;
}): Promise<{ error: string | null }> {
  const me = await requireTenantId();
  const parsed = estimateVehicleAttachSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid vehicle.' };
  const estimate = await prisma.estimate.findFirst({
    where: { id: parsed.data.estimateId, tenantId: me.tenantId, deletedAt: null },
    select: { id: true, status: true },
  });
  if (!estimate) return { error: 'Estimate not found.' };
  if (estimate.status === EstimateStatus.FINALIZED) return { error: 'Estimate is finalized.' };
  const trim = await prisma.vehicleTrim.findFirst({
    where: { id: parsed.data.trimId, tenantId: me.tenantId, deletedAt: null },
    select: {
      id: true,
      year: true,
      trimName: true,
      bodyStyle: true,
      photos: { where: { isPrimary: true }, take: 1, select: { url: true } },
      model: { select: { name: true, make: { select: { name: true } } } },
    },
  });
  if (!trim) return { error: 'Vehicle not found.' };

  await prisma.estimateVehicle.upsert({
    where: { tenantId_estimateId: { tenantId: me.tenantId, estimateId: estimate.id } },
    update: {
      trimId: trim.id,
      year: trim.year,
      make: trim.model.make.name,
      model: trim.model.name,
      trim: trim.trimName,
      coverageType: parsed.data.coverageType,
      wrapType: parsed.data.wrapType,
      photoUrl: trim.photos[0]?.url ?? null,
    },
    create: {
      tenantId: me.tenantId,
      estimateId: estimate.id,
      trimId: trim.id,
      year: trim.year,
      make: trim.model.make.name,
      model: trim.model.name,
      trim: trim.trimName,
      coverageType: parsed.data.coverageType,
      wrapType: parsed.data.wrapType,
      photoUrl: trim.photos[0]?.url ?? null,
    },
  });
  revalidatePath(`/estimates/${estimate.id}`);
  return { error: null };
}

export async function updateEstimateVehicleAction(input: unknown): Promise<{ error: string | null }> {
  const me = await requireTenantId();
  const parsed = estimateVehicleManualSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid vehicle.' };
  const estimate = await prisma.estimate.findFirst({
    where: { id: parsed.data.estimateId, tenantId: me.tenantId, deletedAt: null },
    select: { id: true, status: true },
  });
  if (!estimate) return { error: 'Estimate not found.' };
  if (estimate.status === EstimateStatus.FINALIZED) return { error: 'Estimate is finalized.' };
  await prisma.estimateVehicle.upsert({
    where: { tenantId_estimateId: { tenantId: me.tenantId, estimateId: estimate.id } },
    update: parsed.data,
    create: { tenantId: me.tenantId, ...parsed.data },
  });
  revalidatePath(`/estimates/${estimate.id}`);
  return { error: null };
}

export async function removeEstimateVehicleAction(estimateId: string): Promise<{ error: string | null }> {
  const me = await requireTenantId();
  const estimate = await prisma.estimate.findFirst({
    where: { id: estimateId, tenantId: me.tenantId, deletedAt: null },
    select: { id: true, status: true },
  });
  if (!estimate) return { error: 'Estimate not found.' };
  if (estimate.status === EstimateStatus.FINALIZED) return { error: 'Estimate is finalized.' };
  await prisma.estimateVehicle.deleteMany({ where: { tenantId: me.tenantId, estimateId } });
  revalidatePath(`/estimates/${estimateId}`);
  return { error: null };
}
