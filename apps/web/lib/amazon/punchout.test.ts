import { describe, expect, it } from 'vitest';
import {
  buildPunchOutSetupRequest,
  parsePunchOutOrderMessage,
  parsePunchOutSetupResponse,
} from './punchout';
import { amountToCents, centsToAmount, cxmlTimestamp, escapeXml } from './cxml';

/**
 * The protocol layer is where an integration silently goes wrong: a rejected
 * setup that looks like a redirect, a cart that parses to one item instead of
 * three, a price that arrives as a float and lands a cent off. These cover the
 * shapes Amazon actually sends.
 */

const CREDS = {
  identity: 'BVisibleIncTEST',
  sharedSecret: 'shhh-not-a-real-secret',
  credentialDomain: 'NetworkId',
  toIdentity: 'Amazon',
};

describe('money conversion', () => {
  it('round-trips integer cents without float drift', () => {
    for (const cents of [0, 1, 9, 99, 264, 1450, 100000, 123456789]) {
      expect(amountToCents(centsToAmount(cents))).toBe(cents);
    }
  });

  it('always emits two decimal places', () => {
    expect(centsToAmount(264)).toBe('2.64');
    expect(centsToAmount(200)).toBe('2.00');
    expect(centsToAmount(5)).toBe('0.05');
  });

  it('treats unparseable amounts as zero rather than NaN', () => {
    // NaN would propagate into a PO total and corrupt the order silently.
    for (const junk of ['', '  ', 'abc', null, undefined, '1.2.3']) {
      expect(amountToCents(junk)).toBe(0);
    }
    expect(amountToCents('1,234.50')).toBe(123450);
  });
});

describe('buildPunchOutSetupRequest', () => {
  const xml = buildPunchOutSetupRequest({
    ...CREDS,
    buyerCookie: 'cookie-abc-123',
    returnUrl: 'https://app.example.com/api/amazon/punchout/return',
    supplierSetupUrl: 'https://abintegrations.amazon.com/punchout/test',
    userEmail: 'yitzy@bvisible.us',
    userName: 'Yitzy W',
    now: new Date('2026-08-18T12:00:00Z'),
    nonce: 'n1',
  });

  it('carries the credentials, cookie, and both URLs', () => {
    expect(xml).toContain('<Identity>BVisibleIncTEST</Identity>');
    expect(xml).toContain('<SharedSecret>shhh-not-a-real-secret</SharedSecret>');
    expect(xml).toContain('<BuyerCookie>cookie-abc-123</BuyerCookie>');
    expect(xml).toContain('https://app.example.com/api/amazon/punchout/return');
    expect(xml).toContain('https://abintegrations.amazon.com/punchout/test');
    expect(xml).toContain('operation="create"');
  });

  it('emits a UTC timestamp with an offset', () => {
    expect(cxmlTimestamp(new Date('2026-08-18T12:00:00Z'))).toBe('2026-08-18T12:00:00+00:00');
  });

  it('escapes values so a hostile name cannot break the document', () => {
    const hostile = buildPunchOutSetupRequest({
      ...CREDS,
      buyerCookie: 'c',
      returnUrl: 'https://x.test/r',
      supplierSetupUrl: 'https://x.test/s',
      userEmail: 'a@b.us',
      userName: '</Identity><Evil>',
      now: new Date('2026-08-18T12:00:00Z'),
      nonce: 'n',
    });
    expect(hostile).not.toContain('<Evil>');
    expect(escapeXml('a & b')).toBe('a &amp; b');
  });
});

