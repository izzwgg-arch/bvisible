import fs from 'node:fs';
import path from 'node:path';
import { EstimateStatus, prisma, type EstimateLineKind, type QbItem } from '@bvisible/db';
import { getTenantInvoiceProfile } from '@/lib/company/tenant-invoice-profile';
import { guardStaleBusinessInfo } from '@/lib/company/business-info';
import { buildCustomerQuoteLines } from '@/lib/estimate/customer-quote-view';
import { buildEstimateTerms } from '@/lib/estimate/estimate-terms';
import { qbItemLabel, type QbmeSourceLine } from '@/lib/estimate/qbme';
import { computeSalesTax } from '@/lib/estimate/sales-tax';
import { loadBidOperatingRates } from '@/lib/bid/rates';
import { labelEstimateStatus } from '@/lib/ui/status-labels';

const BRAND_LOGO_PATH =
  [
    path.join(process.cwd(), 'public/brand/b-visible-logo.png'),
    path.join(process.cwd(), 'apps/web/public/brand/b-visible-logo.png'),
  ].find((candidate) => fs.existsSync(candidate)) ??
  path.join(process.cwd(), 'public/brand/b-visible-logo.png');

export interface EstimatePdfLine {
  id: string;
  /** "Item" column — QuickBooks item label when the line stores one, else the line kind. */
  kindLabel: string;
  qbItem: QbItem | null;
  kind: EstimateLineKind | null;
  sourceKind: string | null;
  description: string;
  qtyLabel: string;
  qtyMilli: number;
  rateCents: number;
  totalCents: number;
  taxable: boolean;
}

export interface EstimatePdfData {
  id: string;
  number: string;
  title: string;
  status: EstimateStatus;
  dateLabel: string;
  companyName: string;
  company: {
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    slogan: string | null;
  };
  billTo: {
    companyName: string;
    contactName: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
  };
  lines: EstimatePdfLine[];
  subtotalCents: number;
  taxCents: number;
  /// Sales tax setting used (percent × 1000). 0 = no tax line; the estimate
  /// is presented pre-tax and says so.
  taxPercentMilli: number;
  taxLabel: string;
  totalCents: number;
  notes: string | null;
  terms: string[];
  logoDataUrl: string;
  /// Bid Estimator project details when the estimate is a BID (else null).
  project: {
    name: string | null;
    address: string | null;
    poNumber: string | null;
    contactName: string | null;
  } | null;
  statusLabel: string;
  /// Sales representative assigned to the estimate — always the live
  /// `salesRep` relation (never the customer, never a stale hardcoded
  /// value). Null when unassigned; the Rep box renders blank.
  salesRepName: string | null;
}

export function estimatePdfFilename(estimateNumber: string): string {
  return `Estimate-${estimateNumber.replace(/[^A-Za-z0-9_-]+/g, '-')}.pdf`;
}

