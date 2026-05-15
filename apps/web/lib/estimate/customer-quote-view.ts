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
  readonly qtyMilli: number;
  readonly kind: EstimateLineKind;
  readonly computedCostCents: number;
}

export function buildCustomerQuoteLines(
  lines: ReadonlyArray<DbQuoteLineInput>,
  subtotalCostCents: number,
  finalPriceCents: number
): CustomerQuoteLine[] {
  const refs: LineCostRef[] = lines.map((l) => ({
    id: l.id,
    computedCostCents: l.computedCostCents,
  }));
  const alloc = allocateLineSellCents(refs, subtotalCostCents, finalPriceCents);
  return lines.map((l) => ({
    id: l.id,
    description: l.description,
    qtyLabel: formatQty(l.qtyMilli),
    kindLabel: kindLabel(l.kind),
    lineSellCents: alloc.get(l.id) ?? 0,
  }));
}

export function formatQuoteMoney(cents: number): string {
  return formatMoney(cents);
}
