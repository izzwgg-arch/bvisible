import { headers } from 'next/headers';
import { prisma, Role } from '@bvisible/db';
import { requireRole } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { InviteUserForm } from './invite-user-form';

export const metadata = { title: 'Users' };
export const dynamic = 'force-dynamic';

interface SearchParams {
  invite?: string;
  invitedEmail?: string;
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const me = await requireRole(Role.ADMIN, Role.SUPER_ADMIN);
  const sp = await searchParams;

  // Scope: SUPER_ADMIN sees everyone (cross-tenant). ADMIN sees only
  // their own tenant's users.
  const userWhere = me.role === Role.SUPER_ADMIN ? {} : { tenantId: me.tenantId! };
  const inviteWhere =
    me.role === Role.SUPER_ADMIN
      ? { acceptedAt: null }
      : { tenantId: me.tenantId!, acceptedAt: null };

  const [users, pendingInvites] = await Promise.all([
    prisma.user.findMany({
      where: userWhere,
      orderBy: [{ tenantId: 'asc' }, { email: 'asc' }],
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        disabledAt: true,
        lastLoginAt: true,
        tenant: { select: { name: true, slug: true } },
      },
      take: 200,
    }),
    prisma.userInvite.findMany({
      where: inviteWhere,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        role: true,
        expiresAt: true,
        createdAt: true,
        tenant: { select: { name: true, slug: true } },
      },
      take: 50,
    }),
  ]);

  const inviteLink = sp.invite ? await buildInviteLink(sp.invite) : null;

  return (
    <>
      <PageHeader
        title="Users"
        subtitle={
          me.role === Role.SUPER_ADMIN
            ? 'All users across all tenants.'
            : `Users in ${me.tenant?.name ?? 'your tenant'}.`
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] shadow-[var(--shadow-bv-card)]">
          <div className="border-b border-[var(--color-bv-border)] px-5 py-3">
            <h2 className="text-[15px] font-semibold tracking-tight text-[var(--color-bv-text)]">
              Members
            </h2>
            <p className="mt-0.5 text-[12.5px] text-[var(--color-bv-muted)]">
              {users.length} {users.length === 1 ? 'user' : 'users'}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[var(--color-bv-border)] text-left text-[11.5px] uppercase tracking-wider text-[var(--color-bv-muted)]">
                  <th className="px-5 py-2 font-medium">Email</th>
                  <th className="px-5 py-2 font-medium">Name</th>
                  {me.role === Role.SUPER_ADMIN ? (
                    <th className="px-5 py-2 font-medium">Tenant</th>
                  ) : null}
                  <th className="px-5 py-2 font-medium">Role</th>
                  <th className="px-5 py-2 font-medium">Status</th>
                  <th className="px-5 py-2 font-medium">Last login</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-[var(--color-bv-border)] last:border-b-0">
                    <td className="px-5 py-2.5 text-[var(--color-bv-text)]">{u.email}</td>
                    <td className="px-5 py-2.5 text-[var(--color-bv-text)]">{u.name || '—'}</td>
                    {me.role === Role.SUPER_ADMIN ? (
                      <td className="px-5 py-2.5 text-[var(--color-bv-muted)]">
                        {u.tenant?.name ?? '— (system)'}
                      </td>
                    ) : null}
                    <td className="px-5 py-2.5 text-[var(--color-bv-muted)]">{u.role}</td>
                    <td className="px-5 py-2.5">
                      <StatusBadge disabled={!!u.disabledAt} />
                    </td>
                    <td className="px-5 py-2.5 text-[var(--color-bv-muted)]">
                      {u.lastLoginAt ? formatDate(u.lastLoginAt) : '—'}
                    </td>
                  </tr>
                ))}
                {users.length === 0 ? (
                  <tr>
                    <td
                      colSpan={me.role === Role.SUPER_ADMIN ? 6 : 5}
                      className="px-5 py-8 text-center text-[var(--color-bv-muted)]"
                    >
                      No users yet. Invite someone from the right.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {pendingInvites.length > 0 ? (
            <div className="border-t border-[var(--color-bv-border)] px-5 py-3">
              <h3 className="text-[13px] font-semibold text-[var(--color-bv-text)]">
                Pending invites
              </h3>
              <ul className="mt-2 flex flex-col gap-1 text-[12.5px] text-[var(--color-bv-muted)]">
                {pendingInvites.map((inv) => (
                  <li key={inv.id} className="flex items-center justify-between">
                    <span>
                      {inv.email} · {inv.role}
                      {me.role === Role.SUPER_ADMIN && inv.tenant ? ` · ${inv.tenant.name}` : ''}
                    </span>
                    <span>expires {formatDate(inv.expiresAt)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <section className="rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-5 shadow-[var(--shadow-bv-card)]">
          <h2 className="text-[15px] font-semibold tracking-tight text-[var(--color-bv-text)]">
            Invite a user
          </h2>
          <p className="mt-1 text-[12.5px] text-[var(--color-bv-muted)]">
            {me.role === Role.SUPER_ADMIN && !me.tenantId
              ? 'Pick a tenant first under Tenants. Or set yourself a tenant context.'
              : 'They will get an invite link valid for 7 days.'}
          </p>
          <div className="mt-4">
            <InviteUserForm canChooseAdmin={me.role === Role.SUPER_ADMIN || me.role === Role.ADMIN} />
          </div>
          {sp.invite && inviteLink ? (
            <div className="mt-5 flex flex-col gap-2 rounded-[8px] border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-[12.5px] font-medium text-emerald-900">
                Invite link for {sp.invitedEmail ?? 'the new user'} (email is not yet wired — copy and send manually):
              </p>
              <code className="break-all rounded-md border border-emerald-300 bg-white px-2 py-1 font-mono text-[11.5px] text-emerald-900">
                {inviteLink}
              </code>
            </div>
          ) : null}
        </section>
      </div>
    </>
  );
}

function StatusBadge({ disabled }: { disabled: boolean }) {
  if (disabled) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11.5px] font-medium text-amber-800">
        Disabled
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11.5px] font-medium text-emerald-700">
      Active
    </span>
  );
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

async function buildInviteLink(token: string): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost';
  const proto = (h.get('x-forwarded-proto') ?? 'http').split(',')[0]?.trim() ?? 'http';
  return `${proto}://${host}/invite/${encodeURIComponent(token)}`;
}
