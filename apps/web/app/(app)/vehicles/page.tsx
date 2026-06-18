import Link from 'next/link';
import { prisma, Prisma, Role, VehicleDimensionConfidenceLevel } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { EmptyState } from '@/components/app/empty-state';
import { formatInches, formatSqFt, VEHICLE_PLACEHOLDER_SVG } from '@/lib/vehicles/display';

export const metadata = { title: 'Vehicle Library' };
export const dynamic = 'force-dynamic';

interface SearchParams {
  q?: string;
  year?: string;
  make?: string;
  bodyStyle?: string;
  vehicleType?: string;
  status?: string;
  view?: string;
}

export default async function VehicleLibraryPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const me = await requireTenantId();
  const sp = await searchParams;
  const canManage = me.role === Role.ADMIN || me.role === Role.SUPER_ADMIN;
  const q = sp.q?.trim() ?? '';
  const view = sp.view === 'table' ? 'table' : 'grid';
  const year = sp.year ? Number(sp.year) : null;

  const where: Prisma.VehicleTrimWhereInput = {
    tenantId: me.tenantId,
    deletedAt: null,
    ...(Number.isFinite(year) && year ? { year } : {}),
    ...(sp.bodyStyle ? { bodyStyle: sp.bodyStyle } : {}),
    ...(sp.make ? { model: { make: { name: sp.make } } } : {}),
    ...(sp.vehicleType ? { model: { vehicleType: sp.vehicleType } } : {}),
    ...(q
      ? {
          OR: [
            { trimName: { contains: q, mode: 'insensitive' as const } },
            { bodyStyle: { contains: q, mode: 'insensitive' as const } },
            { model: { name: { contains: q, mode: 'insensitive' as const } } },
            { model: { make: { name: { contains: q, mode: 'insensitive' as const } } } },
            ...(Number.isFinite(Number(q)) ? [{ year: Number(q) }] : []),
          ],
        }
      : {}),
    ...(sp.status === 'has-photo' ? { photos: { some: { isPrimary: true } } } : {}),
    ...(sp.status === 'missing-photo' ? { photos: { none: { isPrimary: true } } } : {}),
    ...(sp.status === 'has-dimensions' ? { dimensionProfiles: { some: {} } } : {}),
    ...(sp.status === 'missing-dimensions' ? { dimensionProfiles: { none: {} } } : {}),
    ...(sp.status === 'has-wrap' ? { dimensionProfiles: { some: { totalApproxWrapSqFt: { not: null } } } } : {}),
    ...(sp.status === 'missing-wrap' ? { OR: [{ dimensionProfiles: { none: {} } }, { dimensionProfiles: { every: { totalApproxWrapSqFt: null } } }] } : {}),
  };

  const [vehicles, makes, bodyStyles, vehicleTypes, totalCount, withPhotoCount, withDimsCount, withWrapCount] = await Promise.all([
    prisma.vehicleTrim.findMany({
      where,
      orderBy: [{ year: 'desc' }, { model: { make: { name: 'asc' } } }, { model: { name: 'asc' } }],
      take: 160,
      select: {
        id: true,
        year: true,
        trimName: true,
        bodyStyle: true,
        model: { select: { name: true, vehicleType: true, make: { select: { name: true } } } },
        dimensionProfiles: { orderBy: [{ updatedAt: 'desc' }], take: 1 },
        photos: { where: { isPrimary: true }, take: 1, select: { url: true, altText: true } },
        templates: { take: 1, select: { id: true } },
      },
    }),
    prisma.vehicleMake.findMany({ where: { tenantId: me.tenantId }, orderBy: { name: 'asc' }, select: { name: true } }),
    prisma.vehicleTrim.findMany({ where: { tenantId: me.tenantId, deletedAt: null, bodyStyle: { not: null } }, distinct: ['bodyStyle'], orderBy: { bodyStyle: 'asc' }, select: { bodyStyle: true } }),
    prisma.vehicleModel.findMany({ where: { tenantId: me.tenantId, vehicleType: { not: null } }, distinct: ['vehicleType'], orderBy: { vehicleType: 'asc' }, select: { vehicleType: true } }),
    prisma.vehicleTrim.count({ where: { tenantId: me.tenantId, deletedAt: null } }),
    prisma.vehicleTrim.count({ where: { tenantId: me.tenantId, deletedAt: null, photos: { some: { isPrimary: true } } } }),
    prisma.vehicleTrim.count({ where: { tenantId: me.tenantId, deletedAt: null, dimensionProfiles: { some: {} } } }),
    prisma.vehicleTrim.count({ where: { tenantId: me.tenantId, deletedAt: null, dimensionProfiles: { some: { totalApproxWrapSqFt: { not: null } } } } }),
  ]);

  return (
    <>
      <PageHeader
        title="Vehicle Library"
        subtitle="Manage vehicles, dimensions, photos, and wrap profiles."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {canManage ? (
              <>
                <Link href="/vehicles/new" className="rounded-[12px] bg-[var(--color-bv-accent)] px-4 py-2.5 text-[13.5px] font-semibold text-white shadow-[0_16px_34px_rgba(47,90,243,0.24)]">Add vehicle</Link>
                <Link href="/vehicles/import" className="rounded-[12px] border border-slate-200 bg-white px-4 py-2.5 text-[13.5px] font-semibold text-slate-700 shadow-sm">Import vehicles</Link>
              </>
            ) : null}
            <a href="/api/vehicles/export" download className="rounded-[12px] border border-slate-200 bg-white px-4 py-2.5 text-[13.5px] font-semibold text-slate-700 shadow-sm">Export CSV</a>
            <Link href="/vehicles?status=has-wrap" className="rounded-[12px] border border-slate-200 bg-white px-4 py-2.5 text-[13.5px] font-semibold text-slate-700 shadow-sm">Manage templates</Link>
          </div>
        }
      />

      <section className="mb-5 grid gap-3 md:grid-cols-4">
        <Metric label="Vehicles" value={totalCount} detail="Tenant library" />
        <Metric label="Photos" value={withPhotoCount} detail="Primary photo attached" />
        <Metric label="Dimensions" value={withDimsCount} detail="Has specs/profile" />
        <Metric label="Wrap profiles" value={withWrapCount} detail="Has sq ft estimate" />
      </section>

      <section className="mb-5 rounded-[22px] border border-white/80 bg-white/90 p-4 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur-xl">
        <form method="get" className="grid gap-3 lg:grid-cols-[1.5fr_repeat(5,1fr)_auto]">
          <input name="q" defaultValue={q} placeholder="Search year, make, model, trim..." className={inputClass} />
          <input name="year" defaultValue={sp.year ?? ''} placeholder="Year" className={inputClass} />
          <Select name="make" value={sp.make ?? ''} label="All makes" options={makes.map((m) => m.name)} />
          <Select name="bodyStyle" value={sp.bodyStyle ?? ''} label="All body styles" options={bodyStyles.map((b) => b.bodyStyle).filter(Boolean) as string[]} />
          <Select name="vehicleType" value={sp.vehicleType ?? ''} label="All vehicle types" options={vehicleTypes.map((v) => v.vehicleType).filter(Boolean) as string[]} />
          <Select name="status" value={sp.status ?? ''} label="All statuses" options={['has-photo', 'missing-photo', 'has-dimensions', 'missing-dimensions', 'has-wrap', 'missing-wrap']} />
          <input type="hidden" name="view" value={view} />
          <button type="submit" className="rounded-[14px] border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-bold text-slate-700 shadow-sm">Search</button>
        </form>
        <div className="mt-3 flex flex-wrap gap-2 text-[12px]">
          <Link href={`/vehicles?view=grid${q ? `&q=${encodeURIComponent(q)}` : ''}`} className={toggleClass(view === 'grid')}>Grid</Link>
          <Link href={`/vehicles?view=table${q ? `&q=${encodeURIComponent(q)}` : ''}`} className={toggleClass(view === 'table')}>Table</Link>
          <Link href="/vehicles?status=missing-photo" className={toggleClass(sp.status === 'missing-photo')}>Needs photo</Link>
          <Link href="/vehicles?status=missing-dimensions" className={toggleClass(sp.status === 'missing-dimensions')}>Needs dimensions</Link>
          <Link href="/vehicles?status=missing-wrap" className={toggleClass(sp.status === 'missing-wrap')}>Needs wrap profile</Link>
        </div>
      </section>

      {vehicles.length === 0 ? (
        <EmptyState
          title="No vehicles found"
          description="Add a vehicle manually or import a CSV/JSON file to seed the library. Estimates can still be created without vehicles."
          primaryAction={canManage ? { label: 'Add vehicle', href: '/vehicles/new' } : undefined}
          secondaryAction={canManage ? { label: 'Import vehicles', href: '/vehicles/import' } : undefined}
        />
      ) : view === 'table' ? (
        <VehicleTable vehicles={vehicles} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {vehicles.map((vehicle) => <VehicleCard key={vehicle.id} vehicle={vehicle} />)}
        </div>
      )}
    </>
  );
}

