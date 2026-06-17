'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@bvisible/db';
import { requireSuperAdmin } from '@/lib/auth/current-user';
import { writeAuditLog } from '@/lib/auth/audit';
import { readRequestContext } from '@/lib/request-context';
import { sealSecret, openSecret } from '@/lib/email-ingest/crypto';
import { saveSmtpConfigSchema, testSmtpConfigSchema } from '@/lib/validators';
import { verifySmtpCredentials, clearTransportCache, smtpConfigSchema } from '@/lib/mailer';

export interface SaveSmtpConfigResult {
  ok: boolean;
  error: string | null;
}

export async function saveSmtpConfigAction(
  payload: unknown
): Promise<SaveSmtpConfigResult> {
  const me = await requireSuperAdmin();
  const ctx = await readRequestContext();

  const parsed = saveSmtpConfigSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const data = parsed.data;

  const existing = await prisma.smtpConfig.findFirst({ select: { id: true, passwordCipher: true } });

  if (!existing && !data.password) {
    return { ok: false, error: 'Password is required on first save.' };
  }

  let passwordCipher: string;
  try {
    if (data.password) {
      passwordCipher = sealSecret(data.password).cipherText;
    } else {
      passwordCipher = existing!.passwordCipher;
    }
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error && err.message.includes('INGEST_SECRET')
          ? 'INGEST_SECRET is not set on the server — required to encrypt the SMTP password.'
          : 'Could not encrypt the SMTP password.',
    };
  }

  if (existing) {
    await prisma.smtpConfig.update({
      where: { id: existing.id },
      data: {
        host: data.host,
        port: data.port,
        secure: data.secure,
        user: data.user,
        passwordCipher,
        from: data.from,
        replyTo: data.replyTo ?? null,
      },
    });
  } else {
    await prisma.smtpConfig.create({
      data: {
        host: data.host,
        port: data.port,
        secure: data.secure,
        user: data.user,
        passwordCipher,
        from: data.from,
        replyTo: data.replyTo ?? null,
      },
    });
  }

  // Flush the nodemailer transport pool so the next send picks up the
  // new credentials without waiting for a PM2 reload.
  clearTransportCache();

  await writeAuditLog({
    action: 'smtp_config_saved',
    userId: me.id,
    tenantId: null,
    targetType: 'smtp_config',
    targetId: 'global',
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: {
      host: data.host,
      port: data.port,
      secure: data.secure,
      created: !existing,
      passwordRotated: Boolean(data.password),
    },
  });

  revalidatePath('/settings/email-test');
  return { ok: true, error: null };
}

export interface TestSmtpConfigResult {
  ok: boolean;
  error: string | null;
  durationMs: number | null;
}

export async function testSmtpConfigAction(
  payload: unknown
): Promise<TestSmtpConfigResult> {
  await requireSuperAdmin();

  const parsed = testSmtpConfigSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.', durationMs: null };
  }
  const data = parsed.data;

  // Resolve the password: use the typed value if provided, else fall
  // back to the stored cipher so the operator can test saved credentials
  // without re-entering the password.
  let resolvedPassword = data.password;
  if (!resolvedPassword) {
    const row = await prisma.smtpConfig.findFirst({ select: { passwordCipher: true } });
    if (!row) {
      return { ok: false, error: 'No saved password yet. Enter a password to test.', durationMs: null };
    }
    try {
      resolvedPassword = openSecret(row.passwordCipher);
    } catch {
      return { ok: false, error: 'Could not decrypt stored password (INGEST_SECRET may have been rotated).', durationMs: null };
    }
  }

  const configParsed = smtpConfigSchema.safeParse({
    host: data.host,
    port: data.port,
    secure: data.secure,
    user: data.user,
    password: resolvedPassword,
    from: data.from,
  });
  if (!configParsed.success) {
    return { ok: false, error: configParsed.error.issues[0]?.message ?? 'Invalid config.', durationMs: null };
  }

  const t0 = Date.now();
  const result = await verifySmtpCredentials(configParsed.data);
  const durationMs = Date.now() - t0;

  if (!result.ok) {
    return { ok: false, error: result.error?.message ?? 'SMTP verify failed.', durationMs };
  }
  return { ok: true, error: null, durationMs };
}
