'use client';

import { useActionState } from 'react';
import type { ReactNode } from 'react';
import { VehicleDimensionConfidenceLevel } from '@bvisible/db';
import { SelectControl } from '@/components/app/select-control';
import type { VehicleFormState } from './actions';

type VehicleFormAction = (prev: VehicleFormState, formData: FormData) => Promise<VehicleFormState>;

export interface VehicleFormInitial {
  year?: number | null;
  make?: string | null;
  model?: string | null;
  trim?: string | null;
  bodyStyle?: string | null;
  vehicleType?: string | null;
  doors?: number | null;
  drivetrain?: string | null;
  fuelType?: string | null;
  engine?: string | null;
  transmission?: string | null;
  lengthIn?: number | null;
  widthIn?: number | null;
  heightIn?: number | null;
  wheelbaseIn?: number | null;
  curbWeightLb?: number | null;
  grossWeightLb?: number | null;
  cargoLengthIn?: number | null;
  cargoWidthIn?: number | null;
  cargoHeightIn?: number | null;
  bedLengthIn?: number | null;
  roofLengthIn?: number | null;
  roofWidthIn?: number | null;
  hoodLengthIn?: number | null;
  hoodWidthIn?: number | null;
  sideApproxSqFt?: number | null;
  roofApproxSqFt?: number | null;
  hoodApproxSqFt?: number | null;
  rearApproxSqFt?: number | null;
  frontApproxSqFt?: number | null;
  totalApproxWrapSqFt?: number | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
  confidenceLevel?: VehicleDimensionConfidenceLevel | null;
  photoUrl?: string | null;
  photoAltText?: string | null;
  photoSourceName?: string | null;
  photoSourceUrl?: string | null;
  photoLicenseNote?: string | null;
  notes?: string | null;
}

