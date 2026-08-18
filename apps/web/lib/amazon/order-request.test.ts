import { describe, expect, it } from 'vitest';
import { buildOrderRequest, orderFailureMessage, parseOrderResponse } from './order-request';

/**
 * This is the code path that spends real money, so the assertions here are
 * about the document being exactly what was reviewed: the right PO number,
 * every line, a total derived from those lines, and a complete address.
 */

const CREDS = {
  identity: 'BVisibleIncTEST',
  sharedSecret: 'shhh',
  credentialDomain: 'NetworkId',
  toIdentity: 'Amazon',
};

const SHIP_TO = {
  name: 'B Visible Signs & Printing',
  street: '123 Main St',
  city: 'Monsey',
  state: 'NY',
  postalCode: '10952',
  countryCode: 'US',
  countryName: 'United States',
  email: 'sales@bvisible.us',
  phone: '',
};

const base = {
  ...CREDS,
  poNumber: 'PO-000063',
  orderDate: new Date('2026-08-18T12:00:00Z'),
  shipTo: SHIP_TO,
  now: new Date('2026-08-18T12:00:00Z'),
  nonce: 'n1',
  lines: [
    {
      supplierPartId: 'B0ABCDEFGH',
      description: 'Blue Painters Tape',
      quantity: 1,
      unitCostCents: 264,
      unitOfMeasure: 'EA',
    },
    {
      supplierPartId: 'B07XYZ1234',
      description: 'Nitrile Gloves',
      quantity: 2,
      unitCostCents: 1450,
      unitOfMeasure: 'BX',
    },
  ],
};

describe('buildOrderRequest', () => {
  it('sends the PO number as the order id and every line', () => {
    const xml = buildOrderRequest(base);
    expect(xml).toContain('orderID="PO-000063"');
    expect(xml).toContain('<SupplierPartID>B0ABCDEFGH</SupplierPartID>');
    expect(xml).toContain('<SupplierPartID>B07XYZ1234</SupplierPartID>');
    expect(xml).toContain('lineNumber="1"');
    expect(xml).toContain('lineNumber="2"');
    expect(xml).toContain('quantity="2"');
  });

  it('totals the order from its lines, not a cached column', () => {
    // 2.64 + (2 x 14.50) = 31.64
    expect(buildOrderRequest(base)).toContain('<Money currency="USD">31.64</Money>');
  });

  it('includes a complete ship-to address', () => {
    const xml = buildOrderRequest(base);
    expect(xml).toContain('<Street>123 Main St</Street>');
    expect(xml).toContain('<City>Monsey</City>');
    expect(xml).toContain('<State>NY</State>');
    expect(xml).toContain('<PostalCode>10952</PostalCode>');
    expect(xml).toContain('isoCountryCode="US"');
  });

  it('escapes the company name rather than breaking the document', () => {
    // "Signs & Printing" is the real company name and a bare & is invalid XML.
    const xml = buildOrderRequest(base);
    expect(xml).toContain('B Visible Signs &amp; Printing');
    expect(xml).not.toMatch(/&(?!amp;|apos;|quot;|lt;|gt;)/);
  });
});

describe('parseOrderResponse', () => {
  it('accepts a 200', () => {
    const r = parseOrderResponse('<cXML><Response><Status code="200" text="OK"/></Response></cXML>');
    expect(r.ok).toBe(true);
  });

  it('reports a rejection and its reason', () => {
    const r = parseOrderResponse(
      '<cXML><Response><Status code="400" text="Item B0ABCDEFGH is not purchasable"/></Response></cXML>'
    );
    expect(r.ok).toBe(false);
    expect(r.statusCode).toBe(400);
    expect(r.statusText).toContain('not purchasable');
  });
});

describe('orderFailureMessage', () => {
  it('maps every category to text free of technical detail', () => {
    const categories = [
      'not_configured',
      'no_ship_to',
      'no_orderable_lines',
      'already_ordered',
      'rejected',
      'send_failed',
    ];
    for (const c of categories) {
      const m = orderFailureMessage(c);
      expect(m.length).toBeGreaterThan(0);
      expect(m).not.toMatch(/cxml|smtp|stack|secret|password|401|500/i);
    }
    expect(orderFailureMessage('unknown')).toBe(orderFailureMessage('send_failed'));
  });
});
