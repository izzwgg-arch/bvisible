'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  POAttachmentKind,
  POEventKind,
  POStatus,
  Role,
  prisma,
} from '@bvisible/db';
import {
  addPoNoteSchema,
  deleteAttachmentSchema,
  savePurchaseOrderSchema,
  setPoQboNumberSchema,
  setPoVendorSchema,
  updatePoStatusSchema,
  uploadAttachmentMetaSchema,
  type AddPoNoteInput,
  type SavePurchaseOrderInput,
  type SetPoQboNumberInput,
  type SetPoVendorInput,
  type UpdatePoStatusInput,
} from '@/lib/validators';
import { writeAuditLog } from '@/lib/auth/audit';
import { requireRole, requireRoleWithEffectiveCompany, requireTenantId } from '@/lib/auth/current-user';
import { readRequestContext } from '@/lib/request-context';
import {
  ALLOWED_MIMES,
  MAX_UPLOAD_BYTES,
  detectMimeFromBytes,
  newStorageKey,
  persistAttachmentBytes,
  resolveAttachmentPath,
  safeOriginalFilename,
} from '@/lib/po/uploads';
import { insertPoAttachmentAndTimelineEvent } from '@/lib/po/attachment-insert';
import { enqueueOcrJobForPoAttachment } from '@/lib/ocr/enqueue';
import { renderPurchaseOrderEmail } from '@/lib/emails/purchase-order';
import { sendMail } from '@/lib/mailer';
import { unlink } from 'node:fs/promises';

export interface SavePoState {
  error: string | null;
  subtotalCents?: number;
  savedAt?: number;
}

export async function savePurchaseOrderAction(
  _prev: SavePoState,
  payload: SavePurchaseOrderInput
): Promise<SavePoState> {
  const me = await requireTenantId();
  const ctx = await readRequestContext();

  const parsed = savePurchaseOrderSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const data = parsed.data;

  const existing = await prisma.purchaseOrder.findFirst({
    where: { id: data.purchaseOrderId, tenantId: me.tenantId, deletedAt: null },
    select: { id: true, number: true, status: true },
  });
  if (!existing) return { error: 'PO not found.' };

  // Sum of qty × cost in integer math. PO has no markup; subtotal is
  // exactly the sum of line costs.
  const lineCosts = data.lines.map((l) =>
    Math.round((l.qtyMilli * l.unitCostCents) / 1000)
  );
  const subtotalCents = lineCosts.reduce((a, b) => a + b, 0);

  await prisma.$transaction(async (tx) => {
    await tx.pOLineItem.deleteMany({
      where: { purchaseOrderId: data.purchaseOrderId, tenantId: me.tenantId },
    });
    if (data.lines.length > 0) {
      await tx.pOLineItem.createMany({
        data: data.lines.map((l, i) => ({
          tenantId: me.tenantId,
          purchaseOrderId: data.purchaseOrderId,
          sortOrder: i,
          kind: l.kind,
          description: l.description,
          estimateLineId: l.estimateLineId,
          catalogItemId: l.catalogItemId,
          bundleComponentId: l.bundleComponentId,
          vendorId: l.vendorId,
          selectedVendorMode: l.selectedVendorMode,
          vendorSku: l.vendorSku,
          unit: l.unit,
          qtyMilli: l.qtyMilli,
          unitCostCents: l.unitCostCents,
          computedCostCents: lineCosts[i] ?? 0,
          receivedQtyMilli: l.receivedQtyMilli,
          notes: l.notes ?? null,
        })),
      });
    }
    const vendorIds = [
      ...new Set(data.lines.map((line) => line.vendorId).filter((id): id is string => Boolean(id))),
    ];
    await tx.purchaseOrderVendor.deleteMany({
      where: {
        tenantId: me.tenantId,
        purchaseOrderId: data.purchaseOrderId,
        vendorId: { notIn: vendorIds.length > 0 ? vendorIds : ['__none__'] },
      },
    });
    if (vendorIds.length > 0) {
      for (const vendorId of vendorIds) {
        await tx.purchaseOrderVendor.upsert({
          where: {
            purchaseOrderId_vendorId: {
              purchaseOrderId: data.purchaseOrderId,
              vendorId,
            },
          },
          create: {
            tenantId: me.tenantId,
            purchaseOrderId: data.purchaseOrderId,
            vendorId,
          },
          update: {},
        });
      }
    }
    await tx.purchaseOrder.update({
      where: { id: data.purchaseOrderId, tenantId: me.tenantId },
      data: {
        notes: data.notes,
        subtotalCents,
      },
    });
    await tx.pOEvent.create({
      data: {
        tenantId: me.tenantId,
        purchaseOrderId: data.purchaseOrderId,
        kind: POEventKind.LINES_SAVED,
        message: `Saved ${data.lines.length} line${data.lines.length === 1 ? '' : 's'} · subtotal $${(subtotalCents / 100).toFixed(2)}`,
        metadata: { lineCount: data.lines.length, subtotalCents },
        actorId: me.id,
      },
    });
  });

  await writeAuditLog({
    action: 'po_saved',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'purchase_order',
    targetId: data.purchaseOrderId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: {
      number: existing.number,
      lineCount: data.lines.length,
      subtotalCents,
    },
  });

  revalidatePath(`/purchase-orders/${data.purchaseOrderId}`);
  revalidatePath('/purchase-orders');
  return { error: null, subtotalCents, savedAt: Date.now() };
}

