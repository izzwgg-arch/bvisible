import Link from 'next/link';
import { requireRoleWithEffectiveCompany } from '@/lib/auth/current-user';
import { Role } from '@bvisible/db';
import { PageHeader } from '@/components/app-shell';
import { CreateShopMaterialItemForm } from './create-item-form';

export const metadata = { title: 'New item' };
export const dynamic = 'force-dynamic';

export default async function NewItemPage() {
  await requireRoleWithEffectiveCompany(Role.ADMIN, Role.SUPER_ADMIN);

  return (
    <>
      <PageHeader
        title="New item"
        subtitle="Create a managed material used for estimates and vendor price tracking."
        actions={
          <Link
            href="/items"
            className="inline-flex items-center justify-center rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3.5 py-2 text-[13.5px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
          >
            Cancel
          </Link>
        }
      />
      <section className="max-w-xl rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-6 shadow-[var(--shadow-bv-card)]">
        <CreateShopMaterialItemForm />
      </section>
    </>
  );
}
