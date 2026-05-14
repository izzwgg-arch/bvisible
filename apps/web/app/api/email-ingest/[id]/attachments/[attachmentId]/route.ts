import { NextRequest, NextResponse } from 'next/server';
import { open } from 'node:fs/promises';
import { Role, prisma } from '@bvisible/db';
import { requireRole } from '@/lib/auth/current-user';
import {
  ALLOWED_MIMES,
  attachmentExists,
  detectMimeFromBytes,
  streamAttachment,
} from '@/lib/po/uploads';
import { resolveEmailAttachmentPath } from '@/lib/email-ingest/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Tenant-gated download for an IngestedEmailAttachment. Same posture as
// the PO attachment route: re-detect MIME from disk on every request,
// always send Content-Disposition: attachment, never trust the DB
// mimeType. ADMIN+ only because the email review surface is an
// operational tool — non-admin tenant users should view email-sourced
// material via the PO timeline once it's been linked.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
): Promise<Response> {
  const me = await requireRole(Role.ADMIN, Role.SUPER_ADMIN);
  if (!me.tenantId) {
    return new NextResponse('Not found', { status: 404 });
  }
  const { id, attachmentId } = await params;

  const att = await prisma.ingestedEmailAttachment.findFirst({
    where: {
      id: attachmentId,
      ingestedEmailId: id,
      tenantId: me.tenantId,
      skipped: false,
    },
    select: {
      id: true,
      storageKey: true,
      originalFilename: true,
      sizeBytes: true,
      ingestedEmailId: true,
    },
  });
  if (!att) {
    return new NextResponse('Not found', { status: 404 });
  }

  let absolutePath: string;
  try {
    absolutePath = resolveEmailAttachmentPath(
      me.tenantId,
      att.ingestedEmailId,
      att.storageKey
    );
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }
  if (!(await attachmentExists(absolutePath))) {
    return new NextResponse('Not found', { status: 404 });
  }

  let detectedMime: string = 'application/octet-stream';
  try {
    const fh = await open(absolutePath, 'r');
    try {
      const head = new Uint8Array(16);
      await fh.read(head, 0, 16, 0);
      const detected = detectMimeFromBytes(head);
      if (detected && (ALLOWED_MIMES as ReadonlyArray<string>).includes(detected.mime)) {
        detectedMime = detected.mime;
      } else {
        return new NextResponse('Not found', { status: 404 });
      }
    } finally {
      await fh.close();
    }
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }

  const stream = streamAttachment(absolutePath);
  // @ts-expect-error Node's Readable is iterable; ReadableStream.from is available in Node 22.
  const body = ReadableStream.from(stream);

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
