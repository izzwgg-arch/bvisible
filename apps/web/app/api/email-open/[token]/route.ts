import { NextResponse } from 'next/server';
import { prisma } from '@bvisible/db';
import { writeAuditLog } from '@/lib/auth/audit';
import {
  EMAIL_OPEN_SEND_ACTIONS,
  openedActionForSendAction,
} from '@/lib/email-open/email-open';

// Public pixel endpoint hit by mail clients — no auth, no cookies.
// It only ever reveals a 1x1 gif; an invalid token gets the same gif so
// the URL leaks nothing about whether a token exists.

const GIF_1X1 = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

function pixelResponse(): NextResponse {
  return new NextResponse(GIF_1X1 as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      Pragma: 'no-cache',
    },
  });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token: rawToken } = await params;
  // Tolerate a cosmetic .gif/.png suffix on the pixel URL.
  const token = rawToken.replace(/\.(gif|png)$/i, '');
  if (!/^[a-f0-9]{32}$/.test(token)) return pixelResponse();

  try {
    const sendRowSelect = {
      action: true,
      tenantId: true,
      targetType: true,
      targetId: true,
      metadata: true,
    } as const;
    // Estimates + single-vendor PO sends store metadata.openToken; the
    // multi-vendor PO send stores one token per vendor email in
    // metadata.openTokens (with vendor names in metadata.openTokenVendors).
    const sendRow =
      (await prisma.auditLog.findFirst({
        where: {
          action: { in: [...EMAIL_OPEN_SEND_ACTIONS] },
          metadata: { path: ['openToken'], equals: token },
        },
        orderBy: { createdAt: 'desc' },
        select: sendRowSelect,
      })) ??
      (await prisma.auditLog.findFirst({
        where: {
          action: { in: [...EMAIL_OPEN_SEND_ACTIONS] },
          metadata: { path: ['openTokens'], array_contains: token },
        },
        orderBy: { createdAt: 'desc' },
        select: sendRowSelect,
      }));
    if (!sendRow) return pixelResponse();

    const openedAction = openedActionForSendAction(sendRow.action);
    if (!openedAction) return pixelResponse();

    const alreadyOpened = await prisma.auditLog.findFirst({
      where: {
        action: openedAction,
        metadata: { path: ['openToken'], equals: token },
      },
      select: { id: true },
    });
    if (alreadyOpened) return pixelResponse();

    const sendMeta = (sendRow.metadata ?? {}) as Record<string, unknown>;
    const tokenVendors =
      sendMeta.openTokenVendors && typeof sendMeta.openTokenVendors === 'object'
        ? (sendMeta.openTokenVendors as Record<string, unknown>)
        : null;
    const vendorName =
      typeof sendMeta.vendorName === 'string'
        ? sendMeta.vendorName
        : tokenVendors && typeof tokenVendors[token] === 'string'
          ? (tokenVendors[token] as string)
          : undefined;
    await writeAuditLog({
      action: openedAction,
      tenantId: sendRow.tenantId,
      targetType: sendRow.targetType,
      targetId: sendRow.targetId,
      metadata: {
        openToken: token,
        number: typeof sendMeta.number === 'string' ? sendMeta.number : undefined,
        vendorName,
        recipientEmail:
          typeof sendMeta.recipientEmail === 'string' ? sendMeta.recipientEmail : undefined,
        sourceMessageId:
          typeof sendMeta.messageId === 'string' ? sendMeta.messageId : undefined,
      },
    });
  } catch {
    // Tracking must never break pixel delivery.
  }
  return pixelResponse();
}
