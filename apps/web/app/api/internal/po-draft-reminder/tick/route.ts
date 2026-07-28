import { NextRequest, NextResponse } from 'next/server';
import { POStatus, prisma } from '@bvisible/db';
import { safeCompareSecret } from '@/lib/email-ingest/crypto';
import { notifyAdminsOfDraftPo } from '@/lib/po/admin-notify';
import { writeAuditLog } from '@/lib/auth/audit';

// Internal tick: every morning, remind admin accounts about POs still
// sitting in DRAFT. Hit by a systemd timer on the host (see
// server-scripts/cron/bvisible-po-draft-reminder.timer). Same exposure
// model as the email-ingest tick: loopback-bound app, /api/internal/*
// not proxied by nginx, shared-secret header as the auth boundary.
//
// Auth: PO_REMINDER_TICK_SECRET, falling back to INGEST_TICK_SECRET so
// a single-secret install works unchanged. 503 when neither is set.
//
// Idempotency: one reminder batch per tenant per ~20h, recorded in the
// audit log (action po_draft_reminder_sent). The timer fires daily; the
// guard makes an accidental double-fire (deploy + timer race) harmless.
// `?force=1` bypasses the guard for smoke testing.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

const HEADER = 'x-bvisible-po-reminder-secret';
const DEDUPE_WINDOW_MS = 20 * 60 * 60 * 1000;

export async function POST(req: NextRequest): Promise<NextResponse> {
  const presented = req.headers.get(HEADER);
  const expected =
    process.env.PO_REMINDER_TICK_SECRET ?? process.env.INGEST_TICK_SECRET ?? '';

  if (!expected) {
    return NextResponse.json(
      { ok: false, error: { code: 'no_secret', message: 'Tick secret not configured.' } },
      { status: 503 }
    );
  }
  if (!safeCompareSecret(presented, expected)) {
    return NextResponse.json(
      { ok: false, error: { code: 'unauthorized', message: 'Invalid tick secret.' } },
      { status: 401 }
    );
  }

  const force = req.nextUrl.searchParams.get('force') === '1';

  // Tenants that currently have draft POs.
  const draftPos = await prisma.purchaseOrder.findMany({
    where: { status: POStatus.DRAFT, deletedAt: null },
    orderBy: [{ tenantId: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, tenantId: true, number: true },
  });

  const byTenant = new Map<string, Array<{ id: string; number: string }>>();
  for (const po of draftPos) {
    const bucket = byTenant.get(po.tenantId) ?? [];
    bucket.push({ id: po.id, number: po.number });
    byTenant.set(po.tenantId, bucket);
  }

  const reports: Array<{
    tenantId: string;
    draftCount: number;
    status: 'sent' | 'skipped_recent' | 'nothing_sent';
    notified: string[];
    skipped: Array<{ number: string; reason: string }>;
  }> = [];

  for (const [tenantId, pos] of byTenant) {
    // Once-per-day guard per tenant.
    if (!force) {
      const recent = await prisma.auditLog.findFirst({
        where: {
          tenantId,
          action: 'po_draft_reminder_sent',
          createdAt: { gte: new Date(Date.now() - DEDUPE_WINDOW_MS) },
        },
        select: { id: true },
      });
      if (recent) {
        reports.push({
          tenantId,
          draftCount: pos.length,
          status: 'skipped_recent',
          notified: [],
          skipped: [],
        });
        continue;
      }
    }

    const notified: string[] = [];
    const skipped: Array<{ number: string; reason: string }> = [];
    for (const po of pos) {
      const r = await notifyAdminsOfDraftPo({
        tenantId,
        purchaseOrderId: po.id,
        reason: 'reminder',
      });
      if (r.ok) notified.push(po.number);
      else skipped.push({ number: po.number, reason: r.skipped });
    }

    if (notified.length > 0) {
      await writeAuditLog({
        action: 'po_draft_reminder_sent',
        tenantId,
        metadata: { poNumbers: notified, draftCount: pos.length },
      });
    }
    reports.push({
      tenantId,
      draftCount: pos.length,
      status: notified.length > 0 ? 'sent' : 'nothing_sent',
      notified,
      skipped,
    });
  }

  return NextResponse.json({
    ok: true,
    data: { tenantsWithDrafts: byTenant.size, reports },
  });
}
