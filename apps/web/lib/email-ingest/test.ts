import { ImapFlow } from 'imapflow';

// Test-connection helper. Pure library used by BOTH:
//   1. The SUPER_ADMIN form's server action (in-app, cookie-authenticated)
//   2. The /api/internal/email-ingest/test route (service-to-service,
//      shared-secret authenticated)
//
// The function MUST:
//   - never log the password (imapflow's logger is hard-disabled)
//   - never throw a plaintext password back into Error.message (we
//     sanitize via a fixed kind enum + a short generic message)
//   - bound every wait so a wedged mailbox can't deadlock the caller
//   - never mutate the mailbox (read-only open, no flag changes,
//     no message marking)

export type TestImapKind =
  | 'auth_failed'
  | 'mailbox_not_found'
  | 'connect_failed'
  | 'tls_error'
  | 'unknown';

export interface TestImapInput {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  mailbox: string;
}

export interface TestImapSuccess {
  ok: true;
  mailboxCount: number;
  mailboxExists: boolean;
  mailbox: string;
  durationMs: number;
}

export interface TestImapFailure {
  ok: false;
  kind: TestImapKind;
  message: string; // sanitized; safe to surface in UI
  durationMs: number;
}

export type TestImapResult = TestImapSuccess | TestImapFailure;

const FRIENDLY: Record<TestImapKind, string> = {
  auth_failed: 'Authentication failed. Check the username and password.',
  mailbox_not_found:
    'Connected, but the configured mailbox/folder does not exist on the server.',
  connect_failed:
    'Could not reach the IMAP server. Check host, port, and TLS.',
  tls_error: 'TLS handshake failed. Check the TLS toggle and the port.',
  unknown:
    'IMAP test failed for an unexpected reason. The server log has the (sanitized) detail.',
};

// Heuristically classify an imapflow error without exposing internals
// to the UI. We look at the message string only — never at the auth
// object, never at the raw frames.
function classify(err: unknown): TestImapKind {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (
    msg.includes('invalid credentials') ||
    msg.includes('authentication failed') ||
    msg.includes('auth failed') ||
    msg.includes('login failed') ||
    msg.includes('login disabled') ||
    msg.includes('authenticationfailed') ||
    msg.includes('app password') ||
    msg.includes('username and password not accepted')
  ) {
    return 'auth_failed';
  }
  if (
    msg.includes('mailbox does not exist') ||
    msg.includes('nonexistent') ||
    msg.includes('no such mailbox') ||
    msg.includes('mailbox not found') ||
    msg.includes("mailbox doesn't exist")
  ) {
    return 'mailbox_not_found';
  }
  if (
    msg.includes('ssl') ||
    msg.includes('tls') ||
    msg.includes('handshake') ||
    msg.includes('cert') ||
    msg.includes('alpn')
  ) {
    return 'tls_error';
  }
  if (
    msg.includes('econnrefused') ||
    msg.includes('etimedout') ||
    msg.includes('enotfound') ||
    msg.includes('eai_again') ||
    msg.includes('ehostunreach') ||
    msg.includes('econnreset') ||
    msg.includes('socket') ||
    msg.includes('timeout') ||
    msg.includes('greeting')
  ) {
    return 'connect_failed';
  }
  return 'unknown';
}

export async function testImapConnection(
  input: TestImapInput
): Promise<TestImapResult> {
  const startedAt = Date.now();
  const client = new ImapFlow({
    host: input.host,
    port: input.port,
    secure: input.secure,
    auth: { user: input.username, pass: input.password },
    // Pino transport off — we never want a verbose IMAP failure mode
    // to leak the password into PM2 logs.
    logger: false,
    socketTimeout: 15_000,
    greetingTimeout: 8_000,
    emitLogs: false,
  });

  try {
    try {
      await client.connect();
    } catch (err) {
      const kind = classify(err);
      // If connect succeeds at the TLS layer but auth fails, imapflow
      // throws here too. Keep the caller honest with the classified
      // kind rather than the raw message.
      return {
        ok: false,
        kind,
        message: FRIENDLY[kind],
        durationMs: Date.now() - startedAt,
      };
    }

    let mailboxCount = 0;
    let mailboxExists = false;
    try {
      const list = await client.list();
      mailboxCount = list.length;
      const wanted = input.mailbox.toLowerCase();
      mailboxExists = list.some(
        (m) =>
          m.path.toLowerCase() === wanted ||
          m.name.toLowerCase() === wanted
      );
    } catch (err) {
      const kind = classify(err);
      return {
        ok: false,
        kind,
        message: FRIENDLY[kind],
        durationMs: Date.now() - startedAt,
      };
    }

    if (!mailboxExists) {
      return {
        ok: false,
        kind: 'mailbox_not_found',
        message: FRIENDLY.mailbox_not_found,
        durationMs: Date.now() - startedAt,
      };
    }

    return {
      ok: true,
      mailboxCount,
      mailboxExists: true,
      mailbox: input.mailbox,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    // Always log out. Catch-and-ignore so a stuck logout doesn't shadow
    // the actual test result.
    await client.logout().catch(() => undefined);
  }
}
