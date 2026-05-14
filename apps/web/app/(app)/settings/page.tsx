import { requireUser } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { ChangePasswordForm } from './change-password-form';
import { logoutAction } from './actions';
import { Role } from '@bvisible/db';

export const metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const user = await requireUser();

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Manage your account."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-5 shadow-[var(--shadow-bv-card)]">
          <h2 className="text-[15px] font-semibold tracking-tight text-[var(--color-bv-text)]">
            Account
          </h2>
          <dl className="mt-4 grid grid-cols-[120px_1fr] gap-y-2 text-[13.5px]">
            <dt className="text-[var(--color-bv-muted)]">Name</dt>
            <dd className="text-[var(--color-bv-text)]">{user.name || '—'}</dd>
            <dt className="text-[var(--color-bv-muted)]">Email</dt>
            <dd className="text-[var(--color-bv-text)]">{user.email}</dd>
            <dt className="text-[var(--color-bv-muted)]">Company</dt>
            <dd className="text-[var(--color-bv-text)]">{user.tenant?.name ?? '— (system)'}</dd>
            <dt className="text-[var(--color-bv-muted)]">Role</dt>
            <dd className="text-[var(--color-bv-text)]">{roleLabel(user.role)}</dd>
          </dl>
          <form action={logoutAction} className="mt-6">
            <button
              type="submit"
              className="inline-flex items-center justify-center rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-bg)] px-3.5 py-2 text-[13.5px] font-medium text-[var(--color-bv-text)] transition-colors hover:bg-[var(--color-bv-surface)]"
            >
              Sign out
            </button>
          </form>
        </section>

        <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-5 shadow-[var(--shadow-bv-card)]">
          <h2 className="text-[15px] font-semibold tracking-tight text-[var(--color-bv-text)]">
            Change password
          </h2>
          <p className="mt-1 text-[13px] text-[var(--color-bv-muted)]">
            Changing your password signs you out of all other sessions.
          </p>
          <div className="mt-4">
            <ChangePasswordForm />
          </div>
        </section>
      </div>
    </>
  );
}

function roleLabel(role: Role): string {
  switch (role) {
    case Role.SUPER_ADMIN:
      return 'Super admin';
    case Role.ADMIN:
      return 'Admin';
    case Role.USER:
      return 'User';
  }
}
