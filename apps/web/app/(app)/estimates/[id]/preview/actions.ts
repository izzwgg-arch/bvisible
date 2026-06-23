'use server';

import { revalidatePath } from 'next/cache';
import { prisma, EstimateStatus } from '@bvisible/db';
import { writeAuditLog } from '@/lib/auth/audit';
import { buildAppAbsoluteUrl } from '@/lib/auth/app-origin';
import { requireTenantId } from '@/lib/auth/current-user';
import { renderEstimateQuoteEmail } from '@/lib/emails/estimate-quote';
import {
  estimatePdfFilename,
  loadEstimatePdfData,
  renderEstimatePdfBuffer,
} from '@/lib/estimate/estimate-pdf';
import { issueEstimateQuoteLink } from '@/lib/estimate/quote-link-issue';
import { statusAfterSuccessfulCustomerSend } from '@/lib/estimate/send-estimate-email-status';
import { verifyTransport, sendMail } from '@/lib/mailer';
import { readRequestContext } from '@/lib/request-context';
import { sendEstimateEmailSchema } from '@/lib/validators';

export interface SendEstimateEmailState {
  ok: boolean;
  error: string | null;
  messageId: string | null;
}

export async function sendEstimateEmailAction(
  _prev: SendEstimateEmailState,
  formData: FormData
): Promise<SendEstimateEmailState> {
  const me = await requireTenantId();
  const ctx = await readRequestContext();

  const parsed = sendEstimateEmailSchema.safeParse({
    estimateId: formData.get('estimateId'),
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid input.',
      messageId: null,
    };
  }
  const { estimateId } = parsed.data;
  const reviewConfirmed = String(formData.get('reviewConfirmed') ?? '') === 'true';
  if (!reviewConfirmed) {
    return {
      ok: false,
      error: 'Open final review and confirm before sending.',
      messageId: null,
    };
  }

  const estimate = await prisma.estimate.findFirst({
    where: { id: estimateId, tenantId: me.tenantId, deletedAt: null },
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
      tenant: { select: { name: true } },
      client: {
        select: {
          email: true,
          contactName: true,
          companyName: true,
        },
      },
    },
  });

  if (!estimate) {
    return { ok: false, error: 'Estimate not found.', messageId: null };
  }

  if (estimate.status === EstimateStatus.FINALIZED) {
    return {
      ok: false,
      error: 'Finalized estimates cannot be emailed from this flow.',
      messageId: null,
    };
  }

  const to = estimate.client.email?.trim();
  if (!to) {
    return {
      ok: false,
      error: 'Client has no email address. Add one on the client record before sending.',
      messageId: null,
    };
  }

  const verify = await verifyTransport();
  if (!verify.ok) {
    return {
      ok: false,
      error: verify.error?.message ?? 'SMTP verify failed.',
      messageId: null,
    };
  }

  const { rawToken } = await issueEstimateQuoteLink({
    prisma,
    tenantId: me.tenantId,
    estimateId: estimate.id,
    createdById: me.id,
    expiresAt: null,
  });

  const quoteUrl = await buildAppAbsoluteUrl(`/quote/${encodeURIComponent(rawToken)}`);

  const mail = renderEstimateQuoteEmail({
    companyName: estimate.tenant.name,
    estimateNumber: estimate.number,
    title: estimate.title,
    quoteUrl,
    contactName: estimate.client.contactName,
  });
  const pdfData = await loadEstimatePdfData(me.tenantId, estimate.id);
  if (!pdfData) {
    return { ok: false, error: 'Could not generate estimate PDF.', messageId: null };
  }
  const pdf = await renderEstimatePdfBuffer(pdfData);

  const send = await sendMail({
    to,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    attachments: [
      {
        filename: estimatePdfFilename(estimate.number),
        content: pdf,
        contentType: 'application/pdf',
      },
    ],
  });

  if (!send.ok) {
    return {
      ok: false,
      error: send.error.message,
      messageId: null,
    };
  }

  const nextStatus = statusAfterSuccessfulCustomerSend(estimate.status);

  if (nextStatus) {
    await prisma.estimate.update({
      where: { id: estimate.id, tenantId: me.tenantId },
      data: { status: nextStatus },
    });
  }

  await writeAuditLog({
    action: 'estimate_sent_to_client',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'estimate',
    targetId: estimate.id,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: {
      number: estimate.number,
      recipientEmail: to,
      messageId: send.result.messageId,
      statusBefore: estimate.status,
      statusAfter: nextStatus ?? estimate.status,
      customerQuoteUrlIssued: true,
      pdfAttached: true,
    },
  });

  revalidatePath(`/estimates/${estimate.id}`);
  revalidatePath(`/estimates/${estimate.id}/preview`);
  revalidatePath('/estimates');

  return {
    ok: true,
    error: null,
    messageId: send.result.messageId,
  };
}