const inputClass = 'h-11 rounded-[14px] border border-slate-200 bg-slate-50/80 px-3 text-[13px] font-semibold text-slate-800 outline-none focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-500/10';

function toggleClass(active: boolean): string {
  return active
    ? 'rounded-full bg-[var(--color-bv-accent)] px-3 py-1.5 font-bold text-white shadow-[0_10px_22px_rgba(47,90,243,0.22)]'
    : 'rounded-full border border-slate-200 bg-white px-3 py-1.5 font-bold text-slate-500 hover:bg-blue-50 hover:text-blue-700';
}

function Select({ name, value, label, options }: { name: string; value: string; label: string; options: string[] }) {
  return (
    <select name={name} defaultValue={value} className={inputClass}>
      <option value="">{label}</option>
      {options.map((option) => <option key={option} value={option}>{option}</option>)}
    </select>
  );
}

function Metric({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div className="rounded-[20px] border border-white/80 bg-white/90 px-5 py-4 shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">{label}</p>
      <p className="mt-2 text-[28px] font-black tracking-[-0.04em] text-slate-950">{value}</p>
      <p className="mt-1 text-[12px] text-slate-500">{detail}</p>
    </div>
  );
}

type VehicleRow = {
  id: string;
  year: number;
  trimName: string | null;
  bodyStyle: string | null;
  model: { name: string; vehicleType: string | null; make: { name: string } };
  dimensionProfiles: Array<{
    lengthIn: number | null;
    widthIn: number | null;
    heightIn: number | null;
    totalApproxWrapSqFt: number | null;
    confidenceLevel: VehicleDimensionConfidenceLevel;
  }>;
  photos: Array<{ url: string; altText: string | null }>;
  templates: Array<{ id: string }>;
};