export async function loadEstimatePdfData(tenantId: string, estimateId: string): Promise<EstimatePdfData | null> {
  const estimate = await prisma.estimate.findFirst({
    where: { id: estimateId, tenantId, deletedAt: null },
    select: {
      id: true,
      number: true,
      title: true,
      status: true,
      notes: true,
      subtotalCostCents: true,
      finalPriceCents: true,
      updatedAt: true,
      tenant: { select: { id: true, name: true } },
      salesRep: { select: { name: true, email: true } },
      bidWorkflow: {
        select: {
          projectName: true,
          projectAddress: true,
          poNumber: true,
          projectContactName: true,
          installInputsJson: true,
        },
      },
      client: {
        select: {
          companyName: true,
          contactName: true,
          email: true,
          phone: true,
          address: true,
        },
      },
      lines: {
        orderBy: [{ sortOrder: 'asc' }],
        select: {
          id: true,
          description: true,
          customerDescription: true,
          hiddenFromCustomer: true,
          qtyMilli: true,
          kind: true,
          computedCostCents: true,
          unitCostCents: true,
          markupExempt: true,
          qbItem: true,
          sourceKind: true,
          lineGroupId: true,
          lineGroupLabel: true,
        },
      },
    },
  });

  if (!estimate) return null;

  const [companyProfile, rates] = await Promise.all([
    getTenantInvoiceProfile(prisma, estimate.tenant),
    loadBidOperatingRates(estimate.tenant.id),
  ]);
  const visibleLines = estimate.lines.filter((line) => !line.hiddenFromCustomer);
  const quoteLines = buildCustomerQuoteLines(
    visibleLines,
    estimate.subtotalCostCents,
    estimate.finalPriceCents,
  );
  const lineById = new Map(visibleLines.map((line) => [line.id, line]));

  const lines = quoteLines.map((line): EstimatePdfLine => {
    const source = lineById.get(line.id);
    const qtyMilli = Math.max(0, source?.qtyMilli ?? 0);
    const qty = qtyMilli > 0 ? qtyMilli / 1000 : 1;
    // Markup-exempt lines (Sheet selling rates, Bid Estimator lines) carry
    // the customer unit rate directly; cost-plus lines back-derive the
    // rate from the allocated sell.
    const exactRate =
      source && source.markupExempt && line.lineSellCents === source.computedCostCents
        ? source.unitCostCents
        : null;
    return {
      id: line.id,
      kindLabel: source?.qbItem ? qbItemLabel(source.qbItem) : shortKindLabel(source?.kind, line.kindLabel),
      qbItem: source?.qbItem ?? null,
      kind: source?.kind ?? null,
      sourceKind: source?.sourceKind ?? null,
      description: line.description,
      qtyLabel: line.qtyLabel,
      qtyMilli: qtyMilli > 0 ? qtyMilli : 1000,
      rateCents: exactRate ?? Math.round(line.lineSellCents / Math.max(qty, 1)),
      totalCents: line.lineSellCents,
      taxable: true,
    };
  });

  const subtotalCents = lines.reduce((sum, line) => sum + line.totalCents, 0);
  const taxableSubtotalCents = lines.reduce((sum, line) => sum + (line.taxable ? line.totalCents : 0), 0);
  const tax = computeSalesTax(taxableSubtotalCents, rates.salesTaxPercentMilli);
  const company = guardStaleBusinessInfo(companyProfile);
  const bid = estimate.bidWorkflow;
  const installInputs = (bid?.installInputsJson ?? null) as { customerAssumptions?: unknown } | null;
  const installAssumptions = Array.isArray(installInputs?.customerAssumptions)
    ? (installInputs!.customerAssumptions as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];

  return {
    id: estimate.id,
    number: estimate.number,
    title: estimate.title,
    status: estimate.status,
    dateLabel: formatPdfDate(estimate.updatedAt),
    companyName: company.name,
    company,
    billTo: estimate.client,
    lines,
    subtotalCents,
    taxCents: tax.taxCents,
    taxPercentMilli: tax.percentMilli,
    taxLabel: tax.label,
    totalCents: tax.totalCents,
    notes: estimate.notes,
    terms: buildEstimateTerms({ additional: installAssumptions }),
    logoDataUrl: companyProfile.logoDataUrl?.trim() || readBrandLogoDataUrl(),
    project: bid
      ? {
          name: bid.projectName?.trim() || null,
          address: bid.projectAddress?.trim() || null,
          poNumber: bid.poNumber?.trim() || null,
          contactName: bid.projectContactName?.trim() || null,
        }
      : null,
    statusLabel: labelEstimateStatus(estimate.status),
    salesRepName: estimate.salesRep?.name?.trim() || estimate.salesRep?.email?.trim() || null,
  };
}

export function renderEstimatePdfHtml(data: EstimatePdfData): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Estimate ${escapeHtml(data.number)}</title>
  <style>${estimatePdfCss()}</style>
