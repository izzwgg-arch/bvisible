/**
 * Logged-in core workflow smoke (production/staging/local).
 *
 * Env (required):
 *   BVISIBLE_BASE_URL       — e.g. https://example.com or http://127.0.0.1:3000
 *   BVISIBLE_ADMIN_EMAIL
 *   BVISIBLE_ADMIN_PASSWORD — never log or print this value
 *
 * Never writes quote tokens to stdout; screenshots/traces are disabled in playwright.config.ts.
 */

import { test, expect, type Page, type Browser } from '@playwright/test';
import { loginAsAdmin, requireEnv, requireSmokeCredentials } from './auth';

const SMOKE_CLIENT = 'SMOKE-Client';
const SMOKE_ITEM = 'SMOKE-CatalogItem';
const SMOKE_ESTIMATE_TITLE = 'SMOKE-CoreWorkflow';

async function ensureSmokeClient(page: Page): Promise<void> {
  await test.step('Ensure smoke client exists', async () => {
    await page.goto('/clients');
    await expect(page.getByRole('heading', { level: 1, name: 'Clients' })).toBeVisible();
    if ((await page.getByText(SMOKE_CLIENT).count()) > 0) return;

    await page.goto('/clients/new');
    await page.locator('#companyName').fill(SMOKE_CLIENT);
    await page.getByRole('button', { name: 'Create client' }).click();
    await expect(page.getByText(new RegExp(`Created ${SMOKE_CLIENT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))).toBeVisible({
      timeout: 30_000,
    });
  });
}

async function ensureSmokeCatalogItem(page: Page): Promise<void> {
  await test.step('Ensure smoke catalog item exists', async () => {
    await page.goto(`/items?q=${encodeURIComponent(SMOKE_ITEM)}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Items' })).toBeVisible();
    if ((await page.getByRole('link', { name: SMOKE_ITEM }).count()) > 0) return;

    await page.goto('/items/new');
    await expect(page.getByRole('heading', { level: 1, name: 'New item' })).toBeVisible();
    await page.locator('input[name="name"]').fill(SMOKE_ITEM);
    await page.locator('input[name="internalCostUsd"]').fill('12.34');
    await page.getByRole('button', { name: 'Create item' }).click();

    try {
      await page.waitForURL(/\/items\/[^/]+$/, { timeout: 30_000 });
    } catch {
      await expect(page.getByText(/already exists/i)).toBeVisible({ timeout: 10_000 });
    }

    await page.goto(`/items?q=${encodeURIComponent(SMOKE_ITEM)}`);
    await expect(page.getByRole('link', { name: SMOKE_ITEM })).toBeVisible({ timeout: 15_000 });
  });
}

async function openOrCreateSmokeEstimate(page: Page): Promise<{ estimateUrl: string; statusFromList: string }> {
  await page.goto('/estimates');
  await expect(page.getByRole('heading', { level: 1, name: 'Estimates' })).toBeVisible();

  const titleLink = page.getByRole('link', { name: SMOKE_ESTIMATE_TITLE });
  if ((await titleLink.count()) === 0) {
    await page.goto('/estimates/new');
    await page.locator('select[name="clientId"]').selectOption({ label: SMOKE_CLIENT });
    await page.locator('input[name="title"]').fill(SMOKE_ESTIMATE_TITLE);
    await page.getByRole('button', { name: 'Create & add lines' }).click();
    await page.waitForURL(/\/estimates\/[^/]+$/, { timeout: 45_000 });
    return { estimateUrl: page.url(), statusFromList: 'Draft' };
  }

  const row = page.locator('tbody tr').filter({ has: titleLink });
  const statusCell = row.locator('td').nth(3);
  const statusFromList = (await statusCell.innerText()).trim();
  await titleLink.click();
  await page.waitForURL(/\/estimates\/[^/]+$/, { timeout: 45_000 });
  return { estimateUrl: page.url(), statusFromList };
}

async function readEstimateNumber(page: Page): Promise<string> {
  const h1 = await page.locator('h1').first().innerText();
  const number = h1.split('·')[0]?.trim();
  if (!number) throw new Error('[smoke:core] Could not parse estimate number from PageHeader title.');
  return number;
}

test.describe.serial('core workflow smoke', () => {
  test.beforeAll(() => {
    requireSmokeCredentials();
  });

  test('SMOKE-CoreWorkflow happy path (idempotent)', async ({ browser }: { browser: Browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await test.step('Login', async () => {
      await loginAsAdmin(page);
    });

    await test.step('Dashboard shows workspace (company name)', async () => {
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByText(/B Visible/)).toBeVisible();
      await expect(page.getByText(/operational overview/)).toBeVisible();
      await expect(page.getByText(/Operational queues/)).toBeVisible();
      await expect(page.getByText(/PO vendor lifecycle/)).toBeVisible();
    });

    await test.step('Route smoke (authenticated)', async () => {
      const routes: ReadonlyArray<[string, RegExp]> = [
        ['/items', /^Items$/],
        ['/items/new', /^New item$/],
        ['/clients', /^Clients$/],
        ['/vendors', /^Vendors$/],
        ['/estimates', /^Estimates$/],
        ['/estimates/new', /^New estimate$/],
        ['/purchase-orders', /^Ordered Materials$/],
        ['/purchase-orders/all', /^All purchase orders$/],
        ['/admin/email-ingestion', /^Email ingestion$/],
        ['/admin/ocr-review', /^Receipt OCR review$/],
        ['/admin/reconciliation', /^PO reconciliation inbox$/],
      ];
      for (const [path, titleRx] of routes) {
        await test.step(`GET ${path}`, async () => {
          await page.goto(path);
          await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleRx);
        });
      }
    });

    await ensureSmokeClient(page);
    await ensureSmokeCatalogItem(page);

    const { estimateUrl, statusFromList } = await test.step(
      'Open or create smoke estimate',
      () => openOrCreateSmokeEstimate(page),
    );

    if (statusFromList === 'Finalized') {
      throw new Error(
        '[smoke:core] SMOKE-CoreWorkflow is FINALIZED — unfinalize or delete this estimate and re-run.',
      );
    }
    if (statusFromList === 'Rejected') {
      throw new Error('[smoke:core] SMOKE-CoreWorkflow is REJECTED — reset status or delete and re-run.');
    }

    await page.goto(estimateUrl);
    const estimateNumber = await readEstimateNumber(page);

    await test.step('Estimate editor shell (no crash)', async () => {
      await expect(page.getByRole('heading', { level: 2, name: 'Line items' })).toBeVisible();
      await expect(page.getByRole('heading', { level: 2, name: 'Catalog items' })).toBeVisible();
      await expect(page.getByRole('heading', { level: 2, name: 'Pricing helper' })).toBeVisible();
      await expect(page.getByRole('link', { name: /Preview quote|Add line items|Send \/ track quote/i })).toBeVisible();
    });

    if (statusFromList === 'Draft') {
      await test.step('Estimate editor + catalog Apply only on click', async () => {
        await expect(page.getByRole('heading', { level: 2, name: 'Line items' })).toBeVisible();
        const noLines = page.getByText('No line items yet');
        if (await noLines.isVisible()) {
          await page.getByRole('button', { name: '+ Material', exact: true }).click();
        }

        const applyBtns = page.getByRole('button', { name: 'Apply' });
        await expect(applyBtns.first()).toBeDisabled();

        const descCell = page.getByRole('textbox', { name: /description$/i }).first();
        await descCell.click();
        await expect(applyBtns.first()).toBeEnabled();

        const descBefore = await descCell.inputValue();

        await page.getByPlaceholder('Filter by name…').fill(SMOKE_ITEM);

        const catalogSection = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Catalog items' }) });

        const rowApply = catalogSection
          .locator('tbody tr')
          .filter({ has: page.getByText(SMOKE_ITEM, { exact: false }) })
          .getByRole('button', { name: 'Apply' })
          .first();

        await rowApply.click();

        await expect(descCell).not.toHaveValue(descBefore);
        await expect(descCell).toHaveValue(new RegExp(SMOKE_ITEM.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));

        await page.getByRole('button', { name: /Save changes \(⌘S\)/ }).click();
        await expect(page.getByText(/Saved · cost/)).toBeVisible({ timeout: 30_000 });
      });

      await test.step('Mark Sent (staff)', async () => {
        const statusSection = page
          .locator('section')
          .filter({ has: page.getByRole('heading', { name: 'Status', exact: true }) });
        await statusSection.getByRole('button', { name: 'Sent', exact: true }).click();
        await expect(statusSection.getByRole('button', { name: 'Sent', exact: true })).toBeDisabled({
          timeout: 30_000,
        });
      });
    }

    await page.goto(estimateUrl);

    await test.step('Quote preview opens', async () => {
      await page.getByRole('link', { name: 'Preview quote' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Quote preview' })).toBeVisible();
    });

    let quoteUrlForAnonymous = '';

    await test.step('Issue public quote link (URL stays in memory only)', async () => {
      const gen = page.getByRole('button', { name: 'Generate public link' });
      const regen = page.getByRole('button', { name: 'Regenerate link' });
      if ((await gen.count()) > 0 && (await gen.isEnabled())) {
        await gen.click();
      } else if ((await regen.count()) > 0 && (await regen.isEnabled())) {
        await regen.click();
      } else {
        throw new Error('[smoke:core] Could not find Generate/Regenerate public link on preview.');
      }

      const urlParagraph = page.getByText('Link (copy now)').locator('+ p');
      await expect(urlParagraph).toBeVisible({ timeout: 45_000 });
      quoteUrlForAnonymous = (await urlParagraph.innerText()).trim();
      if (!quoteUrlForAnonymous.includes('/quote/')) {
        throw new Error('[smoke:core] Issued URL missing /quote/ segment.');
      }
    });

    await test.step('Public quote page (logged-out) — no app shell', async () => {
      const anon = await browser.newContext();
      const pub = await anon.newPage();
      await pub.goto(quoteUrlForAnonymous);
      await expect(pub.getByRole('link', { name: 'Dashboard' })).toHaveCount(0);
      await expect(pub.locator('aside')).toHaveCount(0);
      await expect(pub.getByText(SMOKE_ESTIMATE_TITLE)).toBeVisible({ timeout: 30_000 });

      const acceptBtn = pub.getByRole('button', { name: 'Accept quote' });
      if (await acceptBtn.isVisible()) {
        await acceptBtn.click();
        await expect(pub.getByText(/acceptance has been recorded|already have your acceptance/i)).toBeVisible({
          timeout: 45_000,
        });
      } else {
        await expect(pub.getByText(/Quote accepted/i)).toBeVisible({ timeout: 30_000 });
      }
      await anon.close();
    });

    await test.step('Staff — estimate Approved', async () => {
      await page.goto(estimateUrl);
      await page.reload();
      const statusSection = page
        .locator('section')
        .filter({ has: page.getByRole('heading', { name: 'Status', exact: true }) });
      await expect(statusSection.getByRole('button', { name: 'Approved', exact: true })).toBeDisabled({
        timeout: 60_000,
      });
      await expect(page.getByText('Accepted quote')).toBeVisible();
    });

    await test.step('Purchase order from estimate + link back', async () => {
      await page.goto(estimateUrl);
      const totalsPo = page.locator('#estimate-linked-pos').getByRole('link').first();
      const fulfillmentPo = page
        .locator('section')
        .filter({ hasText: 'Linked purchase orders' })
        .locator('a.font-mono')
        .first();

      if (await totalsPo.isVisible()) {
        await totalsPo.click();
      } else if (await fulfillmentPo.isVisible()) {
        await fulfillmentPo.click();
      } else {
        await page.getByRole('link', { name: 'Create purchase order from estimate' }).click();
        await page.locator('#estimate-create-po').getByRole('button', { name: 'Create PO from estimate' }).click();
        await page.waitForURL(/\/purchase-orders\/[^/]+$/, { timeout: 45_000 });
      }
      await expect(page.getByText('Linked estimate').first()).toBeVisible();
      await expect(page.getByRole('link', { name: estimateNumber })).toBeVisible();
    });

    await context.close();
  });
});
