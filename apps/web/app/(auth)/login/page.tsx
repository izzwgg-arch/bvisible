import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthCard } from '@/components/auth/auth-card';
import { LoginForm } from '@/components/auth/login-form';
import { getCurrentUser } from '@/lib/auth/current-user';

export const metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

interface SearchParams {
  next?: string;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const user = await getCurrentUser();
  if (user) redirect('/dashboard');

  const { next } = await searchParams;
  // Only allow same-origin relative paths in `next` to prevent open-redirect.
  const safeNext = next && next.startsWith('/') && !next.startsWith('//') ? next : undefined;
  const devLoginEmail =
    process.env.NODE_ENV === 'development'
      ? process.env.DEV_LOGIN_EMAIL?.trim() || undefined
      : undefined;

  return (
    <AuthCard
      title="Sign in to B Visible"
      subtitle="Enter the email and password your admin gave you."
      footer={
        <>
          Forgot your password?{' '}
          <Link
            href="/forgot"
            className="font-medium text-[var(--color-bv-accent)] hover:underline"
          >
            Reset it
          </Link>
        </>
      }
    >
      <LoginForm next={safeNext} devLoginEmail={devLoginEmail} />
    </AuthCard>
  );
}
