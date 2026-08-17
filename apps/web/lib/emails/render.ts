// Shared transactional email layout. Plain HTML, table-based, no MJML.
//
// This deliberately uses old, boring email markup: inline styles first,
// fixed-width presentation tables with fluid fallbacks, and plaintext output
// from the same data. That keeps Gmail desktop, mobile clients, and Outlook
// readable without trying to detect the recipient's mail app.

export const BRAND_LOGO_CID = 'bvisible-brand-logo';

const ACCENT = '#F28744';
const ACCENT_TEXT = '#FFFFFF';
const BG = '#F8F4EF';
const SURFACE = '#FFFDFA';
const TEXT = '#1C4972';
const MUTED = '#6D7480';
const BORDER = '#EADFD3';
const FONT_STACK = '-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif';

export interface BrandedEmail {
  /** Hidden preview line shown in many inboxes after the subject. */
  preheader?: string;
  /** First line of body (a short sentence under the heading). */
  intro: string;
  /** Bold heading rendered above the intro. */
  heading: string;
  /** Optional CTA. Renders a button + plaintext URL. */
  button?: { label: string; href: string };
  /** Optional body paragraphs rendered below the intro/CTA. */
  paragraphs?: string[];
  /** Optional second body paragraph rendered below the button. */
  outro?: string;
  /** Optional key/value summary card. */
  details?: ReadonlyArray<{ label: string; value: string }>;
  /** Optional tabular data for purchase orders and other transactional lists. */
  table?: BrandedEmailTable;
  /** Optional emphasized note near the end of the message. */
  note?: string;
  /** Footer line. Defaults to the standard B Visible footer. */
  footer?: string;
  /** Transactional reason shown before the standard safety note. */
  reason?: string;
}

/// A table cell is either plain text, or text carrying a link.
///
/// The link form exists because a bare URL escaped into a `<td>` is NOT
/// clickable in most mail clients — Gmail sometimes auto-linkifies, Outlook
/// does not. Product links shipped that way reach the office as dead text.
export type BrandedEmailCell = string | { text: string; href: string };

export interface BrandedEmailTable {
  title?: string;
  columns: ReadonlyArray<{ label: string; align?: 'left' | 'right' }>;
  rows: ReadonlyArray<ReadonlyArray<BrandedEmailCell>>;
  summary?: { label: string; value: string };
}

const DEFAULT_FOOTER =
  'B Visible sends transactional email for account access, estimates, purchase orders, and operational updates. ' +
  'If this message was unexpected, do not forward it; contact the sender or your B Visible administrator.';

export function wrapBranded(input: BrandedEmail): { html: string; text: string } {
  const footer = [input.reason, input.footer ?? DEFAULT_FOOTER].filter(Boolean).join(' ');
  const html = renderHtml(input, footer);
  const text = renderText(input, footer);
  return { html, text };
}

