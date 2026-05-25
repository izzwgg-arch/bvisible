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

/** Minimal PNG (1×1) for inline-image spam fixtures. */
export function minimalPngBytes(): Uint8Array {
  const b64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/** Non-allowlisted bytes (not PDF/PNG/JPEG/WebP magic). */
export function unsupportedBinaryBytes(): Uint8Array {
  return new Uint8Array(Buffer.from('MZ\x90\x00fake-exe-header-for-fixture'));
}

function boundaryFromMessageId(messageId: string, prefix: string): string {
  return `${prefix}_${messageId.replace(/[^a-z0-9]+/gi, '').slice(0, 16)}`;
}

function encodeBase64Body(bytes: Uint8Array): string {
  const b64 = Buffer.from(bytes).toString('base64');
  return b64.match(/.{1,72}/g)?.join('\r\n') ?? b64;
}

type MixedPart =
  | {
      kind: 'attachment';
      filename: string;
      contentType: string;
      bytes: Uint8Array;
      disposition?: 'attachment' | 'inline';
    }
  | { kind: 'empty'; filename: string; contentType: string };

export function buildMixedAttachmentEmail(opts: {
  messageId: string;
  subject: string;
  from: string;
  body?: string;
  parts: ReadonlyArray<MixedPart>;
}): Buffer {
  const boundary = boundaryFromMessageId(opts.messageId, 'bnd_mix');
  const chunks: string[] = [
    `Message-ID: ${opts.messageId}\r\n`,
    `From: ${opts.from}\r\n`,
    `To: inbox@tenant.local\r\n`,
    `Subject: ${opts.subject}\r\n`,
    `MIME-Version: 1.0\r\n`,
    `Content-Type: multipart/mixed; boundary="${boundary}"\r\n`,
    `\r\n`,
    `--${boundary}\r\n`,
    `Content-Type: text/plain; charset=utf-8\r\n`,
    `\r\n`,
    `${(opts.body ?? 'See attachments.').replace(/\n/g, '\r\n')}\r\n`,
  ];
  for (const part of opts.parts) {
    const disposition =
      part.kind === 'attachment' && part.disposition === 'inline'
        ? 'inline'
        : 'attachment';
    if (part.kind === 'empty') {
      chunks.push(
        `\r\n--${boundary}\r\n`,
        `Content-Type: ${part.contentType}; name="${part.filename}"\r\n`,
        `Content-Disposition: ${disposition}; filename="${part.filename}"\r\n`,
        `Content-Transfer-Encoding: base64\r\n`,
        `\r\n`,
        `\r\n`,
      );
      continue;
    }
    chunks.push(
      `\r\n--${boundary}\r\n`,
      `Content-Type: ${part.contentType}; name="${part.filename}"\r\n`,
      `Content-Disposition: ${disposition}; filename="${part.filename}"\r\n`,
      `Content-Transfer-Encoding: base64\r\n`,
      `\r\n`,
      `${encodeBase64Body(part.bytes)}\r\n`,
    );
  }
  chunks.push(`\r\n--${boundary}--\r\n`);
  return Buffer.from(chunks.join(''), 'utf8');
}

/** Forwarded chain retaining original vendor headers in the body. */
export function buildForwardedVendorChainEmail(opts: {
  messageId: string;
  subject: string;
  forwarderFrom: string;
  originalFrom: string;
  originalSubject: string;
  bodyTail?: string;
}): Buffer {
  const body = [
    '---------- Forwarded message ---------',
    `From: ${opts.originalFrom}`,
    'Date: Mon, 12 May 2026 09:15:00 -0400',
    `Subject: ${opts.originalSubject}`,
    'To: buyer@client.com',
    '',
    'Please confirm shipment for PO-6100.',
    opts.bodyTail ?? '',
  ]
    .filter(Boolean)
    .join('\n');
  return buildTextEmail({
    messageId: opts.messageId,
    subject: opts.subject,
    from: opts.forwarderFrom,
    body,
  });
}

export function buildMultiPdfAttachmentEmail(opts: {
  messageId: string;
  subject: string;
  from: string;
  files: ReadonlyArray<{ filename: string; pdfBytes: Uint8Array }>;
}): Buffer {
  return buildMixedAttachmentEmail({
    messageId: opts.messageId,
    subject: opts.subject,
    from: opts.from,
    body: 'Multiple invoices attached.',
    parts: opts.files.map((f) => ({
      kind: 'attachment' as const,
      filename: f.filename,
      contentType: 'application/pdf',
      bytes: f.pdfBytes,
    })),
  });
}

export function buildPdfAttachmentEmail(opts: {
  messageId: string;
  subject: string;
  from: string;
  filename: string;
  pdfBytes: Uint8Array;
}): Buffer {
  return buildMixedAttachmentEmail({
    messageId: opts.messageId,
    subject: opts.subject,
    from: opts.from,
    parts: [
      {
        kind: 'attachment',
        filename: opts.filename,
        contentType: 'application/pdf',
        bytes: opts.pdfBytes,
      },
    ],
  });
}

/** Inline decorative images plus one real PDF attachment. */
export function buildInlineImageSpamEmail(opts: {
  messageId: string;
  subject: string;
  from: string;
  pdfBytes?: Uint8Array;
  inlineImageCount?: number;
}): Buffer {
  const png = minimalPngBytes();
  const pdf = opts.pdfBytes ?? minimalPdfBytes();
  const inlineCount = opts.inlineImageCount ?? 4;
  const parts: MixedPart[] = [];
  for (let i = 0; i < inlineCount; i++) {
    parts.push({
      kind: 'attachment',
      filename: `logo-${i + 1}.png`,
      contentType: 'image/png',
      bytes: png,
      disposition: 'inline',
    });
  }
  parts.push({
    kind: 'attachment',
    filename: 'invoice.pdf',
    contentType: 'application/pdf',
    bytes: pdf,
  });
  return buildMixedAttachmentEmail({
    messageId: opts.messageId,
    subject: opts.subject,
    from: opts.from,
    body: 'Please see attached invoice.',
    parts,
  });
}

/** Zero-byte attachment part alongside a valid PDF. */
export function buildEmptyAttachmentEmail(opts: {
  messageId: string;
  subject: string;
  from: string;
  emptyFilename?: string;
  validPdfBytes?: Uint8Array;
}): Buffer {
  return buildMixedAttachmentEmail({
    messageId: opts.messageId,
    subject: opts.subject,
    from: opts.from,
    body: 'Empty + valid attachments.',
    parts: [
      {
        kind: 'empty',
        filename: opts.emptyFilename ?? 'blank.pdf',
        contentType: 'application/pdf',
      },
      {
        kind: 'attachment',
        filename: 'real-invoice.pdf',
        contentType: 'application/pdf',
        bytes: opts.validPdfBytes ?? minimalPdfBytes(),
      },
    ],
  });
}

/** Unsupported binary plus a valid PDF in one message. */
export function buildUnsupportedPlusPdfEmail(opts: {
  messageId: string;
  subject: string;
  from: string;
  badFilename?: string;
  pdfFilename?: string;
}): Buffer {
  return buildMixedAttachmentEmail({
    messageId: opts.messageId,
    subject: opts.subject,
    from: opts.from,
    parts: [
      {
        kind: 'attachment',
        filename: opts.badFilename ?? 'setup.exe',
        contentType: 'application/octet-stream',
        bytes: unsupportedBinaryBytes(),
      },
      {
        kind: 'attachment',
        filename: opts.pdfFilename ?? 'invoice.pdf',
        contentType: 'application/pdf',
        bytes: minimalPdfBytes(),
      },
    ],
  });
}
