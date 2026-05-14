'use server';

import { revalidatePath } from 'next/cache';
import {
  EmailIngestStatus,
  EmailMatchReason,
  Role,
  prisma,
} from '@bvisible/db';
import {
  dismissEmailSchema,
  manualLinkEmailSchema,
  retryEmailSchema,
  type DismissEmailInput,
  type ManualLinkEmailInput,
  type RetryEmailInput,
} from '@/lib/validators';
import { writeAuditLog } from '@/lib/auth/audit';
import { requireRoleWithEffectiveCompany } from '@/lib/auth/current-user';
import { readRequestContext } from '@/lib/request-context';
import { materializeIngestedEmailOnPo } from '@/lib/email-ingest/run';

// All actions in this module require ADMIN+ within a tenant. The
// `email-ingestion` review screen is an operational tool (it can move
// money-bearing artifacts onto live POs), not a tenant-user feature.

async function requireAdminInTenant(): Promise<{
  error: null;
  me: Awaited<ReturnType<typeof requireRoleWithEffectiveCompany>>;
}> {
  const me = await requireRoleWithEffectiveCompany(Role.ADMIN, Role.SUPER_ADMIN);
  return { error: null, me };
}

// Operator manually attaches an IngestedEmail to a chosen PO. Both ids
// validated server-side; we never accept a PO id from a different
// tenant or a soft-deleted PO.
export async function manualLinkEmailToPoAction(
  payload: ManualLinkEmailInput
): Promise<{ error: string | null }> {
  const auth = await requireAdminInTenant();
  if (auth.error || !auth.me) return { error: auth.error ?? 'Unauthorized.' };
  const me = auth.me;
  const ctx = await readRequestContext();

  const parsed = manualLinkEmailSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const { ingestedEmailId, purchaseOrderId } = parsed.data;

  const [email, po] = await Promise.all([
    prisma.ingestedEmail.findFirst({
      where: { id: ingestedEmailId, tenantId: me.tenantId! },
      select: { id: true, status: true, messageId: true, fromAddress: true },
    }),
    prisma.purchaseOrder.findFirst({
      where: {
        id: purchaseOrderId,
        tenantId: me.tenantId!,
        deletedAt: null,
      },
      select: { id: true, number: true },
    }),
  ]);
  if (!email) return { error: 'Email not found.' };
  if (!po) return { error: 'PO not found.' };
  if (email.status === EmailIngestStatus.MATCHED) {
    return { error: 'This email is already matched.' };
  }
  if (email.status === EmailIngestStatus.DISMISSED) {
    return { error: 'This email is dismissed; un-dismiss before linking.' };
  }

  await materializeIngestedEmailOnPo({
    tenantId: me.tenantId!,
    ingestedEmailId,
    purchaseOrderId,
    reason: EmailMatchReason.MANUAL,
    hint: po.number,
  });

  await writeAuditLog({
    action: 'email_ingest_manual_link',
    tenantId: me.tenantId,
    userId: me.id,
    targetType: 'ingested_email',
    targetId: ingestedEmailId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: {
      purchaseOrderId,
      poNumber: po.number,
      messageId: email.messageId,
      senderDomain: email.fromAddress.split('@').slice(-1)[0] ?? 'unknown',
    },
  });

  revalidatePath('/admin/email-ingestion');
  revalidatePath(`/purchase-orders/${purchaseOrderId}`);
  return { error: null };
}

// Re-runs the matcher and (if successful) materializes onto the chosen
// PO. Foundation: simple "set status back to PENDING + clear errors";
// the next tick will retry. If you need an immediate retry, manually
// link instead.
export async function retryEmailAction(
  payload: RetryEmailInput
): Promise<{ error: string | null }> {
  const auth = await requireAdminInTenant();
  if (auth.error || !auth.me) return { error: auth.error ?? 'Unauthorized.' };
  const me = auth.me;
  const ctx = await readRequestContext();

  const parsed = retryEmailSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const { ingestedEmailId } = parsed.data;

  const email = await prisma.ingestedEmail.findFirst({
    where: { id: ingestedEmailId, tenantId: me.tenantId! },
    select: { id: true, status: true, messageId: true },
  });
  if (!email) return { error: 'Email not found.' };

  await prisma.ingestedEmail.update({
    where: { id: ingestedEmailId },
    data: {
      status: EmailIngestStatus.PENDING,
      errorMessage: null,
      retriedAt: new Date(),
    },
  });

  await writeAuditLog({
    action: 'email_ingest_retried',
    tenantId: me.tenantId,
    userId: me.id,
    targetType: 'ingested_email',
    targetId: ingestedEmailId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { messageId: email.messageId, previousStatus: email.status },
  });

  revalidatePath('/admin/email-ingestion');
  return { error: null };
}

// "Don't surface this email any more". Bytes stay on disk + the row
// stays in the DB so audit can replay decisions; the operational
// review screen filters DISMISSED rows out of the unmatched bucket.
export async function dismissEmailAction(
  payload: DismissEmailInput
): Promise<{ error: string | null }> {
  const auth = await requireAdminInTenant();
  if (auth.error || !auth.me) return { error: auth.error ?? 'Unauthorized.' };
  const me = auth.me;
  const ctx = await readRequestContext();

  const parsed = dismissEmailSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const { ingestedEmailId } = parsed.data;

  const email = await prisma.ingestedEmail.findFirst({
    where: { id: ingestedEmailId, tenantId: me.tenantId! },
    select: { id: true, status: true, messageId: true },
  });
  if (!email) return { error: 'Email not found.' };
  if (email.status === EmailIngestStatus.MATCHED) {
    return { error: 'A matched email cannot be dismissed.' };
  }

  await prisma.ingestedEmail.update({
    where: { id: ingestedEmailId },
    data: { status: EmailIngestStatus.DISMISSED, processedAt: new Date() },
  });

  await writeAuditLog({
    action: 'email_ingest_dismissed',
    tenantId: me.tenantId,
    userId: me.id,
    targetType: 'ingested_email',
    targetId: ingestedEmailId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { messageId: email.messageId, previousStatus: email.status },
  });

  revalidatePath('/admin/email-ingestion');
  return { error: null };
}
