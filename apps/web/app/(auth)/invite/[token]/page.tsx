import Link from 'next/link';
import { prisma } from '@bvisible/db';
import { AuthCard } from '@/components/auth/auth-card';
import { hashToken } from '@/lib/auth/tokens';
import { InviteForm } from './invite-form';

export const metadata = { title: 'Accept invite' };
export const dynamic = 'force-dynamic';

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invite = await loadInvite(token);

  if (!invite) {
    return (
      <AuthCard
        title="Invite no longer valid"
        subtitle="This invite has expired or has already been accepted."
        footer={
          <Link
            href="/login"
            className="font-medium text-[var(--color-bv-accent)] hover:underline"
          >
            Sign in instead
          </Link>
        }
      >
        <p className="text-[13.5px] text-[var(--color-bv-muted)]">
          Ask your admin to send a new invite.
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Set up your account"
      subtitle={`You were invited as ${invite.role.toLowerCase()}${invite.tenantName ? ' for ' + invite.tenantName : ''}.`}
    >
      <div className="text-[13.5px] text-[var(--color-bv-muted)]">
        Email:{' '}
        <span className="font-medium text-[var(--color-bv-text)]">
          {invite.email}
        </span>
      </div>
      <InviteForm token={token} />
    </AuthCard>
  );
}

async function loadInvite(token: string) {
  if (!token || token.length < 20 || token.length > 80) return null;
  const row = await prisma.userInvite.findUnique({
    where: { tokenHash: hashToken(token) },
    select: {
      id: true,
      email: true,
      role: true,
      tenantId: true,
      acceptedAt: true,
      expiresAt: true,
      tenant: { select: { name: true } },
    },
  });
  if (!row) return null;
  if (row.acceptedAt) return null;
  if (row.expiresAt.getTime() <= Date.now()) return null;
  return {
    email: row.email,
    role: row.role,
    tenantName: row.tenant?.name ?? null,
  };
}
