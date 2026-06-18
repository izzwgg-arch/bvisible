import { NextResponse } from 'next/server';
import { prisma } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { buildCSV } from '@/lib/csv';

export async function GET() {
  const me = await requireTenantId();
  const vehicles = await prisma.vehicleTrim.findMany({
    where: { tenantId: me.tenantId, deletedAt: null },
    orderBy: [{ year: 'desc' }, { model: { make: { name: 'asc' } } }, { model: { name: 'asc' } }],
    select: {
      year: true,
      trimName: true,
      bodyStyle: true,
      doors: true,
      drivetrain: true,
      fuelType: true,
      engine: true,
      transmission: true,
      model: { select: { name: true, vehicleType: true, make: { select: { name: true } } } },
      dimensionProfiles: { orderBy: [{ updatedAt: 'desc' }], take: 1 },
      photos: { where: { isPrimary: true }, take: 1, select: { url: true, sourceName: true, sourceUrl: true, licenseNote: true } },
    },
  });

  const headers = [
    'year', 'make', 'model', 'trim', 'bodyStyle', 'vehicleType', 'doors', 'drivetrain', 'fuelType', 'engine', 'transmission',
    'lengthIn', 'widthIn', 'heightIn', 'wheelbaseIn', 'curbWeightLb', 'grossWeightLb', 'cargoLengthIn', 'cargoWidthIn', 'cargoHeightIn',
    'bedLengthIn', 'roofLengthIn', 'roofWidthIn', 'hoodLengthIn', 'hoodWidthIn', 'sideApproxSqFt', 'roofApproxSqFt', 'hoodApproxSqFt',
    'rearApproxSqFt', 'frontApproxSqFt', 'totalApproxWrapSqFt', 'sourceName', 'sourceUrl', 'confidenceLevel', 'photoUrl',
    'photoSourceName', 'photoSourceUrl', 'photoLicenseNote',
  ];

  const rows = vehicles.map((vehicle) => {
    const p = vehicle.dimensionProfiles[0];
    const photo = vehicle.photos[0];
    return [
      vehicle.year.toString(),
      vehicle.model.make.name,
      vehicle.model.name,
      vehicle.trimName ?? '',
      vehicle.bodyStyle ?? '',
      vehicle.model.vehicleType ?? '',
      vehicle.doors?.toString() ?? '',
      vehicle.drivetrain ?? '',
      vehicle.fuelType ?? '',
      vehicle.engine ?? '',
      vehicle.transmission ?? '',
      n(p?.lengthIn),
      n(p?.widthIn),
      n(p?.heightIn),
      n(p?.wheelbaseIn),
      n(p?.curbWeightLb),
      n(p?.grossWeightLb),
      n(p?.cargoLengthIn),
      n(p?.cargoWidthIn),
      n(p?.cargoHeightIn),
      n(p?.bedLengthIn),
      n(p?.roofLengthIn),
      n(p?.roofWidthIn),
      n(p?.hoodLengthIn),
      n(p?.hoodWidthIn),
      n(p?.sideApproxSqFt),
      n(p?.roofApproxSqFt),
      n(p?.hoodApproxSqFt),
      n(p?.rearApproxSqFt),
      n(p?.frontApproxSqFt),
      n(p?.totalApproxWrapSqFt),
      p?.sourceName ?? '',
      p?.sourceUrl ?? '',
      p?.confidenceLevel ?? '',
      photo?.url ?? '',
      photo?.sourceName ?? '',
      photo?.sourceUrl ?? '',
      photo?.licenseNote ?? '',
    ];
  });

  return new NextResponse(buildCSV(headers, rows), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="vehicles-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}

function n(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}
