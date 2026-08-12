import { notFound } from 'next/navigation';
import { prisma } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import {
  defaultOfficeReminderEmail,
  latestOfficeReminder,
} from '@/lib/po/office-reminder';
import { normalizeExternalUrl } from '@/lib/po/retail-cart';
import { OrderReadyView } from './order-ready-view';

export const metadata = { title: 'Order ready' };
export const dynamic = 'force-dynamic';

/// Result page for a retail (Amazon / Home Depot / …) purchase order.
///
/// Access is tenant-scoped, NOT creator-scoped: any authenticated user of the
/// tenant can open it, follow the product links, print, and resend the
/// reminder. `requireTenantId` blocks logged-out users.
export default async function OrderReadyPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const me = await requireTenantId();
  const { id } = await params;

  const po = await prisma.purchaseOrder.findFirst({
    where: { id, tenantId: me.tenantId, deletedAt: null },
    select: {
      id: true,
      number: true,
      createdAt: true,
      vendor: { select: { name: true } },
      createdBy: { select: { name: true, email: true } },
      lines: {
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          description: true,
          notes: true,
          vendorSku: true,
          productUrl: true,
          qtyMilli: true,
          unit: true,
          unitCostCents: true,
          computedCostCents: true,
          vendor: { select: { name: true } },
        },
      },
    },
  });
  if (!po) notFound();

  const reminder = await latestOfficeReminder(me.tenantId, po.id);

  const vendorName =
    po.vendor?.name ?? po.lines.find((l) => l.vendor?.name)?.vendor?.name ?? 'Store';

  return (
    <OrderReadyView
      po={{
        id: po.id,
        number: po.number,
        createdAt: po.createdAt.toISOString(),
        vendorName,
        createdByLabel: po.createdBy?.name || po.createdBy?.email || 'Unknown',
        lines: po.lines.map((line) => ({
          id: line.id,
          description: line.description,
          // "Specs" on this page = the line's own note (size / spec captured
          // at order time). Sheet-catalog bookkeeping notes are not specs, so
          // they are not shown as one.
          specs: line.notes && !line.notes.startsWith('Sheet catalog:') ? line.notes : '',
          sku: line.vendorSku ?? '',
          // Normalized server-side so the client never renders a scheme-less
          // link (which would resolve app-relative and 404).
          productUrl: normalizeExternalUrl(line.productUrl),
          qtyMilli: line.qtyMilli,
          unit: line.unit,
          unitCostCents: line.unitCostCents,
          computedCostCents: line.computedCostCents,
        })),
      }}
      reminder={reminder}
      // Helper text only. The authoritative default is resolved server-side on
      // every send; this value is never used to decide where mail goes.
      defaultRecipient={defaultOfficeReminderEmail()}
    />
  );
}
