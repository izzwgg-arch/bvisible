/**
 * Production/staging email ingestion smoke — uses parse/match/materialize path
 * without IMAP. Requires DATABASE_URL (server: source /opt/bvisible/shared/env/.env).
 *
 *   pnpm --filter @bvisible/web exec tsx --tsconfig tsconfig.json scripts/smoke-email-ingestion-live.ts
 */

import {
  EmailIngestStatus,
  EmailMatchReason,
  POEventKind,
  POStatus,
  prisma,
  Role,
} from '@bvisible/db';
import { ingestRawMessageForSmoke } from '../lib/email-ingest/run';
import {
  buildPdfAttachmentEmail,
  buildTextEmail,
  minimalPdfBytes,
} from '../lib/email-ingest/fixtures/mime';
import { parseStoredReviewReasonCodes } from '../lib/email-ingest/review-reasons';

const TENANT_SLUG = process.env.SMOKE_EMAIL_TENANT_SLUG?.trim() || 'bvisible';
const VENDOR_MATCH_EMAIL = 'smoke-email-match@bvisible.local';
const VENDOR_SINGLE_EMAIL = 'smoke-email-single@bvisible.local';
const VENDOR_AMBIG_EMAIL = 'smoke-email-ambiguous@bvisible.local';
const PO_MATCH = 'PO-901001';
const PO_SINGLE = 'PO-901002';
const PO_AMBIG_A = 'PO-901003';
const PO_AMBIG_B = 'PO-901004';
const QBO_MATCH = 'QBO-901001';

interface CaseResult {
  caseId: string;
  messageId: string;
  ingest: { kind: string; matched: boolean };
  emailId?: string;
  status?: string;
  matchReason?: string;
  reviewReasonCodes?: string[];
  matchedPoId?: string | null;
  attachmentSkipped?: number;
  vendorReplyEvents?: number;
  ocrDocuments?: number;
  vendorPriceHistoryDelta?: number;
}

async function ensureSmokeData(tenantId: string, actorId: string) {
  const recent = new Date();

  async function upsertVendor(name: string, email: string) {
    return prisma.vendor.upsert({
      where: { tenantId_name: { tenantId, name } },
      create: { tenantId, name, email },
      update: { email, deletedAt: null },
    });
  }

  async function upsertPo(
    vendorId: string,
    number: string,
    qboPoNumber: string | null,
  ): Promise<{ id: string; number: string }> {
    const existing = await prisma.purchaseOrder.findFirst({
      where: { tenantId, number, deletedAt: null },
      select: { id: true, number: true },
    });
    if (existing) {
      await prisma.purchaseOrder.update({
        where: { id: existing.id },
        data: {
          vendorId,
          status: POStatus.SENT,
          updatedAt: recent,
          qboPoNumber,
        },
      });
      return existing;
    }
    return prisma.purchaseOrder.create({
      data: {
        tenantId,
        vendorId,
        number,
        qboPoNumber,
        status: POStatus.SENT,
        createdById: actorId,
        updatedAt: recent,
      },
      select: { id: true, number: true },
    });
  }

  const vendorMatch = await upsertVendor('SMOKE-EMAIL-Match', VENDOR_MATCH_EMAIL);
  const vendorSingle = await upsertVendor('SMOKE-EMAIL-Single', VENDOR_SINGLE_EMAIL);
  const vendorAmbig = await upsertVendor('SMOKE-EMAIL-Ambiguous', VENDOR_AMBIG_EMAIL);

  const poMatch = await upsertPo(vendorMatch.id, PO_MATCH, QBO_MATCH);
  const poSingle = await upsertPo(vendorSingle.id, PO_SINGLE, null);
  const poAmbigA = await upsertPo(vendorAmbig.id, PO_AMBIG_A, null);
  const poAmbigB = await upsertPo(vendorAmbig.id, PO_AMBIG_B, null);

  return { vendorMatch, vendorSingle, vendorAmbig, poMatch, poSingle, poAmbigA, poAmbigB };
}