describe('parsePunchOutSetupResponse', () => {
  it('reads the start page from a success', () => {
    const r = parsePunchOutSetupResponse(`<?xml version="1.0"?>
      <cXML><Response><Status code="200" text="OK"/>
        <PunchOutSetupResponse><StartPage><URL>https://amazon.com/session/xyz</URL></StartPage></PunchOutSetupResponse>
      </Response></cXML>`);
    expect(r.ok).toBe(true);
    expect(r.startPageUrl).toBe('https://amazon.com/session/xyz');
  });

  it('reports a rejection with Amazon\u2019s own reason', () => {
    const r = parsePunchOutSetupResponse(`<?xml version="1.0"?>
      <cXML><Response><Status code="401" text="Unauthorized: shared secret did not match"/></Response></cXML>`);
    expect(r.ok).toBe(false);
    expect(r.statusCode).toBe(401);
    expect(r.statusText).toContain('shared secret');
  });

  it('treats a 200 with no StartPage as a failure', () => {
    // Redirecting to '' would dump the employee back on our own site with no
    // explanation, looking like the button did nothing.
    const r = parsePunchOutSetupResponse(
      `<cXML><Response><Status code="200" text="OK"/></Response></cXML>`
    );
    expect(r.ok).toBe(false);
  });
});

describe('parsePunchOutOrderMessage', () => {
  const cart = (items: string, total = '31.64') => `<?xml version="1.0"?>
    <cXML><Message><PunchOutOrderMessage>
      <BuyerCookie>cookie-abc-123</BuyerCookie>
      <PunchOutOrderMessageHeader operationAllowed="edit">
        <Total><Money currency="USD">${total}</Money></Total>
      </PunchOutOrderMessageHeader>
      ${items}
    </PunchOutOrderMessage></Message></cXML>`;

  const tape = `<ItemIn quantity="1">
      <ItemID><SupplierPartID>B0ABCDEFGH</SupplierPartID></ItemID>
      <ItemDetail>
        <UnitPrice><Money currency="USD">2.64</Money></UnitPrice>
        <Description xml:lang="en">Blue Painter's Tape</Description>
        <UnitOfMeasure>EA</UnitOfMeasure>
        <Extrinsic name="ProductURL">https://www.amazon.com/dp/B0ABCDEFGH</Extrinsic>
      </ItemDetail>
    </ItemIn>`;
  const gloves = `<ItemIn quantity="2">
      <ItemID><SupplierPartID>B07XYZ1234</SupplierPartID></ItemID>
      <ItemDetail>
        <UnitPrice><Money currency="USD">14.50</Money></UnitPrice>
        <Description>Nitrile Gloves</Description>
        <UnitOfMeasure>BX</UnitOfMeasure>
      </ItemDetail>
    </ItemIn>`;

  it('parses a single-item cart as one line, not as a non-array', () => {
    // fast-xml-parser collapses a lone repeated element to an object; a cart
    // of one is the most common real case, so this must not silently drop it.
    const c = parsePunchOutOrderMessage(cart(tape, '2.64'));
    expect(c.items).toHaveLength(1);
    expect(c.items[0]!.supplierPartId).toBe('B0ABCDEFGH');
    expect(c.items[0]!.unitCostCents).toBe(264);
    expect(c.items[0]!.productUrl).toBe('https://www.amazon.com/dp/B0ABCDEFGH');
  });

  it('parses a multi-item cart and totals it from the lines', () => {
    const c = parsePunchOutOrderMessage(cart(`${tape}${gloves}`));
    expect(c.items).toHaveLength(2);
    expect(c.items[1]!.quantity).toBe(2);
    expect(c.subtotalCents).toBe(264 + 2 * 1450);
    expect(c.statedTotalCents).toBe(3164);
    // Our computed total is the authority; the stated one only corroborates.
    expect(c.subtotalCents).toBe(c.statedTotalCents);
  });

  it('returns the buyer cookie so the POST can be tied to a session', () => {
    expect(parsePunchOutOrderMessage(cart(tape)).buyerCookie).toBe('cookie-abc-123');
  });

  it('survives a cart with no items', () => {
    const c = parsePunchOutOrderMessage(cart('', '0.00'));
    expect(c.items).toEqual([]);
    expect(c.subtotalCents).toBe(0);
  });

  it('keeps a line that has no product URL', () => {
    const c = parsePunchOutOrderMessage(cart(gloves, '29.00'));
    expect(c.items[0]!.productUrl).toBe('');
    expect(c.items[0]!.description).toBe('Nitrile Gloves');
  });
});
