import { NextRequest, NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { prisma } from '@bvisible/db';
import { openSecret, safeCompareSecret } from '@/lib/email-ingest/crypto';
import { testImapConnection } from '@/lib/email-ingest/test';
import { internalTestInboxSchema } from '@/lib/validators';

// Internal test endpoint. Same auth posture as /api/internal/email-
// ingest/tick: constant-time compare against INGEST_TICK_SECRET in the
// `x-bvisible-ingest-secret` header. NOT a session route. Public
// reachability:
//   - Bound to 127.0.0.1:3000 (HOSTNAME in ecosystem.config.cjs).
//   - Nginx ingress does NOT proxy /api/internal/* and the middleware
//     whitelists this path so the same loopback POST works as for /tick.
//
// Behavior:
//   - Read JSON body; validate via zod.
//   - If `password` is omitted AND `tenantId` is supplied, decrypt the
//     stored sealed cipher and use it. (Lets a sysadmin rotate host/
//     port/mailbox without re-typing the password.)
//   - Open IMAP, list mailboxes, check the configured one exists.
//   - Return the sanitized result body.
//
// What it must NEVER do:
//   - mutate any DB row
//   - mark messages \Seen
//   - return the password
//   - log the password or the auth object

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

const HEADER = 'x-bvisible-ingest-secret';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const headerStore = await headers();
  const presented = headerStore.get(HEADER);
  const expected = process.env.INGEST_TICK_SECRET ?? '';

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

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: 'bad_body', message: 'Body must be JSON.' } },
      { status: 400 }
    );
  }

  const parsed = internalTestInboxSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'invalid',
          message: parsed.error.issues[0]?.message ?? 'Invalid request body.',
        },
      },
      { status: 400 }
    );
  }

  const body = parsed.data;
  let password = body.password;

  if (!password && body.tenantId) {
    const row = await prisma.tenantEmailInbox.findUnique({
      where: { tenantId: body.tenantId },
      select: { passwordCipher: true, tenantId: true },
    });
    if (row) {
      try {
        password = openSecret(row.passwordCipher);
      } catch {
        return NextResponse.json(
          {
            ok: false,
            error: {
              code: 'cipher_open_failed',
              message:
                'Could not decrypt the stored password. INGEST_SECRET may have been rotated.',
            },
          },
          { status: 500 }
        );
      }
    }
  }

  if (!password) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: 'password_required',
          message:
            'Password is required (or pass tenantId to use the stored sealed password).',
        },
      },
      { status: 400 }
    );
  }

  const result = await testImapConnection({
    host: body.host,
    port: body.port,
    secure: body.secure,
    username: body.username,
    password,
    mailbox: body.mailbox,
  });

  return NextResponse.json({ ok: true, data: result });
}
