// Mailer foundation. Provider-agnostic on purpose: today this wraps a
// stock SMTP transport via Nodemailer; swapping to Postmark/Resend/SES
// later means rewriting only THIS file. Nothing in app code imports
// nodemailer directly.
//
// Logging discipline (also enforced by SECURITY_RULES.md):
//   - never log the SMTP password
//   - never log the full transporter config object
//   - never log raw token URLs (they grant account control)
//   - log only host/port/secure/maskedUser/messageId on success
//   - log only host/port/secure/maskedUser/code/responseCode/safeMessage
//     on failure
//
// Errors are typed so callers can map cleanly to UI strings without
// passing internal nodemailer error fields to the browser.

import nodemailer, { type Transporter } from 'nodemailer';
import type SMTPPool from 'nodemailer/lib/smtp-pool';
import { z } from 'zod';

// -- Config ------------------------------------------------------------

const smtpConfigSchema = z.object({
  host: z.string().min(1, 'SMTP_HOST is required'),
  port: z.coerce.number().int().min(1).max(65535),
  // `secure: true` ⇒ TLS-on-connect (smtps://, port 465).
  // `secure: false` ⇒ plain or STARTTLS, depending on server capability
  // (we leave STARTTLS auto-negotiation to nodemailer).
  secure: z.boolean(),
  user: z.string().min(1, 'SMTP_USER is required'),
  password: z.string().min(1, 'SMTP_PASSWORD is required'),
  from: z.string().min(1, 'SMTP_FROM is required'),
  replyTo: z.string().optional(),
});

export type SmtpConfig = z.infer<typeof smtpConfigSchema>;

export interface SafeSmtpDiagnostics {
  host: string;
  port: number;
  secure: boolean;
  maskedUser: string;
  from: string;
  replyTo?: string | undefined;
}

// Config errors are recoverable (admin can fix .env). Distinct class so
// the UI can print "Mailer not configured: SMTP_HOST is required" as
// opposed to a network error.
export class MailerConfigError extends Error {
  readonly kind = 'config' as const;
  constructor(message: string) {
    super(message);
    this.name = 'MailerConfigError';
  }
}

export class MailerSendError extends Error {
  readonly kind: MailerErrorKind;
  readonly code: string | null;
  readonly responseCode: number | null;
  constructor(
    kind: MailerErrorKind,
    message: string,
    code: string | null = null,
    responseCode: number | null = null
  ) {
    super(message);
    this.name = 'MailerSendError';
    this.kind = kind;
    this.code = code;
    this.responseCode = responseCode;
  }
}

export type MailerErrorKind =
  | 'connect' // ECONNREFUSED, ENOTFOUND, ETIMEDOUT on connect
  | 'auth' // 535-style SMTP auth failure
  | 'timeout' // socket timeout mid-conversation
  | 'recipient' // 5xx on RCPT
  | 'sender' // 5xx on MAIL FROM (often DKIM/SPF)
  | 'unknown';

export interface SendResult {
  messageId: string;
  accepted: ReadonlyArray<string>;
  rejected: ReadonlyArray<string>;
  response: string;
}

// -- Loader ------------------------------------------------------------

// Reading these is cheap, but we cache the parsed result so a long-
// running process doesn't reparse on every send. The cache is per
// process lifetime — touching .env requires a PM2 reload, which kills
// this cache anyway.
let configCache: SmtpConfig | MailerConfigError | null = null;

export function loadSmtpConfig(): SmtpConfig | MailerConfigError {
  if (configCache !== null) return configCache;
  const raw = {
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    user: process.env.SMTP_USER,
    // Honor the legacy SMTP_APP_PASSWORD key as a fallback so an
    // operator who already filled in the speculative ingestion key
    // doesn't have to duplicate it. SMTP_PASSWORD wins if both set.
    password: process.env.SMTP_PASSWORD ?? process.env.SMTP_APP_PASSWORD,
    from: process.env.SMTP_FROM,
    replyTo: process.env.SMTP_REPLY_TO,
    // Default: secure=true on 465, false on 587/25/2525. Allow override.
    secure: parseSecure(process.env.SMTP_SECURE, process.env.SMTP_PORT),
  };
  const parsed = smtpConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `${i.path.join('.') || 'config'}: ${i.message}`)
      .join('; ');
    configCache = new MailerConfigError(msg);
    return configCache;
  }
  configCache = parsed.data;
  return configCache;
}

function parseSecure(raw: string | undefined, portRaw: string | undefined): boolean {
  if (raw === '1' || raw?.toLowerCase() === 'true') return true;
  if (raw === '0' || raw?.toLowerCase() === 'false') return false;
  // No explicit setting → infer from port. 465 is the only IANA-assigned
  // implicit-TLS SMTP port; everything else is STARTTLS or plain.
  return portRaw === '465';
}

// -- Transport ---------------------------------------------------------

let transportCache: Transporter<SMTPPool.SentMessageInfo> | null = null;

function getTransport(config: SmtpConfig): Transporter<SMTPPool.SentMessageInfo> {
  if (transportCache) return transportCache;
  transportCache = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    // 10s caps so a dead SMTP server doesn't pin a server-action handler.
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 10_000,
    // Pool keeps the connection warm between sends in this process.
    pool: true,
    maxConnections: 2,
    maxMessages: 50,
  });
  return transportCache;
}

// -- Logging helpers ---------------------------------------------------

export function maskUser(u: string): string {
  const [local, domain] = u.split('@');
  if (!local || !domain) return '***';
  const head = local.slice(0, 1);
  const tail = local.length > 2 ? local.slice(-1) : '';
  return `${head}${'*'.repeat(Math.max(1, local.length - head.length - tail.length))}${tail}@${domain}`;
}

