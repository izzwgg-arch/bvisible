// cXML OrderRequest — the step that actually places the order on Amazon
// Business.
//
// This is the only code in B Visible that can spend money, so the rules
// around it are deliberately strict:
//
//  1. It is NEVER called automatically. A person opens the draft that came
//     back from PunchOut, reviews it, and explicitly submits it. Order
//     creation and order placement stay separate states, the same way order
//     creation and the office reminder do.
//  2. One successful OrderRequest per purchase order. The caller guards on
//     stored state before calling; a retry after a FAILURE is fine, a retry
//     after a SUCCESS is not, because Amazon would ship twice.
//  3. Nothing here invents an address or a price. A missing ship-to is a
//     refusal, not a default — an order sent to the wrong place is worse
//     than an order not sent.

import {
  buildHeader,
  buildPayloadId,
  centsToAmount,
  cxmlTimestamp,
  escapeXml,
  isSuccess,
  parseCxml,
  readStatus,
  type CxmlCredentials,
} from './cxml';
import type { AmazonShipTo } from './config';

export interface OrderRequestLine {
  supplierPartId: string;
  description: string;
  quantity: number;
  unitCostCents: number;
  unitOfMeasure: string;
}

export interface OrderRequestInput extends CxmlCredentials {
  poNumber: string;
  orderDate: Date;
  lines: OrderRequestLine[];
  shipTo: AmazonShipTo;
  now: Date;
  nonce: string;
}

export function buildOrderRequest(input: OrderRequestInput): string {
  const timestamp = cxmlTimestamp(input.now);
  const payloadId = buildPayloadId(input.now, input.nonce);
  const header = buildHeader(input);
  // Recomputed from the lines rather than taking a cached PO column, so the
  // total Amazon is asked to charge always equals the items being ordered.
  const totalCents = input.lines.reduce((sum, l) => sum + l.unitCostCents * l.quantity, 0);
  const orderDate = cxmlTimestamp(input.orderDate);

  const items = input.lines
    .map(
      (line, index) => `      <ItemOut quantity="${line.quantity}" lineNumber="${index + 1}">
        <ItemID>
          <SupplierPartID>${escapeXml(line.supplierPartId)}</SupplierPartID>
        </ItemID>
        <ItemDetail>
          <UnitPrice><Money currency="USD">${centsToAmount(line.unitCostCents)}</Money></UnitPrice>
          <Description xml:lang="en">${escapeXml(line.description)}</Description>
          <UnitOfMeasure>${escapeXml(line.unitOfMeasure || 'EA')}</UnitOfMeasure>
        </ItemDetail>
      </ItemOut>`
    )
    .join('\n');

  const address = renderAddress(input.shipTo);
  const body = `  <Request deploymentMode="production">
    <OrderRequest>
      <OrderRequestHeader orderID="${escapeXml(input.poNumber)}" orderDate="${escapeXml(orderDate)}" type="new">
        <Total><Money currency="USD">${centsToAmount(totalCents)}</Money></Total>
        <ShipTo>
${address}
        </ShipTo>
        <BillTo>
${address}
        </BillTo>
      </OrderRequestHeader>
${items}
    </OrderRequest>
  </Request>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE cXML SYSTEM "http://xml.cxml.org/schemas/cXML/1.2.014/cXML.dtd">
<cXML payloadID="${escapeXml(payloadId)}" timestamp="${escapeXml(timestamp)}" xml:lang="en-US">
${header}
${body}
</cXML>`;
}

function renderAddress(shipTo: AmazonShipTo): string {
  const email = shipTo.email
    ? `\n            <Email name="default">${escapeXml(shipTo.email)}</Email>`
    : '';
  return `          <Address addressID="bvisible-shipto">
            <Name xml:lang="en">${escapeXml(shipTo.name)}</Name>
            <PostalAddress name="default">
              <DeliverTo>${escapeXml(shipTo.name)}</DeliverTo>
              <Street>${escapeXml(shipTo.street)}</Street>
              <City>${escapeXml(shipTo.city)}</City>
              <State>${escapeXml(shipTo.state)}</State>
              <PostalCode>${escapeXml(shipTo.postalCode)}</PostalCode>
              <Country isoCountryCode="${escapeXml(shipTo.countryCode)}">${escapeXml(shipTo.countryName)}</Country>
            </PostalAddress>${email}
          </Address>`;
}

/// Safe failure labels. Rendered to the user, so they must never carry a
/// provider message, stack trace, or credential.
export type OrderFailureCategory =
  | 'not_configured'
  | 'no_ship_to'
  | 'no_orderable_lines'
  | 'already_ordered'
  | 'rejected'
  | 'send_failed';

const FAILURE_MESSAGES: Record<OrderFailureCategory, string> = {
  not_configured: 'Amazon ordering is not set up yet.',
  no_ship_to: 'No shipping address is configured for Amazon orders.',
  no_orderable_lines: 'This order has no Amazon items with a product number.',
  already_ordered: 'This order was already placed with Amazon.',
  rejected: 'Amazon did not accept this order.',
  send_failed: 'The order could not be sent to Amazon. You can try again.',
};

export function orderFailureMessage(category: string | null | undefined): string {
  const key = (category ?? '') as OrderFailureCategory;
  return FAILURE_MESSAGES[key] ?? FAILURE_MESSAGES.send_failed;
}

export interface OrderResponse {
  ok: boolean;
  statusCode: number;
  /// Amazon's protocol-level explanation. Shown to admins on failure; it
  /// describes the document, never our credentials.
  statusText: string;
}

export function parseOrderResponse(xml: string): OrderResponse {
  const status = readStatus(parseCxml(xml));
  return { ok: isSuccess(status), statusCode: status.code, statusText: status.text };
}
