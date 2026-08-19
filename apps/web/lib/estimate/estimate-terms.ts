// Customer-facing terms & conditions for estimates. Single source used by
// the estimate PDF, the staff preview, the public quote, and the Bid
// Estimator's customer-ready estimate — never duplicated per surface.
//
// The first three lines are B Visible's existing printed terms. The rest
// cover the assumptions a bid estimate depends on (customer-supplied
// information, installation assumptions, change orders). Estimate-specific
// installation assumptions / exclusions are appended by the caller.

export const DEFAULT_ESTIMATE_TERMS: ReadonlyArray<string> = [
  'All products include a one (1) year limited warranty.',
  'Electrical connections must be completed by a licensed electrician.',
  'Estimate valid for 30 days from date of issue.',
  'Pricing is based on the quantities, drawings, and specifications supplied by the customer; changes to scope, quantities, sizes, or materials are handled by written change order.',
  'Installation, when included, assumes normal site access and ready mounting surfaces unless stated otherwise in the line description.',
];

export interface EstimateTermsOptions {
  /** Extra project-specific assumption lines (e.g. from the installation step). */
  additional?: ReadonlyArray<string | null | undefined>;
}

export function buildEstimateTerms(options: EstimateTermsOptions = {}): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of [...DEFAULT_ESTIMATE_TERMS, ...(options.additional ?? [])]) {
    const text = (line ?? '').trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}
