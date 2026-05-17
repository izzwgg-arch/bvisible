/**
 * Minimal RFC 5322 messages for ingest fixture tests (no external fixtures dir).
 */
export function buildTextEmail(opts: {
  messageId: string;
  subject: string;
  from: string;
  to?: string;
  body: string;
}): Buffer {
  const to = opts.to ?? 'inbox@tenant.local';
  const raw =
    `Message-ID: ${opts.messageId}\r\n` +
    `From: ${opts.from}\r\n` +
    `To: ${to}\r\n` +
    `Subject: ${opts.subject}\r\n` +
    `MIME-Version: 1.0\r\n` +
    `Content-Type: text/plain; charset=utf-8\r\n` +
    `\r\n` +
    `${opts.body.replace(/\n/g, '\r\n')}\r\n`;
  return Buffer.from(raw, 'utf8');
}

/** PDF magic + minimal EOF for mailparser + sniff path. */
export function minimalPdfBytes(): Uint8Array {
  const b = Buffer.concat([
    Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'),
  ]);
  return new Uint8Array(b);
}

export function buildPdfAttachmentEmail(opts: {
  messageId: string;
  subject: string;
  from: string;
  filename: string;
  pdfBytes: Uint8Array;
}): Buffer {
  const boundary = 'bnd_' + opts.messageId.replace(/[^a-z0-9]+/gi, '').slice(0, 20);
  const b64 = Buffer.from(opts.pdfBytes).toString('base64');
  const raw =
    `Message-ID: ${opts.messageId}\r\n` +
    `From: ${opts.from}\r\n` +
    `To: inbox@tenant.local\r\n` +
    `Subject: ${opts.subject}\r\n` +
    `MIME-Version: 1.0\r\n` +
    `Content-Type: multipart/mixed; boundary="${boundary}"\r\n` +
    `\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: text/plain; charset=utf-8\r\n` +
    `\r\n` +
    `See attached.\r\n` +
    `\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: application/pdf; name="${opts.filename}"\r\n` +
    `Content-Disposition: attachment; filename="${opts.filename}"\r\n` +
    `Content-Transfer-Encoding: base64\r\n` +
    `\r\n` +
    `${b64.match(/.{1,72}/g)?.join('\r\n') ?? b64}\r\n` +
    `\r\n` +
    `--${boundary}--\r\n`;
  return Buffer.from(raw, 'utf8');
}
