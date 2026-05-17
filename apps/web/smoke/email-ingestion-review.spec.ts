/**
 * Admin email ingestion review UI smoke.
 *
 * Env: BVISIBLE_BASE_URL, BVISIBLE_ADMIN_EMAIL, BVISIBLE_ADMIN_PASSWORD
 * Prerequisite: run scripts/smoke-email-ingestion-live.ts on the same environment.
 */

import { test, expect, type Page } from '@playwright/test';

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`[smoke:email-ingestion] Missing env: ${name}`);
  return v;
}

async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto('/login');
  await page.locator('#email').fill(requireEnv('BVISIBLE_ADMIN_EMAIL'));
  await page.locator('#password').fill(requireEnv('BVISIBLE_ADMIN_PASSWORD'));
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 45_000 });
}

test('email ingestion review UI shows smoke rows and controls', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/admin/email-ingestion?filter=all');
  await expect(page.getByRole('heading', { level: 1, name: /email ingestion/i })).toBeVisible({
    timeout: 20_000,
  });

  const smokeRow = page.locator('li').filter({ hasText: 'SMOKE-EMAIL' }).first();
  await expect(smokeRow).toBeVisible({ timeout: 15_000 });
  await smokeRow.getByRole('button', { name: 'Details' }).click();

  await expect(page.getByText(/Matched by|No automatic PO match|Manual review/i).first()).toBeVisible();
  await expect(page.getByText('Link', { exact: true })).toBeVisible();
  await expect(page.getByText('Retry', { exact: true })).toBeVisible();
  await expect(page.getByText('Dismiss', { exact: true })).toBeVisible();

  const skipped = page.getByText('Skipped', { exact: true });
  if ((await skipped.count()) > 0) {
    await expect(skipped.first()).toBeVisible();
  }
});
