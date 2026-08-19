// Canonical B Visible business identity for customer-facing documents.
//
// The live values come from the company (tenant) record — editable at
// /admin/tenants — and these are the fallbacks. `guardStaleBusinessInfo`
// refuses the two known-wrong values that used to float around older
// data (a Florida address and a 407 phone number) so a stale tenant row
// can never print them on an estimate.

export const BVISIBLE_BUSINESS_INFO = {
  name: 'B Visible',
  legalName: 'B Visible Signs & Printing',
  slogan: 'Signs & Printing',
  address: '97 Route 17M\nHarriman, NY 10926',
  phone: '845-238-0478',
  email: 'Sales@bvisible.us',
} as const;

// Matches a 407 area code in any common spelling — "407-374-1527",
// "(407) 374 1527", "+1 407.374.1527".
const STALE_PHONE_RE = /(?:^|\D)\(?407\)?\D{0,2}\d{3}\D?\d{4}(?:\D|$)/;
const STALE_ADDRESS_RE = /\bflorida\b|,\s*fl\b|\bfl\s+\d{5}\b|\borlando\b/i;

export function isStalePhone(phone: string | null | undefined): boolean {
  return !!phone && STALE_PHONE_RE.test(phone);
}

export function isStaleAddress(address: string | null | undefined): boolean {
  return !!address && STALE_ADDRESS_RE.test(address);
}

export interface CompanyBusinessInfoInput {
  name: string | null | undefined;
  phone: string | null | undefined;
  email: string | null | undefined;
  address: string | null | undefined;
  slogan: string | null | undefined;
}

export interface CompanyBusinessInfo {
  name: string;
  phone: string;
  email: string;
  address: string;
  slogan: string;
}

function clean(value: string | null | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

/** Live company record first; canonical Harriman fallbacks; stale values refused. */
export function guardStaleBusinessInfo(profile: CompanyBusinessInfoInput): CompanyBusinessInfo {
  const phone = clean(profile.phone);
  const address = clean(profile.address);
  return {
    name: clean(profile.name) ?? BVISIBLE_BUSINESS_INFO.name,
    phone: phone && !isStalePhone(phone) ? phone : BVISIBLE_BUSINESS_INFO.phone,
    email: clean(profile.email) ?? BVISIBLE_BUSINESS_INFO.email,
    address: address && !isStaleAddress(address) ? address : BVISIBLE_BUSINESS_INFO.address,
    slogan: clean(profile.slogan) ?? BVISIBLE_BUSINESS_INFO.slogan,
  };
}