function renderHtml(input: BrandedEmail, footer: string): string {
  const preheader = escapeText(input.preheader ?? input.intro);
  const button = input.button
    ? `
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:26px 0 18px 0;">
        <tr>
          <td align="center" bgcolor="${ACCENT}" style="border-radius:10px;mso-padding-alt:13px 22px;">
            <a href="${escapeAttr(input.button.href)}"
               style="display:inline-block;padding:13px 22px;font-family:${FONT_STACK};font-size:15px;font-weight:700;line-height:1.2;color:${ACCENT_TEXT};text-decoration:none;border-radius:10px;">
              ${escapeText(input.button.label)}
            </a>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 18px 0;font-family:${FONT_STACK};font-size:13px;line-height:1.55;color:${MUTED};">
        Or copy this link into your browser:<br>
        <a href="${escapeAttr(input.button.href)}" style="color:${TEXT};word-break:break-all;">${escapeText(input.button.href)}</a>
      </p>`
    : '';

  const paragraphs = [
    ...(input.paragraphs ?? []),
    ...(input.outro ? [input.outro] : []),
  ]
    .map(
      (paragraph) =>
        `<p style="margin:0 0 16px 0;font-family:${FONT_STACK};font-size:15px;line-height:1.65;color:${TEXT};">${escapeText(paragraph)}</p>`,
    )
    .join('');

  const details = input.details?.length
    ? renderDetails(input.details)
    : '';
  const table = input.table ? renderTable(input.table) : '';
  const note = input.note
    ? `<p style="margin:18px 0 0 0;padding:14px 16px;border-left:4px solid ${ACCENT};background:${BG};font-family:${FONT_STACK};font-size:14px;line-height:1.55;color:${TEXT};">${escapeText(input.note)}</p>`
    : '';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta http-equiv="x-ua-compatible" content="ie=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeText(input.heading)}</title>
    <style>
      @media screen and (max-width: 620px) {
        .bv-shell { padding: 18px 10px !important; }
        .bv-card { width: 100% !important; max-width: 100% !important; border-radius: 12px !important; }
        .bv-pad { padding-left: 18px !important; padding-right: 18px !important; }
        .bv-logo { width: 156px !important; max-width: 78% !important; }
        .bv-heading { font-size: 22px !important; }
        .bv-body { font-size: 15px !important; }
        .bv-table-scroll { overflow-x: auto !important; }
      }
    </style>
  </head>
  <body style="margin:0;padding:0;background:${BG};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
    <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${BG};opacity:0;">
      ${preheader}
    </div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" class="bv-shell" style="width:100%;background:${BG};padding:34px 12px;">
      <tr>
        <td align="center">
          <!--[if mso]><table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" class="bv-card" style="width:100%;max-width:600px;background:${SURFACE};border:1px solid ${BORDER};border-radius:18px;overflow:hidden;border-collapse:separate;">
            <tr>
              <td class="bv-pad" style="padding:26px 32px 10px 32px;">
                <table role="presentation" cellspacing="0" cellpadding="0" border="0">
                  <tr>
                    <td style="padding:0;">
                      <img src="cid:${BRAND_LOGO_CID}"
                           width="180"
                           alt="B Visible Signs and Printing"
                           class="bv-logo"
                           style="display:block;width:180px;max-width:180px;height:auto;border:0;outline:none;text-decoration:none;">
                      <div style="display:none;overflow:hidden;mso-hide:all;font-family:${FONT_STACK};font-size:14px;font-weight:700;color:${TEXT};">
                        B Visible <span style="color:${MUTED};font-weight:400;">· Signs · Printing</span>
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td class="bv-pad" style="padding:8px 32px 30px 32px;">
                <h1 class="bv-heading" style="margin:16px 0 10px 0;font-family:${FONT_STACK};font-size:24px;line-height:1.25;color:${TEXT};font-weight:750;">
                  ${escapeText(input.heading)}
                </h1>
                <p class="bv-body" style="margin:0 0 16px 0;font-family:${FONT_STACK};font-size:15px;line-height:1.65;color:${TEXT};">
                  ${escapeText(input.intro)}
                </p>
                ${details}
                ${button}
                ${paragraphs}
                ${table}
                ${note}
              </td>
            </tr>
            <tr>
              <td class="bv-pad" style="padding:18px 32px 24px 32px;border-top:1px solid ${BORDER};">
                <p style="margin:0 0 8px 0;font-family:${FONT_STACK};font-size:13px;line-height:1.5;color:${TEXT};font-weight:700;">
                  B Visible
                </p>
                <p style="margin:0;font-family:${FONT_STACK};font-size:12px;line-height:1.55;color:${MUTED};">
                  ${escapeText(footer)}
                </p>
              </td>
            </tr>
          </table>
          <!--[if mso]></td></tr></table><![endif]-->
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function renderText(input: BrandedEmail, footer: string): string {
  const lines: string[] = [];
  lines.push('B Visible · Signs & Printing');
  lines.push('');
  lines.push(input.heading);
  lines.push('');
  lines.push(input.intro);
  if (input.details?.length) {
    lines.push('');
    for (const detail of input.details) {
      lines.push(`${detail.label}: ${detail.value}`);
    }
  }
  if (input.button) {
    lines.push('');
    lines.push(`${input.button.label}: ${input.button.href}`);
  }
  for (const paragraph of input.paragraphs ?? []) {
    lines.push('');
    lines.push(paragraph);
  }
  if (input.outro) {
    lines.push('');
    lines.push(input.outro);
  }
  if (input.table) {
    lines.push('');
    if (input.table.title) lines.push(input.table.title);
    for (const row of input.table.rows) {
      lines.push(`- ${row.map(cellText).join(' | ')}`);
    }
    if (input.table.summary) {
      lines.push(`${input.table.summary.label}: ${input.table.summary.value}`);
    }
  }
  if (input.note) {
    lines.push('');
    lines.push(input.note);
  }
  lines.push('');
  lines.push('---');
  lines.push(footer);
  return lines.join('\n');
}

function renderDetails(details: ReadonlyArray<{ label: string; value: string }>): string {
  const rows = details
    .map(
      (detail) => `
          <tr>
            <td style="padding:9px 12px;border-bottom:1px solid ${BORDER};font-family:${FONT_STACK};font-size:12px;line-height:1.4;color:${MUTED};text-transform:uppercase;letter-spacing:.06em;">
              ${escapeText(detail.label)}
            </td>
            <td align="right" style="padding:9px 12px;border-bottom:1px solid ${BORDER};font-family:${FONT_STACK};font-size:14px;line-height:1.4;color:${TEXT};font-weight:700;">
              ${escapeText(detail.value)}
            </td>
          </tr>`,
    )
    .join('');

  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:20px 0 22px 0;border:1px solid ${BORDER};border-radius:12px;border-collapse:separate;overflow:hidden;background:#ffffff;">
      ${rows}
    </table>`;
}

function renderTable(table: BrandedEmailTable): string {
  const headers = table.columns
    .map(
      (column) =>
        `<th align="${column.align ?? 'left'}" style="padding:10px 12px;font-family:${FONT_STACK};font-size:11px;line-height:1.35;color:${MUTED};text-transform:uppercase;letter-spacing:.07em;border-bottom:1px solid ${BORDER};">${escapeText(column.label)}</th>`,
    )
    .join('');
  const rows = table.rows
    .map(
      (row) => `
        <tr>
          ${row
            .map((cell, index) => {
              const align = table.columns[index]?.align ?? 'left';
              return `<td align="${align}" style="padding:11px 12px;border-bottom:1px solid ${BORDER};font-family:${FONT_STACK};font-size:13px;line-height:1.45;color:${TEXT};vertical-align:top;">${renderCell(cell)}</td>`;
            })
            .join('')}
        </tr>`,
    )
    .join('');
  const summary = table.summary
    ? `
        <tr>
          <td colspan="${table.columns.length}" align="right" style="padding:13px 12px;font-family:${FONT_STACK};font-size:15px;line-height:1.4;color:${TEXT};font-weight:800;background:${BG};">
            ${escapeText(table.summary.label)}: ${escapeText(table.summary.value)}
          </td>
        </tr>`
    : '';

  return `
    ${table.title ? `<h2 style="margin:22px 0 10px 0;font-family:${FONT_STACK};font-size:16px;line-height:1.35;color:${TEXT};font-weight:750;">${escapeText(table.title)}</h2>` : ''}
    <div class="bv-table-scroll" style="width:100%;max-width:100%;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;min-width:520px;border:1px solid ${BORDER};border-radius:12px;border-collapse:separate;overflow:hidden;background:#ffffff;">
        <thead>
          <tr style="background:${BG};">
            ${headers}
          </tr>
        </thead>
        <tbody>
          ${rows}
          ${summary}
        </tbody>
      </table>
    </div>`;
}

/// One table cell as HTML. A link cell becomes a real anchor; anything whose
/// href is not http(s) degrades to plain text rather than emitting the
/// attacker-controlled scheme (`javascript:`, `data:`) into the message.
function renderCell(cell: BrandedEmailCell): string {
  if (typeof cell === 'string') return escapeText(cell);
  const href = safeHref(cell.href);
  if (!href) return escapeText(cell.text);
  return `<a href="${escapeAttr(href)}" style="color:${TEXT};font-weight:700;text-decoration:underline;word-break:break-all;">${escapeText(cell.text)}</a>`;
}

/// Plaintext form of a cell. Link cells emit the URL itself — the text-only
/// part of the message is where a reader copies the address from.
function cellText(cell: BrandedEmailCell): string {
  if (typeof cell === 'string') return cell;
  const href = safeHref(cell.href);
  return href ? `${cell.text}: ${href}` : cell.text;
}

function safeHref(raw: string): string {
  const t = (raw ?? '').trim();
  return /^https?:\/\//i.test(t) ? t : '';
}

export function escapeText(s: string): string {
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
