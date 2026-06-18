import Link from 'next/link';
import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { CreateVendorForm } from './vendor-form';

export const metadata = { title: 'New vendor' };
export const dynamic = 'force-dynamic';

export default async function NewVendorPage() {
  await requireTenantId();
  return (
    <>
      <PageHeader
        title="Add vendor"
        subtitle="Add a supplier you'll be writing POs to."
        actions={
          <Link
            href="/vendors"
            className="inline-flex items-center justify-center rounded-[12px] border border-slate-200 bg-white/90 px-4 py-2.5 text-[13.5px] font-semibold text-slate-700 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:bg-white"
          >
            Cancel
          </Link>
        }
      />
      <div className="max-w-xl overflow-hidden rounded-[22px] border border-white/80 bg-white/90 p-6 shadow-[0_22px_70px_rgba(15,23,42,0.10)] backdrop-blur-xl">
        <p className="mb-5 text-[13px] leading-relaxed text-slate-500">
          Add one or more email addresses and phone numbers. You can always add more from the vendor profile after saving.
        </p>
        <CreateVendorForm />
      </div>
    </>
  );
}
