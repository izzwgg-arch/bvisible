import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@bvisible/db';
import { open } from 'node:fs/promises';
import { requireTenantId } from '@/lib/auth/current-user';
import { attachmentExists, streamAttachment } from '@/lib/po/uploads';
import { BID_ALLOWED_MIMES, detectBidMime, resolveBidSourcePath } from '@/lib/bid/uploads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Tenant-gated download for Bid Estimator source files (takeoffs, plans,
// specs, photos). Same posture as PO attachments: the MIME is re-detected
// from the bytes on disk before streaming, always sent as an attachment,
// never cached. Private storage paths are never exposed.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; fileId: string }> }): Promise<Response> {
  const me = await requireTenantId();
  const { id, fileId } = await params;

  const file = await prisma.bidSourceFile.findFirst({
    where: { id: fileId, estimateId: id, tenantId: me.tenantId },
    select: { id: true, storageKey: true, originalFilename: true, sizeBytes: true, estimate: { select: { deletedAt: true } } },
  });
  if (!file || file.estimate.deletedAt) return new NextResponse('Not found', { status: 404 });

  let absolutePath: string;
  try {
    absolutePath = resolveBidSourcePath(me.tenantId, id, file.storageKey);
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }
  if (!(await attachmentExists(absolutePath))) return new NextResponse('Not found', { status: 404 });

  let detectedMime = 'application/octet-stream';
  try {
    const fh = await open(absolutePath, 'r');
    try {
      const head = new Uint8Array(4096);
      const { bytesRead } = await fh.read(head, 0, 4096, 0);
      const detected = detectBidMime(head.subarray(0, bytesRead), file.originalFilename);
      if (detected && (BID_ALLOWED_MIMES as ReadonlyArray<string>).includes(detected.mime)) detectedMime = detected.mime;
    } finally {
      await fh.close();
    }
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }

  const stream = streamAttachment(absolutePath);
  // @ts-expect-error Node's Readable is iterable; ReadableStream.from is available in Node 22.
  const body = ReadableStream.from(stream);
  const safeAscii = file.originalFilename.replace(/[^\x20-\x7e]/g, '_');
  const utf8Encoded = encodeURIComponent(file.originalFilename);
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': detectedMime,
      'Content-Length': String(file.sizeBytes),
      'Content-Disposition': `attachment; filename="${safeAscii}"; filename*=UTF-8''${utf8Encoded}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
