import { headers } from 'next/headers';
import { prisma, Role } from '@bvisible/db';
import { requireRole } from '@/lib/auth/current-user';
import { resolveEffectiveCompany } from '@/lib/auth/effective-company';
import { PageHeader } from '@/components/app-shell';
import { AdminMetric, AdminPanel, AdminPill } from '@/components/app/admin-ui';
import { InviteUserForm } from './invite-user-form';
import { resendInviteAction } from './actions';

export const metadata = { title: 'Users' };
export const dynamic = 'force-dynamic';

interface SearchParams {
  invite?: string;
  invitedEmail?: string;
  sent?: string;
  resent?: string;
  mailErr?: string;
  inviteErr?: string;
}

const MAIL_ERR_LABELS: Record<string, string> = {
  no_config: 'SMTP is not configured. Set SMTP_HOST/PORT/USER/PASSWORD/FROM in /opt/bvisible/shared/env/.env, then redeploy.',
  connect: 'Could not reach the SMTP server. Check SMTP_HOST and SMTP_PORT.',
  auth: 'SMTP rejected our credentials. Check SMTP_USER and SMTP_PASSWORD.',
  timeout: 'SMTP server did not respond in time.',
  recipient: 'The SMTP server rejected the recipient address.',
  sender: 'The SMTP server rejected the sender address (likely SPF or DKIM).',
  unknown: 'SMTP delivery failed. See the email-test page in Settings for details.',
};

