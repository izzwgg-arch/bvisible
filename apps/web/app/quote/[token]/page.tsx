import type { Metadata } from 'next';
import { prisma } from '@bvisible/db';

import { QuoteDocument } from '@/app/(app)/estimates/[id]/preview/quote-document';
import { writeAuditLog } from '@/lib/auth/audit';
import { recordPublicQuoteView, resolvePublicQuoteByRawToken } from '@/lib/estimate/load-public-quote';
import { readRequestContext } from '@/lib/request-context';

import { PublicQuoteToolbar } from './public-quote-toolbar';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: 'Estimate quote',
    robots: {
      index: false,
      follow: false,
      googleBot: { index: false, follow: false },
    },
  };
}

function InvalidQuoteMessage() {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-lg flex-col justify-center px-6 py-16 text-center">
      <p className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[var(--color-bv-muted)]">
        Quote unavailable
      </p>
      <h1 className="mt-3 text-[22px] font-semibold text-[var(--color-bv-text)]">
        This link is invalid or no longer active
      </h1>
      <p className="mt-4 text-[14px] leading-relaxed text-[var(--color-bv-muted)]">
        If you expected an estimate here, ask your contact at our shop for a new link — expired or revoked links cannot be reopened.
      </p>
    </main>
  );
}

export default async function PublicQuotePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token: rawSegment } = await params;
  let decoded = rawSegment;
  try {
    decoded = decodeURIComponent(rawSegment);
  } catch {
    decoded = rawSegment;
  }

  const quote = await resolvePublicQuoteByRawToken(prisma, decoded);

  if (!quote) {
    return <InvalidQuoteMessage />;
  }

  await recordPublicQuoteView({
    prisma,
    linkId: quote.linkId,
    tenantId: quote.tenantId,
    estimateId: quote.estimateId,
  });

  const ctx = await readRequestContext();
  await writeAuditLog({
    action: 'estimate_quote_viewed_public',
    tenantId: quote.tenantId,
    userId: null,
    targetType: 'estimate',
    targetId: quote.estimateId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { quoteLinkId: quote.linkId },
  });

  return (
    <div className="min-h-screen px-4 py-10 print:px-0 print:py-0">
      <div className="mx-auto mb-8 flex max-w-[880px] justify-end print:hidden">
        <PublicQuoteToolbar />
      </div>
      <QuoteDocument
        companyName={quote.companyName}
        estimateNumber={quote.estimateNumber}
        title={quote.title}
        quoteDateLabel={quote.quoteDateLabel}
        billTo={quote.billTo}
        lines={quote.lines}
        totalSellCents={quote.totalSellCents}
        notes={quote.notes}
      />
    </div>
  );
}
