import { NextResponse } from 'next/server';
import { prisma, Role } from '@bvisible/db';
import { requireRoleWithEffectiveCompany } from '@/lib/auth/current-user';
import { buildCSV } from '@/lib/csv';

// GET /api/items/export
// Streams all tenant catalog items as a CSV file.
// Compatible with QBO Products and Services import format.
export async function GET() {
  const me = await requireRoleWithEffectiveCompany(Role.ADMIN, Role.SUPER_ADMIN);

  const items = await prisma.shopMaterialItem.findMany({
    where: { tenantId: me.tenantId },
    orderBy: [{ name: 'asc' }],
    select: {
      name: true,
      notes: true,
      kind: true,
      catalogUnit: true,
      customUnitLabel: true,
      internalCostCents: true,
      defaultSellPriceCents: true,
      markupPercentMilli: true,
      defaultQtyMilli: true,
      isActive: true,
    },
  });

  const headers = [
    'Item Name',
    'Description',
    'Type',
    'Unit',
    'Internal Cost (USD)',
    'Default Sell Price (USD)',
    'Markup %',
    'Default Qty',
    'Is Active',
  ];

  const rows = items.map((item) => {
    const unit = item.catalogUnit === 'CUSTOM'
      ? (item.customUnitLabel ?? 'CUSTOM')
      : item.catalogUnit;

    return [
      item.name,
      item.notes ?? '',
      item.kind,
      unit,
      (item.internalCostCents / 100).toFixed(2),
      item.defaultSellPriceCents !== null
        ? (item.defaultSellPriceCents / 100).toFixed(2)
        : '',
      (item.markupPercentMilli / 1000).toFixed(1),
      (item.defaultQtyMilli / 1000).toFixed(item.defaultQtyMilli % 1000 === 0 ? 0 : 3),
      item.isActive ? 'true' : 'false',
    ];
  });

  const csv = buildCSV(headers, rows);
  const filename = `catalog-${new Date().toISOString().slice(0, 10)}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
