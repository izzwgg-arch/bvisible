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

  const safeTitle = escapeHtml(input.title);
  const safeUrl = escapeHtml(input.quoteUrl);

  const html = `<!DOCTYPE html>
<html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#0f1729;">
<p>${escapeHtml(greeting)}</p>
<p>Please review estimate <strong>${escapeHtml(input.estimateNumber)}</strong>${safeTitle ? ` — ${safeTitle}` : ''}.</p>
<p><a href="${safeUrl}" style="color:#2f5af3;">Open estimate quote</a></p>
<p style="font-size:13px;color:#5b6478;">You can open this link without signing in. Use your browser&apos;s print dialog if you need a PDF.</p>
</body></html>`;

  const text = `${greeting}\n\nPlease review estimate ${input.estimateNumber}${input.title ? ` — ${input.title}` : ''}.\n\n${input.quoteUrl}\n`;

  return { subject: `${input.companyName} · Estimate ${input.estimateNumber}`, html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
