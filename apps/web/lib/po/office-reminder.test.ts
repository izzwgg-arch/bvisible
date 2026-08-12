import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The office reminder must reach sales@bvisible.us automatically, and must
 * never leak provider detail or credentials into anything the user sees.
 *
 * These cover the pure decision logic — default resolution, validation, the
 * safe failure vocabulary, and the email body. The send path itself needs a
 * database and an SMTP transport, so it is exercised in the app, not here.
 */

vi.mock('@bvisible/db', () => ({
  POReminderStatus: { PENDING: 'PENDING', SENT: 'SENT', FAILED: 'FAILED' },
  prisma: {},
}));
vi.mock('@/lib/mailer', () => ({ MailerConfigError: class MailerConfigError extends Error {}, sendMail: vi.fn() }));
vi.mock('@/lib/po/admin-notify', () => ({ resolveAppOrigin: vi.fn(async () => 'https://app.example.com') }));

const ORIGINAL_ENV = process.env.AMAZON_OFFICE_REMINDER_EMAIL;

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.AMAZON_OFFICE_REMINDER_EMAIL;
  else process.env.AMAZON_OFFICE_REMINDER_EMAIL = ORIGINAL_ENV;
  vi.resetModules();
});

describe('defaultOfficeReminderEmail', () => {
  it('falls back to sales@bvisible.us when nothing is configured', async () => {
    delete process.env.AMAZON_OFFICE_REMINDER_EMAIL;
    const { defaultOfficeReminderEmail } = await import('./office-reminder');
    expect(defaultOfficeReminderEmail()).toBe('sales@bvisible.us');
  });

  it('uses the configured address when one is set', async () => {
    process.env.AMAZON_OFFICE_REMINDER_EMAIL = 'orders@bvisible.us';
    const { defaultOfficeReminderEmail } = await import('./office-reminder');
    expect(defaultOfficeReminderEmail()).toBe('orders@bvisible.us');
  });

  it('ignores a malformed setting rather than sending nowhere', async () => {
    process.env.AMAZON_OFFICE_REMINDER_EMAIL = 'not-an-email';
    const { defaultOfficeReminderEmail } = await import('./office-reminder');
    expect(defaultOfficeReminderEmail()).toBe('sales@bvisible.us');
  });

  it('never resolves to the misspelled vvisible domain', async () => {
    delete process.env.AMAZON_OFFICE_REMINDER_EMAIL;
    const { defaultOfficeReminderEmail, DEFAULT_OFFICE_REMINDER_EMAIL } = await import('./office-reminder');
    expect(defaultOfficeReminderEmail()).not.toContain('vvisible');
    expect(DEFAULT_OFFICE_REMINDER_EMAIL).toBe('sales@bvisible.us');
  });
});

describe('isValidEmail', () => {
  it('accepts ordinary addresses and rejects junk', async () => {
    const { isValidEmail } = await import('./office-reminder');
    expect(isValidEmail('sales@bvisible.us')).toBe(true);
    expect(isValidEmail('  sales@bvisible.us  ')).toBe(true);
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail(null)).toBe(false);
    expect(isValidEmail('sales@bvisible')).toBe(false);
    expect(isValidEmail('sales bvisible.us')).toBe(false);
    expect(isValidEmail(`${'a'.repeat(320)}@x.us`)).toBe(false);
  });
});

describe('reminderFailureMessage', () => {
  it('maps every category to user-facing text with no technical detail', async () => {
    const { reminderFailureMessage } = await import('./office-reminder');
    for (const category of ['smtp_not_configured', 'invalid_recipient', 'send_failed']) {
      const message = reminderFailureMessage(category);
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toMatch(/smtp:|stack|password|token|econn|5\d\d /i);
    }
  });

  it('falls back to the generic message for an unknown category', async () => {
    const { reminderFailureMessage } = await import('./office-reminder');
    expect(reminderFailureMessage('something_new')).toBe(reminderFailureMessage('send_failed'));
    expect(reminderFailureMessage(null)).toBe(reminderFailureMessage('send_failed'));
  });
});

describe('buildOfficeReminderEmail', () => {
  const base = {
    poNumber: 'PO-000063',
    vendorName: 'Amazon',
    createdByLabel: 'Yitzy W',
    createdAt: new Date('2026-08-12T15:04:00Z'),
    subtotalCents: 264,
    poUrl: 'https://app.example.com/purchase-orders/po_1',
    lines: [
      {
        description: "Blue Painter's Tape — Roll",
        vendorSku: 'B0ABCDEFGH',
        productUrl: 'www.amazon.com/dp/B0ABCDEFGH',
        qtyMilli: 1000,
        unit: 'EACH',
        unitCostCents: 264,
        computedCostCents: 264,
        notes: null,
      },
    ],
  };

  it('carries the PO number, creator, items, links and total', async () => {
    const { buildOfficeReminderEmail } = await import('./office-reminder');
    const { subject, html, text } = buildOfficeReminderEmail(base);
    expect(subject).toBe('Amazon order ready: PO-000063');
    for (const body of [html, text]) {
      expect(body).toContain('PO-000063');
      expect(body).toContain('Yitzy W');
      // Apostrophe-free substring: the HTML body escapes it, the text body
      // does not, and both are correct.
      expect(body).toContain('Tape — Roll');
      expect(body).toContain('amazon.com/dp/B0ABCDEFGH');
      expect(body).toContain('$2.64');
    }
  });

  it('never claims the purchase was completed automatically', async () => {
    const { buildOfficeReminderEmail } = await import('./office-reminder');
    const { html, text } = buildOfficeReminderEmail(base);
    for (const body of [html, text]) {
      expect(body).toMatch(/does not place the order|Nothing has been purchased/i);
      expect(body).not.toMatch(/order (has been )?placed|payment (was )?taken|purchased for you/i);
    }
  });

  it('contains no image markup — this workflow is deliberately picture-free', async () => {
    const { buildOfficeReminderEmail } = await import('./office-reminder');
    const { html } = buildOfficeReminderEmail(base);
    // The branded wrapper embeds one inline logo by CID; no PRODUCT images.
    expect(html).not.toMatch(/<img[^>]+src=["']https?:\/\/(?!.*b-visible-logo)/i);
    expect(html).not.toMatch(/imageUrl|productImage|placeholder\.(png|jpg)/i);
  });

  it('says so plainly when a line has no product link', async () => {
    const { buildOfficeReminderEmail } = await import('./office-reminder');
    const { text } = buildOfficeReminderEmail({
      ...base,
      lines: [{ ...base.lines[0]!, productUrl: null }],
    });
    expect(text).toContain('No link on file');
    // The item still ships in the email even without a link.
    expect(text).toContain("Blue Painter's Tape — Roll");
  });
});
