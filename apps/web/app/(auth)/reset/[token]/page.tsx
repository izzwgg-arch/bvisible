import Link from 'next/link';
import { prisma } from '@bvisible/db';
import { AuthCard } from '@/components/auth/auth-card';
import { hashToken } from '@/lib/auth/tokens';
import { ResetForm } from './reset-form';

export const metadata = { title: 'Set a new password' };
export const dynamic = 'force-dynamic';

export default async function ResetPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const valid = await isTokenValid(token);

  if (!valid) {
    return (
      <AuthCard
        title="Reset link no longer valid"
        subtitle="The link you followed has expired or has already been used."
        footer={
          <>
            <Link
              href="/forgot"
              className="font-medium text-[var(--color-bv-accent)] hover:underline"
            >
              Request a new one
            </Link>
          </>
        }
      >
        <p className="text-[13.5px] text-[var(--color-bv-muted)]">
          Reset links expire after 30 minutes and can only be used once.
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Set a new password"
      subtitle="Pick a password at least 12 characters long."
      footer={
        <Link
          href="/login"
          className="font-medium text-[var(--color-bv-accent)] hover:underline"
        >
          Back to sign in
        </Link>
      }
    >
      <ResetForm token={token} />
    </AuthCard>
  );
}

async function isTokenValid(token: string): Promise<boolean> {
  if (!token || token.length < 20 || token.length > 80) return false;
  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { expiresAt: true, usedAt: true },
  });
  if (!row) return false;
  if (row.usedAt) return false;
  if (row.expiresAt.getTime() <= Date.now()) return false;
  return true;
}
