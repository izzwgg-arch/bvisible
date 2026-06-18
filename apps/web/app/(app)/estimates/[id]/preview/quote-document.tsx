import type { CustomerQuoteLine } from '@/lib/estimate/customer-quote';
import { formatQuoteMoney } from '@/lib/estimate/customer-quote-view';

const STANDARD_TERMS = `This quote is valid subject to written acceptance and availability. Pricing excludes taxes unless noted.`;

export function QuoteDocument(props: {
  company: {
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    slogan: string | null;
    logoDataUrl: string | null;
  };
  estimateNumber: string;
  title: string;
  quoteDateLabel: string;
  billTo: {
    companyName: string;
    contactName: string | null;
    email: string | null;
    phone: string | null;
  };
  lines: ReadonlyArray<CustomerQuoteLine>;
  totalSellCents: number;
  notes: string | null;
}) {
  return (
    <article className="bv-quote-document mx-auto max-w-[880px] rounded-[var(--radius-bv)] border border-[var(--color-bv-border)] bg-[var(--color-bv-surface)] p-10 shadow-[var(--shadow-bv-card)] print:border-0 print:shadow-none print:p-0">
      <header className="flex flex-col gap-6 border-b border-[var(--color-bv-border)] pb-8 print:pb-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex max-w-[520px] items-start gap-4">
            {props.company.logoDataUrl ? (
              <div className="flex h-20 w-32 shrink-0 items-center justify-center overflow-hidden rounded-[14px] border border-[var(--color-bv-border)] bg-white p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={props.company.logoDataUrl} alt={`${props.company.name} logo`} className="max-h-full max-w-full object-contain" />
              </div>
            ) : null}
            <div className="flex min-w-0 flex-col gap-1">
              {props.company.slogan ? (
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-bv-muted)]">
                  {props.company.slogan}
                </span>
              ) : null}
              <h2 className="text-[26px] font-semibold tracking-tight text-[var(--color-bv-text)]">
                {props.company.name}
              </h2>
              <CompanyContact company={props.company} />
            </div>
          </div>
          <div className="text-right">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-bv-muted)]">
              Estimate
            </p>
            <p className="text-[20px] font-semibold text-[var(--color-bv-text)]">{props.estimateNumber}</p>
            <p className="mt-1 text-[13px] text-[var(--color-bv-muted)]">{props.quoteDateLabel}</p>
          </div>
        </div>
        <div>
          <p className="text-[15px] font-semibold text-[var(--color-bv-text)]">{props.title}</p>
        </div>
      </header>

      <section className="mt-8 grid gap-8 md:grid-cols-2 print:mt-6">
        <div>
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-bv-muted)]">
            Bill to
          </h3>
          <p className="mt-2 text-[15px] font-semibold text-[var(--color-bv-text)]">
            {props.billTo.companyName}
          </p>
          {props.billTo.contactName ? (
            <p className="mt-1 text-[13.5px] text-[var(--color-bv-text)]">{props.billTo.contactName}</p>
          ) : null}
          {props.billTo.email ? (
            <p className="mt-1 text-[13px] text-[var(--color-bv-muted)]">{props.billTo.email}</p>
          ) : null}
          {props.billTo.phone ? (
            <p className="mt-0.5 text-[13px] text-[var(--color-bv-muted)]">{props.billTo.phone}</p>
          ) : null}
        </div>
      </section>

      <section className="mt-10 print:mt-8">
        <h3 className="sr-only">Line items</h3>
        <div className="overflow-hidden rounded-[10px] border border-[var(--color-bv-border)] print:border-[var(--color-bv-border)]">
          <table className="w-full border-collapse text-left text-[13.5px]">
            <thead className="bg-[var(--color-bv-bg)] text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-bv-muted)]">
              <tr>
                <th className="px-4 py-3">Description</th>
                <th className="hidden w-[100px] px-4 py-3 sm:table-cell">Type</th>
                <th className="w-[72px] px-4 py-3 text-right">Qty</th>
                <th className="w-[120px] px-4 py-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-bv-border)] bg-[var(--color-bv-surface)]">
              {props.lines.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-[var(--color-bv-muted)]">
                    No line items on this estimate.
                  </td>
                </tr>
              ) : (
                props.lines.map((row) => (
                  <tr key={row.id}>
                    <td className="px-4 py-3 align-top text-[var(--color-bv-text)]">
                      <span className="font-medium">{row.description}</span>
                      <span className="mt-1 block text-[12px] text-[var(--color-bv-muted)] sm:hidden">
                        {row.kindLabel}
                      </span>
                    </td>
                    <td className="hidden px-4 py-3 align-top text-[var(--color-bv-muted)] sm:table-cell">
                      {row.kindLabel}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--color-bv-text)]">
                      {row.qtyLabel}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium text-[var(--color-bv-text)]">
                      {formatQuoteMoney(row.lineSellCents)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-6 flex justify-end border-t border-[var(--color-bv-border)] pt-4">
          <div className="w-full max-w-xs space-y-2 text-[13.5px]">
            <div className="flex justify-between text-[var(--color-bv-muted)]">
              <span>Total</span>
              <span className="tabular-nums font-semibold text-[var(--color-bv-text)]">
                {formatQuoteMoney(props.totalSellCents)}
              </span>
            </div>
          </div>
        </div>
      </section>

      {(props.notes?.trim() ?? '').length > 0 ? (
        <section className="mt-10 border-t border-[var(--color-bv-border)] pt-8 print:mt-8 print:pt-6">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-bv-muted)]">
            Notes
          </h3>
          <p className="mt-3 whitespace-pre-wrap text-[13.5px] leading-relaxed text-[var(--color-bv-text)]">
            {props.notes!.trim()}
          </p>
        </section>
      ) : null}

      <section className="mt-10 border-t border-[var(--color-bv-border)] pt-8 print:mt-8 print:pt-6">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--color-bv-muted)]">
          Terms
        </h3>
        <p className="mt-3 text-[13px] leading-relaxed text-[var(--color-bv-muted)]">{STANDARD_TERMS}</p>
      </section>

      <footer className="mt-12 text-center text-[11px] text-[var(--color-bv-muted)] print:mt-8">
        Thank you for your business.
      </footer>
    </article>
  );
}

function CompanyContact({
  company,
}: {
  company: {
    phone: string | null;
    email: string | null;
    address: string | null;
  };
}) {
  const items = [company.phone, company.email].filter(Boolean);
  const address = company.address?.trim();

  if (items.length === 0 && !address) return null;

  return (
    <div className="mt-2 space-y-0.5 text-[12.5px] leading-relaxed text-[var(--color-bv-muted)]">
      {items.length > 0 ? <p>{items.join(' | ')}</p> : null}
      {address ? <p className="whitespace-pre-line">{address}</p> : null}
    </div>
  );
}
