import { BRAND_LOGO_CID } from './render';
import { formatMoney, formatQty } from '@/lib/estimate/format';

export type PurchaseOrderEmailLine = {
  description: string;
  qtyMilli: number;
  unit: string;
  vendorSku: string | null;
  unitCostCents: number;
  totalCents: number;
  notes: string | null;
};

export function renderPurchaseOrderEmail(input: {
  companyName: string;
  vendorName: string;
  poNumber: string;
  qboPoNumber: string | null;
  estimateNumber: string | null;
  lines: PurchaseOrderEmailLine[];
  subtotalCents: number;
}): { subject: string; html: string; text: string } {
  const title = `Purchase Order ${input.poNumber}`;
  const qbo = input.qboPoNumber ? ` / QBO ${input.qboPoNumber}` : '';
  const estimate = input.estimateNumber ? ` from estimate ${input.estimateNumber}` : '';
  const rows = input.lines
    .map(
      (line) => `
<tr>
  <td style="padding:10px;border-bottom:1px solid #eadfd3;">${escapeHtml(line.description)}${line.notes ? `<br><span style="font-size:12px;color:#6d7480;">${escapeHtml(line.notes)}</span>` : ''}</td>
  <td style="padding:10px;border-bottom:1px solid #eadfd3;">${escapeHtml(line.vendorSku ?? '')}</td>
  <td style="padding:10px;border-bottom:1px solid #eadfd3;text-align:right;">${escapeHtml(formatQty(line.qtyMilli))}</td>
  <td style="padding:10px;border-bottom:1px solid #eadfd3;">${escapeHtml(line.unit)}</td>
  <td style="padding:10px;border-bottom:1px solid #eadfd3;text-align:right;">${escapeHtml(formatMoney(line.unitCostCents))}</td>
  <td style="padding:10px;border-bottom:1px solid #eadfd3;text-align:right;font-weight:650;">${escapeHtml(formatMoney(line.totalCents))}</td>
</tr>`,
    )
    .join('');

  const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f8f4ef;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f8f4ef;padding:32px 12px;">
<tr><td align="center">
<table role="presentation" width="680" cellspacing="0" cellpadding="0" border="0" style="max-width:680px;background:#fffdfa;border:1px solid #eadfd3;border-radius:16px;overflow:hidden;">
<tr><td style="padding:24px 28px 8px 28px;">
<img src="cid:${BRAND_LOGO_CID}" width="190" alt="B Visible Signs and Printing" style="display:block;width:190px;max-width:190px;height:auto;border:0;outline:none;text-decoration:none;">
</td></tr>
<tr><td style="padding:8px 28px 28px 28px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.5;color:#1C4972;">
<p style="margin:16px 0 12px 0;">Hello ${escapeHtml(input.vendorName)},</p>
<p style="margin:0 0 18px 0;">Please fulfill <strong>${escapeHtml(title)}</strong>${escapeHtml(qbo)}${escapeHtml(estimate)}. This email includes only the items assigned to your vendor section.</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="border:1px solid #eadfd3;border-radius:12px;border-collapse:separate;border-spacing:0;overflow:hidden;font-size:13px;">
<thead><tr style="background:#f8f4ef;color:#6d7480;text-transform:uppercase;font-size:11px;letter-spacing:.08em;">
<th align="left" style="padding:10px;">Item</th><th align="left" style="padding:10px;">SKU</th><th align="right" style="padding:10px;">Qty</th><th align="left" style="padding:10px;">Unit</th><th align="right" style="padding:10px;">Unit cost</th><th align="right" style="padding:10px;">Total</th>
</tr></thead>
<tbody>${rows}</tbody>
</table>
<p style="margin:18px 0 0 0;text-align:right;font-size:16px;font-weight:750;">Subtotal: ${escapeHtml(formatMoney(input.subtotalCents))}</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;

  const lineText = input.lines
    .map((line) => `- ${line.description}${line.vendorSku ? ` (${line.vendorSku})` : ''}: ${formatQty(line.qtyMilli)} ${line.unit} @ ${formatMoney(line.unitCostCents)} = ${formatMoney(line.totalCents)}`)
    .join('\n');
  const text = `Hello ${input.vendorName},\n\nPlease fulfill ${title}${qbo}${estimate}. This email includes only the items assigned to your vendor section.\n\n${lineText}\n\nSubtotal: ${formatMoney(input.subtotalCents)}\n`;

  return {
    subject: `${input.companyName} · PO ${input.poNumber}`,
    html,
    text,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
