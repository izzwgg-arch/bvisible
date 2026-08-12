import Link from 'next/link';
import { POStatus, prisma } from '@bvisible/db';
import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { OrderedMaterials, type PoCardData } from './ordered-materials';

export const metadata = { title: 'Ordered Materials' };
export const dynamic = 'force-dynamic';

// Everything except cancelled (hidden from the shop checklist — still
// visible under /purchase-orders/all) and soft-deleted POs.
const VISIBLE_STATUSES: POStatus[] = [
  POStatus.SENT,
  POStatus.ORDERED,
  POStatus.PARTIALLY_RECEIVED,
  POStatus.RECEIVED,
  POStatus.DRAFT,
];

// One grouped fetch for the whole checklist — POs, items, vendors,
// employees, receiving totals in a single query. History loads on demand
// when a material row is opened.
const PAGE_LIMIT = 250;

export default async function OrderedMaterialsPage() {
  const me = await requireTenantId();

  const pos = await prisma.purchaseOrder.findMany({
    where: {
      tenantId: me.tenantId,
      deletedAt: null,
      status: { in: VISIBLE_STATUSES },
    },
    orderBy: { createdAt: 'desc' },
    take: PAGE_LIMIT,
    select: {
      id: true,
      number: true,
      status: true,
      createdAt: true,
      createdBy: { select: { name: true, email: true } },
      vendor: { select: { name: true } },
      vendorSections: { select: { sentAt: true } },
      lines: {
        orderBy: { sortOrder: 'asc' },
        select: {
          id: true,
          description: true,
          qtyMilli: true,
          receivedQtyMilli: true,
          unit: true,
        },
      },
    },
  });

  const cards: PoCardData[] = pos.map((po) => {
    const sentAt = po.vendorSections
      .map((s) => s.sentAt)
      .filter((d): d is Date => d != null)
      .sort((a, b) => b.getTime() - a.getTime())[0];
    return {
      id: po.id,
      number: po.number,
      status: po.status,
      createdAtIso: po.createdAt.toISOString(),
      sentAtIso: sentAt ? sentAt.toISOString() : null,
      vendorName: po.vendor?.name ?? 'Vendor unassigned',
      createdByName: po.createdBy.name || po.createdBy.email,
      lines: po.lines.map((l) => ({
        id: l.id,
        description: l.description,
        qtyMilli: l.qtyMilli,
        receivedQtyMilli: l.receivedQtyMilli,
        unit: l.unit,
      })),
    };
  });

  return (
    <>
      <PageHeader
        title="Ordered Materials"
        subtitle="See what was ordered and check it off when it arrives."
        actions={
          <Link
            href="/purchase-orders/shop-order"
            className="inline-flex items-center justify-center rounded-[12px] bg-[var(--color-bv-accent)] px-4 py-2.5 text-[13.5px] font-semibold text-[var(--color-bv-accent-foreground)] shadow-[0_16px_34px_rgba(47,90,243,0.24)] transition-all hover:-translate-y-0.5 hover:opacity-95"
          >
            + Order Material
          </Link>
        }
      />
      <OrderedMaterials pos={cards} />
      <div className="mt-8 text-center">
        <Link
          href="/purchase-orders/all"
          className="text-[11.5px] font-medium text-[var(--color-bv-muted)] underline-offset-2 hover:underline"
        >
          Full purchase-order list
        </Link>
      </div>
    </>
  );
}
