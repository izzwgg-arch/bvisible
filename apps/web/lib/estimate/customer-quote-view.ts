import type { EstimateLineKind } from '@bvisible/db';
import { formatMoney, formatQty } from '@bvisible/pricing';
import { kindLabel } from '@/lib/estimate/format';
import {
  allocateLineSellCents,
  type CustomerQuoteLine,
  type LineCostRef,
} from '@/lib/estimate/customer-quote';

export interface DbQuoteLineInput {
  readonly id: string;
  readonly description: string;
  readonly customerDescription?: string | null;
  readonly hiddenFromCustomer?: boolean;
  readonly qtyMilli: number;
  readonly kind: EstimateLineKind;
  readonly computedCostCents: number;
  /** Bundle grouping — members collapse into a single customer row. */
  readonly lineGroupId?: string | null;
  readonly lineGroupLabel?: string | null;
}

export function buildCustomerQuoteLines(
  lines: ReadonlyArray<DbQuoteLineInput>,
  subtotalCostCents: number,
  finalPriceCents: number
): CustomerQuoteLine[] {
  const visibleLines = lines.filter((l) => !l.hiddenFromCustomer);
  const refs: LineCostRef[] = visibleLines.map((l) => ({
    id: l.id,
    computedCostCents: l.computedCostCents,
  }));
  const alloc = allocateLineSellCents(refs, subtotalCostCents, finalPriceCents);

  // A bundle prints as a single line. Its components are internal
  // detail, so their allocated sells roll up into the bundle's price
  // and the customer sees the bundle name instead of the parts.
  const rows: CustomerQuoteLine[] = [];
  const rowIndexByGroup = new Map<string, number>();

  for (const l of visibleLines) {
    const lineSellCents = alloc.get(l.id) ?? 0;
    const groupId = l.lineGroupId ?? null;

    if (!groupId) {
      rows.push({
        id: l.id,
        description: l.customerDescription?.trim() ? l.customerDescription : l.description,
        qtyLabel: formatQty(l.qtyMilli),
        kindLabel: kindLabel(l.kind),
        lineSellCents,
      });
      continue;
    }

    const at = rowIndexByGroup.get(groupId);
    if (at === undefined) {
      rowIndexByGroup.set(groupId, rows.length);
      rows.push({
        id: `group-${groupId}`,
        description:
          l.lineGroupLabel?.trim() ||
          (l.customerDescription?.trim() ? l.customerDescription : l.description),
        qtyLabel: formatQty(1000),
        kindLabel: 'Bundle',
        lineSellCents,
      });
      continue;
    }

    const existing = rows[at];
    if (existing) {
      rows[at] = { ...existing, lineSellCents: existing.lineSellCents + lineSellCents };
    }
  }

  return rows;
}

export function formatQuoteMoney(cents: number): string {
  return formatMoney(cents);
}
