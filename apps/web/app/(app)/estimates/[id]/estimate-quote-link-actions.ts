'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@bvisible/db';

import { requireTenantId } from '@/lib/auth/current-user';
import { buildAppAbsoluteUrl } from '@/lib/auth/app-origin';
import {
  issueEstimateQuoteLinkFormSchema,
  revokeEstimateQuoteLinkFormSchema,
} from '@/lib/validators';
import { issueEstimateQuoteLink, revokeAllQuoteLinksForEstimate } from '@/lib/estimate/quote-link-issue';

export type IssueQuoteLinkActionResult =
  | { ok: true; quoteUrl: string }
  | { ok: false; error: string };

export type RevokeQuoteLinkActionResult =
  | { ok: true; revokedCount: number }
  | { ok: false; error: string };

function parseOptionalExpiresAt(raw: string | undefined): Date | null | 'invalid' {
  const t = raw?.trim();
  if (!t) return null;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return 'invalid';
  return d;
}

export async function issueEstimateQuoteLinkAction(input: {
  estimateId: string;
  expiresAtLocal?: string;
}): Promise<IssueQuoteLinkActionResult> {
  const me = await requireTenantId();
  const parsed = issueEstimateQuoteLinkFormSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const { estimateId, expiresAtLocal } = parsed.data;
  const expiresAt = parseOptionalExpiresAt(expiresAtLocal);
  if (expiresAt === 'invalid') {
    return { ok: false, error: 'Invalid expiration date.' };
  }

  const estimate = await prisma.estimate.findFirst({
    where: { id: estimateId, tenantId: me.tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!estimate) {
    return { ok: false, error: 'Estimate not found.' };
  }

  const { rawToken } = await issueEstimateQuoteLink({
    prisma,
    tenantId: me.tenantId,
    estimateId,
    createdById: me.id,
    expiresAt,
  });

  const quoteUrl = await buildAppAbsoluteUrl(`/quote/${encodeURIComponent(rawToken)}`);

  revalidatePath(`/estimates/${estimateId}`);
  revalidatePath(`/estimates/${estimateId}/preview`);

  return { ok: true, quoteUrl };
}

export async function revokeEstimateQuoteLinkAction(input: {
  estimateId: string;
}): Promise<RevokeQuoteLinkActionResult> {
  const me = await requireTenantId();
  const parsed = revokeEstimateQuoteLinkFormSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }

  const { estimateId } = parsed.data;

  const estimate = await prisma.estimate.findFirst({
    where: { id: estimateId, tenantId: me.tenantId, deletedAt: null },
    select: { id: true },
  });
  if (!estimate) {
    return { ok: false, error: 'Estimate not found.' };
  }

  const revokedCount = await revokeAllQuoteLinksForEstimate({
    prisma,
    tenantId: me.tenantId,
    estimateId,
  });

  revalidatePath(`/estimates/${estimateId}`);
  revalidatePath(`/estimates/${estimateId}/preview`);

  return { ok: true, revokedCount };
}
