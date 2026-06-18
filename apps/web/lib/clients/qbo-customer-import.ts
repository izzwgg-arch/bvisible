export type ClientImportRow = {
  companyName: string;
  contactName: string | null;
  email: string | null;
  secondaryEmail: string | null;
  phone: string | null;
  alternatePhone: string | null;
  address: string | null;
  notes: string | null;
};

function firstNonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    const trimmed = (value ?? '').trim();
    if (trimmed) return trimmed;
  }
  return '';
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function parseEmails(raw: string): { email: string | null; secondaryEmail: string | null } {
  const parts = raw
    .split(/[,;]/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  const valid = parts.filter(isEmail);
  if (valid.length === 0) return { email: null, secondaryEmail: null };
  if (valid.length === 1) return { email: valid[0]!, secondaryEmail: null };
  return {
    email: valid[0]!,
    secondaryEmail: valid.slice(1).join(', '),
  };
}

function looksLikeAddressLine(line: string, companyName: string): boolean {
  const normalized = normalizeKey(line);
  const company = normalizeKey(companyName);
  if (!normalized || normalized === company) return false;

  // Bill-to line 1 often repeats the company/customer name exactly.
  if (company && (normalized === company || normalized.startsWith(company + ' '))) {
    return false;
  }

  return true;
}

function buildAddress(row: Record<string, string>, companyName: string): string | null {
  const lines = ['bill to 1', 'bill to 2', 'bill to 3', 'bill to 4', 'bill to 5']
    .map((key) => (row[key] || '').trim())
    .filter((line) => looksLikeAddressLine(line, companyName));

  if (lines.length === 0) return null;
  return lines.join('\n').slice(0, 500);
}

/**
 * Maps a QBO Customer List CSV row (headers lowercased by parseCSV) into client fields.
 */
export function mapQboCustomerRow(row: Record<string, string>): ClientImportRow | null {
  const companyName = firstNonEmpty(
    row['company'],
    row['customer'],
    row['customer name'],
    row['display name'],
    row['name'],
  );

  if (!companyName) return null;

  let contactName: string | null = null;
  const contactRaw = firstNonEmpty(row['primary contact'], row['contact name'], row['contact']);
  if (contactRaw) {
    contactName = contactRaw;
  } else {
    const first = (row['first name'] || row['firstname'] || '').trim();
    const last = (row['last name'] || row['lastname'] || '').trim();
    const combined = [first, row['m.i.']?.trim(), last].filter(Boolean).join(' ');
    if (combined) contactName = combined;
  }

  const { email, secondaryEmail } = parseEmails(
    firstNonEmpty(row['main email'], row['email'], row['e-mail']),
  );

  const phone =
    firstNonEmpty(
      row['main phone'],
      row['phone'],
      row['work phone'],
      row['mobile'],
      row['cell phone'],
    ) || null;

  const alternatePhone =
    firstNonEmpty(row['alt. phone'], row['alt phone'], row['alternate phone'], row['secondary phone']) ||
    null;

  const address = buildAddress(row, companyName);

  const notes = (row['notes'] || row['memo'] || row['note'] || '').trim() || null;

  return {
    companyName: companyName.slice(0, 160),
    contactName: contactName ? contactName.slice(0, 120) : null,
    email: email ? email.slice(0, 254) : null,
    secondaryEmail: secondaryEmail ? secondaryEmail.slice(0, 254) : null,
    phone: phone ? phone.slice(0, 40) : null,
    alternatePhone: alternatePhone ? alternatePhone.slice(0, 40) : null,
    address: address ? address.slice(0, 500) : null,
    notes: notes ? notes.slice(0, 2000) : null,
  };
}
