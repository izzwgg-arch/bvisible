import { randomBytes } from 'node:crypto';

// Open-tracking for outbound estimate / purchase-order emails.
// Each send embeds a 1x1 pixel whose URL carries a random token; the
// token is stored on the send's audit row (metadata.openToken). When the
// pixel is fetched we log a matching *_email_opened audit row once.

export const EMAIL_OPEN_SEND_ACTIONS = ['estimate_sent_to_client', 'po_sent'] as const;

export function generateEmailOpenToken(): string {
  return randomBytes(16).toString('hex');
}

export function emailOpenPixelHtml(pixelUrl: string): string {
  // Width/height attributes + inline style keep strict clients from
  // reserving layout space; alt stays empty so screen readers skip it.
  return `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;overflow:hidden" />`;
}

/** Append the tracking pixel just before </body> when present, else at the end. */
export function appendEmailOpenPixel(html: string, pixelUrl: string): string {
  const pixel = emailOpenPixelHtml(pixelUrl);
  const idx = html.toLowerCase().lastIndexOf('</body>');
  if (idx === -1) return html + pixel;
  return html.slice(0, idx) + pixel + html.slice(idx);
}

export function openedActionForSendAction(
  sendAction: string
): 'estimate_email_opened' | 'po_email_opened' | null {
  if (sendAction === 'estimate_sent_to_client') return 'estimate_email_opened';
  if (sendAction === 'po_sent') return 'po_email_opened';
  return null;
}
