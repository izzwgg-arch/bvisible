// Retail / online-store vendor helpers for the shop-order flow.
// Shared by the server action (PO creation) and the client flow
// (automatic cart opening + office draft email). Pure functions only.

/// Vendors whose orders are placed manually by the office on the vendor's
/// website — never emailed a PO.
export const RETAIL_VENDOR_RE =
  /amazon|home\s*depot|walmart|lowe'?s|staples|office\s*depot|target|best\s*buy|ebay/i;

export const ASIN_RE = /^B0[A-Z0-9]{8}$/i;

export interface RetailCartLine {
  name: string;
  qty: number;
  url: string;
  sku: string;
  unitPriceCents: number;
}

/// Product URLs typed into the Sheet often miss the scheme
/// ("www.amazon.com/dp/…"). Rendered as-is those resolve RELATIVE to the
/// app and open a 404 — normalize to an absolute https URL. Anything that
/// doesn't look like a web address becomes '' (no link) rather than a
/// broken one.
export function normalizeExternalUrl(raw: string | null | undefined): string {
  const t = (raw ?? '').trim();
  if (!t) return '';
  if (/^https?:\/\//i.test(t)) return t;
  if (/^\/\//.test(t)) return `https:${t}`;
  // Domain-looking strings: "amazon.com/dp/X", "www.homedepot.com/p/123".
  if (/^[\w-]+(\.[\w-]+)+([/?#]|$)/i.test(t)) return `https://${t}`;
  return '';
}

/// Amazon ASIN from the SKU column, or extracted from the product URL
/// ("/dp/B0XXXXXXXX", "/gp/product/B0XXXXXXXX").
export function extractAsin(sku: string | null | undefined, url: string | null | undefined): string | null {
  const s = (sku ?? '').trim();
  if (ASIN_RE.test(s)) return s.toUpperCase();
  const u = normalizeExternalUrl(url);
  const m = /\/(?:dp|gp\/product|product)\/([A-Z0-9]{10})(?:[/?#]|$)/i.exec(u);
  if (m && ASIN_RE.test(m[1]!)) return m[1]!.toUpperCase();
  return null;
}

/// Amazon add-to-cart URL for a whole order — only when EVERY line has a
/// resolvable ASIN (otherwise a partial cart silently drops items).
export function buildAmazonCartUrl(
  items: Array<{ sku?: string | null; url?: string | null; qty: number }>
): string | null {
  if (items.length === 0) return null;
  const asins: Array<{ asin: string; qty: number }> = [];
  for (const item of items) {
    const asin = extractAsin(item.sku, item.url);
    if (!asin) return null;
    asins.push({ asin, qty: Math.max(1, Math.ceil(item.qty)) });
  }
  const params = asins
    .map((a, i) => `ASIN.${i + 1}=${encodeURIComponent(a.asin)}&Quantity.${i + 1}=${a.qty}`)
    .join('&');
  return `https://www.amazon.com/gp/aws/cart/add.html?${params}`;
}

/// Best automatic cart/product URL for a retail vendor order:
/// Amazon gets a true multi-item cart; other stores get the first
/// product page (no public cart-prefill APIs) — the office adds the rest
/// from the draft email's per-item links.
export function buildRetailCartUrl(vendorName: string, items: RetailCartLine[]): string | null {
  if (/amazon/i.test(vendorName)) {
    const cart = buildAmazonCartUrl(items);
    if (cart) return cart;
  }
  const firstWithUrl = items.find((i) => normalizeExternalUrl(i.url));
  return firstWithUrl ? normalizeExternalUrl(firstWithUrl.url) : null;
}

export function isRetailVendor(vendorName: string): boolean {
  return RETAIL_VENDOR_RE.test(vendorName);
}

/// Office review draft email — vendor, items, quantities, prices, links,
/// and total. The office still reviews and places the order manually.
export function buildOfficeDraftEmail(
  poNumber: string,
  vendor: string,
  cartUrl: string | null,
  items: RetailCartLine[]
): { subject: string; body: string } {
  const totalCents = items.reduce((s, i) => s + Math.max(1, Math.ceil(i.qty)) * i.unitPriceCents, 0);
  const money = (cents: number) =>
    (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  const lines = [
    `Purchase order ${poNumber} (${vendor}) is ready for review.`,
    '',
    `Vendor: ${vendor}`,
    '',
    'Items:',
    ...items.map((i) => {
      const qty = Math.max(1, Math.ceil(i.qty));
      const link = normalizeExternalUrl(i.url);
      return `- ${i.name}${i.sku ? ` (SKU ${i.sku})` : ''} x ${qty} @ ${money(i.unitPriceCents)} = ${money(qty * i.unitPriceCents)}${link ? `\n  ${link}` : ''}`;
    }),
    '',
    `Order total: ${money(totalCents)}`,
    ...(cartUrl ? ['', `Prefilled cart: ${cartUrl}`] : []),
    '',
    'Please review and place the order manually. Nothing has been ordered automatically.',
  ];
  return {
    subject: `Review & place order: ${poNumber} — ${vendor}`,
    body: lines.join('\n'),
  };
}
