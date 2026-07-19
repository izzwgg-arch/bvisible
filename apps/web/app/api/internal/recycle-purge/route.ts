import { NextResponse } from 'next/server';
import { purgeExpiredRecycleBin } from '@/lib/assistant/recycle';

// Nightly cleanup endpoint for the Recycle Bin — hard-deletes records that
// were soft-deleted more than 30 days ago. Called by a server-side timer
// hitting 127.0.0.1 directly (bypassing nginx). Public requests always come
// through nginx, which stamps X-Forwarded-For; a direct local call has none,
// so the presence of that header means "not the local cron" → rejected.

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  try {
    const { purged } = await purgeExpiredRecycleBin();
    return NextResponse.json({ ok: true, purged });
  } catch (e) {
    console.error('[recycle-purge] failed:', e);
    return NextResponse.json({ error: 'purge failed' }, { status: 500 });
  }
}
