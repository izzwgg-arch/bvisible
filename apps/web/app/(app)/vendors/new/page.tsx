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
        title="New vendor"
        subtitle="Add a supplier you'll be writing POs to."
        actions={
          <Link
            href="/vendors"
            className="inline-flex items-center justify-center rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3.5 py-2 text-[13.5px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
          >
            Cancel
          </Link>
        }
      />
      <section className="max-w-xl rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-6 shadow-[var(--shadow-bv-card)]">
        <CreateVendorForm />
      </section>
    </>
  );
}
