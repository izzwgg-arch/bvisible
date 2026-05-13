// Tiny shared email layout. Plain HTML, inline styles, no MJML.
//
// Two design constraints:
//   1. Look acceptable in any modern client (Gmail, Outlook 365,
//      Apple Mail, mobile webmail). That means a single centered
//      container, no <style> blocks (Gmail strips them), inline styles
//      only, and a plaintext fallback for the small fraction of clients
//      that block HTML entirely.
//   2. Survive a few years of brand evolution without us reaching for
//      MJML. The brand is one accent color and one wordmark — that's it.

const ACCENT = '#0F172A'; // slate-900 — matches the in-app brand mark
const ACCENT_TEXT = '#FFFFFF';
const BG = '#F8FAFC';
const SURFACE = '#FFFFFF';
const TEXT = '#0F172A';
const MUTED = '#64748B';
const BORDER = '#E2E8F0';

export interface BrandedEmail {
  /** First line of body (a short sentence under the heading). */
  intro: string;
  /** Bold heading rendered above the intro. */
  heading: string;
  /** Optional CTA. Renders a button + plaintext URL. */
  button?: { label: string; href: string };
  /** Optional second body paragraph rendered below the button. */
  outro?: string;
  /** Footer line. Defaults to the standard B Visible footer. */
  footer?: string;
}

const DEFAULT_FOOTER =
  'You received this email because someone signed up or requested action on a B Visible account. ' +
  'If this was not you, you can safely ignore this message.';

export function wrapBranded(input: BrandedEmail): { html: string; text: string } {
  const footer = input.footer ?? DEFAULT_FOOTER;
  const html = renderHtml(input, footer);
  const text = renderText(input, footer);
  return { html, text };
}

function renderHtml(input: BrandedEmail, footer: string): string {
  const button = input.button
    ? `
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0;">
        <tr>
          <td align="center" bgcolor="${ACCENT}" style="border-radius:8px;">
            <a href="${escapeAttr(input.button.href)}"
               style="display:inline-block;padding:12px 22px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:${ACCENT_TEXT};text-decoration:none;border-radius:8px;">
              ${escapeText(input.button.label)}
            </a>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 16px 0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13px;line-height:1.5;color:${MUTED};">
        Or copy this link into your browser:<br>
        <a href="${escapeAttr(input.button.href)}" style="color:${TEXT};word-break:break-all;">${escapeText(input.button.href)}</a>
      </p>`
    : '';

  const outro = input.outro
    ? `<p style="margin:0 0 16px 0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:${TEXT};">${escapeText(input.outro)}</p>`
    : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeText(input.heading)}</title>
  </head>
  <body style="margin:0;padding:0;background:${BG};">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${BG};padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="560" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:${SURFACE};border:1px solid ${BORDER};border-radius:12px;overflow:hidden;">
            <tr>
              <td style="padding:24px 28px 8px 28px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td style="background:${ACCENT};color:${ACCENT_TEXT};font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:700;line-height:1;padding:6px 9px;border-radius:6px;letter-spacing:0.02em;">
                      BV
                    </td>
                    <td style="padding-left:10px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:${TEXT};">
                      B Visible
                      <span style="color:${MUTED};font-weight:400;">· Operations</span>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 28px 24px 28px;">
                <h1 style="margin:16px 0 8px 0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:20px;line-height:1.3;color:${TEXT};font-weight:600;">
                  ${escapeText(input.heading)}
                </h1>
                <p style="margin:0 0 16px 0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.6;color:${TEXT};">
                  ${escapeText(input.intro)}
                </p>
                ${button}
                ${outro}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px 24px 28px;border-top:1px solid ${BORDER};">
                <p style="margin:0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:${MUTED};">
                  ${escapeText(footer)}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function renderText(input: BrandedEmail, footer: string): string {
  const lines: string[] = [];
  lines.push('B Visible · Operations');
  lines.push('');
  lines.push(input.heading);
  lines.push('');
  lines.push(input.intro);
  if (input.button) {
    lines.push('');
    lines.push(`${input.button.label}: ${input.button.href}`);
  }
  if (input.outro) {
    lines.push('');
    lines.push(input.outro);
  }
  lines.push('');
  lines.push('— — —');
  lines.push(footer);
  return lines.join('\n');
}

function escapeText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(s: string): string {
  return escapeText(s);
}
