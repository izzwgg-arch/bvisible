import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatMoney } from '@bvisible/pricing';
import { requireTenantId } from '@/lib/auth/current-user';
import { PageHeader } from '@/components/app-shell';
import { loadEstimatePdfData, qbmeSourceLinesFromPdfData } from '@/lib/estimate/estimate-pdf';
import { buildQbmeExport, QBME_ALLOWED_ITEMS } from '@/lib/estimate/qbme';
import { QbmeBlockActions } from './qbme-block-actions';

export const metadata = { title: 'QBME export' };
export const dynamic = 'force-dynamic';

export default async function QbmeExportPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireTenantId();
  const { id } = await params;

  // Same loader as the customer estimate / PDF, so the QBME block mirrors
  // the printed estimate line by line — never a separate line array.
  const data = await loadEstimatePdfData(me.tenantId, id);
  if (!data) notFound();

  const exportData = buildQbmeExport(qbmeSourceLinesFromPdfData(data));
  const recon = exportData.reconciliation;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="QuickBooks-ready block (QBME)"
        subtitle={`${data.number} · ${data.title} · ${data.billTo.companyName} — one QBME line per customer estimate line, in the same order. Paste the block into the QuickBooks Magic Estimator.`}
        actions={
          <Link
            href={`/estimates/${data.id}`}
            className="inline-flex items-center justify-center rounded-[8px] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] px-3.5 py-2 text-[13.5px] font-medium text-[var(--color-bv-text)] hover:bg-[var(--color-bv-bg)]"
          >
            ← Back to estimate
          </Link>
        }
      />

      <QbmeBlockActions block={exportData.block} filename={`${data.number}-qbme.txt`} />

      <section className="mt-4 rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-5 shadow-[var(--shadow-bv-card)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[13px] font-bold text-[var(--color-bv-text)]">
            {exportData.lines.length} line{exportData.lines.length === 1 ? '' : 's'} — matches the customer estimate
          </div>
          <div
            className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
              recon.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'
            }`}
          >
            {recon.ok
              ? `Reconciled: Σ QTY × RATE = ${formatMoney(recon.qbmeSubtotalCents)} pre-tax subtotal`
              : `Rounding difference of ${formatMoney(Math.abs(recon.driftCents))} vs. the pre-tax subtotal — see lines below`}
          </div>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] text-[12.5px]">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-[0.06em] text-[var(--color-bv-muted)]">
                <th className="py-1.5 pr-3">Item</th>
                <th className="py-1.5 pr-3">Description</th>
                <th className="py-1.5 pr-3 text-right">Qty</th>
                <th className="py-1.5 pr-3 text-right">Rate</th>
                <th className="py-1.5 text-right">Qty × Rate</th>
              </tr>
            </thead>
            <tbody>
              {exportData.lines.map((l, i) => {
                const drift = recon.lineDrift.find((d) => d.index === i);
                return (
                  <tr key={`${i}-${l.item}`} className="border-b border-[var(--color-bv-border)]/50 align-top">
                    <td className="py-1.5 pr-3 font-semibold text-[var(--color-bv-text)]">{l.item}</td>
                    <td className="py-1.5 pr-3 text-[var(--color-bv-muted)]">{l.description}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{l.qty}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">${l.rate}</td>
                    <td className="py-1.5 text-right font-bold tabular-nums text-[var(--color-bv-text)]">
                      {formatMoney(l.amountCents)}
                      {drift ? (
                        <span className="ml-1 text-[10px] font-semibold text-amber-700">
                          ({drift.driftCents > 0 ? '+' : ''}
                          {formatMoney(drift.driftCents)} vs. estimate)
                        </span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              <tr>
                <td className="pt-2.5 text-[13.5px] font-bold text-[var(--color-bv-text)]" colSpan={4}>
                  Pre-tax subtotal
                </td>
                <td className="pt-2.5 text-right text-[15px] font-bold text-[var(--color-bv-accent)]">
                  {formatMoney(recon.qbmeSubtotalCents)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-[var(--color-bv-muted)]">
          Allowed items: {QBME_ALLOWED_ITEMS.join(' · ')}. QTY is numeric, RATE is the per-unit
          selling rate, AMOUNT stays empty for QuickBooks to calculate, and every line ends with a
          final pipe. Sales tax is never a product line; QuickBooks applies it.
        </p>
      </section>
    </div>
  );
}
