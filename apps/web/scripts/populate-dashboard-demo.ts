#!/usr/bin/env tsx
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadLocalEnv(appDir);

const {
  prisma,
  EmailMatchReason,
  EmailIngestStatus,
  EstimateLineKind,
  EstimateStatus,
  OcrJobStatus,
  POAttachmentKind,
  POEventKind,
  POLineKind,
  POReconciliationLineMatch,
  POReconciliationStatus,
  POStatus,
  Role,
  SpendAlertKind,
  SpendAlertStatus,
  VendorPriceConfidence,
  VendorPriceExtractionMethod,
} = await import('@bvisible/db');

const tenantSlug = 'bvisible';
const now = new Date();

function loadLocalEnv(dir: string): void {
  for (const filename of ['.env.local', '.env']) {
    const filepath = path.join(dir, filename);
    if (!existsSync(filepath)) continue;

    for (const rawLine of readFileSync(filepath, 'utf8').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;

      const equalsAt = line.indexOf('=');
      if (equalsAt <= 0) continue;

      const key = line.slice(0, equalsAt).trim();
      let value = line.slice(equalsAt + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      process.env[key] ??= value;
    }
  }
}

function daysAgo(days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function demoKey(value: string): string {
  return createHash('sha256').update(`dashboard-demo:${value}`).digest('hex');
}

async function upsertClient(tenantId: string, data: { companyName: string; contactName: string; email: string }) {
  const existing = await prisma.client.findFirst({
    where: { tenantId, companyName: data.companyName },
    select: { id: true },
  });

  if (existing) {
    return prisma.client.update({
      where: { id: existing.id },
      data: { ...data, deletedAt: null },
    });
  }

  return prisma.client.create({
    data: { tenantId, ...data },
  });
}

async function main(): Promise<void> {
  const tenant = await prisma.tenant.upsert({
    where: { slug: tenantSlug },
    update: { name: 'B Visible' },
    create: { slug: tenantSlug, name: 'B Visible' },
  });

  const user =
    (await prisma.user.findFirst({
      where: {
        OR: [
          { tenantId: tenant.id, role: { in: [Role.ADMIN, Role.SUPER_ADMIN] } },
          { role: Role.SUPER_ADMIN },
        ],
      },
      orderBy: { createdAt: 'asc' },
    })) ??
    (await prisma.user.create({
      data: {
        tenantId: tenant.id,
        email: 'demo.operator@bvisible.local',
        name: 'Demo Operator',
        role: Role.ADMIN,
        inviteAcceptedAt: now,
      },
    }));

  const [northline, apex, lumen] = await Promise.all([
    upsertClient(tenant.id, {
      companyName: 'DEMO Northline Retail',
      contactName: 'Avery Jordan',
      email: 'avery@northline.example',
    }),
    upsertClient(tenant.id, {
      companyName: 'DEMO Apex Studio',
      contactName: 'Mina Patel',
      email: 'mina@apex.example',
    }),
    upsertClient(tenant.id, {
      companyName: 'DEMO Lumen Hospitality',
      contactName: 'Chris Rowan',
      email: 'chris@lumen.example',
    }),
  ]);

  const [metro, brightRoll, frameWorks] = await Promise.all([
    prisma.vendor.upsert({
      where: { tenantId_name: { tenantId: tenant.id, name: 'DEMO Metro Sign Supply' } },
      update: { email: 'orders@metrosign.example', deletedAt: null },
      create: {
        tenantId: tenant.id,
        name: 'DEMO Metro Sign Supply',
        email: 'orders@metrosign.example',
      },
    }),
    prisma.vendor.upsert({
      where: { tenantId_name: { tenantId: tenant.id, name: 'DEMO Bright Roll Media' } },
      update: { email: 'sales@brightroll.example', deletedAt: null },
      create: {
        tenantId: tenant.id,
        name: 'DEMO Bright Roll Media',
        email: 'sales@brightroll.example',
      },
    }),
    prisma.vendor.upsert({
      where: { tenantId_name: { tenantId: tenant.id, name: 'DEMO FrameWorks Wholesale' } },
      update: { email: 'po@frameworks.example', deletedAt: null },
      create: {
        tenantId: tenant.id,
        name: 'DEMO FrameWorks Wholesale',
        email: 'po@frameworks.example',
      },
    }),
  ]);

  const estimates = await Promise.all([
    prisma.estimate.upsert({
      where: { tenantId_number: { tenantId: tenant.id, number: 'DASH-EST-1001' } },
      update: {
        clientId: northline.id,
        title: 'Lobby wayfinding refresh',
        status: EstimateStatus.SENT,
        subtotalCostCents: 284500,
        finalPriceCents: 853500,
        deletedAt: null,
        updatedAt: daysAgo(0.2),
      },
      create: {
        tenantId: tenant.id,
        clientId: northline.id,
        number: 'DASH-EST-1001',
        title: 'Lobby wayfinding refresh',
        status: EstimateStatus.SENT,
        subtotalCostCents: 284500,
        finalPriceCents: 853500,
        createdById: user.id,
        createdAt: daysAgo(3),
        updatedAt: daysAgo(0.2),
      },
    }),
    prisma.estimate.upsert({
      where: { tenantId_number: { tenantId: tenant.id, number: 'DASH-EST-1002' } },
      update: {
        clientId: apex.id,
        title: 'Fleet wrap phase two',
        status: EstimateStatus.APPROVED,
        subtotalCostCents: 519800,
        finalPriceCents: 1559400,
        deletedAt: null,
        updatedAt: daysAgo(0.8),
      },
      create: {
        tenantId: tenant.id,
        clientId: apex.id,
        number: 'DASH-EST-1002',
        title: 'Fleet wrap phase two',
        status: EstimateStatus.APPROVED,
        subtotalCostCents: 519800,
        finalPriceCents: 1559400,
        createdById: user.id,
        createdAt: daysAgo(5),
        updatedAt: daysAgo(0.8),
      },
    }),
    prisma.estimate.upsert({
      where: { tenantId_number: { tenantId: tenant.id, number: 'DASH-EST-1003' } },
      update: {
        clientId: lumen.id,
        title: 'Exterior monument panels',
        status: EstimateStatus.DRAFT,
        subtotalCostCents: 172250,
        finalPriceCents: 516750,
        deletedAt: null,
        updatedAt: daysAgo(1.4),
      },
      create: {
        tenantId: tenant.id,
        clientId: lumen.id,
        number: 'DASH-EST-1003',
        title: 'Exterior monument panels',
        status: EstimateStatus.DRAFT,
        subtotalCostCents: 172250,
        finalPriceCents: 516750,
        createdById: user.id,
        createdAt: daysAgo(2),
        updatedAt: daysAgo(1.4),
      },
    }),
  ]);

  const poData = [
    {
      number: 'DASH-PO-2001',
      estimateId: estimates[1]!.id,
      vendorId: brightRoll.id,
      status: POStatus.ORDERED,
      subtotalCents: 428700,
      description: 'Cast wrap film and laminate bundle',
      updatedAt: daysAgo(0.1),
    },
    {
      number: 'DASH-PO-2002',
      estimateId: estimates[0]!.id,
      vendorId: metro.id,
      status: POStatus.PARTIALLY_RECEIVED,
      subtotalCents: 163900,
      description: 'Directional acrylic and vinyl package',
      updatedAt: daysAgo(0.6),
    },
    {
      number: 'DASH-PO-2003',
      estimateId: estimates[2]!.id,
      vendorId: frameWorks.id,
      status: POStatus.SENT,
      subtotalCents: 98000,
      description: 'ACM panel blanks and mounting hardware',
      updatedAt: daysAgo(1.1),
    },
    {
      number: 'DASH-PO-2004',
      estimateId: null,
      vendorId: metro.id,
      status: POStatus.DRAFT,
      subtotalCents: 44600,
      description: 'Rush install consumables',
      updatedAt: daysAgo(1.8),
    },
  ] as const;

  const purchaseOrders = [];
  for (const po of poData) {
    const record = await prisma.purchaseOrder.upsert({
      where: { tenantId_number: { tenantId: tenant.id, number: po.number } },
      update: {
        estimateId: po.estimateId,
        vendorId: po.vendorId,
        status: po.status,
        subtotalCents: po.subtotalCents,
        notes: 'Dashboard demo record.',
        deletedAt: null,
        operatorMarkedReconciledAt: null,
        updatedAt: po.updatedAt,
      },
      create: {
        tenantId: tenant.id,
        estimateId: po.estimateId,
        vendorId: po.vendorId,
        number: po.number,
        status: po.status,
        subtotalCents: po.subtotalCents,
        notes: 'Dashboard demo record.',
        createdById: user.id,
        createdAt: daysAgo(4),
        updatedAt: po.updatedAt,
      },
    });

    await prisma.pOLineItem.deleteMany({ where: { purchaseOrderId: record.id } });
    await prisma.pOLineItem.create({
      data: {
        tenantId: tenant.id,
        purchaseOrderId: record.id,
        sortOrder: 0,
        kind: POLineKind.MATERIAL,
        description: po.description,
        qtyMilli: 1000,
        unitCostCents: po.subtotalCents,
        computedCostCents: po.subtotalCents,
      },
    });

    purchaseOrders.push(record);
  }

  const catalogItems = await Promise.all([
    prisma.vendorCatalogItem.upsert({
      where: {
        tenantId_vendorId_nameNormalized: {
          tenantId: tenant.id,
          vendorId: brightRoll.id,
          nameNormalized: '3m ij180 cast wrap film',
        },
      },
      update: { vendorSku: 'IJ180-54' },
      create: {
        tenantId: tenant.id,
        vendorId: brightRoll.id,
        nameNormalized: '3m ij180 cast wrap film',
        vendorSku: 'IJ180-54',
      },
    }),
    prisma.vendorCatalogItem.upsert({
      where: {
        tenantId_vendorId_nameNormalized: {
          tenantId: tenant.id,
          vendorId: brightRoll.id,
          nameNormalized: 'matte laminate roll',
        },
      },
      update: { vendorSku: 'LAM-MATTE-54' },
      create: {
        tenantId: tenant.id,
        vendorId: brightRoll.id,
        nameNormalized: 'matte laminate roll',
        vendorSku: 'LAM-MATTE-54',
      },
    }),
    prisma.vendorCatalogItem.upsert({
      where: {
        tenantId_vendorId_nameNormalized: {
          tenantId: tenant.id,
          vendorId: frameWorks.id,
          nameNormalized: 'acm panel 4x8',
        },
      },
      update: { vendorSku: 'ACM-48-WHT' },
      create: {
        tenantId: tenant.id,
        vendorId: frameWorks.id,
        nameNormalized: 'acm panel 4x8',
        vendorSku: 'ACM-48-WHT',
      },
    }),
  ]);

  await prisma.vendorPriceNotification.deleteMany({
    where: {
      tenantId: tenant.id,
      vendorCatalogItemId: { in: catalogItems.map((item) => item.id) },
    },
  });

  await prisma.vendorPriceHistory.deleteMany({
    where: {
      tenantId: tenant.id,
      dedupeKey: { in: catalogItems.flatMap((item) => [demoKey(`${item.id}:old`), demoKey(`${item.id}:new`)]) },
    },
  });

  for (const [index, item] of catalogItems.entries()) {
    const vendorId = index === 2 ? frameWorks.id : brightRoll.id;
    const oldPrice = [128500, 74200, 11800][index]!;
    const newPrice = [119900, 68900, 10300][index]!;

    await prisma.vendorPriceHistory.create({
      data: {
        tenantId: tenant.id,
        vendorId,
        vendorCatalogItemId: item.id,
        itemNameRaw: item.nameNormalized,
        itemNameNormalized: item.nameNormalized,
        priceCents: oldPrice,
        unit: 'roll',
        quantityMilli: 1000,
        confidence: VendorPriceConfidence.HIGH,
        extractionMethod: VendorPriceExtractionMethod.MANUAL,
        dedupeKey: demoKey(`${item.id}:old`),
        effectiveAt: daysAgo(14 + index),
        createdAt: daysAgo(14 + index),
      },
    });

    await prisma.vendorPriceHistory.create({
      data: {
        tenantId: tenant.id,
        vendorId,
        vendorCatalogItemId: item.id,
        itemNameRaw: item.nameNormalized,
        itemNameNormalized: item.nameNormalized,
        priceCents: newPrice,
        unit: 'roll',
        quantityMilli: 1000,
        confidence: VendorPriceConfidence.HIGH,
        extractionMethod: VendorPriceExtractionMethod.MANUAL,
        dedupeKey: demoKey(`${item.id}:new`),
        effectiveAt: daysAgo(index + 1),
        createdAt: daysAgo(index + 1),
      },
    });

    await prisma.vendorPriceNotification.create({
      data: {
        tenantId: tenant.id,
        vendorId,
        vendorCatalogItemId: item.id,
        oldPriceCents: oldPrice,
        newPriceCents: newPrice,
        createdAt: daysAgo(index * 0.4),
      },
    });
  }

  await prisma.pOReconciliation.deleteMany({
    where: {
      tenantId: tenant.id,
      triggerDedupeKey: { in: [demoKey('recon:2001'), demoKey('recon:2002')] },
    },
  });

  for (const [index, po] of [purchaseOrders[0]!, purchaseOrders[1]!].entries()) {
    const reconciliation = await prisma.pOReconciliation.create({
      data: {
        tenantId: tenant.id,
        purchaseOrderId: po.id,
        status: index === 0 ? POReconciliationStatus.VARIANCE : POReconciliationStatus.REVIEW_REQUIRED,
        triggerDedupeKey: demoKey(`recon:${po.number.slice(-4)}`),
        summary: { source: 'dashboard-demo', varianceCount: index + 1 },
        createdAt: daysAgo(index + 0.3),
        updatedAt: daysAgo(index + 0.3),
      },
    });

    const line = await prisma.pOLineItem.findFirst({ where: { purchaseOrderId: po.id } });
    if (line) {
      await prisma.pOReconciliationLine.create({
        data: {
          tenantId: tenant.id,
          poReconciliationId: reconciliation.id,
          sortOrder: 0,
          poLineItemId: line.id,
          match: POReconciliationLineMatch.PRICE_VARIANCE,
          expectedQtyMilli: line.qtyMilli,
          expectedUnitCostCents: line.unitCostCents,
          observedQtyMilli: line.qtyMilli,
          observedUnitPriceCents: line.unitCostCents - 1200,
          priceVarianceCents: -1200,
        },
      });
    }
  }

  await prisma.spendAlert.deleteMany({
    where: {
      tenantId: tenant.id,
      dedupeKey: { in: [demoKey('spend:2001'), demoKey('spend:2002')] },
    },
  });
  await prisma.spendAlert.createMany({
    data: [
      {
        tenantId: tenant.id,
        purchaseOrderId: purchaseOrders[0]!.id,
        vendorId: brightRoll.id,
        kind: SpendAlertKind.PRICE_OVER_PO_EXPECTED,
        status: SpendAlertStatus.OPEN,
        identityKey: demoKey('spend-identity:2001'),
        dedupeKey: demoKey('spend:2001'),
        title: 'Wrap film price variance',
        body: 'Approved receipt pricing differs from the expected PO line.',
        metadata: { source: 'dashboard-demo' },
        createdAt: daysAgo(0.5),
      },
      {
        tenantId: tenant.id,
        purchaseOrderId: purchaseOrders[1]!.id,
        vendorId: metro.id,
        kind: SpendAlertKind.QTY_MISMATCH,
        status: SpendAlertStatus.OPEN,
        identityKey: demoKey('spend-identity:2002'),
        dedupeKey: demoKey('spend:2002'),
        title: 'Acrylic quantity mismatch',
        body: 'Receipt quantity is lower than the requested PO quantity.',
        metadata: { source: 'dashboard-demo' },
        createdAt: daysAgo(1.2),
      },
    ],
  });

  await prisma.ocrDocument.deleteMany({
    where: {
      tenantId: tenant.id,
      poAttachment: { storageKey: { startsWith: 'dashboard-demo-' } },
    },
  });
  await prisma.pOAttachment.deleteMany({
    where: { tenantId: tenant.id, storageKey: { startsWith: 'dashboard-demo-' } },
  });

  for (const [index, po] of [purchaseOrders[0]!, purchaseOrders[2]!].entries()) {
    const attachment = await prisma.pOAttachment.create({
      data: {
        tenantId: tenant.id,
        purchaseOrderId: po.id,
        storageKey: `dashboard-demo-${po.number}.pdf`,
        originalFilename: `${po.number}-vendor-invoice.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 248000 + index * 31000,
        kind: POAttachmentKind.VENDOR_INVOICE,
        uploadedById: user.id,
        createdAt: daysAgo(index + 0.15),
      },
    });
    await prisma.ocrDocument.create({
      data: {
        tenantId: tenant.id,
        poAttachmentId: attachment.id,
        status: index === 0 ? OcrJobStatus.REVIEW_REQUIRED : OcrJobStatus.PENDING,
        rawTextCharCount: 1840 + index * 300,
        rawTextSnippet: 'Dashboard demo OCR preview. Vendor invoice lines detected for review.',
        vendorNameGuess: index === 0 ? brightRoll.name : frameWorks.name,
        totalCentsGuess: po.subtotalCents,
        createdAt: daysAgo(index + 0.1),
        updatedAt: daysAgo(index + 0.1),
      },
    });
  }

  await prisma.ingestedEmail.deleteMany({
    where: { tenantId: tenant.id, messageId: { startsWith: '<dashboard-demo-' } },
  });
  await prisma.ingestedEmail.createMany({
    data: [
      {
        tenantId: tenant.id,
        messageId: '<dashboard-demo-2001@bvisible.local>',
        fromAddress: 'orders@brightroll.example',
        fromName: 'Bright Roll Media',
        toAddress: 'ops@bvisible.local',
        subject: 'Invoice for DASH-PO-2001',
        receivedAt: daysAgo(0.4),
        status: EmailIngestStatus.MATCHED,
        matchReason: EmailMatchReason.PO_NUMBER,
        matchedPurchaseOrderId: purchaseOrders[0]!.id,
        matchedVendorId: brightRoll.id,
        matchHint: 'DASH-PO-2001',
        bodyTextSnippet: 'Attached invoice and updated delivery ETA.',
        hasAttachments: true,
        attachmentCount: 1,
        processedAt: daysAgo(0.4),
        createdAt: daysAgo(0.4),
        updatedAt: daysAgo(0.4),
      },
      {
        tenantId: tenant.id,
        messageId: '<dashboard-demo-unmatched@bvisible.local>',
        fromAddress: 'shipping@unknown-vendor.example',
        fromName: 'Unknown Vendor',
        toAddress: 'ops@bvisible.local',
        subject: 'Delivery receipt needs matching',
        receivedAt: daysAgo(0.7),
        status: EmailIngestStatus.UNMATCHED,
        matchReason: EmailMatchReason.NONE,
        bodyTextSnippet: 'Could not match this receipt to a purchase order automatically.',
        hasAttachments: true,
        attachmentCount: 1,
        reviewReasonCodes: ['NO_PO_MATCH'],
        processedAt: daysAgo(0.7),
        createdAt: daysAgo(0.7),
        updatedAt: daysAgo(0.7),
      },
    ],
  });

  await prisma.pOEvent.deleteMany({
    where: { tenantId: tenant.id, message: { startsWith: 'Dashboard demo:' } },
  });
  await prisma.pOEvent.createMany({
    data: purchaseOrders.slice(0, 3).map((po, index) => ({
      tenantId: tenant.id,
      purchaseOrderId: po.id,
      kind: index === 0 ? POEventKind.VENDOR_REPLY : POEventKind.STATUS_CHANGED,
      message:
        index === 0
          ? 'Dashboard demo: vendor invoice received.'
          : `Dashboard demo: ${po.number} moved through procurement.`,
      actorId: user.id,
      metadata: { source: 'dashboard-demo' },
      createdAt: daysAgo(index + 0.25),
    })),
  });

  await prisma.auditLog.deleteMany({
    where: {
      tenantId: tenant.id,
      action: {
        in: [
          'demo_estimate_sent',
          'demo_po_ordered',
          'demo_vendor_price_drop',
          'demo_ocr_review_created',
          'demo_reconciliation_variance',
          'demo_client_updated',
          'demo_invoice_email_matched',
          'demo_materials_received',
        ],
      },
    },
  });
  const auditRows: Array<[action: string, targetType: string, targetId: string]> = [
    ['demo_estimate_sent', 'estimate', estimates[0]!.id],
    ['demo_po_ordered', 'purchase_order', purchaseOrders[0]!.id],
    ['demo_vendor_price_drop', 'vendor_price_notification', catalogItems[0]!.id],
    ['demo_ocr_review_created', 'ocr_document', purchaseOrders[0]!.id],
    ['demo_reconciliation_variance', 'po_reconciliation', purchaseOrders[1]!.id],
    ['demo_client_updated', 'client', northline.id],
    ['demo_invoice_email_matched', 'ingested_email', purchaseOrders[0]!.id],
    ['demo_materials_received', 'purchase_order', purchaseOrders[1]!.id],
  ];

  await prisma.auditLog.createMany({
    data: auditRows.map(([action, targetType, targetId], index) => ({
      tenantId: tenant.id,
      userId: user.id,
      action,
      targetType,
      targetId,
      metadata: { source: 'dashboard-demo' },
      createdAt: daysAgo(index * 0.25),
    })),
  });

  const [openEstimates, openPurchaseOrders, vendorPriceAlertsOpen, pendingOcrReviews, recentActivity] =
    await Promise.all([
      prisma.estimate.count({
        where: {
          tenantId: tenant.id,
          deletedAt: null,
          status: { in: [EstimateStatus.DRAFT, EstimateStatus.SENT, EstimateStatus.APPROVED] },
        },
      }),
      prisma.purchaseOrder.count({
        where: {
          tenantId: tenant.id,
          deletedAt: null,
          status: {
            in: [POStatus.DRAFT, POStatus.SENT, POStatus.ORDERED, POStatus.PARTIALLY_RECEIVED],
          },
        },
      }),
      prisma.vendorPriceNotification.count({ where: { tenantId: tenant.id, dismissedAt: null } }),
      prisma.ocrDocument.count({
        where: {
          tenantId: tenant.id,
          status: { in: [OcrJobStatus.REVIEW_REQUIRED, OcrJobStatus.PENDING, OcrJobStatus.PROCESSING] },
        },
      }),
      prisma.auditLog.count({ where: { tenantId: tenant.id } }),
    ]);

  console.log('Dashboard demo data populated.');
  console.log(`tenant=${tenant.name} (${tenant.slug})`);
  console.log(`openEstimates=${openEstimates}`);
  console.log(`openPurchaseOrders=${openPurchaseOrders}`);
  console.log(`vendorPriceAlertsOpen=${vendorPriceAlertsOpen}`);
  console.log(`pendingOcrReviews=${pendingOcrReviews}`);
  console.log(`auditRows=${recentActivity}`);
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
