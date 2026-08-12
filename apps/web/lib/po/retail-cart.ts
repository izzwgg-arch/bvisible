// Retail / online-store vendor helpers for the shop-order flow.
// Shared by the server action (PO creation) and the client flow
// (automatic cart opening + office draft email). Pure functions only.

/// Vendors whose orders are placed manually by the office on the vendor's
/// website — never emailed a PO.
export const RETAIL_VENDOR_RE =
  /amazon|home\s*depot|walmart|lowe'?s|staples|office\s*depot|target|best\s*buy|ebay/i;

/// A bare SKU is only trusted as an ASIN in the modern B0 form — the SKU
/// column holds arbitrary vendor part numbers, and a loose 10-char rule
/// would turn "ABC1234567" into a bogus cart entry.
export const ASIN_RE = /^B0[A-Z0-9]{8}$/i;

/// Inside a /dp/ or /gp/product/ path the value is positionally unambiguous,
/// so any 10-char alphanumeric counts (older non-B0 ASINs included). The
/// strict rule above used to be applied here too, which silently discarded
/// perfectly good ASINs pulled from a product URL.
const ASIN_IN_URL_RE = /^[A-Z0-9]{10}$/i;

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
  if (m && ASIN_IN_URL_RE.test(m[1]!)) return m[1]!.toUpperCase();
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

/// Best per-item link for a retail store when no product URL is stored:
/// Amazon gets a direct /dp/ page when the SKU is an ASIN; every other
/// store gets its site search prefilled with the SKU (or the item name).
/// Used by the admin draft-PO email so the office can jump straight to
/// each product even for POs created outside the shop-order flow.
export function buildRetailItemLink(
  vendorName: string,
  sku: string | null | undefined,
  name: string,
  url?: string | null
): string {
  const direct = normalizeExternalUrl(url);
  if (direct) return direct;
  const q = encodeURIComponent((sku ?? '').trim() || name.trim());
  if (!q) return '';
  if (/amazon/i.test(vendorName)) {
    const asin = extractAsin(sku, url);
    return asin ? `https://www.amazon.com/dp/${asin}` : `https://www.amazon.com/s?k=${q}`;
  }
  if (/home\s*depot/i.test(vendorName)) return `https://www.homedepot.com/s/${q}`;
  if (/lowe'?s/i.test(vendorName)) return `https://www.lowes.com/search?searchTerm=${q}`;
  if (/walmart/i.test(vendorName)) return `https://www.walmart.com/search?q=${q}`;
  if (/target/i.test(vendorName)) return `https://www.target.com/s?searchTerm=${q}`;
  if (/best\s*buy/i.test(vendorName)) return `https://www.bestbuy.com/site/searchpage.jsp?st=${q}`;
  if (/staples/i.test(vendorName)) return `https://www.staples.com/${q}/directory_${q}`;
  if (/office\s*depot/i.test(vendorName)) return `https://www.officedepot.com/catalog/search.do?Ntt=${q}`;
  if (/ebay/i.test(vendorName)) return `https://www.ebay.com/sch/i.html?_nkw=${q}`;
  return '';
}

/// Every line of a retail order paired with the best link available for it.
///
/// The point is that `href` is never empty for a known store: stored product
/// URL → /dp/ from an ASIN → store search on the SKU or item name. A cart URL
/// needs an ASIN for EVERY line and is therefore null far more often than not
/// (the Sheet's shop-supply rows carried no SKU or URL at all until the
/// Internal Materials tab gained cols 13/14). When that happens the office
/// still gets a one-click path to each product instead of a dead panel.
export function buildRetailItemLinks(
  vendorName: string,
  items: RetailCartLine[]
): Array<{ name: string; qty: number; href: string }> {
  return items.map((i) => ({
    name: i.name,
    qty: Math.max(1, Math.ceil(i.qty)),
    href: buildRetailItemLink(vendorName, i.sku, i.name, i.url),
  }));
}
