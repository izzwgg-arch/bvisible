// cXML document construction and parsing for the Amazon Business integration.
//
// Kept free of database, network, and environment access so the whole
// protocol layer is unit-testable: every function here maps values to a
// string or a string to values. The pieces that talk to Amazon live in
// punchout.ts / order-request.ts.
//
// Money is handled in integer cents everywhere inside B Visible
// (CODING_STANDARDS.md) and only converted to cXML's decimal string at the
// boundary — floats never accumulate across lines.

import { XMLParser } from 'fast-xml-parser';

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/// cXML wants a plain decimal, never a currency symbol or thousands
/// separator. Derived from integer cents so it cannot drift.
export function centsToAmount(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/// Inverse of centsToAmount, tolerant of what suppliers actually send:
/// "2.64", "2.6", "2", " 2.64 ". Returns 0 for anything unparseable rather
/// than NaN, which would silently poison a PO total.
export function amountToCents(amount: string | number | null | undefined): number {
  if (typeof amount === 'number') return Math.round(amount * 100);
  const t = String(amount ?? '').trim().replace(/,/g, '');
  if (!/^-?\d*(\.\d+)?$/.test(t) || t === '' || t === '-') return 0;
  return Math.round(Number(t) * 100);
}

/// cXML timestamps are ISO 8601 with an offset. Amazon rejects a bare "Z"-less
/// local time, so this always emits UTC.
export function cxmlTimestamp(now: Date): string {
  return now.toISOString().replace(/\.\d{3}Z$/, '+00:00');
}

/// payloadID must be globally unique and is echoed back in responses, which
/// makes it the correlation key when reconciling with Amazon's side.
export function buildPayloadId(now: Date, nonce: string, domain = 'bvisible.us'): string {
  return `${now.getTime()}.${nonce}@${domain}`;
}

export interface CxmlCredentials {
  identity: string;
  sharedSecret: string;
  credentialDomain: string;
  toIdentity: string;
}

/// The <Header> block shared by every request we send. The SharedSecret lives
/// in here, which is why redactCxml exists before anything is logged.
export function buildHeader(creds: CxmlCredentials, userAgent = 'B Visible'): string {
  const domain = escapeXml(creds.credentialDomain);
  return `  <Header>
    <From>
      <Credential domain="${domain}">
        <Identity>${escapeXml(creds.identity)}</Identity>
      </Credential>
    </From>
    <To>
      <Credential domain="${domain}">
        <Identity>${escapeXml(creds.toIdentity)}</Identity>
      </Credential>
    </To>
    <Sender>
      <Credential domain="${domain}">
        <Identity>${escapeXml(creds.identity)}</Identity>
        <SharedSecret>${escapeXml(creds.sharedSecret)}</SharedSecret>
      </Credential>
      <UserAgent>${escapeXml(userAgent)}</UserAgent>
    </Sender>
  </Header>`;
}

export function wrapCxml(input: {
  payloadId: string;
  timestamp: string;
  header: string;
  body: string;
}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE cXML SYSTEM "http://xml.cxml.org/schemas/cXML/1.2.014/cXML.dtd">
<cXML payloadID="${escapeXml(input.payloadId)}" timestamp="${escapeXml(input.timestamp)}" xml:lang="en-US">
${input.header}
${input.body}
</cXML>`;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Amazon sends single-item carts as one <ItemIn>; without this a one-line
  // order parses to an object and a two-line order to an array, and the
  // caller silently handles only one shape.
  isArray: (name) => name === 'ItemIn',
  parseTagValue: false,
  trimValues: true,
});

export function parseCxml(xml: string): Record<string, unknown> {
  return parser.parse(xml) as Record<string, unknown>;
}

export interface CxmlStatus {
  code: number;
  text: string;
}

/// Every cXML reply carries <Status code="200" text="OK">. Anything other
/// than 2xx is a rejection, and the text is Amazon's own explanation.
export function readStatus(parsed: Record<string, unknown>): CxmlStatus {
  const status = pick(parsed, ['cXML', 'Response', 'Status']) as Record<string, unknown> | undefined;
  if (!status) return { code: 0, text: 'No status element in response.' };
  const code = Number(status['@_code'] ?? 0);
  const text = String(status['@_text'] ?? status['#text'] ?? '').trim();
  return { code: Number.isFinite(code) ? code : 0, text };
}

export function isSuccess(status: CxmlStatus): boolean {
  return status.code >= 200 && status.code < 300;
}

/// Safe nested lookup — cXML nests deeply and any level may be absent when a
/// supplier returns an error document instead of the expected shape.
export function pick(root: unknown, path: string[]): unknown {
  let node: unknown = root;
  for (const key of path) {
    if (node === null || node === undefined || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

/// fast-xml-parser gives a string for a bare element and an object for one
/// with attributes or children; callers only ever want the text.
export function text(node: unknown): string {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node).trim();
  if (typeof node === 'object') {
    const t = (node as Record<string, unknown>)['#text'];
    if (t !== undefined) return String(t).trim();
  }
  return '';
}