const INVITE_ERR_LABELS: Record<string, string> = {
  missing: 'Could not resend the invite because the invite id was missing.',
  not_found: 'That pending invite could not be found. It may have already been accepted or removed.',
  accepted: 'That invite has already been accepted.',
};

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const me = await requireRole(Role.ADMIN, Role.SUPER_ADMIN);
  const eff = await resolveEffectiveCompany(me);
  const sp = await searchParams;

  // Scope: SUPER_ADMIN sees everyone (all companies). ADMIN sees only their company.
  const userWhere = me.role === Role.SUPER_ADMIN ? {} : { tenantId: eff.tenantId };
  const inviteWhere =
    me.role === Role.SUPER_ADMIN
      ? { acceptedAt: null }
      : { tenantId: eff.tenantId, acceptedAt: null };

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
  const mailErrMessage = sp.mailErr ? MAIL_ERR_LABELS[sp.mailErr] ?? MAIL_ERR_LABELS.unknown : null;
  const inviteErrMessage = sp.inviteErr ? INVITE_ERR_LABELS[sp.inviteErr] ?? INVITE_ERR_LABELS.not_found : null;
  const activeUsers = users.filter((u) => !u.disabledAt).length;
  const adminUsers = users.filter((u) => u.role === Role.ADMIN || u.role === Role.SUPER_ADMIN).length;
  const recentLoginUsers = users.filter((u) => {
    if (!u.lastLoginAt) return false;
    return Date.now() - u.lastLoginAt.getTime() < 1000 * 60 * 60 * 24 * 30;
  }).length;

  return (
    <>
      <PageHeader
        title="Users"
        subtitle={
          me.role === Role.SUPER_ADMIN
            ? 'Modern access control for every company, role, invite, and operator account.'
            : `Access control for ${eff.tenant.name}: operators, admins, and pending invitations.`
        }
      />

      <div className="grid gap-5">
        <section className="grid gap-3 md:grid-cols-4">
          <AdminMetric label="Members" value={users.length} detail={`${activeUsers} active accounts`} />
          <AdminMetric label="Admins" value={adminUsers} detail="Can manage sensitive workflows" tone="violet" />
          <AdminMetric label="Recent logins" value={recentLoginUsers} detail="Signed in during the last 30 days" tone="emerald" />
          <AdminMetric label="Pending invites" value={pendingInvites.length} detail="Expire after seven days" tone="amber" />
        </section>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <AdminPanel
            title="Member directory"
            eyebrow="Access control"
            description="Operators and admins formatted for fast review, audit, and invite follow-up."
            action={<AdminPill tone="blue">{me.role === Role.SUPER_ADMIN ? 'All companies' : eff.tenant.name}</AdminPill>}
          >
            <div className="grid gap-3 p-4">
              {users.length === 0 ? (
                <div className="rounded-[18px] border border-dashed border-slate-200 bg-slate-50/70 px-5 py-8 text-center text-[13px] text-slate-500">
                  No users yet. Invite someone from the panel on the right.
                </div>
              ) : (
                users.map((u) => (
                  <article
                    key={u.id}
                    className="grid gap-4 rounded-[18px] border border-slate-100 bg-white px-4 py-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-100 hover:shadow-[0_18px_42px_rgba(15,23,42,0.08)] md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)_140px_150px]"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-blue-50 text-[13px] font-semibold text-blue-700 ring-1 ring-blue-100">
                          {initials(u.name || u.email)}
                        </div>
                        <div className="min-w-0">
                          <h3 className="truncate text-[14px] font-semibold text-slate-950">{u.name || 'Unnamed user'}</h3>
                          <p className="truncate text-[12.5px] text-slate-500">{u.email}</p>
                        </div>
                      </div>
                    </div>
                    <div className="min-w-0 text-[12.5px] text-slate-500">
                      <div className="font-medium text-slate-700">{roleLabel(u.role)}</div>
                      {me.role === Role.SUPER_ADMIN ? (
                        <div className="mt-1 truncate">{u.tenant?.name ?? 'System account'}</div>
                      ) : null}
                    </div>
                    <div>
                      <StatusBadge disabled={!!u.disabledAt} />
                    </div>
                    <div className="text-[12px] text-slate-500 tabular-nums">
                      {u.lastLoginAt ? `Last login ${formatDate(u.lastLoginAt)}` : 'No login yet'}
                    </div>
                  </article>
                ))
              )}
            </div>
            {pendingInvites.length > 0 ? (
              <div className="border-t border-slate-100 bg-slate-50/70 px-5 py-4">
                <h3 className="text-[13px] font-semibold text-slate-950">Pending invites</h3>
                <div className="mt-3 grid gap-2">
                  {pendingInvites.map((inv) => (
                    <div key={inv.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-slate-100 bg-white px-3 py-2 text-[12.5px]">
                      <span className="min-w-0 truncate font-medium text-slate-800">
                        {inv.email} · {roleLabel(inv.role)}
                        {me.role === Role.SUPER_ADMIN && inv.tenant ? ` · ${inv.tenant.name}` : ''}
                      </span>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-slate-500">expires {formatDate(inv.expiresAt)}</span>
                        <form action={resendInviteAction}>
                          <input type="hidden" name="inviteId" value={inv.id} />
                          <button
                            type="submit"
                            className="rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-orange-700 transition hover:border-orange-300 hover:bg-orange-100"
                          >
                            Re-invite
                          </button>
                        </form>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </AdminPanel>

          <AdminPanel
            title="Invite a user"
            eyebrow="Team growth"
            description={`Invited users join ${eff.tenant.name}. Links expire seven days after send.`}
          >
            <div className="p-5">
              <InviteUserForm canChooseAdmin={me.role === Role.SUPER_ADMIN || me.role === Role.ADMIN} />
              {sp.sent && !sp.mailErr ? (
                <div className="mt-5 rounded-[16px] border border-emerald-200 bg-emerald-50 p-4">
                  <p className="text-[12.5px] font-semibold text-emerald-900">
                    Invite email sent to {sp.sent}. Link expires in 7 days.
                  </p>
                </div>
              ) : null}
              {sp.resent && !sp.mailErr ? (
                <div className="mt-5 rounded-[16px] border border-emerald-200 bg-emerald-50 p-4">
                  <p className="text-[12.5px] font-semibold text-emerald-900">
                    Invite email re-sent to {sp.resent}. The link now expires in 7 days.
                  </p>
                </div>
              ) : null}
              {inviteErrMessage ? (
                <div className="mt-5 rounded-[16px] border border-rose-200 bg-rose-50 p-4">
                  <p className="text-[12.5px] font-semibold text-rose-900">{inviteErrMessage}</p>
                </div>
              ) : null}
              {sp.invite && inviteLink && mailErrMessage ? (
                <div className="mt-5 flex flex-col gap-2 rounded-[16px] border border-amber-200 bg-amber-50 p-4">
                  <p className="text-[12.5px] font-semibold text-amber-900">
                    Email delivery failed for {sp.invitedEmail ?? 'the new user'}. Copy this invite link and deliver it manually.
                  </p>
                  <p className="text-[12px] text-amber-800">{mailErrMessage}</p>
                  <code className="break-all rounded-md border border-amber-300 bg-white px-2 py-1 font-mono text-[11.5px] text-amber-900">
                    {inviteLink}
                  </code>
                </div>
              ) : null}
            </div>
          </AdminPanel>
        </div>
      </div>
    </>
  );
}

function StatusBadge({ disabled }: { disabled: boolean }) {
  if (disabled) {
    return <AdminPill tone="amber">Disabled</AdminPill>;
  }
  return <AdminPill tone="emerald">Active</AdminPill>;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 16).replace('T', ' ');
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

async function buildInviteLink(token: string): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost';
  const proto = (h.get('x-forwarded-proto') ?? 'http').split(',')[0]?.trim() ?? 'http';
  return `${proto}://${host}/invite/${encodeURIComponent(token)}`;
}

function initials(name: string) {
  return name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
