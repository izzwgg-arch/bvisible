import { BRAND_LOGO_CID } from './render';

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
<html><body style="margin:0;padding:0;background:#f8f4ef;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f8f4ef;padding:32px 12px;">
<tr><td align="center">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:#fffdfa;border:1px solid #eadfd3;border-radius:16px;overflow:hidden;">
<tr><td style="padding:24px 28px 8px 28px;">
<img src="cid:${BRAND_LOGO_CID}" width="190" alt="B Visible Signs and Printing" style="display:block;width:190px;max-width:190px;height:auto;border:0;outline:none;text-decoration:none;">
</td></tr>
<tr><td style="padding:8px 28px 28px 28px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.5;color:#1C4972;">
<p style="margin:16px 0 12px 0;">${escapeHtml(greeting)}</p>
<p style="margin:0 0 18px 0;">Please review estimate <strong>${escapeHtml(input.estimateNumber)}</strong>${safeTitle ? ` — ${safeTitle}` : ''}.</p>
<p style="margin:0 0 18px 0;"><a href="${safeUrl}" style="display:inline-block;border-radius:10px;background:#F28744;color:#ffffff;font-size:14px;font-weight:650;padding:12px 20px;text-decoration:none;">Open estimate quote</a></p>
<p style="margin:0;font-size:13px;color:#6d7480;">A PDF copy of this estimate is attached for your records.</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;

  const text = `${greeting}\n\nPlease review estimate ${input.estimateNumber}${input.title ? ` — ${input.title}` : ''}.\n\n${input.quoteUrl}\n\nA PDF copy of this estimate is attached for your records.\n`;

  return { subject: `${input.companyName} · Estimate ${input.estimateNumber}`, html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
