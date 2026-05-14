'use server';

import { revalidatePath } from 'next/cache';
import { Prisma, prisma } from '@bvisible/db';
import {
  deleteTenantInboxSchema,
  saveTenantInboxSchema,
  testInboxConnectionSchema,
  type DeleteTenantInboxInput,
  type SaveTenantInboxInput,
  type TestInboxConnectionInput,
} from '@/lib/validators';
import { writeAuditLog } from '@/lib/auth/audit';
import { requireSuperAdmin } from '@/lib/auth/current-user';
import { readRequestContext } from '@/lib/request-context';
import { sealSecret, openSecret } from '@/lib/email-ingest/crypto';
import {
  testImapConnection,
  type TestImapResult,
} from '@/lib/email-ingest/test';

// All actions in this module are SUPER_ADMIN-only. The TenantEmailInbox
// row is the source of truth for IMAP credentials; no other surface
// touches it. The plaintext password is held only in process memory
// for the duration of a single action invocation; it never leaves
// this file as a return value or audit payload.

function senderDomain(username: string): string {
  const at = username.lastIndexOf('@');
  if (at < 0) return 'unknown';
  return username.slice(at + 1).toLowerCase();
}

export interface SaveTenantInboxResult {
  ok: boolean;
  error: string | null;
  fieldErrors?: Partial<Record<keyof SaveTenantInboxInput, string>>;
}

export async function saveTenantInboxAction(
  payload: SaveTenantInboxInput
): Promise<SaveTenantInboxResult> {
  const me = await requireSuperAdmin();
  const ctx = await readRequestContext();

  const parsed = saveTenantInboxSchema.safeParse(payload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error: issue?.message ?? 'Invalid input.',
      fieldErrors: issue?.path?.[0]
        ? ({ [issue.path[0] as keyof SaveTenantInboxInput]: issue.message } as Partial<
            Record<keyof SaveTenantInboxInput, string>
          >)
        : undefined,
    };
  }
  const data = parsed.data;

  const tenant = await prisma.tenant.findUnique({
    where: { id: data.tenantId },
    select: { id: true, slug: true },
  });
  if (!tenant) {
    return { ok: false, error: 'Tenant not found.' };
  }

  const existing = await prisma.tenantEmailInbox.findUnique({
    where: { tenantId: data.tenantId },
    select: { id: true, passwordCipher: true },
  });

  if (!existing && !data.password) {
    return {
      ok: false,
      error: 'Password is required when creating a new inbox.',
      fieldErrors: { password: 'Required to create the inbox.' },
    };
  }

  // If editing without a new password, keep the existing sealed cipher.
  // If creating, seal the freshly-typed password. We never store the
  // plaintext anywhere outside this stack frame.
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
          ? 'INGEST_SECRET is not configured. Set it in /opt/bvisible/shared/env/.env and redeploy.'
          : 'Could not seal the IMAP password.',
    };
  }

  try {
    await prisma.tenantEmailInbox.upsert({
      where: { tenantId: data.tenantId },
      create: {
        tenantId: data.tenantId,
        host: data.host,
        port: data.port,
        secure: data.secure,
        mailbox: data.mailbox,
        username: data.username,
        passwordCipher,
        pollIntervalSeconds: data.pollIntervalSeconds,
        enabled: data.enabled,
      },
      update: {
        host: data.host,
        port: data.port,
        secure: data.secure,
        mailbox: data.mailbox,
        username: data.username,
        passwordCipher,
        pollIntervalSeconds: data.pollIntervalSeconds,
        enabled: data.enabled,
        // Clear any sticky error from a previous bad config so the diag
        // panel doesn't keep flagging the new row as errored.
        lastErrorAt: null,
        lastErrorMessage: null,
      },
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      return { ok: false, error: 'An inbox already exists for this tenant.' };
    }
    throw err;
  }

  await writeAuditLog({
    action: 'tenant_inbox_saved',
    userId: me.id,
    tenantId: data.tenantId,
    targetType: 'tenant_email_inbox',
    targetId: data.tenantId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: {
      host: data.host,
      port: data.port,
      secure: data.secure,
      mailbox: data.mailbox,
      enabled: data.enabled,
      pollIntervalSeconds: data.pollIntervalSeconds,
      // Username domain only (so audit doesn't carry the local part as
      // a long-term breadcrumb to the credential).
      senderDomain: senderDomain(data.username),
      created: !existing,
      passwordRotated: Boolean(data.password),
    },
  });

  revalidatePath(`/admin/tenants/${data.tenantId}/email-inbox`);
  revalidatePath('/admin/email-ingestion');
  revalidatePath('/admin/email-ingestion/inboxes');
  return { ok: true, error: null };
}

