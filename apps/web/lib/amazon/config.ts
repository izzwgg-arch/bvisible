// Amazon Business Ordering-API configuration.
//
// SERVER-SIDE ONLY. Nothing here may be imported from a client component:
// the shared secret is a bearer credential for placing real purchase orders
// against the company's Amazon Business account, and it must never reach the
// browser bundle, a server-action return value, a log line, or an error
// message shown to a user.
//
// Everything is read from the environment rather than the database so the
// secret never sits in a table that a report, backup, or admin screen could
// surface. A missing configuration disables the feature rather than failing
// half-way through an order.

export interface AmazonCxmlConfig {
  /// "From Identity" in the Amazon Business console.
  identity: string;
  sharedSecret: string;
  /// PunchOut endpoint. Points at the test URL unless mode is 'production'.
  punchoutUrl: string;
  /// cXML OrderRequest endpoint ("Purchase order request URL").
  orderRequestUrl: string;
  /// Credential domain used in the cXML Header. Amazon's integration guide is
  /// the authority; it is configurable because getting it wrong is the single
  /// most common cause of a rejected PunchOutSetupRequest.
  credentialDomain: string;
  toIdentity: string;
  mode: 'test' | 'production';
}

/// Structured ship-to for OrderRequest. cXML needs discrete address parts and
/// the Tenant row only carries a single free-text `address`, so this comes
/// from configuration rather than being parsed out of prose.
export interface AmazonShipTo {
  name: string;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  countryCode: string;
  countryName: string;
  email: string;
  phone: string;
}

function env(name: string): string {
  return (process.env[name] ?? '').trim();
}

/// Null when the integration is not configured. Callers must treat null as
/// "feature off" and say so plainly, never fall back to a guess.
export function amazonCxmlConfig(): AmazonCxmlConfig | null {
  const identity = env('AMAZON_PUNCHOUT_IDENTITY');
  const sharedSecret = env('AMAZON_PUNCHOUT_SHARED_SECRET');
  if (!identity || !sharedSecret) return null;

  // Default to 'test' so a half-finished setup exercises Amazon's test
  // endpoint instead of creating real orders on the live account.
  const mode = env('AMAZON_PUNCHOUT_MODE') === 'production' ? 'production' : 'test';
  const punchoutUrl =
    mode === 'production'
      ? env('AMAZON_PUNCHOUT_URL') || 'https://abintegrations.amazon.com/punchout'
      : env('AMAZON_PUNCHOUT_TEST_URL') || 'https://abintegrations.amazon.com/punchout/test';
  const orderRequestUrl = env('AMAZON_ORDER_REQUEST_URL');
  if (!orderRequestUrl) {
    // PunchOut alone is still useful (it returns a real cart), so an absent
    // order endpoint disables ordering rather than the whole feature.
  }

  return {
    identity,
    sharedSecret,
    punchoutUrl,
    orderRequestUrl,
    credentialDomain: env('AMAZON_PUNCHOUT_CREDENTIAL_DOMAIN') || 'NetworkId',
    toIdentity: env('AMAZON_PUNCHOUT_TO_IDENTITY') || 'Amazon',
    mode,
  };
}

/// True when orders can actually be submitted (as opposed to only shopping).
export function amazonOrderingEnabled(config: AmazonCxmlConfig | null): boolean {
  return !!config && config.orderRequestUrl.length > 0;
}

export function amazonShipTo(): AmazonShipTo | null {
  const street = env('AMAZON_SHIP_TO_STREET');
  const city = env('AMAZON_SHIP_TO_CITY');
  const state = env('AMAZON_SHIP_TO_STATE');
  const postalCode = env('AMAZON_SHIP_TO_POSTAL_CODE');
  // A partial address would be rejected by Amazon after the order was already
  // recorded on our side, so all four required parts must be present.
  if (!street || !city || !state || !postalCode) return null;
  return {
    name: env('AMAZON_SHIP_TO_NAME') || 'B Visible Signs & Printing',
    street,
    city,
    state,
    postalCode,
    countryCode: env('AMAZON_SHIP_TO_COUNTRY') || 'US',
    countryName: env('AMAZON_SHIP_TO_COUNTRY_NAME') || 'United States',
    email: env('AMAZON_SHIP_TO_EMAIL'),
    phone: env('AMAZON_SHIP_TO_PHONE'),
  };
}

/// Redacts the shared secret from anything about to be logged. cXML carries
/// the credential inline in the document body, so a raw request dump would
/// otherwise write it straight into the PM2 log.
export function redactCxml(xml: string): string {
  return xml.replace(/<SharedSecret>[\s\S]*?<\/SharedSecret>/gi, '<SharedSecret>***</SharedSecret>');
}
