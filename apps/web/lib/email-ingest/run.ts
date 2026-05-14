import {
  EmailIngestStatus,
  EmailMatchReason,
  POAttachmentKind,
  POEventKind,
  Prisma,
  prisma,
} from '@bvisible/db';
import { writeAuditLog } from '@/lib/auth/audit';
import { loadResolvedInbox, type ResolvedInbox } from './config';
import { openImap, ImapConnectError, type ImapClient } from './client';
import { parseRawMessage, type ParsedEmail } from './parse';
import { matchEmail, type MatchReason } from './match';
import {
  persistEmailAttachment,
  promoteEmailAttachmentToPo,
  UnsupportedAttachmentError,
} from './storage';
import { runVendorPriceExtractionAfterMaterialize } from '@/lib/vendor-pricing/persist';
import { unlink } from 'node:fs/promises';
import path from 'node:path';

const MAX_BATCH = 50;
// Bound the per-tick wall time so a chatty mailbox can never wedge the
// route handler beyond what nginx + systemd will tolerate.
const PER_TICK_BUDGET_MS = 90_000;

export interface TickReport {
  tenantId: string;
  scanned: number;
  ingested: number;
  matched: number;
  errors: number;
  durationMs: number;
  skippedReason?: 'no_inbox' | 'lease_active' | 'budget_exceeded' | null;
  errorMessage?: string;
}

// Per-tenant ingestion tick. Returns a report — never throws — so the
// route handler can aggregate results across tenants safely.
export async function runIngestForTenant(tenantId: string): Promise<TickReport> {
  const startedAt = Date.now();
  const profile = await loadResolvedInbox(tenantId);
  if (!profile) {
    return finalReport(tenantId, 0, 0, 0, 0, startedAt, 'no_inbox');
  }

  // Soft lease: claim the inbox row by bumping lastPolledAt only when
  // the previous lease has expired. The UPDATE is atomic across all
  // PM2 processes and survives crashes (the lease decays on its own).
  const claimed = await claimLease(tenantId, profile.pollIntervalSeconds);
  if (!claimed) {
    return finalReport(tenantId, 0, 0, 0, 0, startedAt, 'lease_active');
  }

  let imap: ImapClient | null = null;
  let scanned = 0;
  let ingested = 0;
  let matched = 0;
  let errors = 0;
  let topLevelError: string | null = null;
  const run = await prisma.emailIngestRun.create({
    data: { tenantId },
    select: { id: true },
  });

  try {
    imap = await openImap(profile);
    const messages = await imap.fetchUnseen(MAX_BATCH);
    scanned = messages.length;

    for (const raw of messages) {
      if (Date.now() - startedAt > PER_TICK_BUDGET_MS) {
        topLevelError = 'budget_exceeded';
        break;
      }
      try {
        const result = await ingestOneMessage({
          tenantId,
          rawSource: raw.source,
        });
        if (result.kind === 'inserted') {
          ingested += 1;
          if (result.matched) matched += 1;
        }
        // Always mark seen on a successful processing path. We do this
        // inside the loop AFTER the DB row commits so a crash mid-loop
        // re-fetches the same UID next tick and the UNIQUE constraint
        // short-circuits the second write.
        if (result.kind !== 'parse_failed') {
          await imap.markSeen(raw.uid);
        }
      } catch (err) {
        errors += 1;
        // Surface a recognizable error message on the log line; never
        // serialize the whole error object (it can include the raw
        // mime envelope in its `data` field).
        // eslint-disable-next-line no-console
        console.warn('email_ingest_message_failed', {
          tenantId,
          uid: raw.uid,
          err: err instanceof Error ? err.message : 'unknown',
        });
      }
    }
  } catch (err) {
    topLevelError =
      err instanceof Error ? err.message.slice(0, 500) : 'tick_failed';
    errors += 1;
  } finally {
    if (imap) await imap.close();
  }

  const durationMs = Date.now() - startedAt;

  await prisma.emailIngestRun.update({
    where: { id: run.id },
    data: {
      finishedAt: new Date(),
      durationMs,
      scannedCount: scanned,
      ingestedCount: ingested,
      matchedCount: matched,
      errorCount: errors,
      errorMessage: topLevelError,
    },
  });

  await prisma.tenantEmailInbox
    .updateMany({
      where: { tenantId },
      data: topLevelError
        ? {
            lastErrorAt: new Date(),
            lastErrorMessage: topLevelError,
          }
        : { lastErrorAt: null, lastErrorMessage: null },
    })
    .catch(() => undefined);

  await writeAuditLog({
    action: 'email_ingest_tick',
    tenantId,
    metadata: {
      scanned,
      ingested,
      matched,
      errors,
      durationMs,
      error: topLevelError ?? undefined,
    },
  });

  // Single safe info line per tick — message-id, sender domain, etc.
  // are logged per-message inside ingestOneMessage when relevant.
  // eslint-disable-next-line no-console
  console.info('email_ingest_tick', {
    tenantId,
    scanned,
    ingested,
    matched,
    errors,
    durationMs,
  });

  return {
    tenantId,
    scanned,
    ingested,
    matched,
    errors,
    durationMs,
    errorMessage: topLevelError ?? undefined,
  };
}

