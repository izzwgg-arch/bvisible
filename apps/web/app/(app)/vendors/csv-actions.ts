'use server';

import { prisma, Prisma } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { writeAuditLog } from '@/lib/auth/audit';
import { readRequestContext } from '@/lib/request-context';
import { parseCSV } from '@/lib/csv';

// Maps a CSV row (QBO Vendor List or generic) to vendor fields.
// Accepted headers (case-insensitive):
//   QBO: Vendor, Company, First Name, Last Name, Email, Phone, Mobile, Notes
//   Generic: name, vendor name, email, phone, mobile, notes, memo
function rowToVendor(row: Record<string, string>): {
  name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
} | null {
  const name = (
    row['vendor'] ||
    row['vendor name'] ||
    row['company'] ||
    row['name'] ||
    row['display name'] ||
    ''
  ).trim();

  if (!name) return null;

  const emailRaw = (row['email'] || row['e-mail'] || '').trim().toLowerCase();
  const email = emailRaw && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) ? emailRaw : null;

  const phone =
    (row['phone'] || row['work phone'] || row['mobile'] || row['cell phone'] || '').trim() || null;

  const notes = (row['notes'] || row['memo'] || row['note'] || '').trim() || null;

  return {
    name: name.slice(0, 160),
    email: email ? email.slice(0, 254) : null,
    phone: phone ? phone.slice(0, 40) : null,
    notes: notes ? notes.slice(0, 2000) : null,
  };
}

export interface ImportVendorsResult {
  imported: number;
  skipped: number;
  errors: string[];
}

export async function importVendorsAction(csvText: string): Promise<ImportVendorsResult> {
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
    const data = rowToVendor(row);
    if (!data) {
      skipped++;
      continue;
    }

    try {
      await prisma.vendor.create({
        data: {
          tenantId: me.tenantId,
          name: data.name,
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
        errors.push(`"${data.name}": unexpected error.`);
        skipped++;
      }
    }
  }

  if (imported > 0) {
    await writeAuditLog({
      action: 'vendor_csv_imported',
      userId: me.id,
      tenantId: me.tenantId,
      targetType: 'vendor',
      targetId: 'bulk',
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      metadata: { imported, skipped, totalRows: rows.length },
    });
  }

  return { imported, skipped, errors: errors.slice(0, 10) };
}