export interface DeleteTenantInboxResult {
  ok: boolean;
  error: string | null;
}

export async function deleteTenantInboxAction(
  payload: DeleteTenantInboxInput
): Promise<DeleteTenantInboxResult> {
  const me = await requireSuperAdmin();
  const ctx = await readRequestContext();

  const parsed = deleteTenantInboxSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const { tenantId } = parsed.data;

  const existing = await prisma.tenantEmailInbox.findUnique({
    where: { tenantId },
    select: { id: true },
  });
  if (!existing) {
    return { ok: false, error: 'No inbox configured for this tenant.' };
  }

  await prisma.tenantEmailInbox.delete({ where: { tenantId } });

  await writeAuditLog({
    action: 'tenant_inbox_deleted',
    userId: me.id,
    tenantId,
    targetType: 'tenant_email_inbox',
    targetId: tenantId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: {},
  });

  revalidatePath(`/admin/tenants/${tenantId}/email-inbox`);
  revalidatePath('/admin/email-ingestion');
  revalidatePath('/admin/email-ingestion/inboxes');
  return { ok: true, error: null };
}

export interface TestInboxConnectionResult {
  ok: boolean;
  error: string | null;
  // Test outcome from apps/web/lib/email-ingest/test.ts. Sanitized;
  // never carries credentials.
  result: TestImapResult | null;
}

export async function testInboxConnectionAction(
  payload: TestInboxConnectionInput
): Promise<TestInboxConnectionResult> {
  const me = await requireSuperAdmin();
  const ctx = await readRequestContext();

  const parsed = testInboxConnectionSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid input.',
      result: null,
    };
  }
  const data = parsed.data;

  const tenant = await prisma.tenant.findUnique({
    where: { id: data.tenantId },
    select: { id: true },
  });
  if (!tenant) {
    return { ok: false, error: 'Tenant not found.', result: null };
  }

  // Resolve the password the test will use:
  //   - if the operator typed a password, use it (lets them test a
  //     just-rotated password before saving);
  //   - else fall back to the stored sealed cipher.
  let password = data.password;
  if (!password) {
    const row = await prisma.tenantEmailInbox.findUnique({
      where: { tenantId: data.tenantId },
      select: { passwordCipher: true },
    });
    if (!row) {
      return {
        ok: false,
        error:
          'No saved password yet. Type a password to test before the inbox row exists.',
        result: null,
      };
    }
    try {
      password = openSecret(row.passwordCipher);
    } catch {
      return {
        ok: false,
        error:
          'Could not decrypt the stored password (INGEST_SECRET may have been rotated).',
        result: null,
      };
    }
  }

  const result = await testImapConnection({
    host: data.host,
    port: data.port,
    secure: data.secure,
    username: data.username,
    password,
    mailbox: data.mailbox,
  });

  await writeAuditLog({
    action: 'tenant_inbox_test_run',
    userId: me.id,
    tenantId: data.tenantId,
    targetType: 'tenant_email_inbox',
    targetId: data.tenantId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: {
      host: data.host,
      port: data.port,
      secure: data.secure,
      mailbox: data.mailbox,
      senderDomain: senderDomain(data.username),
      passedTypedPassword: Boolean(data.password),
      ok: result.ok,
      // Only the kind enum + duration. Never the raw error message in
      // case a misclassified path leaks something.
      kind: result.ok ? 'ok' : result.kind,
      durationMs: result.durationMs,
    },
  });

  return { ok: true, error: null, result };
}