export function VehicleForm({
  action,
  submitLabel,
  initial = {},
}: {
  action: VehicleFormAction;
  submitLabel: string;
  initial?: VehicleFormInitial;
}) {
  const [state, formAction, pending] = useActionState(action, { error: null });
  return (
    <form action={formAction} className="grid gap-5">
      {state.error ? (
        <div className="rounded-[14px] border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] font-semibold text-rose-800">
          {state.error}
        </div>
      ) : null}

      <Panel title="Vehicle identity" detail="Make/model data is required; trim and measurements can be filled later.">
        <div className="grid gap-4 md:grid-cols-4">
          <Field name="year" label="Year" type="number" defaultValue={initial.year} />
          <Field name="make" label="Make" required defaultValue={initial.make} />
          <Field name="model" label="Model" required defaultValue={initial.model} />
          <Field name="trim" label="Trim" defaultValue={initial.trim} />
          <Field name="bodyStyle" label="Body style" defaultValue={initial.bodyStyle} />
          <Field name="vehicleType" label="Vehicle type" defaultValue={initial.vehicleType} />
          <Field name="doors" label="Doors" type="number" defaultValue={initial.doors} />
          <Field name="drivetrain" label="Drivetrain" defaultValue={initial.drivetrain} />
          <Field name="fuelType" label="Fuel type" defaultValue={initial.fuelType} />
          <Field name="engine" label="Engine" defaultValue={initial.engine} />
          <Field name="transmission" label="Transmission" defaultValue={initial.transmission} />
        </div>
      </Panel>

      <Panel title="Dimensions" detail="Optional specs used for estimating. They are not production template measurements.">
        <div className="grid gap-4 md:grid-cols-4">
          <Field name="lengthIn" label="Length" type="number" step="0.1" defaultValue={initial.lengthIn} />
          <Field name="widthIn" label="Width" type="number" step="0.1" defaultValue={initial.widthIn} />
          <Field name="heightIn" label="Height" type="number" step="0.1" defaultValue={initial.heightIn} />
          <Field name="wheelbaseIn" label="Wheelbase" type="number" step="0.1" defaultValue={initial.wheelbaseIn} />
          <Field name="curbWeightLb" label="Curb weight lb" type="number" step="1" defaultValue={initial.curbWeightLb} />
          <Field name="grossWeightLb" label="Gross weight lb" type="number" step="1" defaultValue={initial.grossWeightLb} />
          <Field name="cargoLengthIn" label="Cargo length" type="number" step="0.1" defaultValue={initial.cargoLengthIn} />
          <Field name="cargoWidthIn" label="Cargo width" type="number" step="0.1" defaultValue={initial.cargoWidthIn} />
          <Field name="cargoHeightIn" label="Cargo height" type="number" step="0.1" defaultValue={initial.cargoHeightIn} />
          <Field name="bedLengthIn" label="Bed length" type="number" step="0.1" defaultValue={initial.bedLengthIn} />
          <Field name="roofLengthIn" label="Roof length" type="number" step="0.1" defaultValue={initial.roofLengthIn} />
          <Field name="roofWidthIn" label="Roof width" type="number" step="0.1" defaultValue={initial.roofWidthIn} />
          <Field name="hoodLengthIn" label="Hood length" type="number" step="0.1" defaultValue={initial.hoodLengthIn} />
          <Field name="hoodWidthIn" label="Hood width" type="number" step="0.1" defaultValue={initial.hoodWidthIn} />
        </div>
      </Panel>

      <Panel title="Wrap estimate profile" detail="Wrap square footage is an estimate and can be edited.">
        <div className="grid gap-4 md:grid-cols-3">
          <Field name="totalApproxWrapSqFt" label="Total wrap sq ft" type="number" step="0.1" defaultValue={initial.totalApproxWrapSqFt} />
          <Field name="sideApproxSqFt" label="Sides sq ft" type="number" step="0.1" defaultValue={initial.sideApproxSqFt} />
          <Field name="roofApproxSqFt" label="Roof sq ft" type="number" step="0.1" defaultValue={initial.roofApproxSqFt} />
          <Field name="hoodApproxSqFt" label="Hood sq ft" type="number" step="0.1" defaultValue={initial.hoodApproxSqFt} />
          <Field name="rearApproxSqFt" label="Rear sq ft" type="number" step="0.1" defaultValue={initial.rearApproxSqFt} />
          <Field name="frontApproxSqFt" label="Front sq ft" type="number" step="0.1" defaultValue={initial.frontApproxSqFt} />
        </div>
      </Panel>

      <Panel title="Photo and source" detail="Only store photo URLs when licensing allows it; otherwise the UI shows a placeholder.">
        <div className="grid gap-4 md:grid-cols-2">
          <Field name="photoUrl" label="Primary photo URL" type="url" defaultValue={initial.photoUrl} />
          <Field name="photoAltText" label="Photo alt text" defaultValue={initial.photoAltText} />
          <Field name="photoSourceName" label="Photo source" defaultValue={initial.photoSourceName} />
          <Field name="photoSourceUrl" label="Photo source URL" type="url" defaultValue={initial.photoSourceUrl} />
          <Field name="photoLicenseNote" label="Photo license note" defaultValue={initial.photoLicenseNote} />
          <Field name="sourceName" label="Dimension source" defaultValue={initial.sourceName} />
          <Field name="sourceUrl" label="Dimension source URL" type="url" defaultValue={initial.sourceUrl} />
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Confidence</span>
            <SelectControl name="confidenceLevel" defaultValue={initial.confidenceLevel ?? VehicleDimensionConfidenceLevel.MANUAL} className={inputClass}>
              {Object.values(VehicleDimensionConfidenceLevel).map((level) => (
                <option key={level} value={level}>{level.toLowerCase()}</option>
              ))}
            </SelectControl>
          </label>
        </div>
        <label className="mt-4 flex flex-col gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Internal notes</span>
          <textarea name="notes" rows={4} defaultValue={initial.notes ?? ''} className={inputClass} />
        </label>
      </Panel>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending}
          className="rounded-[12px] bg-[var(--color-bv-accent)] px-5 py-3 text-[13.5px] font-bold text-white shadow-[0_16px_34px_rgba(47,90,243,0.24)] transition hover:-translate-y-0.5 disabled:opacity-60"
        >
          {pending ? 'Saving...' : submitLabel}
        </button>
      </div>
    </form>
  );
}

const inputClass = 'rounded-[12px] border border-slate-200 bg-white px-3 py-2.5 text-[13px] font-semibold text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10';

function Panel({ title, detail, children }: { title: string; detail: string; children: ReactNode }) {
  return (
    <section className="rounded-[22px] border border-white/80 bg-white/90 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.08)] backdrop-blur-xl">
      <div className="mb-4">
        <h2 className="text-[15px] font-bold text-slate-950">{title}</h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-slate-500">{detail}</p>
      </div>
      {children}
    </section>
  );
}

function Field({
  name,
  label,
  type = 'text',
  step,
  required = false,
  defaultValue,
}: {
  name: string;
  label: string;
  type?: string;
  step?: string;
  required?: boolean;
  defaultValue?: string | number | null;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</span>
      <input
        name={name}
        type={type}
        step={step}
        required={required}
        defaultValue={defaultValue ?? ''}
        className={inputClass}
      />
    </label>
  );
}