export async function updatePoStatusAction(
  payload: UpdatePoStatusInput
): Promise<{ error: string | null }> {
  const me = await requireTenantId();
  const ctx = await readRequestContext();

  const parsed = updatePoStatusSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const { purchaseOrderId, status } = parsed.data;

  const existing = await prisma.purchaseOrder.findFirst({
    where: { id: purchaseOrderId, tenantId: me.tenantId, deletedAt: null },
    select: { id: true, status: true, number: true },
  });
  if (!existing) return { error: 'PO not found.' };
  if (existing.status === status) return { error: null };

  await prisma.$transaction(async (tx) => {
    await tx.purchaseOrder.update({
      where: { id: purchaseOrderId, tenantId: me.tenantId },
      data: { status },
    });
    await tx.pOEvent.create({
      data: {
        tenantId: me.tenantId,
        purchaseOrderId,
        kind:
          status === POStatus.CANCELED
            ? POEventKind.CANCELED
            : POEventKind.STATUS_CHANGED,
        message: `Status: ${existing.status} → ${status}`,
        metadata: { from: existing.status, to: status },
        actorId: me.id,
      },
    });
  });

  await writeAuditLog({
    action: 'po_status_changed',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'purchase_order',
    targetId: purchaseOrderId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { number: existing.number, from: existing.status, to: status },
  });

  revalidatePath(`/purchase-orders/${purchaseOrderId}`);
  revalidatePath('/purchase-orders');
  return { error: null };
}

export async function setPoQboNumberAction(
  payload: SetPoQboNumberInput
): Promise<{ error: string | null }> {
  const me = await requireTenantId();
  const ctx = await readRequestContext();

  const parsed = setPoQboNumberSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const { purchaseOrderId, qboPoNumber } = parsed.data;

  const existing = await prisma.purchaseOrder.findFirst({
    where: { id: purchaseOrderId, tenantId: me.tenantId, deletedAt: null },
    select: { id: true, number: true, qboPoNumber: true },
  });
  if (!existing) return { error: 'PO not found.' };
  if (existing.qboPoNumber === qboPoNumber) return { error: null };

  await prisma.$transaction(async (tx) => {
    await tx.purchaseOrder.update({
      where: { id: purchaseOrderId, tenantId: me.tenantId },
      data: { qboPoNumber },
    });
    await tx.pOEvent.create({
      data: {
        tenantId: me.tenantId,
        purchaseOrderId,
        kind: POEventKind.QBO_NUMBER_ASSIGNED,
        message: qboPoNumber
          ? `QBO number set to ${qboPoNumber}`
          : 'QBO number cleared',
        metadata: { from: existing.qboPoNumber, to: qboPoNumber },
        actorId: me.id,
      },
    });
  });

  await writeAuditLog({
    action: 'po_qbo_number_set',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'purchase_order',
    targetId: purchaseOrderId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: {
      number: existing.number,
      from: existing.qboPoNumber,
      to: qboPoNumber,
    },
  });

  revalidatePath(`/purchase-orders/${purchaseOrderId}`);
  revalidatePath('/purchase-orders');
  return { error: null };
}

