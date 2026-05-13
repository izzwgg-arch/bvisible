'use server';

import { redirect } from 'next/navigation';
import { prisma } from '@bvisible/db';
import { loginSchema } from '@/lib/validators';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { createSession } from '@/lib/auth/session';
import { writeAuditLog } from '@/lib/auth/audit';
import { isLockedForEmail } from '@/lib/auth/rate-limit';
import { readRequestContext } from '@/lib/request-context';

export interface LoginState {
  error: string | null;
  email?: string;
}

const GENERIC_INVALID = 'Invalid email or password.';
const LOCKED_OUT = 'Too many failed attempts. Try again in a few minutes.';

export async function loginAction(
  _prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    next: formData.get('next') ?? undefined,
  });

  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? GENERIC_INVALID,
      email: typeof formData.get('email') === 'string' ? String(formData.get('email')) : '',
    };
  }

  const { email, password, next } = parsed.data;
  const ctx = await readRequestContext();

  if (await isLockedForEmail(email)) {
    return { error: LOCKED_OUT, email };
  }

  const user = await prisma.user.findFirst({
    where: { email },
    select: {
      id: true,
      email: true,
      tenantId: true,
      passwordHash: true,
      disabledAt: true,
    },
  });

  // Constant-time-ish: when the user doesn't exist or has no hash yet
  // (invited but never accepted), do a real argon2id hashPassword() of
  // the submitted password. It takes ~the same time as verifyPassword(),
  // so response time does not leak whether the email is registered.
  let passOk = false;
  if (user?.passwordHash) {
    passOk = await verifyPassword(password, user.passwordHash);
  } else {
    await hashPassword(password);
  }

  if (!user || !passOk || !user.passwordHash) {
    await writeAuditLog({
      action: 'login_failure',
      userId: user?.id ?? null,
      tenantId: user?.tenantId ?? null,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { email, reason: !user ? 'unknown_email' : 'bad_password' },
    });
    return { error: GENERIC_INVALID, email };
  }

  if (user.disabledAt) {
    await writeAuditLog({
      action: 'login_failure',
      userId: user.id,
      tenantId: user.tenantId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { email, reason: 'disabled' },
    });
    return { error: GENERIC_INVALID, email };
  }

  await createSession({
    userId: user.id,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });
  await writeAuditLog({
    action: 'login_success',
    userId: user.id,
    tenantId: user.tenantId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
  });

  // Same-origin relative path only. Re-validate here in case a future
  // call site bypasses the page-level check.
  const target = next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
  redirect(target);
}
