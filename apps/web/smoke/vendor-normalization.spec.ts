/**
 * Vendor normalization rail + OCR review smoke (production/staging/local).
 *
 * Env (required):
 *   BVISIBLE_BASE_URL
 *   BVISIBLE_ADMIN_EMAIL
 *   BVISIBLE_ADMIN_PASSWORD — never log or print
 *
 * Uses SMOKE-* rows only; does not require private production catalog data.
 */

import { test, expect, type Page } from '@playwright/test';
import { loginAsAdmin, requireSmokeCredentials } from './auth';

const SMOKE_CLIENT = 'SMOKE-Client';
const SMOKE_ESTIMATE_TITLE = 'SMOKE-VendorNorm';

const CORO_VARIANTS = [
  'COROPLAST 4MM WHITE',
  '4MM WHITE CORO',
  'Coro-Plast White 4 mm',
] as const;

const UNKNOWN_LABEL = 'ZZZ-NOMATCH-SMOKE-999';

function vendorRail(page: Page) {
  return page.locator('[aria-label="Vendor pricing intelligence for this material line"]');
}

async function ensureSmokeClient(page: Page): Promise<void> {
  await page.goto('/clients');
  await expect(page.getByRole('heading', { level: 1, name: 'Clients' })).toBeVisible();
  if ((await page.getByText(SMOKE_CLIENT).count()) > 0) return;

  await page.goto('/clients/new');
  await page.locator('#companyName').fill(SMOKE_CLIENT);
  await page.getByRole('button', { name: 'Create client' }).click();
  await expect(page.getByText(new RegExp(`Created ${SMOKE_CLIENT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))).toBeVisible({
    timeout: 30_000,
  });
}

async function openOrCreateSmokeEstimate(page: Page): Promise<string> {
  await page.goto('/estimates');
  await expect(page.getByRole('heading', { level: 1, name: 'Estimates' })).toBeVisible();

  const titleLink = page.getByRole('link', { name: SMOKE_ESTIMATE_TITLE });
  if ((await titleLink.count()) === 0) {
    await page.goto('/estimates/new');
    await page.locator('select[name="clientId"]').selectOption({ label: SMOKE_CLIENT });
    await page.locator('input[name="title"]').fill(SMOKE_ESTIMATE_TITLE);
    await page.getByRole('button', { name: 'Create estimate' }).click();
    await page.waitForURL(/\/estimates\/[^/]+$/, { timeout: 45_000 });
    return page.url();
  }

  await titleLink.click();
  await page.waitForURL(/\/estimates\/[^/]+$/, { timeout: 45_000 });
  return page.url();
}

async function ensureMaterialLine(page: Page): Promise<void> {
  const noLines = page.getByText('No lines yet. Add a row below to start.');
  if (await noLines.isVisible()) {
    await page.getByRole('button', { name: '+ Material', exact: true }).click();
  }
}

test.describe.serial('vendor normalization smoke', () => {
  test.beforeAll(() => {
    requireSmokeCredentials();
  });

  test('estimate rail — match guidance, Apply-only, keyboard', async ({ page }) => {
    await loginAsAdmin(page);
    await ensureSmokeClient(page);
    const estimateUrl = await openOrCreateSmokeEstimate(page);
    await page.goto(estimateUrl);

    await expect(page.getByRole('heading', { level: 2, name: 'Line items' })).toBeVisible();
    await ensureMaterialLine(page);

    const descCell = page.getByRole('textbox', { name: /description$/i }).first();
    const unitCell = page.getByRole('textbox', { name: /unit cost$/i }).first();
    const rail = vendorRail(page);

    await descCell.click();

    for (const label of CORO_VARIANTS) {
      await test.step(`Rail hints for: ${label}`, async () => {
        await descCell.fill('');
        await descCell.fill(label);
        await expect(rail.getByText('Vendor intelligence')).toBeVisible({ timeout: 8_000 });
        await expect(rail).toContainText(/match|catalog|alias|Needs review|normalized|Managed item/i, {
          timeout: 8_000,
        });
      });
    }

    await test.step('Unknown label — needs review guidance', async () => {
      await descCell.fill(UNKNOWN_LABEL);
      await expect(rail).toContainText(/Needs review|manual review|No deterministic/i, {
        timeout: 8_000,
      });
    });

    await test.step('Typing does not mutate unit cost', async () => {
      await unitCell.click();
      await unitCell.fill('12.34');
      await unitCell.press('Enter');
      const before = await unitCell.inputValue();

      await descCell.click();
      await descCell.fill('COROPLAST 4MM WHITE');
      await page.waitForTimeout(400);
      await expect(unitCell).toHaveValue(before);
    });

    await test.step('Apply suggested cost only on click', async () => {
      const applySuggested = rail.getByRole('button', { name: 'Apply suggested cost' });
      if ((await applySuggested.count()) === 0) return;

      const before = await unitCell.inputValue();
      await applySuggested.click();
      await expect(unitCell).not.toHaveValue(before);
    });

    await test.step('Grid Enter navigation still works', async () => {
      await descCell.click();
      await descCell.press('Enter');
      const qtyCell = page.getByRole('textbox', { name: /quantity$/i }).first();
      await expect(qtyCell).toBeFocused({ timeout: 5_000 });
    });
  });

  test('OCR review — queue, detail, operator copy', async ({ page }) => {
    await loginAsAdmin(page);

    await page.goto('/admin/ocr-review');
    await expect(page.getByRole('heading', { level: 1, name: 'Receipt OCR review' })).toBeVisible();
    await expect(
      page.getByText(/confirm before vendor price history|vendor price history is written/i),
    ).toBeVisible();

    const detailLink = page
      .locator('table tbody tr')
      .first()
      .getByRole('link')
      .first();

    if ((await detailLink.count()) === 0) {
      test.info().annotations.push({
        type: 'skip-detail',
        description: 'No OCR rows in queue — list/empty state smoke only',
      });
      await expect(
        page.getByText(/queue is clear|Receipt OCR|purchase order/i),
      ).toBeVisible();
      return;
    }

    await detailLink.click();
    await page.waitForURL(/\/admin\/ocr-review\/[^/]+$/, { timeout: 30_000 });

    await expect(
      page.getByText(/vendor price history/i),
    ).toBeVisible();

    const rawPreview = page.getByRole('heading', { name: /OCR text preview/i });
    if (await rawPreview.isVisible()) {
      await expect(page.locator('pre').first()).toBeVisible();
    }

    const reviewSection = page.getByRole('heading', { name: 'Review line candidates' });
    if (await reviewSection.isVisible()) {
      await expect(page.getByRole('button', { name: 'Approve selected' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Reject' })).toBeVisible();

      const parseChip = page.getByText(/Price at end|Quantity ×|Qty label|Parsed from OCR/i).first();
      if ((await parseChip.count()) > 0) {
        await expect(parseChip).toBeVisible();
      }

      await expect(page.getByText(/^HIGH$/)).toHaveCount(0);
      await expect(page.getByText(/^qty_label_unit_price$/)).toHaveCount(0);
    }
  });
});
