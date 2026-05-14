import { createHash } from 'node:crypto';
import {
  POEventKind,
  Prisma,
  prisma,
} from '@bvisible/db';
import { writeAuditLog } from '@/lib/auth/audit';
import {
  extractPricesFromFilename,
  extractPricesFromSubject,
  extractPricesFromTextBlob,
  type ExtractedPriceCandidate,
} from './extract';
import { normalizeVendorItemName } from './normalize';

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function formatLowerPriceMessage(
  itemNorm: string,
  oldCents: number,
  newCents: number
): string {
  const delta = oldCents - newCents;
  return (
    `Lower price detected for ${itemNorm}: was ${formatMoney(oldCents)} → ${formatMoney(newCents)} ` +
    `(−${formatMoney(delta)}). Operational alert — prices are not auto-updated.`
  ).slice(0, 900);
}

function buildDedupeKey(parts: Record<string, unknown>): string {
  const payload = JSON.stringify(parts);
  return createHash('sha256').update(payload, 'utf8').digest('hex');
}

async function resolveCatalogItem(
  tenantId: string,
  vendorId: string,
  normalized: string
): Promise<{ id: string }> {
  const existing = await prisma.vendorCatalogItem.findUnique({
    where: {
      tenantId_vendorId_nameNormalized: {
        tenantId,
        vendorId,
        nameNormalized: normalized,
      },
    },
    select: { id: true },
  });
  if (existing) return existing;

  const alias = await prisma.vendorItemAlias.findUnique({
    where: {
      tenantId_vendorId_aliasNormalized: {
        tenantId,
        vendorId,
        aliasNormalized: normalized,
      },
    },
    select: { vendorCatalogItemId: true },
  });
  if (alias) return { id: alias.vendorCatalogItemId };

  const row = await prisma.vendorCatalogItem.create({
    data: { tenantId, vendorId, nameNormalized: normalized },
    select: { id: true },
  });
  return row;
}

async function persistOneCandidate(args: {
  tenantId: string;
  vendorId: string;
  ingestedEmailId: string;
  purchaseOrderId: string;
  actorId: string;
  candidate: ExtractedPriceCandidate;
}): Promise<'inserted' | 'duplicate' | 'skipped'> {
  const itemNorm = normalizeVendorItemName(args.candidate.itemRaw);
  if (!itemNorm || itemNorm.length < 2) return 'skipped';

  const dedupeKey = buildDedupeKey({
    tenantId: args.tenantId,
    emailId: args.ingestedEmailId,
    attachmentId: args.candidate.sourceAttachmentId,
    method: args.candidate.method,
    ord: args.candidate.ordinal,
    item: itemNorm,
    price: args.candidate.priceCents,
    unit: args.candidate.unit,
  });

  const catalog = await resolveCatalogItem(
    args.tenantId,
    args.vendorId,
    itemNorm
  );

  const prev = await prisma.vendorPriceHistory.findFirst({
    where: {
      tenantId: args.tenantId,
      vendorCatalogItemId: catalog.id,
    },
    orderBy: { createdAt: 'desc' },
    select: { priceCents: true },
  });

  try {
    await prisma.vendorPriceHistory.create({
      data: {
        tenantId: args.tenantId,
        vendorId: args.vendorId,
        vendorCatalogItemId: catalog.id,
        itemNameRaw: args.candidate.itemRaw.slice(0, 500),
        itemNameNormalized: itemNorm.slice(0, 400),
        priceCents: args.candidate.priceCents,
        unit: args.candidate.unit,
        quantityMilli: args.candidate.quantityMilli,
        sourceEmailId: args.ingestedEmailId,
        sourceAttachmentId: args.candidate.sourceAttachmentId,
        confidence: args.candidate.confidence,
        extractionMethod: args.candidate.method,
        dedupeKey,
      },
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      return 'duplicate';
    }
    throw err;
  }

  if (prev && args.candidate.priceCents < prev.priceCents) {
    await prisma.vendorPriceNotification.create({
      data: {
        tenantId: args.tenantId,
        vendorId: args.vendorId,
        vendorCatalogItemId: catalog.id,
        oldPriceCents: prev.priceCents,
        newPriceCents: args.candidate.priceCents,
        sourceEmailId: args.ingestedEmailId,
      },
    });

    await prisma.pOEvent.create({
      data: {
        tenantId: args.tenantId,
        purchaseOrderId: args.purchaseOrderId,
        kind: POEventKind.VENDOR_LOWER_PRICE,
        message: formatLowerPriceMessage(
          itemNorm,
          prev.priceCents,
          args.candidate.priceCents
        ),
        metadata: {
          vendorCatalogItemId: catalog.id,
          oldPriceCents: prev.priceCents,
          newPriceCents: args.candidate.priceCents,
          sourceEmailId: args.ingestedEmailId,
          itemNameNormalized: itemNorm,
        },
        actorId: args.actorId,
        sourceEmailId: args.ingestedEmailId,
      },
    });

    await writeAuditLog({
      action: 'vendor_price_lower_detected',
      tenantId: args.tenantId,
      targetType: 'vendor_catalog_item',
      targetId: catalog.id,
      metadata: {
        vendorId: args.vendorId,
        oldPriceCents: prev.priceCents,
        newPriceCents: args.candidate.priceCents,
        sourceEmailId: args.ingestedEmailId,
      },
    });
  }

  return 'inserted';
}

/**
 * Runs after a matched vendor email is materialised onto a PO.
 * Failures are swallowed by the caller — email ingestion always wins.
 */
export async function runVendorPriceExtractionAfterMaterialize(args: {
  tenantId: string;
  vendorId: string;
  ingestedEmailId: string;
  purchaseOrderId: string;
  actorId: string;
  subject: string;
  bodyTextSnippet: string | null;
  attachments: ReadonlyArray<{
    id: string;
    originalFilename: string;
    skipped: boolean;
  }>;
}): Promise<void> {
  const merged: ExtractedPriceCandidate[] = [];
  let ord = 0;
  for (const s of extractPricesFromSubject(args.subject, null)) {
    merged.push({ ...s, ordinal: ord++ });
  }
  for (const line of extractPricesFromTextBlob(
    args.bodyTextSnippet,
    'LINE_REGEX',
    null
  )) {
    merged.push({ ...line, ordinal: ord++ });
  }
  for (const att of args.attachments) {
    if (att.skipped) continue;
    for (const fn of extractPricesFromFilename(
      att.originalFilename,
      att.id
    )) {
      merged.push({ ...fn, ordinal: ord++ });
    }
  }

  let inserted = 0;
  let duplicates = 0;
  let skipped = 0;

  for (const c of merged) {
    const r = await persistOneCandidate({
      tenantId: args.tenantId,
      vendorId: args.vendorId,
      ingestedEmailId: args.ingestedEmailId,
      purchaseOrderId: args.purchaseOrderId,
      actorId: args.actorId,
      candidate: c,
    });
    if (r === 'inserted') inserted += 1;
    else if (r === 'duplicate') duplicates += 1;
    else skipped += 1;
  }

  if (inserted > 0 || duplicates > 0) {
    // eslint-disable-next-line no-console
    console.info('vendor_price_extraction', {
      tenantId: args.tenantId,
      vendorId: args.vendorId,
      emailId: args.ingestedEmailId,
      inserted,
      duplicates,
      skipped,
      candidates: merged.length,
    });
  }
}
