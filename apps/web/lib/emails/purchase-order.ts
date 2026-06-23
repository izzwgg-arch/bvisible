import { wrapBranded } from './render';
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

  const { html, text } = wrapBranded({
    preheader: `${title} from ${input.companyName} is ready for fulfillment.`,
    heading: title,
    intro:
      `Hello ${input.vendorName}, please fulfill ${title}${qbo}${estimate}. ` +
      'This email includes only the items assigned to your vendor section.',
    details: [
      { label: 'Vendor', value: input.vendorName },
      { label: 'Purchase order', value: input.poNumber },
      ...(input.qboPoNumber ? [{ label: 'QBO PO', value: input.qboPoNumber }] : []),
      ...(input.estimateNumber ? [{ label: 'Estimate', value: input.estimateNumber }] : []),
    ],
    table: {
      title: 'Items to fulfill',
      columns: [
        { label: 'Item' },
        { label: 'SKU' },
        { label: 'Qty', align: 'right' },
        { label: 'Unit' },
        { label: 'Unit cost', align: 'right' },
        { label: 'Total', align: 'right' },
      ],
      rows: input.lines.map((line) => [
        line.notes ? `${line.description} Notes: ${line.notes}` : line.description,
        line.vendorSku ?? '',
        formatQty(line.qtyMilli),
        line.unit,
        formatMoney(line.unitCostCents),
        formatMoney(line.totalCents),
      ]),
      summary: { label: 'Subtotal', value: formatMoney(input.subtotalCents) },
    },
    reason: `You received this email because ${input.companyName} sent a purchase order to this vendor address through B Visible.`,
  });

  return {
    subject: `${input.companyName} · PO ${input.poNumber}`,
    html,
    text,
  };
}
