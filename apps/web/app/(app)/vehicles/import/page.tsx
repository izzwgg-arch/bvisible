import Link from 'next/link';
import { PageHeader } from '@/components/app-shell';
import { VehicleImportClient } from './vehicle-import-client';

export const metadata = { title: 'Import vehicles' };

export default function VehicleImportPage() {
  return (
    <>
      <PageHeader
        title="Import vehicles"
        subtitle="Upload CSV or JSON vehicle metadata. Bad rows are skipped, imports are idempotent, and photo/template licensing remains manual."
        actions={
          <Link href="/vehicles" className="rounded-[12px] border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-semibold text-slate-700 shadow-sm">
            Back to library
          </Link>
        }
      />
      <VehicleImportClient />
    </>
  );
}