export function diagnosticsFor(config: SmtpConfig): SafeSmtpDiagnostics {
  return {
    host: config.host,
    port: config.port,
    secure: config.secure,
    maskedUser: maskUser(config.user),
    from: config.from,
    replyTo: config.replyTo,
  };
}

function logSafe(
  level: 'info' | 'warn' | 'error',
  msg: string,
  fields: Record<string, unknown> | SafeSmtpDiagnostics
): void {
  const line = JSON.stringify({ level, msg, mailer: true, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

// -- Public API --------------------------------------------------------

export interface SendMailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface VerifyResult {
  ok: boolean;
  diagnostics: SafeSmtpDiagnostics;
  error?: { kind: MailerErrorKind | 'config'; message: string; code?: string | null; responseCode?: number | null };
}

export async function verifyTransport(): Promise<VerifyResult> {
  const config = loadSmtpConfig();
  if (config instanceof MailerConfigError) {
    logSafe('warn', 'smtp_verify_skipped_no_config', { message: config.message });
    return {
      ok: false,
      diagnostics: emptyDiagnostics(),
      error: { kind: 'config', message: config.message },
    };
  }
  const diagnostics = diagnosticsFor(config);
  try {
    const transport = getTransport(config);
    await transport.verify();
    logSafe('info', 'smtp_verify_ok', diagnostics);
    return { ok: true, diagnostics };
  } catch (err) {
    const mapped = mapTransportError(err);
    logSafe('error', 'smtp_verify_failed', {
      ...diagnostics,
      kind: mapped.kind,
      code: mapped.code,
      responseCode: mapped.responseCode,
      message: mapped.message,
    });
    return {
      ok: false,
      diagnostics,
      error: {
        kind: mapped.kind,
        message: mapped.message,
        code: mapped.code,
        responseCode: mapped.responseCode,
      },
    };
  }
}

export async function sendMail(input: SendMailInput): Promise<
  | { ok: true; result: SendResult; diagnostics: SafeSmtpDiagnostics }
  | { ok: false; error: MailerConfigError | MailerSendError; diagnostics: SafeSmtpDiagnostics }
> {
  const config = loadSmtpConfig();
  if (config instanceof MailerConfigError) {
    logSafe('warn', 'smtp_send_skipped_no_config', { message: config.message });
    return { ok: false, error: config, diagnostics: emptyDiagnostics() };
  }
  const diagnostics = diagnosticsFor(config);
  try {
    const transport = getTransport(config);
    const info = await transport.sendMail({
      from: config.from,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
      ...(config.replyTo ? { replyTo: config.replyTo } : {}),
    });
    const result: SendResult = {
      messageId: info.messageId,
      accepted: (info.accepted ?? []).map(String),
      rejected: (info.rejected ?? []).map(String),
      response: typeof info.response === 'string' ? info.response : '',
    };
    logSafe('info', 'smtp_send_ok', {
      ...diagnostics,
      messageId: result.messageId,
      acceptedCount: result.accepted.length,
      rejectedCount: result.rejected.length,
    });
    return { ok: true, result, diagnostics };
  } catch (err) {
    const mapped = mapTransportError(err);
    logSafe('error', 'smtp_send_failed', {
      ...diagnostics,
      kind: mapped.kind,
      code: mapped.code,
      responseCode: mapped.responseCode,
      message: mapped.message,
    });
    return { ok: false, error: mapped, diagnostics };
  }
}

function emptyDiagnostics(): SafeSmtpDiagnostics {
  return { host: '', port: 0, secure: false, maskedUser: '', from: '' };
}

// Map nodemailer's error grab-bag onto our typed surface. Nodemailer
// surfaces SMTP response codes at `err.responseCode` (number) and OS
// errors at `err.code` (string like ECONNREFUSED).
function mapTransportError(err: unknown): MailerSendError {
  const e = err as { code?: string; responseCode?: number; message?: string; command?: string };
  const code = typeof e?.code === 'string' ? e.code : null;
  const responseCode = typeof e?.responseCode === 'number' ? e.responseCode : null;
  const message = typeof e?.message === 'string' ? sanitize(e.message) : 'SMTP send failed';

  // Network-level errors first.
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EHOSTUNREACH') {
    return new MailerSendError('connect', `Could not reach SMTP server (${code}).`, code, responseCode);
  }
  if (code === 'ETIMEDOUT' || code === 'ESOCKET') {
    return new MailerSendError('timeout', 'SMTP server did not respond in time.', code, responseCode);
  }
  // Auth failures: SMTP 535/534 + nodemailer command 'AUTH'.
  if (responseCode === 535 || responseCode === 534 || e?.command === 'AUTH PLAIN' || e?.command === 'AUTH LOGIN') {
    return new MailerSendError('auth', 'SMTP authentication failed. Check SMTP_USER and SMTP_PASSWORD.', code, responseCode);
  }
  // Recipient rejection (5xx on RCPT).
  if (e?.command === 'RCPT TO' || (typeof responseCode === 'number' && responseCode >= 550 && responseCode <= 559)) {
    return new MailerSendError('recipient', 'Recipient rejected by SMTP server.', code, responseCode);
  }
  // Sender rejection (5xx on MAIL FROM, often DKIM/SPF).
  if (e?.command === 'MAIL FROM') {
    return new MailerSendError('sender', 'Sender address rejected by SMTP server.', code, responseCode);
  }
  return new MailerSendError('unknown', message, code, responseCode);
}

function sanitize(message: string): string {
  // Strip anything that smells like a credential out of error messages
  // before they bubble up. Nodemailer doesn't usually echo the password
  // but defense-in-depth.
  return message
    .replace(/pass(word)?[=:]\s*\S+/gi, 'password=[redacted]')
    .replace(/\bauth\s+\S+/gi, 'auth [redacted]');
}
