import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@bvisible/db';
import { open } from 'node:fs/promises';
import { requireTenantId } from '@/lib/auth/current-user';
import {
  ALLOWED_MIMES,
  attachmentExists,
  detectMimeFromBytes,
  resolveAttachmentPath,
  streamAttachment,
} from '@/lib/po/uploads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Tenant-gated download route. We re-detect the MIME on every stream
// so a row with a tampered DB value can't influence what the browser
// thinks it's receiving. We always send Content-Disposition: attachment
// (never inline) so even an HTML payload that snuck in would not
// execute in the user's session origin.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
): Promise<Response> {
  const me = await requireTenantId();
  const { id, attachmentId } = await params;

  const att = await prisma.pOAttachment.findFirst({
    where: {
      id: attachmentId,
      purchaseOrderId: id,
      tenantId: me.tenantId,
    },
    select: {
      id: true,
      storageKey: true,
      originalFilename: true,
      mimeType: true,
      sizeBytes: true,
      purchaseOrder: { select: { deletedAt: true } },
    },
  });
  if (!att || att.purchaseOrder.deletedAt) {
    return new NextResponse('Not found', { status: 404 });
  }

  let absolutePath: string;
  try {
    absolutePath = resolveAttachmentPath(me.tenantId, id, att.storageKey);
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }
  if (!(await attachmentExists(absolutePath))) {
    return new NextResponse('Not found', { status: 404 });
  }

  // Re-detect MIME from disk before streaming. The DB value is a hint;
  // the bytes are the source of truth.
  let detectedMime: string = 'application/octet-stream';
  try {
    const fh = await open(absolutePath, 'r');
    try {
      const head = new Uint8Array(16);
      await fh.read(head, 0, 16, 0);
      const detected = detectMimeFromBytes(head);
      if (detected && (ALLOWED_MIMES as ReadonlyArray<string>).includes(detected.mime)) {
        detectedMime = detected.mime;
      }
    } finally {
      await fh.close();
    }
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }

  const stream = streamAttachment(absolutePath);
  // Convert Node Readable → web ReadableStream the way Next 15 expects.
  // @ts-expect-error Node's Readable is iterable; ReadableStream.from is available in Node 22.
  const body = ReadableStream.from(stream);

  // Filename header: ASCII-safe display name + RFC 5987 UTF-8 fallback.
  const safeAscii = att.originalFilename.replace(/[^\x20-\x7e]/g, '_');
  const utf8Encoded = encodeURIComponent(att.originalFilename);

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': detectedMime,
      'Content-Length': String(att.sizeBytes),
      'Content-Disposition': `attachment; filename="${safeAscii}"; filename*=UTF-8''${utf8Encoded}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
