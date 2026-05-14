import { simpleParser, type AddressObject } from 'mailparser';

// Reduced, sanitized projection of a vendor email for downstream use.
// We intentionally do NOT round-trip the full HTML body: it's a
// massive source of XSS surface area and we don't render it. The
// review screen shows `bodyTextSnippet` (text/plain or text-extracted)
// truncated to ~2 KB.

export interface ParsedAttachment {
  filename: string;
  contentType: string;
  bytes: Uint8Array;
}

export interface ParsedEmail {
  messageId: string | null;
  fromAddress: string;
  fromName: string | null;
  toAddress: string | null;
  subject: string;
  receivedAt: Date;
  bodyTextSnippet: string | null;
  attachments: ParsedAttachment[];
}

const SNIPPET_BYTES = 2048;

function firstAddress(addr: AddressObject | AddressObject[] | undefined): {
  address: string;
  name: string | null;
} | null {
  if (!addr) return null;
  const arr = Array.isArray(addr) ? addr : [addr];
  for (const a of arr) {
    for (const v of a.value ?? []) {
      if (v.address) {
        return { address: v.address, name: v.name || null };
      }
    }
  }
  return null;
}

function joinAddresses(
  addr: AddressObject | AddressObject[] | undefined
): string | null {
  if (!addr) return null;
  const arr = Array.isArray(addr) ? addr : [addr];
  const out: string[] = [];
  for (const a of arr) {
    for (const v of a.value ?? []) {
      if (v.address) out.push(v.address);
    }
  }
  return out.length === 0 ? null : out.join(', ');
}

function clipSnippet(s: string | undefined | null): string | null {
  if (!s) return null;
  // Strip nul + bare control chars; collapse whitespace; clip.
  const cleaned = s
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (cleaned.length === 0) return null;
  if (cleaned.length <= SNIPPET_BYTES) return cleaned;
  return `${cleaned.slice(0, SNIPPET_BYTES - 1)}…`;
}

export async function parseRawMessage(
  rawSource: Buffer
): Promise<ParsedEmail> {
  const parsed = await simpleParser(rawSource, {
    skipImageLinks: true,
    skipHtmlToText: false,
  });

  const from = firstAddress(parsed.from);
  if (!from || !from.address) {
    throw new Error('email_missing_from');
  }

  const to = joinAddresses(parsed.to);
  const subject = (parsed.subject || '(no subject)').trim().slice(0, 500);
  const receivedAt = parsed.date ?? new Date();

  // mailparser populates `text` even if only HTML was sent (it does
  // the conversion internally).
  const snippet = clipSnippet(parsed.text);

  const attachments: ParsedAttachment[] = (parsed.attachments ?? [])
    .filter((a) => a.content && a.content.length > 0)
    .map((a) => ({
      filename: a.filename || 'attachment',
      contentType: a.contentType || 'application/octet-stream',
      bytes: new Uint8Array(a.content as Buffer),
    }));

  return {
    messageId: parsed.messageId ? parsed.messageId.trim() : null,
    fromAddress: from.address.toLowerCase(),
    fromName: from.name,
    toAddress: to,
    subject,
    receivedAt,
    bodyTextSnippet: snippet,
    attachments,
  };
}
