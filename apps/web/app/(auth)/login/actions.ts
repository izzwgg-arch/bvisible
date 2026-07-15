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

function safeNextPath(raw: FormDataEntryValue | null): string | undefined {
  if (typeof raw !== 'string') return undefined;
  return raw.startsWith('/') && !raw.startsWith('//') ? raw : undefined;
}

async function performLogin(
  email: string,
  password: string,
  next: string | undefined,
): Promise<LoginState> {
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

  redirect(next ?? '/home');
}

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

  return performLogin(parsed.data.email, parsed.data.password, parsed.data.next);
}

/** One-click local sign-in. Disabled in production; credentials live in server env only. */
export async function devLoginAction(
  _prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  if (process.env.NODE_ENV !== 'development') {
    return { error: 'Dev login is not available.', email: '' };
  }

  const email = process.env.DEV_LOGIN_EMAIL?.trim().toLowerCase();
  const password = process.env.DEV_LOGIN_PASSWORD;
  if (!email || !password) {
    return {
      error: 'Set DEV_LOGIN_EMAIL and DEV_LOGIN_PASSWORD in apps/web/.env.local.',
      email: '',
    };
  }

  return performLogin(email, password, safeNextPath(formData.get('next')));
}

export async function loginFormAction(
  prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  if (formData.get('intent') === 'dev') return devLoginAction(prev, formData);
  return loginAction(prev, formData);
}
