import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { safeCompareSecret } from '@/lib/email-ingest/crypto';
import { runOcrWorkerTick } from '@/lib/ocr/worker';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const HEADER = 'x-bvisible-ocr-secret';

/**
 * Internal OCR worker tick. Invoke from systemd timer / cron on localhost only,
 * same posture as `/api/internal/email-ingest/tick` (see SECURITY_RULES.md).
 */
export async function POST(): Promise<NextResponse> {
  const headerStore = await headers();
  const presented = headerStore.get(HEADER);
  const expected =
    process.env.OCR_TICK_SECRET ?? process.env.INGEST_TICK_SECRET ?? '';

  if (!expected) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'no_secret',
          message: 'OCR tick secret not configured.',
        },
      },
      { status: 503 }
    );
  }

  if (!safeCompareSecret(presented, expected)) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'unauthorized',
          message: 'Invalid OCR tick secret.',
        },
      },
      { status: 401 }
    );
  }

  const { processed } = await runOcrWorkerTick(3);
  return NextResponse.json({
    ok: true,
    data: { processed },
  });
}
