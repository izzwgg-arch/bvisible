import { wrapBranded } from './render';

export interface EstimateQuoteEmailInput {
  companyName: string;
  estimateNumber: string;
  title: string;
  quoteUrl: string;
  contactName: string | null;
}

export function renderEstimateQuoteEmail(input: EstimateQuoteEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const greeting = input.contactName?.trim()
    ? `Hello ${input.contactName.trim()},`
    : 'Hello,';

  const { html, text } = wrapBranded({
    preheader: `Estimate ${input.estimateNumber} from ${input.companyName} is ready for review.`,
    heading: `Estimate ${input.estimateNumber}`,
    intro: `${greeting} please review the estimate from ${input.companyName}.`,
    details: [
      { label: 'Estimate', value: input.estimateNumber },
      ...(input.title.trim() ? [{ label: 'Project', value: input.title.trim() }] : []),
    ],
    button: { label: 'Open estimate quote', href: input.quoteUrl },
    note: 'A PDF copy of this estimate is attached for your records.',
    reason: `You received this email because ${input.companyName} sent an estimate to this address through B Visible.`,
  });

  return { subject: `${input.companyName} · Estimate ${input.estimateNumber}`, html, text };
}
