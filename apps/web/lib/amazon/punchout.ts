// cXML PunchOut: start a shopping session on Amazon Business, and read the
// cart Amazon hands back.
//
// WHAT PUNCHOUT IS, precisely — because the mental model matters for every
// decision below: the employee shops a real Amazon Business cart, and when
// they submit it, Amazon POSTs the cart BACK to us as a PunchOutOrderMessage.
// Nothing has been bought at that point. The cart becomes a DRAFT purchase
// order on our side, and placing the actual order is a separate, explicitly
// approved step (order-request.ts).
//
// The value here is that the returned lines carry REAL ASINs, REAL prices,
// and REAL product URLs straight from Amazon — no Sheet transcription, no
// guessing a link from a SKU.

import {
  buildHeader,
  buildPayloadId,
  centsToAmount,
  cxmlTimestamp,
  escapeXml,
  isSuccess,
  parseCxml,
  pick,
  readStatus,
  text,
  amountToCents,
  type CxmlCredentials,
} from './cxml';

export interface PunchoutSetupInput extends CxmlCredentials {
  /// High-entropy, single-use. Amazon echoes it in the returned cart and it is
  /// the ONLY thing tying that unauthenticated POST back to a session, user,
  /// and tenant — so it is a secret, not just a correlation id.
  buyerCookie: string;
  /// Where Amazon browser-POSTs the finished cart.
  returnUrl: string;
  /// Amazon's PunchOut endpoint.
  supplierSetupUrl: string;
  userEmail: string;
  userName: string;
  now: Date;
  nonce: string;
}

export function buildPunchOutSetupRequest(input: PunchoutSetupInput): string {
  const timestamp = cxmlTimestamp(input.now);
  const payloadId = buildPayloadId(input.now, input.nonce);
  const header = buildHeader(input);
  const body = `  <Request deploymentMode="production">
    <PunchOutSetupRequest operation="create">
      <BuyerCookie>${escapeXml(input.buyerCookie)}</BuyerCookie>
      <Extrinsic name="UserEmail">${escapeXml(input.userEmail)}</Extrinsic>
      <Extrinsic name="UniqueName">${escapeXml(input.userEmail)}</Extrinsic>
      <Extrinsic name="User">${escapeXml(input.userName)}</Extrinsic>
      <BrowserFormPost>
        <URL>${escapeXml(input.returnUrl)}</URL>
      </BrowserFormPost>
      <SupplierSetup>
        <URL>${escapeXml(input.supplierSetupUrl)}</URL>
      </SupplierSetup>
    </PunchOutSetupRequest>
  </Request>`;
  return wrap(payloadId, timestamp, header, body);
}

function wrap(payloadId: string, timestamp: string, header: string, body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE cXML SYSTEM "http://xml.cxml.org/schemas/cXML/1.2.014/cXML.dtd">
<cXML payloadID="${escapeXml(payloadId)}" timestamp="${escapeXml(timestamp)}" xml:lang="en-US">
${header}
${body}
</cXML>`;
}

export interface PunchoutSetupResult {
  ok: boolean;
  startPageUrl: string;
  statusCode: number;
  /// Amazon's own explanation of a rejection. Safe to show an admin (it is a
  /// protocol message, not a credential) but never contains our secret.
  statusText: string;
}

export function parsePunchOutSetupResponse(xml: string): PunchoutSetupResult {
  const parsed = parseCxml(xml);
  const status = readStatus(parsed);
  const startPageUrl = text(
    pick(parsed, ['cXML', 'Response', 'PunchOutSetupResponse', 'StartPage', 'URL'])
  );
  return {
    // A 200 with no StartPage is still a failure: there is nowhere to send
    // the employee, and redirecting to an empty URL would land them on our
    // own site with no explanation.
    ok: isSuccess(status) && startPageUrl.length > 0,
    startPageUrl,
    statusCode: status.code,
    statusText: status.text,
  };
}

export interface PunchoutCartItem {
  /// Amazon's ASIN, from SupplierPartID.
  supplierPartId: string;
  description: string;
  /// Whole units. Amazon returns integers here; carts cannot hold 0.5 of an item.
  quantity: number;
  unitCostCents: number;
  unitOfMeasure: string;
  /// Product page URL when Amazon supplies one. This is what finally makes
  /// "View on Amazon" exact rather than derived from a SKU.
  productUrl: string;
  manufacturerPartId: string;
  classification: string;
}

export interface PunchoutCart {
  buyerCookie: string;
  items: PunchoutCartItem[];
  /// Recomputed from the lines rather than trusting the header total, so what
  /// we store always equals the sum of what we stored.
  subtotalCents: number;
  /// Amazon's own stated total, kept only to detect disagreement.
  statedTotalCents: number;
}

export function parsePunchOutOrderMessage(xml: string): PunchoutCart {
  const parsed = parseCxml(xml);
  const message = pick(parsed, ['cXML', 'Message', 'PunchOutOrderMessage']) as
    | Record<string, unknown>
    | undefined;
  const buyerCookie = text(message?.['BuyerCookie']);
  const rawItems = (message?.['ItemIn'] ?? []) as unknown[];

  const items: PunchoutCartItem[] = [];
  for (const raw of Array.isArray(rawItems) ? rawItems : [rawItems]) {
    if (!raw || typeof raw !== 'object') continue;
    const node = raw as Record<string, unknown>;
    const detail = (node['ItemDetail'] ?? {}) as Record<string, unknown>;
    const quantity = Number(node['@_quantity'] ?? 0);
    const unitCostCents = amountToCents(
      text(pick(detail, ['UnitPrice', 'Money'])) ||
        (pick(detail, ['UnitPrice', 'Money']) as { '#text'?: string })?.['#text']
    );
    const supplierPartId = text(pick(node, ['ItemID', 'SupplierPartID']));
    const description = text(detail['Description']);
    // A line with no identifier and no description is not something a person
    // could act on; dropping it beats persisting an unorderable blank row.
    if (!supplierPartId && !description) continue;
    items.push({
      supplierPartId,
      description,
      quantity: Number.isFinite(quantity) && quantity > 0 ? Math.round(quantity) : 1,
      unitCostCents,
      unitOfMeasure: text(detail['UnitOfMeasure']) || 'EA',
      productUrl: readExtrinsic(detail, ['ProductURL', 'ProductUrl', 'URL']),
      manufacturerPartId: text(detail['ManufacturerPartID']),
      classification: text(detail['Classification']),
    });
  }

  const subtotalCents = items.reduce((sum, i) => sum + i.unitCostCents * i.quantity, 0);
  const statedTotalCents = amountToCents(
    text(pick(message ?? {}, ['PunchOutOrderMessageHeader', 'Total', 'Money'])) ||
      ((pick(message ?? {}, ['PunchOutOrderMessageHeader', 'Total', 'Money']) as {
        '#text'?: string;
      })?.['#text'] ?? '')
  );

  return { buyerCookie, items, subtotalCents, statedTotalCents };
}

/// <Extrinsic name="ProductURL">…</Extrinsic> — Amazon has used more than one
/// spelling, so callers pass every name they accept.
function readExtrinsic(detail: Record<string, unknown>, names: string[]): string {
  const raw = detail['Extrinsic'];
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const node = entry as Record<string, unknown>;
    const name = String(node['@_name'] ?? '');
    if (names.some((n) => n.toLowerCase() === name.toLowerCase())) {
      const value = text(node);
      if (value) return value;
    }
  }
  return '';
}

export { centsToAmount };
