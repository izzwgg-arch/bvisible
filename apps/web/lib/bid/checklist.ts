// Completion checklist for Step 7 (pure). "Blocking" items stop the
// bid-workflow send / mark-ready path; the estimate can always be saved as
// a draft. Nothing here mutates.

import type { BidLineReviewStatus, BidQuestionStatus, EstimateStatus } from '@bvisible/db';

export interface ChecklistLineInput {
  reviewStatus: BidLineReviewStatus;
  priced: boolean;
  customerDescription: string | null;
  qbItem: string | null;
  isService: boolean;
  hidden: boolean;
}

export interface ChecklistInput {
  estimateStatus: EstimateStatus;
  customer: { companyName: string | null; email: string | null; address: string | null };
  project: { name: string | null; address: string | null };
  sourceFileCount: number;
  takeoffProcessed: boolean;
  lines: ChecklistLineInput[];
  questions: Array<{ status: BidQuestionStatus; affectsPrice: boolean }>;
  designIncluded: boolean | null;
  installIncluded: boolean | null;
  qbmeReconciled: boolean;
  termsPresent: boolean;
  taxConfigured: boolean;
  /// Estimate carries a per-estimate exemption. Changes only the wording of
  /// the tax row — an exempt estimate is correctly configured, not missing a
  /// setting. Optional so existing callers keep working.
  taxExempt?: boolean;
}

export type ChecklistState = 'ok' | 'blocking' | 'warning' | 'pending';

export interface ChecklistItem {
  key: string;
  label: string;
  state: ChecklistState;
  detail: string;
}

export interface BidChecklist {
  items: ChecklistItem[];
  blocking: ChecklistItem[];
  warnings: ChecklistItem[];
  ready: boolean;
  /** True when every pricing-critical item is clear (send / finalize allowed). */
  canSend: boolean;
}

