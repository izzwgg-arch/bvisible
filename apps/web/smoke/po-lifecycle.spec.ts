/**
 * PO vendor lifecycle smoke — dashboard queues, PO detail rail, operator controls.
 * Mutations only on purchase orders whose number starts with SMOKE-.
 *
 * Env: BVISIBLE_BASE_URL, BVISIBLE_ADMIN_EMAIL, BVISIBLE_ADMIN_PASSWORD
 * Optional file: ~/.bvisible-smoke.env (never commit).
 */

import { test, expect, type Page } from '@playwright/test';
import { loginAsAdmin, requireSmokeCredentials } from './auth';
import { isSmokePoNumberForMutation, isSmokePoNumberForRead } from './smoke-fixtures';

async function findPoLink(
  page: Page,
  predicate: (number: string) => boolean,
): Promise<{ href: string; number: string } | null> {
  await page.goto('/purchase-orders');
  await expect(page.getByRole('heading', { level: 1, name: 'Purchase orders' })).toBeVisible();

  const rows = page.locator('tbody tr');
  const count = await rows.count();
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const link = row.getByRole('link').first();
    if ((await link.count()) === 0) continue;
    const number = (await link.innerText()).trim();
    if (!predicate(number)) continue;
    const href = await link.getAttribute('href');
    if (!href) continue;
    return { href, number };
  }
  return null;
}

test.describe.serial('PO lifecycle smoke', () => {
  test.beforeAll(() => {
    requireSmokeCredentials();
  });

  test('dashboard queues and PO lifecycle rail (read-only + SMOKE- mutations)', async ({ page }) => {
    await test.step('Login', async () => {
      await loginAsAdmin(page);
    });

    await test.step('Dashboard — operational + PO lifecycle sections', async () => {
      await page.goto('/dashboard');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByText(/Operational queues/)).toBeVisible();
      await expect(page.getByText(/PO vendor lifecycle/)).toBeVisible();
    });

    await test.step('Route smoke — admin surfaces load', async () => {
      const routes: ReadonlyArray<[string, RegExp]> = [
        ['/purchase-orders', /^Purchase orders$/],
        ['/admin/email-ingestion', /^Email ingestion$/],
        ['/admin/ocr-review', /^Receipt OCR review$/],
        ['/admin/reconciliation', /^PO reconciliation inbox$/],
      ];
      for (const [path, titleRx] of routes) {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(titleRx);
      }
    });

    const smokePo = await test.step('Locate SMOKE- purchase order (mutation target)', async () =>
      findPoLink(page, isSmokePoNumberForMutation),
    );

    const readOnlyPo =
      smokePo ??
      (await test.step('Locate fixture PO for read-only rail (PO-90100*)', async () =>
        findPoLink(page, isSmokePoNumberForRead),
      ));

    if (!readOnlyPo) {
      test.info().annotations.push({
        type: 'skip-po',
        description:
          'No SMOKE- or PO-90100* fixture PO found — run server-scripts/db/.list-smoke-data.sh on the host.',
      });
      return;
    }

    if (!smokePo) {
      test.info().annotations.push({
        type: 'skip-mutation',
        description: `No SMOKE- prefixed PO — read-only rail check on ${readOnlyPo.number} only (no operator clicks).`,
      });
    }

    await test.step(`Open ${readOnlyPo.number} lifecycle rail`, async () => {
      await page.goto(readOnlyPo.href);
      await expect(page.getByRole('heading', { level: 2, name: 'Vendor order lifecycle' })).toBeVisible();
      await expect(page.getByText('Operator lifecycle')).toBeVisible();
    });

    await test.step('Operator controls exist', async () => {
      await expect(page.getByRole('button', { name: 'Mark vendor acknowledged' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Mark received complete' })).toBeVisible();
      const blocked = page.getByRole('button', { name: 'Mark blocked' });
      const clearBlocked = page.getByRole('button', { name: 'Clear blocked' });
      expect((await blocked.count()) + (await clearBlocked.count())).toBeGreaterThan(0);
    });

    if (!smokePo) {
      return;
    }

    await test.step('Mark vendor acknowledged (SMOKE- PO only)', async () => {
      await page.getByRole('button', { name: 'Mark vendor acknowledged' }).click();
      await page.waitForTimeout(1500);
      await expect(page.getByText(/Vendor responded|Waiting on shipment|Vendor acknowledged/i).first()).toBeVisible({
        timeout: 30_000,
      });
    });

    await test.step('Mark blocked then clear (SMOKE- PO only)', async () => {
      const markBlocked = page.getByRole('button', { name: 'Mark blocked' });
      if (await markBlocked.isVisible()) {
        await page.getByPlaceholder('Optional block reason').fill('playwright-smoke');
        await markBlocked.click();
        await page.waitForTimeout(1500);
        await expect(page.getByRole('button', { name: 'Clear blocked' })).toBeVisible({
          timeout: 30_000,
        });
      }
      const clearBtn = page.getByRole('button', { name: 'Clear blocked' });
      if (await clearBtn.isVisible()) {
        await clearBtn.click();
        await page.waitForTimeout(1500);
      }
    });

    await test.step('Timeline shows operator event kinds', async () => {
      await expect(page.getByText(/Operator marked|Operator cleared/i).first()).toBeVisible({
        timeout: 30_000,
      });
    });

    test.info().annotations.push({
      type: 'smoke-po',
      description: `Exercised lifecycle controls on ${smokePo!.number}`,
    });
  });
});
