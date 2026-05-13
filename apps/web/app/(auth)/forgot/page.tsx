import Link from 'next/link';
import { AuthCard } from '@/components/auth/auth-card';
import { ForgotForm } from './forgot-form';

export const metadata = { title: 'Reset password' };
export const dynamic = 'force-dynamic';

export default function ForgotPage() {
  return (
    <AuthCard
      title="Reset your password"
      subtitle="Enter the email on your account. If it exists, a reset link will be issued."
      footer={
        <>
          Remembered it?{' '}
          <Link
            href="/login"
            className="font-medium text-[var(--color-bv-accent)] hover:underline"
          >
            Sign in
          </Link>
        </>
      }
    >
      <ForgotForm />
    </AuthCard>
  );
}