export function buildBidChecklist(input: ChecklistInput): BidChecklist {
  const items: ChecklistItem[] = [];
  const visible = input.lines.filter((l) => !l.hidden && l.reviewStatus !== 'EXCLUDED');
  const signLines = visible.filter((l) => !l.isService);

  const customerOk = !!input.customer.companyName;
  items.push({
    key: 'customer',
    label: 'Customer information complete',
    state: !customerOk ? 'blocking' : !input.customer.email ? 'warning' : 'ok',
    detail: !customerOk ? 'Select a customer.' : !input.customer.email ? 'No customer email on file — needed to send.' : input.customer.companyName!,
  });
  items.push({
    key: 'project',
    label: 'Project information complete',
    state: input.project.name ? (input.project.address ? 'ok' : 'warning') : 'warning',
    detail: input.project.name ? (input.project.address ? `${input.project.name} — ${input.project.address}` : 'Project address is empty.') : 'Project name is empty.',
  });
  items.push({
    key: 'sources',
    label: 'Source files uploaded',
    state: input.sourceFileCount > 0 ? 'ok' : signLines.length > 0 ? 'warning' : 'blocking',
    detail: input.sourceFileCount > 0 ? `${input.sourceFileCount} file${input.sourceFileCount === 1 ? '' : 's'}` : 'No takeoff or plans attached.',
  });
  items.push({
    key: 'takeoff',
    label: 'Takeoff quantities reviewed',
    state: input.takeoffProcessed || signLines.length > 0 ? 'ok' : 'blocking',
    detail: signLines.length > 0 ? `${signLines.length} sign line${signLines.length === 1 ? '' : 's'}` : 'No sign lines yet — import a takeoff or add lines.',
  });
  const unpriced = signLines.filter((l) => !l.priced);
  items.push({
    key: 'priced',
    label: 'Production lines priced',
    state: signLines.length === 0 ? 'pending' : unpriced.length === 0 ? 'ok' : 'blocking',
    detail: unpriced.length === 0 ? 'Every line has a rate.' : `${unpriced.length} line${unpriced.length === 1 ? '' : 's'} without a rate.`,
  });
  const review = signLines.filter((l) => l.reviewStatus === 'NEEDS_REVIEW');
  items.push({
    key: 'review',
    label: 'Uncertain matches reviewed',
    state: review.length === 0 ? 'ok' : 'warning',
    detail: review.length === 0 ? 'No lines waiting for a check.' : `${review.length} line${review.length === 1 ? '' : 's'} still marked "check".`,
  });
  const openQ = input.questions.filter((q) => q.status === 'OPEN');
  const openPriceQ = openQ.filter((q) => q.affectsPrice);
  items.push({
    key: 'questions',
    label: 'Office questions resolved',
    state: openQ.length === 0 ? 'ok' : openPriceQ.length > 0 ? 'blocking' : 'warning',
    detail: openQ.length === 0 ? 'All answered.' : `${openQ.length} open${openPriceQ.length > 0 ? ` (${openPriceQ.length} affect pricing)` : ''}.`,
  });
  items.push({
    key: 'design',
    label: 'Design included or intentionally excluded',
    state: input.designIncluded === null ? 'blocking' : 'ok',
    detail: input.designIncluded === null ? 'Decide on Step 5.' : input.designIncluded ? 'Included' : 'Intentionally excluded',
  });
  items.push({
    key: 'installation',
    label: 'Installation included or intentionally excluded',
    state: input.installIncluded === null ? 'blocking' : 'ok',
    detail: input.installIncluded === null ? 'Decide on Step 6.' : input.installIncluded ? 'Included' : 'Intentionally excluded',
  });
  const noDesc = visible.filter((l) => !l.customerDescription?.trim());
  items.push({
    key: 'descriptions',
    label: 'Customer descriptions complete',
    state: noDesc.length === 0 ? 'ok' : 'blocking',
    detail: noDesc.length === 0 ? 'Every line has a customer-facing description.' : `${noDesc.length} line${noDesc.length === 1 ? '' : 's'} missing a description.`,
  });
  const noItem = visible.filter((l) => !l.qbItem);
  items.push({
    key: 'qbitems',
    label: 'QuickBooks Item mappings valid',
    state: noItem.length === 0 ? 'ok' : 'blocking',
    detail: noItem.length === 0 ? 'Every line maps to an allowed Item.' : `${noItem.length} line${noItem.length === 1 ? '' : 's'} without an Item.`,
  });
  const estimateReady = visible.length > 0 && unpriced.length === 0 && noDesc.length === 0;
  items.push({ key: 'estimate', label: 'Customer estimate ready', state: estimateReady ? 'ok' : 'pending', detail: estimateReady ? `${visible.length} lines` : 'Waiting on the items above.' });
  items.push({ key: 'qbme', label: 'QBME ready', state: estimateReady ? 'ok' : 'pending', detail: estimateReady ? `${visible.length} lines, one per estimate line` : 'Waiting on the items above.' });
  items.push({ key: 'reconciled', label: 'QBME subtotal reconciled', state: !estimateReady ? 'pending' : input.qbmeReconciled ? 'ok' : 'warning', detail: input.qbmeReconciled ? 'Σ QTY × RATE equals the pre-tax subtotal.' : 'Rounding difference — see the QBME panel.' });
  items.push({ key: 'terms', label: 'Required terms present', state: input.termsPresent ? 'ok' : 'blocking', detail: input.termsPresent ? 'Company terms attached.' : 'No terms configured.' });
  items.push({
    key: 'tax',
    label: input.taxExempt ? 'Sales tax exempt' : 'Sales tax configured',
    state: input.taxConfigured ? 'ok' : 'warning',
    detail: input.taxExempt
      ? 'Exempt on this estimate — no tax charged.'
      : input.taxConfigured
        ? 'From company setting.'
        : 'Not configured — estimate shows pre-tax totals.',
  });

  const blocking = items.filter((i) => i.state === 'blocking');
  const warnings = items.filter((i) => i.state === 'warning');
  return { items, blocking, warnings, ready: blocking.length === 0 && warnings.length === 0, canSend: blocking.length === 0 };
}
