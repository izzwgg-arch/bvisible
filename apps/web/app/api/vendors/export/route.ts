import { NextResponse } from 'next/server';
import { prisma } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { buildCSV } from '@/lib/csv';

// GET /api/vendors/export
// Returns all tenant vendors as a downloadable CSV.
export async function GET() {
  const me = await requireTenantId();

  const vendors = await prisma.vendor.findMany({
    where: { tenantId: me.tenantId, deletedAt: null },
    orderBy: [{ name: 'asc' }],
    select: {
      name: true,
      email: true,
      phone: true,
      notes: true,
    },
  });

  const headers = ['Vendor Name', 'Email', 'Phone', 'Notes'];

  const rows = vendors.map((v) => [
    v.name,
    v.email ?? '',
    v.phone ?? '',
    v.notes ?? '',
  ]);

  const csv = buildCSV(headers, rows);
  const filename = `vendors-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