export async function setPoVendorAction(
  payload: SetPoVendorInput
): Promise<{ error: string | null }> {
  const me = await requireTenantId();
  const ctx = await readRequestContext();

  const parsed = setPoVendorSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const { purchaseOrderId, vendorId } = parsed.data;

  const existing = await prisma.purchaseOrder.findFirst({
    where: { id: purchaseOrderId, tenantId: me.tenantId, deletedAt: null },
    select: { id: true, number: true, vendorId: true, vendor: { select: { name: true } } },
  });
  if (!existing) return { error: 'PO not found.' };

  let vendorName: string | null = null;
  if (vendorId) {
    const v = await prisma.vendor.findFirst({
      where: { id: vendorId, tenantId: me.tenantId, deletedAt: null },
      select: { id: true, name: true },
    });
    if (!v) return { error: 'That vendor does not exist.' };
    vendorName = v.name;
  }

  if (existing.vendorId === vendorId) return { error: null };

  await prisma.$transaction(async (tx) => {
    await tx.purchaseOrder.update({
      where: { id: purchaseOrderId, tenantId: me.tenantId },
      data: { vendorId },
    });
    await tx.pOEvent.create({
      data: {
        tenantId: me.tenantId,
        purchaseOrderId,
        kind: POEventKind.VENDOR_ASSIGNED,
        message: vendorId
          ? `Vendor set to ${vendorName ?? vendorId}`
          : 'Vendor cleared',
        metadata: {
          from: existing.vendorId,
          to: vendorId,
          vendorName,
        },
        actorId: me.id,
      },
    });
  });

  await writeAuditLog({
    action: 'po_vendor_set',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'purchase_order',
    targetId: purchaseOrderId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { number: existing.number, from: existing.vendorId, to: vendorId },
  });

  revalidatePath(`/purchase-orders/${purchaseOrderId}`);
  revalidatePath('/purchase-orders');
  return { error: null };
}

export async function addPoNoteAction(
  payload: AddPoNoteInput
): Promise<{ error: string | null }> {
  const me = await requireTenantId();
  const ctx = await readRequestContext();

  const parsed = addPoNoteSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const { purchaseOrderId, note } = parsed.data;

  const existing = await prisma.purchaseOrder.findFirst({
    where: { id: purchaseOrderId, tenantId: me.tenantId, deletedAt: null },
    select: { id: true, number: true },
  });
  if (!existing) return { error: 'PO not found.' };

  await prisma.pOEvent.create({
    data: {
      tenantId: me.tenantId,
      purchaseOrderId,
      kind: POEventKind.NOTE_ADDED,
      message: note,
      actorId: me.id,
    },
  });

  await writeAuditLog({
    action: 'po_note_added',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'purchase_order',
    targetId: purchaseOrderId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { number: existing.number, length: note.length },
  });

  revalidatePath(`/purchase-orders/${purchaseOrderId}`);
  return { error: null };
}

export interface UploadAttachmentState {
  error: string | null;
  uploadedAt?: number;
}

