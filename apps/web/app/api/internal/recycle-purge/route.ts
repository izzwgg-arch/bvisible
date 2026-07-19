import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { safeCompareSecret } from '@/lib/email-ingest/crypto';
import { purgeExpiredRecycleBin } from '@/lib/assistant/recycle';

// Nightly Recycle Bin purge — hard-deletes records soft-deleted more than
// 30 days ago. Invoked by a systemd timer on the host, authenticated with
// the same shared secret the email-ingest tick uses (INGEST_TICK_SECRET).
// Same model: 127.0.0.1-bound app, /api/internal/* not proxied by nginx,
// and the secret header is the real auth boundary.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const HEADER = 'x-bvisible-ingest-secret';

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

  try {
    const { purged } = await purgeExpiredRecycleBin();
    return NextResponse.json({ ok: true, purged });
  } catch (e) {
    console.error('[recycle-purge] failed:', e);
    return NextResponse.json({ ok: false, error: 'purge failed' }, { status: 500 });
  }
}
