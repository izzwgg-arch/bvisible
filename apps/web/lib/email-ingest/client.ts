import { ImapFlow, type FetchMessageObject } from 'imapflow';
import type { ResolvedInbox } from './config';

// Thin wrapper over imapflow that:
//  - bounds connect/idle/socket time so a stuck mailbox can never wedge
//    the tick longer than ~30s,
//  - never logs the password (we pass `logger: false` so imapflow's
//    pino transport is suppressed entirely),
//  - exposes the four primitives we need: connect, listUnseen, fetchOne,
//    markSeen, close.

export interface RawMessage {
  uid: number;
  source: Buffer;
}

export interface ImapClient {
  fetchUnseen(maxBatch: number): Promise<RawMessage[]>;
  markSeen(uid: number): Promise<void>;
  close(): Promise<void>;
}

export class ImapConnectError extends Error {
  readonly kind = 'imap_connect' as const;
  constructor(message: string) {
    super(message);
    this.name = 'ImapConnectError';
  }
}

export async function openImap(profile: ResolvedInbox): Promise<ImapClient> {
  const client = new ImapFlow({
    host: profile.host,
    port: profile.port,
    secure: profile.secure,
    auth: { user: profile.username, pass: profile.password },
    // Disable imapflow's internal logger entirely so a verbose
    // failure mode never accidentally writes the password (or any
    // raw frame containing it) to PM2 logs.
    logger: false,
    // Bound everything; defaults are 90s+.
    socketTimeout: 30_000,
    greetingTimeout: 10_000,
    emitLogs: false,
  });

  try {
    await client.connect();
  } catch (err) {
    throw new ImapConnectError(
      err instanceof Error ? err.message : 'connect failed'
    );
  }

  // Open the configured mailbox in read-write so we can mark \Seen.
  try {
    await client.mailboxOpen(profile.mailbox, { readOnly: false });
  } catch (err) {
    await client.logout().catch(() => undefined);
    throw new ImapConnectError(
      err instanceof Error
        ? `cannot open mailbox: ${err.message}`
        : 'cannot open mailbox'
    );
  }

  return {
    async fetchUnseen(maxBatch: number): Promise<RawMessage[]> {
      const out: RawMessage[] = [];
      // imapflow's fetch() is an async iterator. Pass `seen: false` to
      // narrow to UNSEEN; we keep our own UNIQUE(messageId) idempotency
      // because UNSEEN can be racy across clients (e.g. a phone also
      // looking at the inbox).
      for await (const msg of client.fetch(
        { seen: false },
        { uid: true, source: true }
      ) as AsyncIterable<FetchMessageObject>) {
        if (!msg.source) continue;
        out.push({
          uid: msg.uid,
          source: Buffer.isBuffer(msg.source)
            ? msg.source
            : Buffer.from(msg.source),
        });
        if (out.length >= maxBatch) break;
      }
      return out;
    },
    async markSeen(uid: number): Promise<void> {
      await client.messageFlagsAdd({ uid: String(uid) }, ['\\Seen'], {
        uid: true,
      });
    },
    async close(): Promise<void> {
      await client.logout().catch(() => undefined);
    },
  };
}