// File-receiving server action. The runtime decodes the multipart body
// for us; the File blob arrives as a real Web File. We:
//  1. Look up the PO under our tenant (refuses cross-tenant writes).
//  2. Check size + parse magic bytes.
//  3. Generate a server-side storage key.
//  4. Persist bytes under the per-tenant directory.
//  5. Insert metadata + emit a POEvent in one transaction.
export async function uploadPoAttachmentAction(
  _prev: UploadAttachmentState,
  formData: FormData
): Promise<UploadAttachmentState> {
  const me = await requireTenantId();
  const ctx = await readRequestContext();

  const meta = uploadAttachmentMetaSchema.safeParse({
    purchaseOrderId: formData.get('purchaseOrderId'),
    kind: formData.get('kind'),
  });
  if (!meta.success) {
    return { error: meta.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const { purchaseOrderId, kind } = meta.data;

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { error: 'Pick a file to upload.' };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { error: `File is too large. Max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.` };
  }

  const po = await prisma.purchaseOrder.findFirst({
    where: { id: purchaseOrderId, tenantId: me.tenantId, deletedAt: null },
    select: { id: true, number: true },
  });
  if (!po) return { error: 'PO not found.' };

  const arrayBuf = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuf);
  const detected = detectMimeFromBytes(bytes);
  if (!detected || !ALLOWED_MIMES.includes(detected.mime)) {
    return {
      error: `Unsupported file type. Allowed: ${ALLOWED_MIMES.join(', ')}.`,
    };
  }

  const original = safeOriginalFilename(file.name);
  const storageKey = newStorageKey(original);

  try {
    await persistAttachmentBytes({
      tenantId: me.tenantId,
      purchaseOrderId,
      storageKey,
      bytes,
    });
  } catch (err) {
    return {
      error:
        err instanceof Error && err.message
          ? `Could not save file: ${err.message}.`
          : 'Could not save file.',
    };
  }

  const created = await prisma.$transaction(async (tx) =>
    insertPoAttachmentAndTimelineEvent(tx, {
      tenantId: me.tenantId,
      purchaseOrderId,
      uploadedById: me.id,
      storageKey,
      originalFilename: original,
      mimeType: detected.mime,
      sizeBytes: bytes.byteLength,
      kind: kind as POAttachmentKind,
    })
  );

  try {
    await enqueueOcrJobForPoAttachment({
      tenantId: me.tenantId,
      poAttachmentId: created.attachmentId,
      kind: kind as POAttachmentKind,
    });
  } catch {
    // OCR enqueue must never block uploads.
  }

  await writeAuditLog({
    action: 'po_attachment_added',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'po_attachment',
    targetId: created.attachmentId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: {
      number: po.number,
      mimeType: detected.mime,
      sizeBytes: bytes.byteLength,
      kind,
    },
  });

  revalidatePath(`/purchase-orders/${purchaseOrderId}`);
  return { error: null, uploadedAt: Date.now() };
}

export async function deletePoAttachmentAction(
  payload: { purchaseOrderId: string; attachmentId: string }
): Promise<{ error: string | null }> {
  const me = await requireTenantId();
  const ctx = await readRequestContext();

  const parsed = deleteAttachmentSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? 'Invalid input.' };
  }
  const { purchaseOrderId, attachmentId } = parsed.data;

  const att = await prisma.pOAttachment.findFirst({
    where: {
      id: attachmentId,
      tenantId: me.tenantId,
      purchaseOrderId,
    },
    select: {
      id: true,
      storageKey: true,
      originalFilename: true,
      purchaseOrder: { select: { number: true, deletedAt: true } },
    },
  });
  if (!att || att.purchaseOrder.deletedAt) {
    return { error: 'Attachment not found.' };
  }

  await prisma.$transaction(async (tx) => {
    await tx.pOAttachment.delete({ where: { id: attachmentId } });
    await tx.pOEvent.create({
      data: {
        tenantId: me.tenantId,
        purchaseOrderId,
        kind: POEventKind.ATTACHMENT_DELETED,
        message: `Removed ${att.originalFilename}`,
        metadata: { attachmentId, originalFilename: att.originalFilename },
        actorId: me.id,
      },
    });
  });

  // Best-effort disk cleanup. If unlink fails we still keep the row
  // gone — the file is unreferenced and won't be served because the
  // download route looks up the row first.
  try {
    const abs = resolveAttachmentPath(me.tenantId, purchaseOrderId, att.storageKey);
    await unlink(abs);
  } catch {
    // ignore — see comment above
  }

  await writeAuditLog({
    action: 'po_attachment_deleted',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'po_attachment',
    targetId: attachmentId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: {
      number: att.purchaseOrder.number,
      originalFilename: att.originalFilename,
    },
  });

  revalidatePath(`/purchase-orders/${purchaseOrderId}`);
  return { error: null };
}

