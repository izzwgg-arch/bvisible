import { expect, type Page } from '@playwright/test';

export function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    throw new Error(`[smoke] Missing required environment variable: ${name}`);
  }
  return v;
}

export function requireSmokeCredentials(): void {
  requireEnv('BVISIBLE_ADMIN_EMAIL');
  requireEnv('BVISIBLE_ADMIN_PASSWORD');
}

/** Never log or print the password. */
export async function loginAsAdmin(page: Page): Promise<void> {
  const email = requireEnv('BVISIBLE_ADMIN_EMAIL');
  const password = requireEnv('BVISIBLE_ADMIN_PASSWORD');

  await page.goto('/login');
  await expect(page.getByRole('heading', { level: 1, name: /sign in to b visible/i })).toBeVisible();
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 45_000 });
}
