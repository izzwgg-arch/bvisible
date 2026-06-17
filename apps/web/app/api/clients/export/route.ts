import { NextResponse } from 'next/server';
import { prisma } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { buildCSV } from '@/lib/csv';

// GET /api/clients/export
// Streams all tenant clients as a CSV file.
// Compatible with QBO Customer List import format.
export async function GET() {
  const me = await requireTenantId();

  const clients = await prisma.client.findMany({
    where: { tenantId: me.tenantId, deletedAt: null },
    orderBy: [{ companyName: 'asc' }],
    select: {
      companyName: true,
      contactName: true,
      email: true,
      phone: true,
      notes: true,
    },
  });

  const headers = ['Customer Name', 'Contact Name', 'Email', 'Phone', 'Notes'];

  const rows = clients.map((c) => [
    c.companyName,
    c.contactName ?? '',
    c.email ?? '',
    c.phone ?? '',
    c.notes ?? '',
  ]);

  const csv = buildCSV(headers, rows);
  const filename = `customers-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
