// All email addresses a PO should go to for a vendor. A vendor can have
// several emails on file (the `emails` array, synced from the Sheet Vendor
// Directory, plus the single `email` field). Every valid, unique address
// receives the PO — deduped case-insensitively.

export function vendorRecipients(vendor: {
  email?: string | null;
  emails?: string[] | null;
}): string[] {
  const candidates = [...(vendor.emails ?? []), vendor.email ?? ''];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of candidates) {
    const e = (raw ?? '').trim();
    if (!e || !e.includes('@')) continue;
    const key = e.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/// Comma-separated recipient string for Nodemailer's `to` field (accepts
/// multiple addresses). Empty string when the vendor has no email.
export function vendorRecipientLine(vendor: {
  email?: string | null;
  emails?: string[] | null;
}): string {
  return vendorRecipients(vendor).join(', ');
}
