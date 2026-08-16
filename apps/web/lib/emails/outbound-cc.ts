// Standing CC list for outbound ESTIMATE emails.
//
// Owner directive (Aug 2026): cg@, lt@ and sales@ are copied on every estimate
// email the app sends.
//
// Purchase orders used to share this list. They no longer do — the PO CC list
// is admin-managed per company and lives in the database; see
// lib/emails/po-cc.ts. Editing this constant therefore affects estimates ONLY,
// and editing the PO list in the admin area affects purchase orders only. That
// separation is the point: neither can silently change the other.
export const OUTBOUND_DOCUMENT_CC: ReadonlyArray<string> = [
  'cg@bvisible.us',
  'lt@bvisible.us',
  'sales@bvisible.us',
];
