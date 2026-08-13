/**
 * Assistant Excel-attachment smoke — dev-login only (local dev server).
 * Proves the client side of "upload an Excel takeoff to the assistant":
 * the dock parses the workbook in the browser and sends the structured
 * takeoff payload with the chat message. /api/assistant is mocked, so no
 * OpenAI key is needed and nothing is created.
 */
import path from 'node:path';
import { test, expect } from '@playwright/test';

const WORKBOOK = path.resolve('smoke/fixtures/takeoff-234-clark.xlsx');

test('SMOKE assistant dock parses and attaches an Excel takeoff', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/login');
  await page.getByRole('button', { name: /dev login/i }).click();
  // Let the login redirect land first (on /home, which crashes on
  // hydration — pre-existing, unrelated) so our own navigation isn't
  // superseded by it, then go to a healthy page.
  await page.waitForURL(/\/home/, { timeout: 60_000 }).catch(() => undefined);
  await page.goto('/estimates');
  await page.waitForURL(/\/estimates$/, { timeout: 60_000 });

  // Capture the assistant call instead of hitting OpenAI.
  let capturedBody: Record<string, unknown> | null = null;
  await page.route('**/api/assistant', async (route) => {
    capturedBody = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        reply: 'Draft EST-MOCK created — review it in Estimates.',
        toolEvents: [{ tool: 'create_estimate_from_takeoff', summary: 'mock' }],
      }),
    });
  });

  // Open the floating assistant dock and attach the workbook. The first
  // click can land before hydration on a cold dev server — retry until
  // the composer's file input exists.
  const dockInput = page.locator('input[type="file"][accept*="xlsx"]');
  await expect(async () => {
    await page.getByRole('button', { name: /assistant/i }).first().click();
    await expect(dockInput).toBeAttached({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  await page.setInputFiles('input[type="file"][accept*="xlsx"]', WORKBOOK);
  await expect(page.getByText(/takeoff-234-clark\.xlsx · 154 lines/)).toBeVisible();

  await page.getByRole('button', { name: /^Send/ }).click();
  await expect(page.getByText('Draft EST-MOCK created — review it in Estimates.')).toBeVisible();

  // The structured takeoff rode along with the message.
  expect(capturedBody).not.toBeNull();
  const takeoff = capturedBody!.takeoff as {
    fileName: string;
    tabs: Array<{ sheetName: string; lines: unknown[]; priceBasis: string }>;
  };
  expect(takeoff.fileName).toContain('takeoff-234-clark');
  expect(takeoff.tabs.map((t) => t.sheetName).sort()).toEqual([
    'Estimating Sheet',
    'Signage Schedule',
  ]);
  expect(takeoff.tabs.reduce((n, t) => n + t.lines.length, 0)).toBe(154);
  const messages = capturedBody!.messages as Array<{ role: string; content: string }>;
  expect(messages[messages.length - 1]!.content).toContain('takeoff-234-clark');

  // The pending chip cleared after send.
  await expect(page.getByText(/154 lines/)).toBeHidden();
});
