import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { updateVehicleAction } from '../../actions';
import { VehicleForm } from '../../vehicle-form';

export const metadata = { title: 'Edit vehicle' };
export const dynamic = 'force-dynamic';

export default async function EditVehiclePage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireTenantId();
  const { id } = await params;
  const vehicle = await prisma.vehicleTrim.findFirst({
    where: { id, tenantId: me.tenantId, deletedAt: null },
    select: {
      id: true,
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
      photos: { where: { isPrimary: true }, take: 1 },
    },
  });
  if (!vehicle) notFound();

  const profile = vehicle.dimensionProfiles[0];
  const photo = vehicle.photos[0];

  return (
    <>
      <PageHeader
        title="Edit vehicle"
        subtitle={`${vehicle.year} ${vehicle.model.make.name} ${vehicle.model.name}${vehicle.trimName ? ` ${vehicle.trimName}` : ''}`}
        actions={
          <Link href={`/vehicles/${vehicle.id}`} className="rounded-[12px] border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-semibold text-slate-700 shadow-sm">
            Back to detail
          </Link>
        }
      />
      <VehicleForm
        action={updateVehicleAction.bind(null, vehicle.id)}
        submitLabel="Save vehicle"
        initial={{
          year: vehicle.year,
          make: vehicle.model.make.name,
          model: vehicle.model.name,
          trim: vehicle.trimName,
          bodyStyle: vehicle.bodyStyle,
          vehicleType: vehicle.model.vehicleType,
          doors: vehicle.doors,
          drivetrain: vehicle.drivetrain,
          fuelType: vehicle.fuelType,
          engine: vehicle.engine,
          transmission: vehicle.transmission,
          ...profile,
          photoUrl: photo?.url,
          photoAltText: photo?.altText,
          photoSourceName: photo?.sourceName,
          photoSourceUrl: photo?.sourceUrl,
          photoLicenseNote: photo?.licenseNote,
        }}
      />
    </>
  );
}