async function snapshotEmail(
  tenantId: string,
  messageId: string,
): Promise<CaseResult | null> {
  const row = await prisma.ingestedEmail.findFirst({
    where: { tenantId, messageId },
    select: {
      id: true,
      status: true,
      matchReason: true,
      reviewReasonCodes: true,
      matchedPurchaseOrderId: true,
      attachments: { select: { skipped: true } },
    },
  });
  if (!row) return null;
  const vendorReplies = await prisma.pOEvent.count({
    where: {
      tenantId,
      sourceEmailId: row.id,
      kind: POEventKind.VENDOR_REPLY,
    },
  });
  const ocrCount = await prisma.ocrDocument.count({
    where: {
      tenantId,
      poAttachment: { sourceEmailId: row.id },
    },
  });
  return {
    caseId: '',
    messageId,
    ingest: { kind: 'inserted', matched: row.status === EmailIngestStatus.MATCHED },
    emailId: row.id,
    status: row.status,
    matchReason: row.matchReason,
    reviewReasonCodes: parseStoredReviewReasonCodes(row.reviewReasonCodes),
    matchedPoId: row.matchedPurchaseOrderId,
    attachmentSkipped: row.attachments.filter((a) => a.skipped).length,
    vendorReplyEvents: vendorReplies,
    ocrDocuments: ocrCount,
  };
}

async function countVendorPriceHistory(tenantId: string): Promise<number> {
  return prisma.vendorPriceHistory.count({ where: { tenantId } });
}

async function runCase(
  tenantId: string,
  caseId: string,
  raw: Buffer,
  messageId: string,
  priceBefore: number,
): Promise<CaseResult> {
  const ingest = await ingestRawMessageForSmoke({ tenantId, rawSource: raw });
  const snap = (await snapshotEmail(tenantId, messageId)) ?? {
    caseId,
    messageId,
    ingest,
  };
  snap.caseId = caseId;
  snap.ingest = ingest;
  const priceAfter = await countVendorPriceHistory(tenantId);
  snap.vendorPriceHistoryDelta = priceAfter - priceBefore;
  return snap;
}

