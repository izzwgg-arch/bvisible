/**
 * Deterministic DB verification for vendor pricing extraction (no IMAP).
 *
 * Prerequisites: DATABASE_URL (e.g. from repo `.env` or `/opt/bvisible/shared/env/.env`).
 *
 * Run from repo:
 *   pnpm --filter @bvisible/web exec tsx --tsconfig tsconfig.json scripts/verify-vendor-pricing.ts
 *
 * Or: server-scripts/db/.verify-vendor-pricing.sh (sources server env on production).
 */

import {
  EmailIngestStatus,
  EmailMatchReason,
  POEventKind,
  prisma,
  Role,
} from '@bvisible/db';
import { hashPassword } from '../lib/auth/password';
import { nextPoNumber } from '../lib/po/number';
import { runVendorPriceExtractionAfterMaterialize } from '../lib/vendor-pricing/persist';

const TENANT_SLUG = 'vendor-pricing-verify';

async function main(): Promise<void> {
  await prisma.tenant.deleteMany({ where: { slug: TENANT_SLUG } });

  const tenant = await prisma.tenant.create({
    data: {
      name: 'Vendor pricing verify (sandbox)',
      slug: TENANT_SLUG,
    },
  });

  const passwordHash = await hashPassword('verify-passphrase-12');
  const user = await prisma.user.create({
    data: {
      tenantId: tenant.id,
      email: `vp-verify+worker@${TENANT_SLUG}.local`,
      role: Role.USER,
      passwordHash,
      inviteAcceptedAt: new Date(),
    },
  });

  const vendor = await prisma.vendor.create({
    data: {
      tenantId: tenant.id,
      name: `VP Verify Vendor ${Date.now()}`,
    },
  });

  const purchaseOrder = await prisma.$transaction(async (tx) => {
    const number = await nextPoNumber(tx, tenant.id);
    return tx.purchaseOrder.create({
      data: {
        tenantId: tenant.id,
        vendorId: vendor.id,
        number,
        createdById: user.id,
        subtotalCents: 0,
      },
    });
  });

  const msgId = `<vp-verify-${Date.now()}@${TENANT_SLUG}.local>`;
  const bodySnippet = ['ACM 4X8 WHITE: 145.00', 'ACM 4X8 WHITE: 125.00'].join(
    '\n'
  );

  const ingested = await prisma.ingestedEmail.create({
    data: {
      tenantId: tenant.id,
      messageId: msgId,
      fromAddress: 'supplier@verify.example',
      subject: 'VP verify sandbox email',
      receivedAt: new Date(),
      status: EmailIngestStatus.MATCHED,
      matchReason: EmailMatchReason.PO_NUMBER,
      matchedPurchaseOrderId: purchaseOrder.id,
      matchedVendorId: vendor.id,
      matchHint: purchaseOrder.number,
      bodyTextSnippet: bodySnippet,
      processedAt: new Date(),
    },
  });

  const linesBefore = await prisma.pOLineItem.count({
    where: { tenantId: tenant.id },
  });

  await runVendorPriceExtractionAfterMaterialize({
    tenantId: tenant.id,
    vendorId: vendor.id,
    ingestedEmailId: ingested.id,
    purchaseOrderId: purchaseOrder.id,
    actorId: user.id,
    subject: ingested.subject,
    bodyTextSnippet: bodySnippet,
    attachments: [],
  });

  const catCount = await prisma.vendorCatalogItem.count({
    where: { tenantId: tenant.id, vendorId: vendor.id },
  });
  const histCount = await prisma.vendorPriceHistory.count({
    where: { tenantId: tenant.id },
  });
  const notifUndismissed = await prisma.vendorPriceNotification.count({
    where: { tenantId: tenant.id, dismissedAt: null },
  });
  const lowerEvents = await prisma.pOEvent.count({
    where: {
      tenantId: tenant.id,
      purchaseOrderId: purchaseOrder.id,
      kind: POEventKind.VENDOR_LOWER_PRICE,
    },
  });

  const linesAfterFirst = await prisma.pOLineItem.count({
    where: { tenantId: tenant.id },
  });

  if (
    catCount !== 1 ||
    histCount !== 2 ||
    notifUndismissed !== 1 ||
    lowerEvents !== 1 ||
    linesAfterFirst !== linesBefore
  ) {
    await prisma.tenant.delete({ where: { id: tenant.id } });
    throw new Error(
      `FAIL: assertions after first extraction ${JSON.stringify({
        catCount,
        histCount,
        notifUndismissed,
        lowerEvents,
        linesBefore,
        linesAfterFirst,
      })}`
    );
  }

  await runVendorPriceExtractionAfterMaterialize({
    tenantId: tenant.id,
    vendorId: vendor.id,
    ingestedEmailId: ingested.id,
    purchaseOrderId: purchaseOrder.id,
    actorId: user.id,
    subject: ingested.subject,
    bodyTextSnippet: bodySnippet,
    attachments: [],
  });

  const histAfterReplay = await prisma.vendorPriceHistory.count({
    where: { tenantId: tenant.id },
  });

  if (histAfterReplay !== 2) {
    await prisma.tenant.delete({ where: { id: tenant.id } });
    throw new Error(
      `FAIL: duplicate replay inserted rows ${JSON.stringify({ histAfterReplay })}`
    );
  }

  await prisma.tenant.delete({ where: { id: tenant.id } });

  // eslint-disable-next-line no-console
  console.log('PASS vendor-pricing DB verification');
}

async function run(): Promise<void> {
  try {
    await main();
  } finally {
    await prisma.$disconnect();
  }
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(
    'FAIL vendor-pricing DB verification',
    err instanceof Error ? err.message : String(err)
  );
  process.exit(1);
});
