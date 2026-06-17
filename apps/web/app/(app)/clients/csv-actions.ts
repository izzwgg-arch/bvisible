'use server';

import { prisma, Prisma } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { writeAuditLog } from '@/lib/auth/audit';
import { readRequestContext } from '@/lib/request-context';
import { parseCSV } from '@/lib/csv';

// QBO Customer List column mappings (case-insensitive header matching).
// QBO exports headers like: Customer, Company, First Name, Last Name,
// Email, Phone, Mobile, Notes, Billing Address, etc.
// We map what we can; unknown columns are ignored.
function rowToClient(row: Record<string, string>): {
  companyName: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
} | null {
  // Company name: prefer "company" column, then "customer", then "name",
  // then "display name" (QBO's default export header).
  const companyName = (
    row['company'] ||
    row['customer'] ||
    row['customer name'] ||
    row['display name'] ||
    row['name'] ||
    ''
  ).trim();

  if (!companyName) return null;

  // Contact name: prefer "contact name", else combine "first name"+"last name"
  let contactName: string | null = null;
  const contactRaw = row['contact name'] || row['contact'] || '';
  if (contactRaw.trim()) {
    contactName = contactRaw.trim();
  } else {
    const first = (row['first name'] || row['firstname'] || '').trim();
    const last = (row['last name'] || row['lastname'] || '').trim();
    const combined = [first, last].filter(Boolean).join(' ');
    if (combined) contactName = combined;
  }

  // Email
  const emailRaw = (row['email'] || row['e-mail'] || '').trim().toLowerCase();
  const email = emailRaw && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) ? emailRaw : null;

  // Phone: prefer "phone", then "work phone", then "mobile"
  const phone =
    (row['phone'] || row['work phone'] || row['mobile'] || row['cell phone'] || '').trim() || null;

  // Notes / memo
  const notes = (row['notes'] || row['memo'] || row['note'] || '').trim() || null;

  return {
    companyName: companyName.slice(0, 160),
    contactName: contactName ? contactName.slice(0, 120) : null,
    email: email ? email.slice(0, 254) : null,
    phone: phone ? phone.slice(0, 40) : null,
    notes: notes ? notes.slice(0, 2000) : null,
  };
}

export interface ImportClientsResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export async function importClientsAction(csvText: string): Promise<ImportClientsResult> {
  const me = await requireTenantId();
  const ctx = await readRequestContext();

  let rows: Array<Record<string, string>>;
  try {
    rows = parseCSV(csvText);
  } catch {
    return { imported: 0, skipped: 0, errors: ['Could not parse CSV — check the file format.'] };
  }

  if (rows.length === 0) {
    return { imported: 0, skipped: 0, errors: ['CSV file is empty or has no data rows.'] };
  }

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const row of rows) {
    const data = rowToClient(row);
    if (!data) {
      skipped++;
      continue;
    }

    try {
      await prisma.client.create({
        data: {
          tenantId: me.tenantId,
          companyName: data.companyName,
          contactName: data.contactName,
          email: data.email,
          phone: data.phone,
          notes: data.notes,
        },
        select: { id: true },
      });
      imported++;
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        skipped++;
      } else {
        errors.push(`"${data.companyName}": unexpected error.`);
        skipped++;
      }
    }
  }

  if (imported > 0) {
    await writeAuditLog({
      action: 'client_csv_imported',
      userId: me.id,
      tenantId: me.tenantId,
      targetType: 'client',
      targetId: 'bulk',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { imported, skipped, totalRows: rows.length },
    });
  }

  return { imported, skipped, errors: errors.slice(0, 10) };
}