function VehicleCard({ vehicle }: { vehicle: VehicleRow }) {
  const profile = vehicle.dimensionProfiles[0];
  const photo = vehicle.photos[0];
  return (
    <Link href={`/vehicles/${vehicle.id}`} className="overflow-hidden rounded-[22px] border border-white/80 bg-white/90 shadow-[0_20px_60px_rgba(15,23,42,0.09)] transition hover:-translate-y-0.5 hover:shadow-[0_24px_70px_rgba(15,23,42,0.13)]">
      <img src={photo?.url ?? VEHICLE_PLACEHOLDER_SVG} alt={photo?.altText ?? 'Vehicle placeholder'} className="h-44 w-full object-cover" />
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-[16px] font-black tracking-[-0.02em] text-slate-950">{vehicle.year} {vehicle.model.make.name} {vehicle.model.name}</h2>
            <p className="mt-1 text-[13px] font-semibold text-slate-500">{vehicle.trimName ?? 'Base trim'} · {vehicle.bodyStyle ?? vehicle.model.vehicleType ?? 'Body style missing'}</p>
          </div>
          <span className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-blue-700">{formatSqFt(profile?.totalApproxWrapSqFt)}</span>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2 text-[11px]">
          <Mini label="L" value={formatInches(profile?.lengthIn)} />
          <Mini label="W" value={formatInches(profile?.widthIn)} />
          <Mini label="H" value={formatInches(profile?.heightIn)} />
        </div>
        <div className="mt-4 flex flex-wrap gap-1.5">
          <Badge ok={Boolean(photo)} label={photo ? 'Photo' : 'No photo'} />
          <Badge ok={Boolean(profile)} label={profile ? 'Dimensions' : 'No dimensions'} />
          <Badge ok={profile?.confidenceLevel === VehicleDimensionConfidenceLevel.VERIFIED} label={profile?.confidenceLevel === VehicleDimensionConfidenceLevel.VERIFIED ? 'Verified' : 'Unverified'} />
          <Badge ok={vehicle.templates.length > 0} label={vehicle.templates.length > 0 ? 'Template' : 'No template'} />
        </div>
      </div>
    </Link>
  );
}

function VehicleTable({ vehicles }: { vehicles: VehicleRow[] }) {
  return (
    <section className="overflow-hidden rounded-[22px] border border-white/80 bg-white/90 shadow-[0_22px_70px_rgba(15,23,42,0.10)]">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1100px] text-[13px]">
          <thead><tr className="border-b border-slate-100 bg-slate-50/70 text-left text-[11px] uppercase tracking-[0.18em] text-slate-400">
            <th className="px-4 py-3">Photo</th><th>Year</th><th>Make</th><th>Model</th><th>Trim</th><th>Body style</th><th>Length</th><th>Width</th><th>Height</th><th>Wrap sq ft</th><th>Status</th><th>Actions</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {vehicles.map((vehicle) => {
              const profile = vehicle.dimensionProfiles[0];
              const photo = vehicle.photos[0];
              return (
                <tr key={vehicle.id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-3"><img src={photo?.url ?? VEHICLE_PLACEHOLDER_SVG} alt="" className="h-12 w-16 rounded-[10px] object-cover ring-1 ring-slate-200" /></td>
                  <td className="font-bold">{vehicle.year}</td>
                  <td>{vehicle.model.make.name}</td>
                  <td className="font-semibold">{vehicle.model.name}</td>
                  <td>{vehicle.trimName ?? '-'}</td>
                  <td>{vehicle.bodyStyle ?? vehicle.model.vehicleType ?? '-'}</td>
                  <td>{formatInches(profile?.lengthIn)}</td>
                  <td>{formatInches(profile?.widthIn)}</td>
                  <td>{formatInches(profile?.heightIn)}</td>
                  <td className="font-bold text-emerald-700">{formatSqFt(profile?.totalApproxWrapSqFt)}</td>
                  <td><Badge ok={Boolean(photo && profile)} label={photo && profile ? 'Ready' : 'Needs data'} /></td>
                  <td><Link href={`/vehicles/${vehicle.id}`} className="font-bold text-blue-600 hover:underline">Open</Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return <div className="rounded-[12px] bg-slate-50 px-3 py-2"><p className="font-bold text-slate-400">{label}</p><p className="mt-1 font-black text-slate-800">{value}</p></div>;
}

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500'}`}>{label}</span>;
}
