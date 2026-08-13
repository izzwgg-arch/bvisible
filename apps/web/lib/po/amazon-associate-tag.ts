// Amazon Associates tag, server-side only.
//
// Amazon's Add to Cart form (`/gp/aws/cart/add.html`) requires AssociateTag.
// Without it the endpoint does NOT return an error — it redirects to the first
// product's detail page, so a cart button appears to "open the product instead
// of the cart". That single missing parameter is the difference between a
// prefilled cart and an apparently broken feature.
//
// The tag is not a secret (it travels in every affiliate URL), but it is read
// here rather than in shared code so client bundles never depend on server
// configuration — the pages that need it pass it down explicitly.

/// Trimmed AMAZON_ASSOCIATE_TAG, or '' when unset. Empty means every Amazon
/// cart URL resolves to null and the UI falls back to per-item links, which is
/// honest: a tagless cart URL cannot work.
export function amazonAssociateTag(): string {
  return (process.env.AMAZON_ASSOCIATE_TAG ?? '').trim();
}
