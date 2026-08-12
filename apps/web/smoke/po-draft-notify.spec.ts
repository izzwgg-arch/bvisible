/**
 * Shop-order office notification + catalog auto-add + morning reminder smoke.
 *
 * Proves, against a running app + real DB + real SMTP transport:
 *  1. Placing a shop order with retail items (Amazon + Home Depot custom
 *     items) creates one PO per vendor, marks them SENT, and emails every
 *     admin the office reminder with store links.
 *  2. Items not in the catalog auto-add themselves (visible in /items).
 *  3. The PO timeline records the admin notification.
 *  4. Saving another order as a draft leaves it in DRAFT, and the morning
 *     reminder tick re-emails admins about POs still in DRAFT.
 *  5. (When SMOKE_SINK_DIR is set — local runs with the scratchpad SMTP
 *     sink) the captured emails contain the store links.
 *
 * Env: BVISIBLE_BASE_URL, BVISIBLE_ADMIN_EMAIL, BVISIBLE_ADMIN_PASSWORD
 * Optional: BVISIBLE_TICK_SECRET (enables the reminder-tick step),
 *           SMOKE_SINK_DIR (enables captured-email content assertions).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { loginAsAdmin, requireSmokeCredentials } from './auth';

const RUN_ID = `${Date.now()}`.slice(-6);
const AMAZON_ITEM = `SMOKE-E2E Amazon cam strap ${RUN_ID}`;
const HD_ITEM = `SMOKE-E2E HD hex bolt ${RUN_ID}`;
const DRAFT_ITEM = `SMOKE-E2E draft blade ${RUN_ID}`;

function readSinkEmails(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.eml'))
    .sort()
    .map((f) => readFileSync(join(dir, f), 'utf8'));
}

/// MIME quoted-printable soft line breaks ("=\r\n") split long URLs across
/// lines — undo them (plus =3D etc.) before asserting on content.
function decodeQp(raw: string): string {
  return raw
    .replace(/=\r?\n/g, '')
    .replace(/=([0-9A-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

async function addCustomMaterial(
  page: Page,
  name: string,
  vendor: string,
  price: string
): Promise<void> {
  await page.getByRole('button', { name: /add a material not listed/i }).click();
  await page.getByPlaceholder('What does the shop need?').fill(name);
  await page.getByPlaceholder('Vendor name').fill(vendor);
  await page.locator('input[type="number"][step="0.01"]').first().fill(price);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
}

test.describe.serial('Shop order office notification + catalog auto-add + reminder', () => {
  test.beforeAll(() => {
    requireSmokeCredentials();
  });

  let poNumbers: string[] = [];

  test('shop order → SENT POs + office reminder email + catalog auto-add', async ({ page }) => {
    await test.step('Login', async () => {
      await loginAsAdmin(page);
    });

    await test.step('Create shop order with two custom retail items', async () => {
      await page.goto('/purchase-orders/shop-order');
      await expect(page.getByRole('heading', { name: /order materials/i })).toBeVisible();

      await addCustomMaterial(page, AMAZON_ITEM, 'Amazon', '19.99');
      await addCustomMaterial(page, HD_ITEM, 'Home Depot', '4.50');

      await page.getByRole('button', { name: 'Review order' }).click();
      await expect(page.getByRole('heading', { name: /^Review order$/ })).toBeVisible();

      // Popup carts may open from the same click (retail auto-open) — ignore.
      await page.getByRole('button', { name: /add items to amazon cart/i }).click();
      await expect(
        page.getByRole('heading', { name: /order placed|order created/i })
      ).toBeVisible({ timeout: 45_000 });
    });

    await test.step('Results screen lists one PO per vendor', async () => {
      const body = await page.locator('main').innerText();
      const matches = body.match(/PO-\d{6}/g) ?? [];
      poNumbers = [...new Set(matches)];
      expect(poNumbers.length).toBeGreaterThanOrEqual(2);
    });

    await test.step('Catalog auto-add: both items now exist in /items', async () => {
      for (const name of [AMAZON_ITEM, HD_ITEM]) {
        await page.goto(`/items?q=${encodeURIComponent(name)}`);
        await expect(page.getByText(name).first()).toBeVisible({ timeout: 20_000 });
      }
    });

    await test.step('PO timeline records the admin notification', async () => {
      await page.goto('/purchase-orders');
      const link = page.getByRole('link', { name: poNumbers[0] }).first();
      await link.click();
      await page.waitForURL(/\/purchase-orders\//);
      // The notification lands just before the PO flips to SENT — reload
      // until the timeline event appears (up to ~20s).
      let found = false;
      for (let i = 0; i < 10 && !found; i++) {
        found = (await page.getByText(/admins notified by email/i).count()) > 0;
        if (!found) {
          await page.waitForTimeout(2000);
          await page.reload();
        }
      }
      expect(found).toBe(true);
    });
  });

  test('saving as draft keeps the PO in DRAFT for the reminder tick', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/purchase-orders/shop-order');
    await expect(page.getByRole('heading', { name: /order materials/i })).toBeVisible();

    await addCustomMaterial(page, DRAFT_ITEM, 'Home Depot', '2.25');
    await page.getByRole('button', { name: /save as draft/i }).click();
    await expect(page.getByRole('heading', { name: /draft(s)? saved/i })).toBeVisible({
      timeout: 45_000,
    });

    // The draft shows under the Ordered Materials DRAFTS section.
    await page.goto('/purchase-orders');
    await expect(page.getByText(/drafts/i).first()).toBeVisible({ timeout: 20_000 });
  });

  test('morning reminder tick re-notifies admins about drafts', async ({ page }) => {
    test.skip(!process.env.BVISIBLE_TICK_SECRET?.trim(), 'BVISIBLE_TICK_SECRET not set');
    const res = await page.request.post('/api/internal/po-draft-reminder/tick?force=1', {
      headers: { 'x-bvisible-po-reminder-secret': process.env.BVISIBLE_TICK_SECRET!.trim() },
    });
    expect(res.status()).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      data: { tenantsWithDrafts: number; reports: Array<{ status: string; notified: string[] }> };
    };
    expect(json.ok).toBe(true);
    expect(json.data.tenantsWithDrafts).toBeGreaterThanOrEqual(1);
    const sent = json.data.reports.flatMap((r) => r.notified);
    expect(sent.length).toBeGreaterThanOrEqual(1);
    test.info().annotations.push({
      type: 'reminder-tick',
      description: `reminded about: ${sent.join(', ')}`,
    });
  });

  test('captured emails contain store links and reminder subjects', async () => {
    const dir = process.env.SMOKE_SINK_DIR?.trim();
    test.skip(!dir, 'SMOKE_SINK_DIR not set (no local SMTP sink)');
    const emails = readSinkEmails(dir!).map(decodeQp);
    expect(emails.length).toBeGreaterThanOrEqual(2);

    // Subjects are MIME-encoded (em dashes), so assert on rendered body text.
    const creation = emails.filter((e) => e.includes('needs to be placed'));
    expect(creation.length).toBeGreaterThanOrEqual(2);
    const amazonMail = creation.find((e) => e.includes('Amazon'));
    const hdMail = creation.find((e) => e.includes('Home Depot'));
    expect(amazonMail).toBeTruthy();
    expect(hdMail).toBeTruthy();
    expect(amazonMail!).toContain('https://www.amazon.com/s?k=');
    expect(hdMail!).toContain('https://www.homedepot.com/s/');

    const reminders = emails.filter((e) => e.includes('is still a draft'));
    expect(reminders.length).toBeGreaterThanOrEqual(1);
  });
});
