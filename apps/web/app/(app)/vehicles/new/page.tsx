import Link from 'next/link';
import { PageHeader } from '@/components/app-shell';
import { createVehicleAction } from '../actions';
import { VehicleForm } from '../vehicle-form';

export const metadata = { title: 'Add vehicle' };

export default function NewVehiclePage() {
  return (
    <>
      <PageHeader
        title="Add vehicle"
        subtitle="Create a vehicle profile with optional dimensions, wrap-area estimates, source notes, and a licensed photo URL."
        actions={
          <Link href="/vehicles" className="rounded-[12px] border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-semibold text-slate-700 shadow-sm">
            Back to library
          </Link>
        }
      />
      <VehicleForm action={createVehicleAction} submitLabel="Create vehicle" />
    </>
  );
}
