import { prisma, type TenantEmailInbox } from '@bvisible/db';
import { openSecret, sealSecret } from './crypto';

// Resolved IMAP connection profile for a single tenant. The plaintext
// password is held only in process memory for the duration of one
// tick; nothing else stores it.
export interface ResolvedInbox {
  tenantId: string;
  host: string;
  port: number;
  secure: boolean;
  mailbox: string;
  username: string;
  password: string;
  pollIntervalSeconds: number;
}

export interface DiagInbox {
  configured: boolean;
  source: 'db' | 'env' | 'none';
  host: string | null;
  port: number | null;
  secure: boolean | null;
  mailbox: string | null;
  maskedUsername: string | null;
  pollIntervalSeconds: number | null;
  enabled: boolean | null;
  lastPolledAt: Date | null;
  lastErrorAt: Date | null;
  lastErrorMessage: string | null;
}

function clampPollSeconds(n: number | undefined | null, fallback = 60): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return fallback;
  if (n < 30) return 30;
  if (n > 3600) return 3600;
  return Math.floor(n);
}

function maskUsername(u: string | null | undefined): string | null {
  if (!u) return null;
  const at = u.indexOf('@');
  if (at <= 0) {
    if (u.length <= 2) return '***';
    return `${u[0]}***${u[u.length - 1]}`;
  }
  const local = u.slice(0, at);
  const domain = u.slice(at);
  if (local.length <= 2) return `***${domain}`;
  return `${local[0]}***${local[local.length - 1]}${domain}`;
}

// Returns a fully-resolved inbox profile or null when neither the DB
// row nor the env fallback yields a complete config. All callers MUST
// treat null as "skip this tenant" — never assume a partial config.
export async function loadResolvedInbox(
  tenantId: string
): Promise<ResolvedInbox | null> {
  const row = await prisma.tenantEmailInbox.findUnique({
    where: { tenantId },
  });
  if (row && row.enabled) {
    try {
      const password = openSecret(row.passwordCipher);
      return {
        tenantId,
        host: row.host,
        port: row.port,
        secure: row.secure,
        mailbox: row.mailbox,
        username: row.username,
        password,
        pollIntervalSeconds: clampPollSeconds(row.pollIntervalSeconds),
      };
    } catch {
      // Decryption failed (e.g. INGEST_SECRET rotated). The caller
      // logs against the run record; never echo the cipher or raw
      // openssl error.
      return null;
    }
  }

  // .env fallback for the single-tenant install. Useful before the
  // operator reaches the in-app config form for the first tenant.
  const envHost = process.env.IMAP_HOST;
  const envUser = process.env.IMAP_USER;
  const envPass = process.env.IMAP_PASSWORD;
  if (!envHost || !envUser || !envPass) return null;
  const envPort = Number.parseInt(process.env.IMAP_PORT ?? '993', 10);
  const envTls =
    (process.env.IMAP_TLS ?? 'true').toLowerCase() !== 'false';
  const envMailbox = process.env.IMAP_MAILBOX || 'INBOX';
  const envInterval = Number.parseInt(
    process.env.IMAP_POLL_INTERVAL_SECONDS ?? '60',
    10
  );
  return {
    tenantId,
    host: envHost,
    port: Number.isFinite(envPort) ? envPort : 993,
    secure: envTls,
    mailbox: envMailbox,
    username: envUser,
    password: envPass,
    pollIntervalSeconds: clampPollSeconds(envInterval),
  };
}

// Diagnostic projection — never exposes the password and only ever
// hits the DB row (the env-fallback path is reported separately).
export async function loadInboxDiag(tenantId: string): Promise<DiagInbox> {
  const row: TenantEmailInbox | null =
    await prisma.tenantEmailInbox.findUnique({
      where: { tenantId },
    });
  if (row) {
    return {
      configured: true,
      source: 'db',
      host: row.host,
      port: row.port,
      secure: row.secure,
      mailbox: row.mailbox,
      maskedUsername: maskUsername(row.username),
      pollIntervalSeconds: row.pollIntervalSeconds,
      enabled: row.enabled,
      lastPolledAt: row.lastPolledAt,
      lastErrorAt: row.lastErrorAt,
      lastErrorMessage: row.lastErrorMessage,
    };
  }
  // Env fallback diagnostics. We do NOT report `lastPolledAt` from env
  // because there's no row to track it on.
  if (process.env.IMAP_HOST && process.env.IMAP_USER) {
    return {
      configured: true,
      source: 'env',
      host: process.env.IMAP_HOST,
      port: Number.parseInt(process.env.IMAP_PORT ?? '993', 10),
      secure: (process.env.IMAP_TLS ?? 'true').toLowerCase() !== 'false',
      mailbox: process.env.IMAP_MAILBOX || 'INBOX',
      maskedUsername: maskUsername(process.env.IMAP_USER),
      pollIntervalSeconds: clampPollSeconds(
        Number.parseInt(process.env.IMAP_POLL_INTERVAL_SECONDS ?? '60', 10)
      ),
      enabled: true,
      lastPolledAt: null,
      lastErrorAt: null,
      lastErrorMessage: null,
    };
  }
  return {
    configured: false,
    source: 'none',
    host: null,
    port: null,
    secure: null,
    mailbox: null,
    maskedUsername: null,
    pollIntervalSeconds: null,
    enabled: null,
    lastPolledAt: null,
    lastErrorAt: null,
    lastErrorMessage: null,
  };
}

// Helper used by the SUPER_ADMIN config form (not built in this
// foundation, kept here for the future). Never exposed via a
// JSON response.
export function _sealForStorage(plain: string): string {
  return sealSecret(plain).cipherText;
}
