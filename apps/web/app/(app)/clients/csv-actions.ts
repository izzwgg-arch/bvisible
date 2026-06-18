'use server';

import { prisma, Prisma } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { writeAuditLog } from '@/lib/auth/audit';
import { readRequestContext } from '@/lib/request-context';
import { parseCSV } from '@/lib/csv';
import { mapQboCustomerRow } from '@/lib/clients/qbo-customer-import';

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
    const data = mapQboCustomerRow(row);
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
          secondaryEmail: data.secondaryEmail,
          phone: data.phone,
          alternatePhone: data.alternatePhone,
          address: data.address,
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