</head>
<body>
${renderEstimatePdfBody(data)}
</body>
</html>`;
}

export async function renderEstimatePdfBuffer(data: EstimatePdfData): Promise<Buffer> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 850 }, deviceScaleFactor: 1 });
    await page.setContent(renderEstimatePdfHtml(data), { waitUntil: 'networkidle' });
    return await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: { top: '0.25in', right: '0.25in', bottom: '0.25in', left: '0.25in' },
    });
  } finally {
    await browser.close();
  }
}

export function renderEstimatePdfBody(data: EstimatePdfData): string {
  const companyAddress = addressLines(data.company.address);
  const billToAddress = addressLines(data.billTo.address);
  return `<main class="estimate-page">
  <section class="estimate-card">
    <header class="top">
      <div class="brand">
        <img src="${data.logoDataUrl}" alt="B Visible Signs and Printing">
        <div class="company-details">
          ${companyAddress.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}
          ${data.company.phone ? `<p>${escapeHtml(data.company.phone)}</p>` : ''}
          ${data.company.email ? `<p>${escapeHtml(data.company.email)}</p>` : ''}
        </div>
      </div>
      <div class="estimate-meta">
        <div class="estimate-label">Estimate</div>
        <div class="estimate-number">${escapeHtml(data.number)}</div>
        <div class="meta-row"><span>Date</span><strong>${escapeHtml(data.dateLabel)}</strong></div>
        <div class="meta-row status-row"><span>Status</span><strong>${escapeHtml(data.statusLabel)}</strong></div>
      </div>
    </header>

    <section class="bill-row">
      <div class="bill-to">
        <h2>Bill to:</h2>
        <p class="client-name">${escapeHtml(data.billTo.companyName || 'Customer')}</p>
        ${billToAddress.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}
        ${data.billTo.phone ? `<p>${escapeHtml(data.billTo.phone)}</p>` : ''}
        ${data.billTo.contactName ? `<p>${escapeHtml(data.billTo.contactName)}</p>` : ''}
        ${data.billTo.email ? `<p>${escapeHtml(data.billTo.email)}</p>` : ''}
        ${data.project && (data.project.name || data.project.address)
          ? `<h2 class="project-heading">Project</h2>
        ${data.project.name ? `<p class="client-name">${escapeHtml(data.project.name)}</p>` : ''}
        ${addressLines(data.project.address).map((line) => `<p>${escapeHtml(line)}</p>`).join('')}
        ${data.project.contactName ? `<p>${escapeHtml(data.project.contactName)}</p>` : ''}`
          : ''}
      </div>
      <div class="po-meta">
        <div><span>P.O. No.</span><strong>${data.project?.poNumber ? escapeHtml(data.project.poNumber) : '&nbsp;'}</strong></div>
        <div><span>Rep</span><strong>${data.salesRepName ? escapeHtml(data.salesRepName) : '&nbsp;'}</strong></div>
      </div>
    </section>

    <section class="items">
      <table>
        <thead>
          <tr>
            <th class="kind">Item</th>
            <th>Description</th>
            <th class="num">Qty</th>
            <th class="num">Rate</th>
            <th class="num">Total</th>
          </tr>
        </thead>
        <tbody>
          ${data.lines.length === 0
            ? '<tr><td colspan="5" class="empty">No line items on this estimate.</td></tr>'
            : data.lines.map(renderLine).join('')}
        </tbody>
      </table>
    </section>

    <section class="bottom">
      <div class="terms">
        <h3>Terms and conditions</h3>
        ${data.terms.map((term) => `<p>${escapeHtml(term)}</p>`).join('')}
        ${data.notes?.trim() ? `<p class="notes">${escapeHtml(data.notes.trim())}</p>` : ''}
      </div>
      <div class="totals">
        <div><span>Subtotal</span><strong>${formatMoney(data.subtotalCents)}</strong></div>
        ${data.taxPercentMilli > 0
          ? `<div><span>Sales Tax (${escapeHtml(data.taxLabel)})</span><strong>${formatMoney(data.taxCents)}</strong></div>`
          : `<div><span>Sales tax</span><strong>Not included</strong></div>`}
        <div class="total"><span>${data.taxPercentMilli > 0 ? 'Total investment' : 'Estimated total (pre-tax)'}</span><strong>${formatMoney(data.totalCents)}</strong></div>
      </div>
    </section>
  </section>
