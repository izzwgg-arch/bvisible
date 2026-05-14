import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { prisma } from '@bvisible/db';
import { runIngestForTenant } from '@/lib/email-ingest/run';
import { safeCompareSecret } from '@/lib/email-ingest/crypto';

// Internal tick endpoint. Hit by a systemd timer on the host (see
// server-scripts/cron/bvisible-ingest-tick.timer). Public reachability:
//   - Bound to 127.0.0.1:3000 (HOSTNAME in ecosystem.config.cjs).
//   - Nginx ingress does NOT proxy /api/internal/* (see deploy-once.sh
//     nginx config); even if it did, the shared-secret header is the
//     authentication boundary.
//
// Auth model: a single shared secret in INGEST_TICK_SECRET. We compare
// in constant time and refuse anything else with a generic 401. The
// route handler intentionally has no session / cookie path because it
// is invoked by the host, not by a browser.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

const HEADER = 'x-bvisible-ingest-secret';

export async function POST(): Promise<NextResponse> {
  const headerStore = await headers();
  const presented = headerStore.get(HEADER);
  const expected = process.env.INGEST_TICK_SECRET ?? '';

  if (!expected) {
    // Hard refuse if the operator forgot to set the secret in .env;
    // we never want this route to silently 200 with no auth.
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

  // Tenant set: union of (a) tenants with an inbox row, (b) the env
  // fallback tenants (single-tenant install). For (b) we only loop the
  // first tenant in the system to avoid hammering the same env mailbox
  // once per tenant; this is intentional foundation behaviour.
  const inboxTenants = await prisma.tenantEmailInbox.findMany({
    where: { enabled: true },
    select: { tenantId: true },
  });
  const ids = new Set<string>(inboxTenants.map((r) => r.tenantId));

  if (
    ids.size === 0 &&
    process.env.IMAP_HOST &&
    process.env.IMAP_USER &&
    process.env.IMAP_PASSWORD
  ) {
    const fallback = await prisma.tenant.findFirst({
      orderBy: [{ createdAt: 'asc' }],
      select: { id: true },
    });
    if (fallback) ids.add(fallback.id);
  }

  if (ids.size === 0) {
    return NextResponse.json({
      ok: true,
      data: { processed: 0, reports: [] },
    });
  }

  const reports = [];
  for (const tenantId of ids) {
    const r = await runIngestForTenant(tenantId);
    reports.push(r);
  }

  return NextResponse.json({
    ok: true,
    data: { processed: reports.length, reports },
  });
}
