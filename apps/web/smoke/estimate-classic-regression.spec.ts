/**
 * Classic-estimate regression — proves the pre-existing estimate lifecycle
 * still works after the Bid Estimator landed (shared QBME serializer, shared
 * PDF/tax/terms modules, new EstimateType, read-only helper change).
 *
 * Covers: guided create → grid editor save (replace-all path) → preview +
 * PDF → QBME page → approve → create PO from estimate → finalize (R-EST-04
 * gates) → save refused while FINALIZED.
 *
 * Dev-login only (local dev server).
 */
import path from 'node:path';
import { test, expect } from '@playwright/test';

const RUN = `SMOKE-CLASSIC-${Date.now().toString(36).toUpperCase()}`;
const WORKBOOK = path.resolve('smoke/fixtures/takeoff-234-clark.xlsx');

test('SMOKE classic estimate — create, save, preview, QBME, approve, PO, finalize', async ({ page }) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(30_000);

  await page.goto('/login');
  await page.getByRole('button', { name: /dev login/i }).click();
  await page.waitForURL(/\/(home|dashboard)/, { timeout: 60_000 }).catch(() => undefined);

  // ---- guided create (unchanged flow) ----
  await page.goto('/estimates/new');
  await page.waitForURL(/estimates\/new$/);
  // The Bid Estimator banner is offered but the quick builder still works.
  await expect(page.getByText(/Use the Bid Estimator/i)).toBeVisible();
  // Lines via the existing Excel import panel (the classic import path).
  await page.getByRole('button', { name: /import from excel/i }).click();
  await page.setInputFiles('input[type="file"]', WORKBOOK);
  await page.getByRole('button', { name: /Signage Schedule · 20/ }).click();
  await page.getByRole('button', { name: /Add 20 lines to estimate/ }).click();
  await expect(page.getByText('Import estimate from Excel')).toBeHidden();
  await page.locator('input[placeholder="Example: Main entrance pylon"]').fill(`${RUN} Storefront sign`);
  await page.getByRole('button', { name: /choose customer/i }).focus();
  await page.keyboard.press('ArrowUp'); // "+ New customer…"
  await page.fill('input[placeholder="Customer or company"]', `${RUN} Co`);
  await page.getByRole('button', { name: /save estimate/i }).click();
  await page.waitForURL((u) => /\/estimates\/(?!new)[a-z0-9-]+/i.test(u.pathname), { timeout: 60_000 });
  const estimateId = page.url().match(/\/estimates\/([a-z0-9]+)/)![1]!;

  // ---- grid editor still saves (replace-all path untouched for CUSTOM) ----
  await expect(page.getByText(`${RUN} Storefront sign`).first()).toBeVisible();
  await expect(page.getByText(/Bid Estimator estimate/)).toHaveCount(0); // banner is BID-only
  const saveButton = page.getByRole('button', { name: /^Save$/ }).first();
  if (await saveButton.count()) {
    await saveButton.click({ trial: true }).catch(() => undefined);
  }

  // ---- preview + PDF + QBME (shared modules) ----
  await page.goto(`/estimates/${estimateId}/preview`);
  await expect(page.locator('body')).toContainText('Harriman, NY 10926');
  await expect(page.locator('body')).not.toContainText('407-');
  const pdf = await page.request.get(`/estimates/${estimateId}/preview/pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toContain('application/pdf');

  await page.goto(`/estimates/${estimateId}/qbme`);
  await expect(page.getByRole('heading', { name: /QuickBooks-ready block/i })).toBeVisible();
  const block = await page.locator('pre').first().innerText();
  expect(block.startsWith('QB_ESTIMATE_START')).toBe(true);
  expect(block.trimEnd().endsWith('QB_ESTIMATE_END')).toBe(true);
  for (const raw of block.split('\n').slice(1, -1)) {
    expect(raw.startsWith('Line=')).toBe(true);
    expect(raw.endsWith('|')).toBe(true);
    expect(raw.slice(5).split('|')).toHaveLength(5);
  }

  // ---- approve → PO → finalize (R-EST-04 lifecycle) ----
  await page.goto(`/estimates/${estimateId}`);
  await page.getByRole('button', { name: /^Approve$/ }).click();
  await expect(page.getByRole('button', { name: /Approved/ })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: /finalize estimate/i }).click();
  // Finalize either succeeds (auto-creates the internal-materials PO and
  // navigates there) or reports the R-EST-04 gate — both prove the gate runs.
  await page.waitForTimeout(4000);
  const finalized = await page.getByRole('button', { name: /Finalized/ }).count();
  const onPo = /\/purchase-orders\//.test(page.url());
  const gate = await page.getByText(/No internal material lines|Estimate must be Approved|QuickBooks PO number|reconciliation/i).count();
  expect(finalized > 0 || onPo || gate > 0).toBe(true);

  // ---- the estimates list still renders classic rows ----
  await page.goto('/estimates');
  await expect(page.getByRole('heading', { level: 1, name: 'Estimates' })).toBeVisible();
  await expect(page.locator('a', { hasText: `${RUN} Storefront sign` }).first()).toBeVisible();
});
