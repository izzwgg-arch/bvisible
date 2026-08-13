/**
 * Excel estimate import smoke — dev-login only (local dev server).
 * Drives the real /estimates/new page: open the Excel import panel →
 * upload the fixture takeoff workbook (three tabs: sell-price schedule,
 * cost-basis estimating sheet, and a rate catalog that must be ignored) →
 * assert tab detection + pricing semantics → add lines → save → assert
 * the created estimate got the section bundles and sheet totals.
 * Creates SMOKE- prefixed fixtures per smoke conventions.
 */
import path from 'node:path';
import { test, expect } from '@playwright/test';

const WORKBOOK = path.resolve('smoke/fixtures/takeoff-234-clark.xlsx');

test('SMOKE excel takeoff import end to end', async ({ page }) => {
  test.setTimeout(180_000);
  // Dev login (development-only one-click button).
  await page.goto('/login');
  await page.getByRole('button', { name: /dev login/i }).click();
  // The login 303 sets the session cookie; /home currently crashes on
  // hydration (pre-existing, unrelated in-flight work), so don't wait for
  // it — head straight for the builder page.
  await page.waitForTimeout(3000);

  await page.goto('/estimates/new');
  await page.waitForURL(/estimates\/new/, { timeout: 60_000 });
  await page.getByRole('button', { name: /import from excel/i }).click();
  await expect(page.getByText('Import estimate from Excel')).toBeVisible();

  await page.setInputFiles('input[type="file"]', WORKBOOK);

  // Both takeoff tabs detected, biggest first; Rate Catalog ignored.
  await expect(page.getByRole('button', { name: /Estimating Sheet · 134/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Signage Schedule · 20/ })).toBeVisible();
  await expect(page.getByText(/costs import as costs/i)).toBeVisible();
  await expect(page.getByText('Sheet total $27,325.00')).toBeVisible();

  // The operator can override the detected pricing basis in both directions.
  await page.getByRole('button', { name: /final prices — import as-is/i }).click();
  await expect(page.getByText(/final selling prices/i)).toBeVisible();
  await page.getByRole('button', { name: /costs — my markup applies/i }).click();
  await expect(page.getByText(/costs import as costs/i)).toBeVisible();
  await page.screenshot({ path: 'test-results/excel-import-preview.png', fullPage: false });

  // Switch to the sell-price tab and check semantics + skipped-tax note.
  await page.getByRole('button', { name: /Signage Schedule · 20/ }).click();
  await expect(page.getByText(/final selling prices/i)).toBeVisible();
  await expect(page.getByText('Sheet total $33,925.00')).toBeVisible();
  await expect(page.getByText(/no sales-tax field/i).first()).toBeVisible();
  await expect(page.getByText('Apartment Entry Signage')).toBeVisible();

  // Import the schedule tab into the builder.
  await page.getByRole('button', { name: /Add 20 lines to estimate/ }).click();
  await expect(page.getByText('Import estimate from Excel')).toBeHidden();

  // Section bundles arrived as cards; title auto-filled from the sheet.
  await expect(page.getByText('Exterior & Building Identification').first()).toBeVisible();
  await expect(page.getByText('Design, Installation & Sales Tax').first()).toBeVisible();
  const titleInput = page.locator('input[placeholder="Example: Main entrance pylon"]');
  await expect(titleInput).toHaveValue(/234 CLARKSON AVENUE/);

  // Fill customer + save (SMOKE- prefixed fixture per smoke conventions).
  await titleInput.fill('SMOKE-Excel Import 234 Clark');
  // SelectControl commits via keyboard: ArrowUp on the trigger wraps to the
  // last option, which is "+ New customer…" (the hidden native select's
  // onChange is a no-op, so selectOption can't drive it).
  await page.getByRole('button', { name: /choose customer/i }).focus();
  await page.keyboard.press('ArrowUp');
  await page.fill('input[placeholder="Customer or company"]', 'SMOKE Excel Import Co');
  await page.screenshot({ path: 'test-results/excel-import-builder.png', fullPage: true });

  await page.getByRole('button', { name: /save estimate/i }).click();
  // "new" also matches \/estimates\/x+ — explicitly wait to leave the builder.
  await page.waitForURL((u) => /\/estimates\/(?!new)[a-z0-9-]+/i.test(u.pathname), {
    timeout: 45_000,
  });

  // The editor shows the imported estimate: sections became bundles with
  // the workbook's subtotals, and the pre-tax total matches the sheet.
  await expect(page.getByText('SMOKE-Excel Import 234 Clark').first()).toBeVisible();
  await expect(page.getByText(/Estimate #\d+/).first()).toBeVisible();
  await expect(page.getByRole('textbox', { name: /Bundle \d+ name/ }).nth(1)).toHaveValue(
    'Interior Signage'
  );
  await expect(page.getByRole('row', { name: /Interior Signage.*12 items.*\$15,230\.00/ })).toBeVisible();
  await expect(page.getByText('$33,925.00').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/excel-import-editor.png', fullPage: true });
});
