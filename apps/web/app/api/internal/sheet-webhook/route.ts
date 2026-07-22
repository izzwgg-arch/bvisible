import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { prisma } from '@bvisible/db';
import { safeCompareSecret } from '@/lib/email-ingest/crypto';
import { runSheetSync } from '@/lib/sheet-sync/sync';

// Instant Sheet→DB sync. A Google Apps Script onEdit trigger installed on
// the pricing Sheet POSTs here whenever the owner edits any cell, so the
// database follows within seconds instead of the 5-minute pull TTL (which
// stays in place as the fallback reconciler).
//
// Auth: same shared-secret model as the other internal endpoints
// (INGEST_TICK_SECRET header, constant-time compare).

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 120;

const HEADER = 'x-bvisible-ingest-secret';

// Basic debounce: Apps Script fires on every cell edit; syncing more than
// once per 20s is wasted work.
let lastRunAt = 0;

export async function POST(): Promise<NextResponse> {
  const headerStore = await headers();
  const presented = headerStore.get(HEADER);
  const expected = process.env.INGEST_TICK_SECRET ?? '';
  if (!expected) {
    return NextResponse.json({ ok: false, error: 'Secret not configured.' }, { status: 503 });
  }
  if (!safeCompareSecret(presented, expected)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 });
  }

  if (Date.now() - lastRunAt < 20_000) {
    return NextResponse.json({ ok: true, debounced: true });
  }
  lastRunAt = Date.now();

  const tenant = await prisma.tenant.findFirst({ orderBy: [{ createdAt: 'asc' }], select: { id: true } });
  if (!tenant) return NextResponse.json({ ok: false, error: 'No tenant.' }, { status: 500 });

  const result = await runSheetSync(tenant.id);
  return NextResponse.json({ ok: result.ok, materialCount: result.materialCount ?? 0, error: result.error ?? null });
}
