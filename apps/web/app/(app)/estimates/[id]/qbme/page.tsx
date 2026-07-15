import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@bvisible/db';
import { formatMoney } from '@bvisible/pricing';
import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { buildQbmeExport, type QbmeLineInput } from '@/lib/estimate/qbme';
import { QbmeBlockActions } from './qbme-block-actions';

export const metadata = { title: 'QBME export' };
export const dynamic = 'force-dynamic';

export default async function QbmeExportPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireTenantId();
  const { id } = await params;

  const estimate = await prisma.estimate.findFirst({
    where: { id, tenantId: me.tenantId, deletedAt: null },
    select: {
      id: true,
      number: true,
      title: true,
      multiplierMilli: true,
      designFlatCents: true,
      finalPriceCents: true,
      client: { select: { companyName: true } },
      lines: {
        orderBy: { sortOrder: 'asc' },
        select: {
          kind: true,
          description: true,
          computedCostCents: true,
          markupExempt: true,
          sourceKind: true,
        },
      },
    },
  });
  if (!estimate) notFound();

  const exportData = buildQbmeExport({
    title: estimate.title,
    multiplierMilli: estimate.multiplierMilli,
    designFlatCents: estimate.designFlatCents,
    finalPriceCents: estimate.finalPriceCents,
    lines: estimate.lines as QbmeLineInput[],
  });

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="QuickBooks-ready block (QBME)"
        subtitle={`${estimate.number} · ${estimate.title} · ${estimate.client.companyName} — copy this block into QuickBooks. Priced with B Visible rules; Sheet-priced lines are never marked up twice.`}
        actions={
          <Link
            href={`/estimates/${estimate.id}`}
            className="inline-flex items-center justify-center rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3.5 py-2 text-[13.5px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
          >
            ← Back to estimate
          </Link>
        }
      />

      <QbmeBlockActions
        block={exportData.block}
        filename={`${estimate.number}-qbme.txt`}
      />

      {/* summary */}
      <section className="mt-4 rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-5 shadow-[var(--shadow-bv-card)]">
        <div className="text-[13px] font-bold text-[var(--color-bv-text)]">Summary</div>
        <table className="mt-2 w-full text-[12.5px]">
          <tbody>
            {exportData.lines.map((l) => (
              <tr key={l.item} className="border-b border-[var(--color-bv-border)]/50">
                <td className="py-1.5 font-semibold text-[var(--color-bv-text)]">{l.item}</td>
                <td className="py-1.5 text-[var(--color-bv-muted)]">{l.description}</td>
                <td className="py-1.5 text-right font-bold text-[var(--color-bv-text)]">
                  {formatMoney(l.rateCents)}
                </td>
              </tr>
            ))}
            <tr>
              <td className="pt-2.5 text-[13.5px] font-bold text-[var(--color-bv-text)]">
                Final total
              </td>
              <td />
              <td className="pt-2.5 text-right text-[15px] font-bold text-[var(--color-bv-accent)]">
                {formatMoney(exportData.totalCents)}
              </td>
            </tr>
          </tbody>
        </table>
        <p className="mt-3 text-[11px] leading-relaxed text-[var(--color-bv-muted)]">
          Allowed items: Wrapping · Sales · 3D Lettering · Design · Shipping · Installation. QTY is
          numeric, RATE is the unit price, AMOUNT stays empty, and every line ends with a final
          pipe.
        </p>
      </section>
    </div>
  );
}