async function main(): Promise<void> {
  const tenant = await prisma.tenant.findFirst({
    where: { slug: TENANT_SLUG },
    select: { id: true, slug: true, name: true },
  });
  if (!tenant) {
    throw new Error(`Tenant slug not found: ${TENANT_SLUG}`);
  }

  const actor =
    (await prisma.user.findFirst({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    })) ??
    (await prisma.user.findFirst({
      where: { role: Role.SUPER_ADMIN },
      select: { id: true },
    }));
  if (!actor) throw new Error('No user found to own smoke POs');

  const data = await ensureSmokeData(tenant.id, actor.id);
  const results: CaseResult[] = [];
  const priceBaseline = await countVendorPriceHistory(tenant.id);

  // A — subject PO match
  const msgA = '<smoke-email-a@bvisible.local>';
  results.push(
    await runCase(
      tenant.id,
      'A_subject_po',
      buildTextEmail({
        messageId: msgA,
        subject: `SMOKE-EMAIL subject ${PO_MATCH}`,
        from: `SMOKE Vendor <${VENDOR_MATCH_EMAIL}>`,
        body: 'Quote attached soon.',
      }),
      msgA,
      priceBaseline,
    ),
  );

  // B — body PO match
  const msgB = '<smoke-email-b@bvisible.local>';
  results.push(
    await runCase(
      tenant.id,
      'B_body_po',
      buildTextEmail({
        messageId: msgB,
        subject: 'SMOKE-EMAIL body reference',
        from: `SMOKE Vendor <${VENDOR_MATCH_EMAIL}>`,
        body: `Please ship ${PO_MATCH} this week.`,
      }),
      msgB,
      priceBaseline,
    ),
  );

  // C — vendor + single recent open PO
  const msgC = '<smoke-email-c@bvisible.local>';
  results.push(
    await runCase(
      tenant.id,
      'C_vendor_single_po',
      buildTextEmail({
        messageId: msgC,
        subject: 'SMOKE-EMAIL vendor single',
        from: `SMOKE Single <${VENDOR_SINGLE_EMAIL}>`,
        body: 'No PO number in this message.',
      }),
      msgC,
      priceBaseline,
    ),
  );

  // D — vendor + two recent open POs → ambiguous
  const msgD = '<smoke-email-d@bvisible.local>';
  results.push(
    await runCase(
      tenant.id,
      'D_vendor_multi_po',
      buildTextEmail({
        messageId: msgD,
        subject: 'SMOKE-EMAIL vendor ambiguous',
        from: `SMOKE Ambiguous <${VENDOR_AMBIG_EMAIL}>`,
        body: 'General update — no PO token.',
      }),
      msgD,
      priceBaseline,
    ),
  );

  // E — unsupported attachment (zip magic) + no match token
  const zipBody = Buffer.from('PK\x03\x04fake-zip-content');
  const boundary = 'smokezip';
  const msgE = '<smoke-email-e@bvisible.local>';
  const rawE = Buffer.from(
    `Message-ID: ${msgE}\r\nFrom: stranger@example.com\r\nTo: inbox@bvisible.local\r\nSubject: SMOKE-EMAIL bad attachment\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n--${boundary}\r\nContent-Type: text/plain\r\n\r\nno po here\r\n\r\n--${boundary}\r\nContent-Type: application/zip; name="evil.zip"\r\nContent-Disposition: attachment; filename="evil.zip"\r\nContent-Transfer-Encoding: base64\r\n\r\n${zipBody.toString('base64')}\r\n\r\n--${boundary}--\r\n`,
    'utf8',
  );
  results.push(await runCase(tenant.id, 'E_bad_attachment', rawE, msgE, priceBaseline));

  // F — duplicate Message-ID
  const dup = await ingestRawMessageForSmoke({
    tenantId: tenant.id,
    rawSource: buildTextEmail({
      messageId: msgA,
      subject: `SMOKE-EMAIL duplicate ${PO_MATCH}`,
      from: `SMOKE Match <${VENDOR_MATCH_EMAIL}>`,
      body: 'duplicate attempt',
    }),
  });
  const snapF = await snapshotEmail(tenant.id, msgA);
  const emailCount = await prisma.ingestedEmail.count({
    where: { tenantId: tenant.id, messageId: msgA },
  });
  results.push({
    caseId: 'F_duplicate_message_id',
    messageId: msgA,
    ingest: dup,
    emailId: snapF?.emailId,
    status: snapF?.status,
    matchReason: snapF?.matchReason,
    reviewReasonCodes: snapF?.reviewReasonCodes,
    matchedPoId: snapF?.matchedPoId,
    attachmentSkipped: snapF?.attachmentSkipped,
    vendorReplyEvents: snapF?.vendorReplyEvents,
    ocrDocuments: snapF?.ocrDocuments,
    vendorPriceHistoryDelta: 0,
    duplicateRowCount: emailCount,
  } as CaseResult & { duplicateRowCount?: number });

  // G — PDF attachment on matched PO (OCR enqueue)
  const msgG = '<smoke-email-g@bvisible.local>';
  results.push(
    await runCase(
      tenant.id,
      'G_pdf_ocr',
      buildPdfAttachmentEmail({
        messageId: msgG,
        subject: `SMOKE-EMAIL invoice ${PO_MATCH}`,
        from: `SMOKE Vendor <${VENDOR_MATCH_EMAIL}>`,
        filename: `invoice-${PO_MATCH}.pdf`,
        pdfBytes: minimalPdfBytes(),
      }),
      msgG,
      priceBaseline,
    ),
  );

  const summary = {
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    vendors: {
      match: { id: data.vendorMatch.id, email: VENDOR_MATCH_EMAIL },
      single: { id: data.vendorSingle.id, email: VENDOR_SINGLE_EMAIL },
      ambiguous: { id: data.vendorAmbig.id, email: VENDOR_AMBIG_EMAIL },
    },
    purchaseOrders: {
      poMatch: { id: data.poMatch.id, number: data.poMatch.number, qbo: QBO_MATCH },
      poSingle: { id: data.poSingle.id, number: data.poSingle.number },
      poAmbigA: { id: data.poAmbigA.id, number: data.poAmbigA.number },
      poAmbigB: { id: data.poAmbigB.id, number: data.poAmbigB.number },
    },
    results,
  };

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[smoke-email-ingestion-live] FAIL', err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