async function claimLease(
  tenantId: string,
  pollIntervalSeconds: number
): Promise<boolean> {
  // Only relevant for DB-rooted inboxes — env-fallback installs always
  // win the lease (single-tenant; tick runs sequentially anyway).
  const has = await prisma.tenantEmailInbox.findUnique({
    where: { tenantId },
    select: { id: true },
  });
  if (!has) return true;
  const cutoff = new Date(Date.now() - pollIntervalSeconds * 1000);
  const updated = await prisma.tenantEmailInbox.updateMany({
    where: {
      tenantId,
      enabled: true,
      OR: [{ lastPolledAt: null }, { lastPolledAt: { lt: cutoff } }],
    },
    data: { lastPolledAt: new Date() },
  });
  return updated.count > 0;
}

interface IngestArgs {
  tenantId: string;
  rawSource: Buffer;
}

interface IngestOk {
  kind: 'inserted' | 'duplicate';
  matched: boolean;
}

interface IngestParseFailed {
  kind: 'parse_failed';
  matched: false;
}

type IngestResult = IngestOk | IngestParseFailed;

async function ingestOneMessage(args: IngestArgs): Promise<IngestResult> {
  let parsed: ParsedEmail;
  try {
    parsed = await parseRawMessage(args.rawSource);
  } catch {
    return { kind: 'parse_failed', matched: false };
  }

  // Idempotency anchor: if there is no Message-ID we can't dedupe.
  // Synthesise one from a hash so retries still collapse.
  const messageId = parsed.messageId
    ? parsed.messageId
    : `<no-id-${args.tenantId}-${parsed.fromAddress}-${parsed.receivedAt.getTime()}>`;

  const senderDomain = parsed.fromAddress.split('@').slice(-1)[0] ?? 'unknown';

  // Insert the IngestedEmail row first. UNIQUE(tenantId, messageId)
  // shortcircuits a re-process. Inside the same transaction we write
  // every IngestedEmailAttachment row so the bytes-on-disk side either
  // has a complete row set or zero rows.
  let createdId: string | null = null;
  let createdMatchReason: EmailMatchReason = EmailMatchReason.NONE;
  try {
    createdId = await prisma.$transaction(async (tx) => {
      const email = await tx.ingestedEmail.create({
        data: {
          tenantId: args.tenantId,
          messageId,
          fromAddress: parsed.fromAddress,
          fromName: parsed.fromName,
          toAddress: parsed.toAddress,
          subject: parsed.subject,
          receivedAt: parsed.receivedAt,
          bodyTextSnippet: parsed.bodyTextSnippet,
          hasAttachments: parsed.attachments.length > 0,
          attachmentCount: parsed.attachments.length,
          status: EmailIngestStatus.PENDING,
          matchReason: EmailMatchReason.NONE,
        },
        select: { id: true },
      });

      const attachmentNames: string[] = [];
      for (const att of parsed.attachments) {
        try {
          const persisted = await persistEmailAttachment({
            tenantId: args.tenantId,
            ingestedEmailId: email.id,
            originalFilename: att.filename,
            bytes: att.bytes,
          });
          attachmentNames.push(att.filename);
          await tx.ingestedEmailAttachment.create({
            data: {
              tenantId: args.tenantId,
              ingestedEmailId: email.id,
              storageKey: persisted.storageKey,
              originalFilename: att.filename,
              mimeType: persisted.detected.mime,
              sizeBytes: att.bytes.byteLength,
              sha256: persisted.sha256,
            },
          });
        } catch (err) {
          if (err instanceof UnsupportedAttachmentError) {
            await tx.ingestedEmailAttachment.create({
              data: {
                tenantId: args.tenantId,
                ingestedEmailId: email.id,
                storageKey: '',
                originalFilename: att.filename,
                mimeType: att.contentType,
                sizeBytes: att.bytes.byteLength,
                sha256: '',
                skipped: true,
                skipReason: err.message,
              },
            });
          } else {
            // Unknown failure — don't fail the email row, but mark it
            // so review surfaces the issue.
            throw err;
          }
        }
      }

      return email.id;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // Already processed — idempotent skip.
      return { kind: 'duplicate', matched: false };
    }
    throw err;
  }

  // Match outside the insert transaction so a slow vendor lookup
  // doesn't hold attachment INSERTs open.
  const stored = await prisma.ingestedEmail.findUnique({
    where: { id: createdId! },
    select: {
      id: true,
      attachments: { select: { originalFilename: true, skipped: true } },
    },
  });
  const attachmentNamesForMatch = (stored?.attachments ?? []).map(
    (a) => a.originalFilename
  );

  const match = await matchEmail({
    tenantId: args.tenantId,
    email: parsed,
    attachmentNames: attachmentNamesForMatch,
  });

  let isMatched = false;
  if (match.reason !== 'NONE' && match.purchaseOrderId) {
    isMatched = true;
    createdMatchReason = mapReason(match.reason);
    await materializeOnPo({
      tenantId: args.tenantId,
      ingestedEmailId: createdId!,
      purchaseOrderId: match.purchaseOrderId,
      vendorId: match.vendorId,
      reason: createdMatchReason,
      hint: match.hint,
      parsed,
    });
  } else {
    await prisma.ingestedEmail.update({
      where: { id: createdId! },
      data: {
        status: EmailIngestStatus.UNMATCHED,
        matchReason: EmailMatchReason.NONE,
        matchedVendorId: match.vendorId,
        matchHint: match.hint,
        processedAt: new Date(),
      },
    });
  }

  // eslint-disable-next-line no-console
  console.info('email_ingest_message', {
    tenantId: args.tenantId,
    messageId,
    senderDomain,
    attachments: parsed.attachments.length,
    match: match.reason,
    matched: isMatched,
  });

  if (isMatched) {
    await writeAuditLog({
      action: 'email_ingest_message_matched',
      tenantId: args.tenantId,
      targetType: 'ingested_email',
      targetId: createdId,
      metadata: {
        messageId,
        senderDomain,
        match: match.reason,
        purchaseOrderId: match.purchaseOrderId,
      },
    });
  } else {
    await writeAuditLog({
      action: 'email_ingest_message_ingested',
      tenantId: args.tenantId,
      targetType: 'ingested_email',
      targetId: createdId,
      metadata: {
        messageId,
        senderDomain,
        attachments: parsed.attachments.length,
        vendorId: match.vendorId,
      },
    });
  }

  return { kind: 'inserted', matched: isMatched };
}

function mapReason(r: MatchReason): EmailMatchReason {
  switch (r) {
    case 'QBO_NUMBER':
      return EmailMatchReason.QBO_NUMBER;
    case 'PO_NUMBER':
      return EmailMatchReason.PO_NUMBER;
    case 'VENDOR_AND_RECENT':
      return EmailMatchReason.VENDOR_AND_RECENT;
    case 'NONE':
    default:
      return EmailMatchReason.NONE;
  }
}

interface MaterializeArgs {
  tenantId: string;
  ingestedEmailId: string;
  purchaseOrderId: string;
  vendorId: string | null;
  reason: EmailMatchReason;
  hint: string | null;
  parsed: ParsedEmail;
}

// Promote every successfully-stored attachment of the IngestedEmail
// onto the matched PO. Materialization is best-effort per attachment;
// a single bad blob does not abort the others. The IngestedEmail row
// is moved to MATCHED + the timeline VENDOR_REPLY event is written
// AFTER attachment promotion so a failure leaves the email as PENDING
// for review.
async function materializeOnPo(args: MaterializeArgs): Promise<void> {
  const stored = await prisma.ingestedEmail.findUnique({
    where: { id: args.ingestedEmailId },
    select: {
      attachments: {
        where: { skipped: false },
        select: {
          id: true,
          storageKey: true,
          originalFilename: true,
          mimeType: true,
          sizeBytes: true,
        },
      },
    },
  });
  if (!stored) return;

  // Resolve a "system" actor for the POAttachment.uploadedById /
  // POEvent.actorId fields. We use the PO's createdById as a stable,
  // per-tenant operator identity. (Future: a dedicated bot user.)
  const po = await prisma.purchaseOrder.findUnique({
    where: { id: args.purchaseOrderId },
    select: { createdById: true, number: true, vendorId: true },
  });
  if (!po) return;

  const promoted: { id: string; mimeType: string; originalFilename: string }[] = [];
  for (const att of stored.attachments) {
    try {
      const promotedFile = await promoteEmailAttachmentToPo({
        tenantId: args.tenantId,
        purchaseOrderId: args.purchaseOrderId,
        ingestedEmailId: args.ingestedEmailId,
        emailStorageKey: att.storageKey,
        originalFilename: att.originalFilename,
        // We re-use the magic-byte-detected mime (string is a runtime
        // check away from AllowedMime; the persistEmailAttachment path
        // already guaranteed it).
        detectedMime: att.mimeType as Parameters<
          typeof promoteEmailAttachmentToPo
        >[0]['detectedMime'],
      });
      const row = await prisma.pOAttachment.create({
        data: {
          tenantId: args.tenantId,
          purchaseOrderId: args.purchaseOrderId,
          storageKey: promotedFile.poStorageKey,
          originalFilename: att.originalFilename,
          mimeType: att.mimeType,
          sizeBytes: att.sizeBytes,
          kind: POAttachmentKind.EMAIL_ATTACHMENT,
          uploadedById: po.createdById,
          sourceEmailId: args.ingestedEmailId,
        },
        select: { id: true },
      });
      promoted.push({
        id: row.id,
        mimeType: att.mimeType,
        originalFilename: att.originalFilename,
      });
    } catch (err) {
      // Best-effort cleanup of any orphan file copy.
      try {
        const dir = path.join(
          process.env.UPLOAD_DIR ?? '/opt/bvisible/shared/uploads',
          args.tenantId,
          'po',
          args.purchaseOrderId
        );
        const candidate = path.join(dir, att.storageKey);
        await unlink(candidate);
      } catch {
        // ignore
      }
      // eslint-disable-next-line no-console
      console.warn('email_ingest_attachment_failed', {
        tenantId: args.tenantId,
        purchaseOrderId: args.purchaseOrderId,
        attachment: att.originalFilename,
        err: err instanceof Error ? err.message : 'unknown',
      });
    }
  }

  await prisma.$transaction([
    prisma.pOEvent.create({
      data: {
        tenantId: args.tenantId,
        purchaseOrderId: args.purchaseOrderId,
        kind: POEventKind.VENDOR_REPLY,
        message: buildTimelineMessage({
          fromAddress: args.parsed.fromAddress,
          fromName: args.parsed.fromName,
          subject: args.parsed.subject,
          attachmentCount: promoted.length,
        }),
        metadata: {
          messageId: args.parsed.messageId,
          fromAddress: args.parsed.fromAddress,
          subject: args.parsed.subject,
          attachmentCount: promoted.length,
          matchReason: args.reason,
          matchHint: args.hint,
        },
        actorId: po.createdById,
        sourceEmailId: args.ingestedEmailId,
      },
    }),
    prisma.ingestedEmail.update({
      where: { id: args.ingestedEmailId },
      data: {
        status: EmailIngestStatus.MATCHED,
        matchReason: args.reason,
        matchedPurchaseOrderId: args.purchaseOrderId,
        matchedVendorId: args.vendorId,
        matchHint: args.hint,
        processedAt: new Date(),
      },
    }),
  ]);

  const effectiveVendorId = args.vendorId ?? po.vendorId;
  if (effectiveVendorId) {
    try {
      await runVendorPriceExtractionAfterMaterialize({
        tenantId: args.tenantId,
        vendorId: effectiveVendorId,
        ingestedEmailId: args.ingestedEmailId,
        purchaseOrderId: args.purchaseOrderId,
        actorId: po.createdById,
        subject: args.parsed.subject,
        bodyTextSnippet: args.parsed.bodyTextSnippet,
        attachments: stored.attachments.map((a) => ({
          id: a.id,
          originalFilename: a.originalFilename,
          skipped: false,
        })),
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('vendor_price_extraction_failed', {
        tenantId: args.tenantId,
        ingestedEmailId: args.ingestedEmailId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export function buildTimelineMessage(args: {
  fromAddress: string;
  fromName: string | null;
  subject: string;
  attachmentCount: number;
}): string {
  const sender =
    args.fromName && args.fromName.trim().length > 0
      ? `${args.fromName} <${args.fromAddress}>`
      : args.fromAddress;
  const attach =
    args.attachmentCount === 0
      ? 'no attachments'
      : `${args.attachmentCount} attachment${args.attachmentCount === 1 ? '' : 's'}`;
  return `Vendor email from ${sender}: ${args.subject} · ${attach}`;
}

function finalReport(
  tenantId: string,
  scanned: number,
  ingested: number,
  matched: number,
  errors: number,
  startedAt: number,
  skipped?: 'no_inbox' | 'lease_active' | 'budget_exceeded' | null
): TickReport {
  return {
    tenantId,
    scanned,
    ingested,
    matched,
    errors,
    durationMs: Date.now() - startedAt,
    skippedReason: skipped ?? null,
  };
}

// Re-export so the route handler can catch the typed connect error.
export { ImapConnectError, type ResolvedInbox };

// ---------------------------------------------------------------------
// Manual / retry promotion path
// ---------------------------------------------------------------------

// Promote a previously-stored IngestedEmail onto a PO from outside the
// tick (manual link in /admin/email-ingestion, or the retry button on a
// FAILED row). Tenant authorization MUST be enforced by the caller —
// this helper only operates on rows the caller already validated.
export async function materializeIngestedEmailOnPo(args: {
  tenantId: string;
  ingestedEmailId: string;
  purchaseOrderId: string;
  reason: EmailMatchReason;
  hint: string | null;
}): Promise<void> {
  const stored = await prisma.ingestedEmail.findFirst({
    where: { id: args.ingestedEmailId, tenantId: args.tenantId },
    select: {
      id: true,
      messageId: true,
      fromAddress: true,
      fromName: true,
      subject: true,
      receivedAt: true,
      bodyTextSnippet: true,
      matchedVendorId: true,
    },
  });
  if (!stored) return;
  await materializeOnPo({
    tenantId: args.tenantId,
    ingestedEmailId: stored.id,
    purchaseOrderId: args.purchaseOrderId,
    vendorId: stored.matchedVendorId,
    reason: args.reason,
    hint: args.hint,
    parsed: {
      messageId: stored.messageId,
      fromAddress: stored.fromAddress,
      fromName: stored.fromName,
      toAddress: null,
      subject: stored.subject,
      receivedAt: stored.receivedAt,
      bodyTextSnippet: stored.bodyTextSnippet,
      attachments: [],
    },
  });
}