export async function sendPurchaseOrderAction(
  purchaseOrderId: string
): Promise<{ error: string | null; sentCount?: number; failedCount?: number }> {
  const me = await requireTenantId();
  const ctx = await readRequestContext();

  const po = await prisma.purchaseOrder.findFirst({
    where: { id: purchaseOrderId, tenantId: me.tenantId, deletedAt: null },
    select: {
      id: true,
      number: true,
      qboPoNumber: true,
      estimate: { select: { number: true } },
      lines: {
        orderBy: [{ sortOrder: 'asc' }],
        select: {
          id: true,
          description: true,
          qtyMilli: true,
          unit: true,
          unitCostCents: true,
          computedCostCents: true,
          vendorSku: true,
          notes: true,
          vendorId: true,
          vendor: {
            select: {
              id: true,
              name: true,
              email: true,
              emails: true,
            },
          },
        },
      },
    },
  });
  if (!po) return { error: 'PO not found.' };

  const groups = new Map<
    string,
    {
      vendor: NonNullable<(typeof po.lines)[number]['vendor']>;
      lines: typeof po.lines;
    }
  >();
  for (const line of po.lines) {
    if (!line.vendorId || !line.vendor) continue;
    const existing = groups.get(line.vendorId);
    if (existing) existing.lines.push(line);
    else groups.set(line.vendorId, { vendor: line.vendor, lines: [line] });
  }

  if (groups.size === 0) {
    return { error: 'Assign vendors to PO lines before sending.' };
  }

  let sentCount = 0;
  let failedCount = 0;

  for (const [vendorId, group] of groups) {
    const recipient = group.vendor.emails[0] ?? group.vendor.email;
    const subtotalCents = group.lines.reduce((sum, line) => sum + line.computedCostCents, 0);
    if (!recipient) {
      failedCount += 1;
      await recordVendorSendFailure({
        purchaseOrderId,
        tenantId: me.tenantId,
        vendorId,
        actorId: me.id,
        message: `No email address is configured for ${group.vendor.name}.`,
      });
      continue;
    }

    const email = renderPurchaseOrderEmail({
      companyName: me.tenant.name,
      vendorName: group.vendor.name,
      poNumber: po.number,
      qboPoNumber: po.qboPoNumber,
      estimateNumber: po.estimate?.number ?? null,
      subtotalCents,
      lines: group.lines.map((line) => ({
        description: line.description,
        qtyMilli: line.qtyMilli,
        unit: unitLabel(line.unit),
        vendorSku: line.vendorSku,
        unitCostCents: line.unitCostCents,
        totalCents: line.computedCostCents,
        notes: line.notes,
      })),
    });

    const sent = await sendMail({
      to: recipient,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });

    if (sent.ok) {
      sentCount += 1;
      await prisma.$transaction(async (tx) => {
        await tx.purchaseOrderVendor.upsert({
          where: { purchaseOrderId_vendorId: { purchaseOrderId, vendorId } },
          create: {
            tenantId: me.tenantId,
            purchaseOrderId,
            vendorId,
            status: 'SENT',
            sentAt: new Date(),
            messageId: sent.result.messageId,
            lastError: null,
          },
          update: {
            status: 'SENT',
            sentAt: new Date(),
            messageId: sent.result.messageId,
            lastError: null,
          },
        });
        await tx.pOEvent.create({
          data: {
            tenantId: me.tenantId,
            purchaseOrderId,
            kind: POEventKind.VENDOR_PO_SENT,
            message: `Sent ${po.number} to ${group.vendor.name} with ${group.lines.length} line${group.lines.length === 1 ? '' : 's'}`,
            metadata: {
              vendorId,
              vendorName: group.vendor.name,
              lineIds: group.lines.map((line) => line.id),
              messageId: sent.result.messageId,
              subtotalCents,
            },
            actorId: me.id,
          },
        });
      });
    } else {
      failedCount += 1;
      await recordVendorSendFailure({
        purchaseOrderId,
        tenantId: me.tenantId,
        vendorId,
        actorId: me.id,
        message: sent.error.message,
      });
    }
  }

  if (sentCount > 0) {
    await prisma.purchaseOrder.update({
      where: { id: purchaseOrderId, tenantId: me.tenantId },
      data: { status: POStatus.SENT },
    });
  }

  await writeAuditLog({
    action: 'po_sent',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'purchase_order',
    targetId: purchaseOrderId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { number: po.number, sentCount, failedCount },
  });

  revalidatePath(`/purchase-orders/${purchaseOrderId}`);
  revalidatePath('/purchase-orders');

  return {
    error: failedCount > 0 ? `${sentCount} vendor email${sentCount === 1 ? '' : 's'} sent, ${failedCount} failed.` : null,
    sentCount,
    failedCount,
  };
}

