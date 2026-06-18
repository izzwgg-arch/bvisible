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
      secondaryEmail: true,
      phone: true,
      alternatePhone: true,
      address: true,
      notes: true,
    },
  });

  const headers = [
    'Company',
    'Customer',
    'Contact Name',
    'Main Email',
    'Secondary Email',
    'Main Phone',
    'Alt. Phone',
    'Bill to 1',
    'Bill to 2',
    'Bill to 3',
    'Notes',
  ];

  const rows = clients.map((c) => {
    const [billTo1, billTo2, billTo3] = (c.address ?? '').split('\n');
    return [
      c.companyName,
      c.companyName,
      c.contactName ?? '',
      c.email ?? '',
      c.secondaryEmail ?? '',
      c.phone ?? '',
      c.alternatePhone ?? '',
      billTo1 ?? '',
      billTo2 ?? '',
      billTo3 ?? '',
      c.notes ?? '',
    ];
  });

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
