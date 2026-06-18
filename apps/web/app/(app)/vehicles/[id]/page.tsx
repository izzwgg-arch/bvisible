import Link from 'next/link';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { prisma, Role } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { archiveVehicleAction } from '../actions';
import { confidenceLabel, formatInches, formatSqFt, VEHICLE_PLACEHOLDER_SVG } from '@/lib/vehicles/display';

export const metadata = { title: 'Vehicle detail' };
export const dynamic = 'force-dynamic';

export default async function VehicleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireTenantId();
  const { id } = await params;
  const canManage = me.role === Role.ADMIN || me.role === Role.SUPER_ADMIN;
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
      createdAt: true,
      updatedAt: true,
      model: { select: { name: true, bodyClass: true, vehicleType: true, make: { select: { name: true, country: true, logoUrl: true } } } },
      dimensionProfiles: { orderBy: [{ updatedAt: 'desc' }], take: 3 },
      photos: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }] },
      templates: { orderBy: [{ createdAt: 'desc' }] },
    },
  });
  if (!vehicle) notFound();
  const profile = vehicle.dimensionProfiles[0];
  const photo = vehicle.photos[0];
  const name = `${vehicle.year} ${vehicle.model.make.name} ${vehicle.model.name}${vehicle.trimName ? ` ${vehicle.trimName}` : ''}`;

  return (
    <>
      <PageHeader
        title={name}
        subtitle={`${vehicle.bodyStyle ?? vehicle.model.vehicleType ?? 'Vehicle'} profile for estimating wraps, lettering, decals, fleet graphics, and production jobs.`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href="/vehicles" className="rounded-[12px] border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-semibold text-slate-700 shadow-sm">Back</Link>
            {canManage ? <Link href={`/vehicles/${vehicle.id}/edit`} className="rounded-[12px] bg-[var(--color-bv-accent)] px-4 py-2.5 text-[13px] font-bold text-white shadow-[0_16px_34px_rgba(47,90,243,0.24)]">Edit vehicle</Link> : null}
          </div>
        }
      />

      <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="overflow-hidden rounded-[24px] border border-white/80 bg-white/90 shadow-[0_24px_70px_rgba(15,23,42,0.10)]">
          <img src={photo?.url ?? VEHICLE_PLACEHOLDER_SVG} alt={photo?.altText ?? name} className="h-[360px] w-full object-cover" />
          <div className="border-t border-slate-100 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge label={photo ? 'Photo' : 'Missing photo'} tone={photo ? 'emerald' : 'slate'} />
              <Badge label={profile ? 'Dimensions' : 'Missing dimensions'} tone={profile ? 'emerald' : 'slate'} />
              <Badge label={profile ? confidenceLabel(profile.confidenceLevel) : 'Unverified'} tone={profile?.confidenceLevel === 'VERIFIED' ? 'blue' : 'slate'} />
              <Badge label={vehicle.templates.length > 0 ? 'Template attached' : 'No template'} tone={vehicle.templates.length > 0 ? 'emerald' : 'slate'} />
            </div>
            <p className="mt-4 text-[13px] leading-relaxed text-slate-500">
              Wrap square footage is an estimate and can be edited. Public vehicle specs should not be treated as exact production template measurements.
            </p>
          </div>
        </div>

        <div className="grid gap-5">
          <Panel title="Vehicle">
            <Info label="Year" value={String(vehicle.year)} />
            <Info label="Make" value={vehicle.model.make.name} />
            <Info label="Model" value={vehicle.model.name} />
            <Info label="Trim" value={vehicle.trimName ?? 'Missing'} />
            <Info label="Body style" value={vehicle.bodyStyle ?? 'Missing'} />
            <Info label="Vehicle type" value={vehicle.model.vehicleType ?? 'Missing'} />
            <Info label="Doors" value={vehicle.doors?.toString() ?? 'Missing'} />
            <Info label="Drivetrain" value={vehicle.drivetrain ?? 'Missing'} />
            <Info label="Fuel type" value={vehicle.fuelType ?? 'Missing'} />
          </Panel>
          <Panel title="Actions">
            <div className="grid gap-2">
              {canManage ? (
                <>
                  <Link href={`/vehicles/${vehicle.id}/edit`} className={actionClass}>Upload/change photo</Link>
                  <Link href={`/vehicles/${vehicle.id}/edit`} className={actionClass}>Add dimensions or wrap profile</Link>
                  <Link href={`/vehicles/new?duplicate=${vehicle.id}`} className={actionClass}>Duplicate vehicle</Link>
                  <Link href={`/vehicles/${vehicle.id}/edit#templates`} className={actionClass}>Attach template</Link>
                  <form action={archiveVehicleAction.bind(null, vehicle.id)}>
                    <button type="submit" className="w-full rounded-[12px] border border-rose-200 bg-rose-50 px-4 py-2.5 text-[13px] font-bold text-rose-700">Archive vehicle</button>
                  </form>
                </>
              ) : (
                <p className="text-[13px] text-slate-500">You can view and attach vehicles to estimates. Admins manage library records.</p>
              )}
            </div>
          </Panel>
        </div>
      </section>

      <section className="mt-5 grid gap-5 xl:grid-cols-3">
        <Panel title="Dimensions">
          <Info label="Length" value={formatInches(profile?.lengthIn)} />
          <Info label="Width" value={formatInches(profile?.widthIn)} />
          <Info label="Height" value={formatInches(profile?.heightIn)} />
          <Info label="Wheelbase" value={formatInches(profile?.wheelbaseIn)} />
          <Info label="Cargo L/W/H" value={`${formatInches(profile?.cargoLengthIn)} / ${formatInches(profile?.cargoWidthIn)} / ${formatInches(profile?.cargoHeightIn)}`} />
          <Info label="Bed length" value={formatInches(profile?.bedLengthIn)} />
        </Panel>

        <Panel title="Wrap estimate profile">
          <Info label="Full wrap" value={formatSqFt(profile?.totalApproxWrapSqFt)} strong />
          <Info label="Sides" value={formatSqFt(profile?.sideApproxSqFt)} />
          <Info label="Hood" value={formatSqFt(profile?.hoodApproxSqFt)} />
          <Info label="Roof" value={formatSqFt(profile?.roofApproxSqFt)} />
          <Info label="Rear" value={formatSqFt(profile?.rearApproxSqFt)} />
          <Info label="Front" value={formatSqFt(profile?.frontApproxSqFt)} />
        </Panel>

        <Panel title="Source data">
          <Info label="Source" value={profile?.sourceName ?? 'Missing'} />
          <Info label="Confidence" value={profile ? confidenceLabel(profile.confidenceLevel) : 'Missing'} />
          <Info label="Updated" value={vehicle.updatedAt.toISOString().slice(0, 10)} />
          {profile?.sourceUrl ? <a href={profile.sourceUrl} className="mt-3 block text-[13px] font-bold text-blue-600 underline">Open source URL</a> : null}
          {photo?.licenseNote ? <p className="mt-3 text-[12.5px] leading-relaxed text-slate-500">{photo.licenseNote}</p> : null}
        </Panel>
      </section>

      <section className="mt-5 grid gap-5 xl:grid-cols-2">
        <Panel title="Photos">
          {vehicle.photos.length === 0 ? <p className="text-[13px] text-slate-500">No licensed photo saved. Placeholder is shown across the app.</p> : (
            <div className="grid gap-3 sm:grid-cols-2">
              {vehicle.photos.map((p) => <img key={p.id} src={p.url} alt={p.altText ?? name} className="h-32 rounded-[14px] object-cover ring-1 ring-slate-200" />)}
            </div>
          )}
        </Panel>
        <Panel title="Templates">
          {vehicle.templates.length === 0 ? <p className="text-[13px] text-slate-500">No wrap templates attached. Use only licensed or manually uploaded templates.</p> : (
            <ul className="grid gap-2">
              {vehicle.templates.map((template) => (
                <li key={template.id} className="rounded-[14px] border border-slate-200 bg-slate-50 px-3 py-2">
                  <a href={template.fileUrl} className="font-bold text-blue-600 underline">{template.templateName}</a>
                  <p className="text-[12px] text-slate-500">{template.fileType} · {template.sourceName ?? 'Manual source'}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </section>
    </>
  );
}

const actionClass = 'rounded-[12px] border border-slate-200 bg-white px-4 py-2.5 text-center text-[13px] font-bold text-slate-700 shadow-sm transition hover:bg-slate-50';

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-[22px] border border-white/80 bg-white/90 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)]">
      <h2 className="mb-4 text-[15px] font-black tracking-[-0.01em] text-slate-950">{title}</h2>
      <div className="grid gap-2">{children}</div>
    </section>
  );
}

function Info({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-slate-100 py-2 last:border-b-0">
      <span className="text-[12px] font-semibold text-slate-400">{label}</span>
      <span className={`text-right text-[13px] ${strong ? 'font-black text-emerald-700' : 'font-bold text-slate-800'}`}>{value}</span>
    </div>
  );
}

function Badge({ label, tone }: { label: string; tone: 'emerald' | 'blue' | 'slate' }) {
  const cls = tone === 'emerald'
    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
    : tone === 'blue'
      ? 'border-blue-200 bg-blue-50 text-blue-700'
      : 'border-slate-200 bg-slate-50 text-slate-500';
  return <span className={`${cls} rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide`}>{label}</span>;
}