async function recordVendorSendFailure(args: {
  tenantId: string;
  purchaseOrderId: string;
  vendorId: string;
  actorId: string;
  message: string;
}) {
  await prisma.$transaction(async (tx) => {
    await tx.purchaseOrderVendor.upsert({
      where: { purchaseOrderId_vendorId: { purchaseOrderId: args.purchaseOrderId, vendorId: args.vendorId } },
      create: {
        tenantId: args.tenantId,
        purchaseOrderId: args.purchaseOrderId,
        vendorId: args.vendorId,
        status: 'FAILED',
        lastError: args.message,
      },
      update: {
        status: 'FAILED',
        lastError: args.message,
      },
    });
    await tx.pOEvent.create({
      data: {
        tenantId: args.tenantId,
        purchaseOrderId: args.purchaseOrderId,
        kind: POEventKind.VENDOR_PO_SEND_FAILED,
        message: `Vendor PO send failed: ${args.message}`,
        metadata: { vendorId: args.vendorId },
        actorId: args.actorId,
      },
    });
  });
}

function unitLabel(unit: string): string {
  return unit.toLowerCase().replace(/_/g, ' ');
}

// Soft delete. Restricted to ADMIN+; USER can edit but not destroy.
export async function deletePurchaseOrderAction(
  purchaseOrderId: string
): Promise<void> {
  const me = await requireRoleWithEffectiveCompany(Role.ADMIN, Role.SUPER_ADMIN);
  const ctx = await readRequestContext();

  const existing = await prisma.purchaseOrder.findFirst({
    where: { id: purchaseOrderId, tenantId: me.tenantId, deletedAt: null },
    select: { id: true, number: true },
  });
  if (!existing) {
    redirect('/purchase-orders');
  }

  await prisma.purchaseOrder.update({
    where: { id: purchaseOrderId, tenantId: me.tenantId },
    data: { deletedAt: new Date() },
  });

  await writeAuditLog({
    action: 'po_deleted',
    userId: me.id,
    tenantId: me.tenantId,
    targetType: 'purchase_order',
    targetId: purchaseOrderId,
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: { number: existing.number },
  });

  revalidatePath('/purchase-orders');
  redirect(`/purchase-orders?deleted=${encodeURIComponent(existing.number)}`);
}
