import { NextResponse } from 'next/server';
import { acceptReturnedCart } from '@/lib/amazon/punchout-service';

// Where Amazon Business posts a finished PunchOut cart.
//
// This is a CROSS-SITE browser form POST from Amazon's domain, so it arrives
// with no session cookie and cannot be session-authenticated. The BuyerCookie
// inside the cXML is the credential — it is 256 bits of CSPRNG output, single
// use, and time-boxed. See punchout-service.ts for the full model.
//
// The endpoint is therefore in the middleware allow-list. It accepts only a
// cart that matches a live session; anything else is turned away without
// revealing whether the cookie existed.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/// Amazon sends the document as a form field. `cxml-urlencoded` is the field
/// name in the cXML spec; the others are accepted because supplier
/// implementations differ and a missed field name looks like a dead button.
const CXML_FIELDS = ['cxml-urlencoded', 'cXML-urlencoded', 'cxml', 'cXML'];

export async function POST(request: Request): Promise<Response> {
  const contentType = request.headers.get('content-type') ?? '';

  let cxml = '';
  try {
    if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
      const form = await request.formData();
      for (const field of CXML_FIELDS) {
        const value = form.get(field);
        if (typeof value === 'string' && value.trim()) {
          cxml = value;
          break;
        }
      }
    } else {
      // Some configurations post the document as a raw XML body.
      cxml = await request.text();
    }
  } catch {
    return htmlResponse('That cart could not be read.', 400);
  }

  if (!cxml.trim()) return htmlResponse('That cart arrived empty.', 400);

  const result = await acceptReturnedCart(cxml);

  if (!result.ok) {
    // Deliberately uniform wording: the response must not reveal whether a
    // buyer cookie exists, or a captured POST could be used to probe.
    const message =
      result.reason === 'empty_cart'
        ? 'Your Amazon cart was empty, so no order was created.'
        : 'That Amazon shopping session is no longer valid. Start a new one from Order materials.';
    return htmlResponse(message, 200);
  }

  // A browser is sitting on this POST, so hand it to the new draft. 303 turns
  // the POST into a GET, which keeps a refresh from re-submitting the cart.
  return NextResponse.redirect(
    new URL(`/purchase-orders/${result.purchaseOrderId}`, request.url),
    303
  );
}

/// Amazon's redirect lands a real person here, so a failure has to be a
/// readable page rather than a JSON blob.
function htmlResponse(message: string, status: number): Response {
  const body = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Amazon cart</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body{margin:0;background:#FBF8F4;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1C4972}
  .card{max-width:520px;margin:12vh auto;padding:28px;background:#fff;border:1px solid #E7E2DA;border-radius:16px;text-align:center}
  a{display:inline-block;margin-top:18px;padding:12px 20px;border-radius:10px;background:#C2410C;color:#fff;text-decoration:none;font-weight:700}
</style></head>
<body><div class="card"><h1 style="font-size:20px;margin:0 0 8px">Amazon cart</h1>
<p style="margin:0;color:#6D7480;font-size:14px">${escapeHtml(message)}</p>
<a href="/purchase-orders/shop-order">Back to Order materials</a></div></body></html>`;
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
