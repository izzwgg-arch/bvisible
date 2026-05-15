'use server';

import { revalidatePath } from 'next/cache';
import { prisma } from '@bvisible/db';

import { executePublicQuoteCustomerResponse } from '@/lib/estimate/execute-public-quote-response';
import { readRequestContext } from '@/lib/request-context';
import { submitPublicQuoteResponseSchema } from '@/lib/validators';

export type PublicQuoteActionState = {
  ok: boolean | null;
  message: string | null;
};

export const initialPublicQuoteActionState: PublicQuoteActionState = {
  ok: null,
  message: null,
};

export async function submitPublicQuoteResponseAction(
  _prev: PublicQuoteActionState,
  formData: FormData
): Promise<PublicQuoteActionState> {
  const parsed = submitPublicQuoteResponseSchema.safeParse({
    rawToken: formData.get('rawToken'),
    intent: formData.get('intent'),
    customerName: formData.get('customerName'),
    customerNote: formData.get('customerNote'),
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: parsed.error.issues[0]?.message ?? 'Invalid input.',
    };
  }

  const ctx = await readRequestContext();
  const exec = await executePublicQuoteCustomerResponse({
    prisma,
    rawToken: parsed.data.rawToken,
    intent: parsed.data.intent,
    customerName: parsed.data.customerName,
    customerNote: parsed.data.customerNote,
    ctx: { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent },
  });

  if (!exec.ok) {
    return { ok: false, message: exec.message };
  }

  revalidatePath(`/quote/${encodeURIComponent(parsed.data.rawToken)}`);

  if (exec.outcome === 'idempotent') {
    return {
      ok: true,
      message:
        exec.intent === 'accept'
          ? 'Thanks — we already have your acceptance on file.'
          : 'Thanks — we already have your decline on file.',
    };
  }

  return {
    ok: true,
    message:
      exec.intent === 'accept'
        ? 'Thank you — your acceptance has been recorded.'
        : 'Thanks — your response has been recorded.',
  };
}