</main>`;
}

function renderLine(line: EstimatePdfLine): string {
  return `<tr>
    <td class="kind">${escapeHtml(line.kindLabel)}</td>
    <td class="desc">${escapeHtml(line.description)}</td>
    <td class="num">${escapeHtml(line.qtyLabel)}</td>
    <td class="num">${formatMoney(line.rateCents)}</td>
    <td class="num">${formatMoney(line.totalCents)}${line.taxable ? '<span class="taxable">T</span>' : ''}</td>
  </tr>`;
}

export function estimatePdfCss(): string {
  return `
    * { box-sizing: border-box; }
    body { margin: 0; background: #f8f4ef; color: #1C4972; font-family: Arial, Helvetica, sans-serif; }
    .estimate-page { min-height: 100vh; padding: 30px 24px; }
    .estimate-card { width: 8in; min-height: 10.5in; margin: 0 auto; background: #fff; box-shadow: 0 18px 54px rgba(28,73,114,0.12); }
    .top { display: grid; grid-template-columns: 1fr 178px; gap: 24px; align-items: start; padding: 28px 34px 16px; border-bottom: 2px solid #F28744; }
    .brand img { width: 288px; max-width: 100%; height: auto; display: block; }
    .company-details { margin-top: 8px; color: #1C4972; font-size: 10.5px; line-height: 1.28; }
    .company-details p { margin: 1px 0; }
    .estimate-meta { text-align: right; color: #1C4972; }
    .estimate-label { font-size: 22px; font-weight: 800; line-height: 1; }
    .estimate-number { margin-top: 5px; font-size: 12px; font-weight: 700; color: #F28744; }
    .meta-row { margin-top: 24px; display: grid; grid-template-columns: 1fr auto; gap: 14px; font-size: 10.5px; }
    .meta-row span, .po-meta span { color: #6d7480; }
    .bill-row { display: grid; grid-template-columns: 1fr 186px; gap: 22px; padding: 12px 34px 18px; }
    h2 { margin: 0 0 7px; font-size: 10.5px; text-transform: uppercase; letter-spacing: .08em; color: #F28744; }
    .bill-to p { margin: 2px 0; font-size: 10.5px; color: #1C4972; }
    .client-name { font-size: 11.5px !important; font-weight: 800; }
    .po-meta { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; align-content: start; }
    .po-meta div { min-height: 45px; border: 1px solid #eadfd3; background: #fff7ed; border-radius: 5px; padding: 7px 9px; }
    .po-meta span { display: block; font-size: 8.5px; text-transform: uppercase; letter-spacing: .08em; }
    .po-meta strong { display: block; margin-top: 7px; font-size: 10.5px; }
    .items { padding: 0 34px 10px; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 10.5px; }
    thead { display: table-header-group; }
    tbody tr { page-break-inside: avoid; break-inside: avoid; }
    .status-row { margin-top: 6px; }
    .project-heading { margin-top: 10px; }
    thead th { padding: 8px 6px 6px; border-bottom: 1px solid #1C4972; color: #1C4972; text-align: left; text-transform: uppercase; letter-spacing: .08em; font-size: 8px; }
    tbody td { padding: 7px 6px; border-bottom: 0; vertical-align: top; color: #1C4972; }
    th.kind, td.kind { width: 72px; color: #F28744; font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    th.num, td.num { width: 72px; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
    td.desc { line-height: 1.28; color: #1f2f3d; }
    .taxable { margin-left: 2px; color: #F28744; font-weight: 800; }
    .empty { padding: 28px 8px; text-align: center; color: #6d7480; }
    .bottom { display: grid; grid-template-columns: 1fr 222px; gap: 24px; padding: 12px 34px 30px; align-items: start; }
    .terms { padding-top: 8px; }
    .terms h3 { margin: 0 0 8px; text-transform: uppercase; letter-spacing: .08em; font-size: 8.5px; color: #1C4972; }
    .terms p { margin: 3px 0; font-size: 9.5px; line-height: 1.28; color: #6d7480; }
    .terms .notes { margin-top: 12px; color: #1C4972; }
    .totals { border: 1px solid #f1e2d2; background: #fff7ed; border-radius: 5px; padding: 10px 11px; align-self: start; }
    .totals div { display: flex; justify-content: space-between; gap: 18px; padding: 5px 0; font-size: 10px; color: #6d7480; }
    .totals strong { color: #1C4972; font-variant-numeric: tabular-nums; }
    .totals .total { margin-top: 7px; border-top: 1px solid #F28744; padding-top: 9px; font-size: 11.5px; font-weight: 800; text-transform: uppercase; color: #1C4972; }
    .totals .total strong { color: #F28744; font-size: 12.5px; }
    @media print {
      body { background: #fff; }
      .estimate-page { padding: 0; }
      .estimate-card { width: auto; min-height: auto; border: 0; box-shadow: none; }
    }
  `;
}

/**
 * The QBME block is built from these exact lines so the customer estimate
 * and QuickBooks output agree line by line (same order, description, qty,
 * unit rate).
 */
export function qbmeSourceLinesFromPdfData(data: Pick<EstimatePdfData, 'lines'>): QbmeSourceLine[] {
  return data.lines.map((line) => ({
    qbItem: line.qbItem,
    kind: line.kind ?? 'MATERIAL',
    sourceKind: line.sourceKind,
    description: line.description,
    qtyMilli: line.qtyMilli,
    rateCents: line.rateCents,
    totalCents: line.totalCents,
  }));
}

function addressLines(value: string | null | undefined): string[] {
  const parts = (value ?? '')
    .split(/\r?\n|,\s*(?=\S)/)
    .map((line) => line.trim())
    .filter(Boolean);
  // Keep "City, ST 12345" together instead of printing the state + ZIP on
  // their own line.
  const out: string[] = [];
  for (const part of parts) {
    if (out.length > 0 && /^[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?$/.test(part)) {
      out[out.length - 1] = `${out[out.length - 1]}, ${part}`;
    } else {
      out.push(part);
    }
  }
  return out;
}

function readBrandLogoDataUrl(): string {
  const buffer = fs.readFileSync(BRAND_LOGO_PATH);
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

function formatPdfDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US').format(date);
}

function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function shortKindLabel(kind: EstimateLineKind | undefined, fallback: string): string {
  if (!kind) return fallback;
  if (kind === 'INSTALL') return 'Installation';
  return kind.charAt(0) + kind.slice(1).toLowerCase();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
