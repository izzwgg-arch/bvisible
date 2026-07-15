// Print-friendly purchase-order document (the "Open PDF" target).
// Lives outside the (app) route group so no sidebar/chrome prints —
// browser Print → Save as PDF produces the vendor-ready document.
// Session-gated like every other authenticated route (middleware +
// requireTenantId), tenant-scoped query.

import { prisma } from '@bvisible/db';
import { notFound } from 'next/navigation';
import { requireTenantId } from '@/lib/auth/current-user';
import { formatMoney, formatQty } from '@bvisible/pricing';
import { PrintToolbar } from './print-toolbar';

export const metadata = { title: 'Purchase order' };
export const dynamic = 'force-dynamic';

const FALLBACK_ADDRESS = '97 Route 17M, Harriman, New York';
const FALLBACK_PHONE = '407-374-1527';

export default async function PoPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireTenantId();
  const { id } = await params;

  const po = await prisma.purchaseOrder.findFirst({
    where: { id, tenantId: me.tenantId, deletedAt: null },
    select: {
      number: true,
      qboPoNumber: true,
      notes: true,
      subtotalCents: true,
      createdAt: true,
      vendor: { select: { name: true, email: true, emails: true } },
      lines: {
        orderBy: { sortOrder: 'asc' },
        select: {
          description: true,
          qtyMilli: true,
          unitCostCents: true,
          computedCostCents: true,
        },
      },
      tenant: { select: { name: true, address: true, phone: true } },
    },
  });
  if (!po) notFound();

  const company = po.tenant.name || 'B Visible Signs & Printing';
  const address = po.tenant.address || FALLBACK_ADDRESS;
  const phone = po.tenant.phone || FALLBACK_PHONE;
  const vendorEmails = po.vendor
    ? [po.vendor.email, ...po.vendor.emails].filter(
        (e, i, all): e is string => !!e && all.indexOf(e) === i
      )
    : [];

  return (
    <div className="mx-auto max-w-[820px] bg-white p-10 font-sans text-[#1a1a1a] print:p-0">
      <PrintToolbar />

      <div className="flex items-start justify-between">
        <div>
          <div className="text-[26px] font-extrabold tracking-tight text-[#F28744]">
            {company.toUpperCase()}
          </div>
          <div className="text-[12px] text-neutral-500">Signs &amp; Printing</div>
          <div className="mt-2 text-[13px]">{address}</div>
          <div className="text-[13px]">{phone}</div>
        </div>
        <div className="text-right">
          <div className="text-[24px] font-extrabold tracking-tight">PURCHASE ORDER</div>
          <div className="mt-2 text-[15px] font-bold">PO No. {po.number.replace(/^PO-?/, '')}</div>
          {po.qboPoNumber ? (
            <div className="text-[12px] text-neutral-500">QuickBooks # {po.qboPoNumber}</div>
          ) : null}
          <div className="text-[13px]">
            Date{' '}
            {po.createdAt.toLocaleDateString('en-US', {
              month: 'numeric',
              day: 'numeric',
              year: 'numeric',
            })}
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4">
        <div className="rounded border border-neutral-300 p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
            Vendor
          </div>
          <div className="mt-1 text-[15px] font-bold">{po.vendor?.name ?? 'Vendor TBD'}</div>
          {vendorEmails.length > 0 ? (
            <div className="text-[11px] text-neutral-500">{vendorEmails.join(', ')}</div>
          ) : null}
        </div>
        <div className="rounded border border-neutral-300 p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-neutral-500">
            Ship to
          </div>
          <div className="mt-1 text-[15px] font-bold">{company}</div>
          <div className="text-[11px] text-neutral-500">{address}</div>
        </div>
      </div>

      <table className="mt-6 w-full border-collapse text-[13px]">
        <thead>
          <tr className="bg-[#16181d] text-white">
            <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider">
              Item
            </th>
            <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wider">
              Qty
            </th>
            <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wider">
              Rate
            </th>
            <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wider">
              Amount
            </th>
          </tr>
        </thead>
        <tbody>
          {po.lines.map((line, i) => (
            <tr key={i} className="border-b border-neutral-200">
              <td className="px-3 py-2.5">{line.description}</td>
              <td className="px-3 py-2.5 text-right">{formatQty(line.qtyMilli)}</td>
              <td className="px-3 py-2.5 text-right">{formatMoney(line.unitCostCents)}</td>
              <td className="px-3 py-2.5 text-right">{formatMoney(line.computedCostCents)}</td>
            </tr>
          ))}
          <tr>
            <td colSpan={3} className="px-3 py-3 text-right text-[14px] font-bold">
              Total
            </td>
            <td className="px-3 py-3 text-right text-[14px] font-bold">
              {formatMoney(po.subtotalCents)}
            </td>
          </tr>
        </tbody>
      </table>

      {po.notes ? (
        <div className="mt-5 text-[12.5px]">
          <span className="font-bold">Notes:</span> {po.notes}
        </div>
      ) : null}

      <div className="mt-8 text-[11.5px] text-neutral-500">
        Please confirm receipt of this order and reference PO {po.number} on all invoices,
        packing slips, and correspondence.
      </div>
    </div>
  );
}
