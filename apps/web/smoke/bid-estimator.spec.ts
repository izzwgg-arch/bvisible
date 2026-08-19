/**
 * Bid Estimator end-to-end smoke — dev-login only (local dev server).
 *
 * Walks the complete seven-step workflow against the real app + DB:
 *   1. start a bid estimate (customer + project) → Step 1 project details autosave
 *   2. upload the Excel takeoff + a PDF plan → both stored, takeoff parsed,
 *      headings / totals excluded, standard signs matched
 *   3. review pricing (green / yellow / blue lines, explanation, per-character
 *      conversion 1 set → 11 characters)
 *   4. answer the office question created by the pricing conflict (project rate)
 *      → the line recalculates
 *   5. include design (real Design line)   6. include installation (real line)
 *   7. customer-ready estimate + QBME: one QBME line per estimate line, same
 *      order, Σ qty × rate = pre-tax subtotal, allowed items only, Harriman info
 *   Then leave, reopen from the Estimates list, and resume at the saved step.
 *
 * Prereqs: local dev server, DEV_LOGIN_* env, and the seeded local standard
 * signs (smoke/fixtures/seed-bid-standard-signs.ts). Screenshots land in
 * smoke/output/bid-estimator/.
 */
import path from 'node:path';
import fs from 'node:fs';
import { test, expect, type Page } from '@playwright/test';

const TAKEOFF = path.resolve('smoke/fixtures/bid-azura-takeoff.xlsx');
const PLANS = path.resolve('smoke/fixtures/bid-marked-plans.pdf');
const OUT = path.resolve('smoke/output/bid-estimator');
const RUN = `SMOKE-BID-${Date.now().toString(36).toUpperCase()}`;

async function shot(page: Page, name: string) {
  fs.mkdirSync(OUT, { recursive: true });
  // The app shell scrolls an inner container; reset it so the review
  // screenshots start at the page heading.
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelectorAll('*').forEach((el) => {
      const node = el as HTMLElement;
      if (node.scrollTop > 0) node.scrollTop = 0;
    });
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true });
}

test('SMOKE bid estimator — seven steps, resume, estimate + QBME', async ({ page }) => {
  test.setTimeout(420_000);
  page.setDefaultTimeout(30_000);

  // ---- login (dev login button, lands on /home) ----
  await page.goto('/login');
  await page.getByRole('button', { name: /dev login/i }).click();
  await page.waitForURL(/\/(home|dashboard)/, { timeout: 60_000 }).catch(() => undefined);

  // ---- start a bid estimate ----
  await page.goto('/estimates/new/bid');
  await page.waitForURL(/\/estimates\/new\/bid$/);
  // Customer picker: pick "+ New customer" via keyboard (SelectControl cannot be clicked in Playwright).
  const trigger = page.locator('#start-customer button').first();
  await trigger.focus();
  await page.keyboard.press('ArrowUp'); // wraps to the last option: "+ New customer…"
  await expect(page.locator('#newClientName')).toBeVisible();
  await page.fill('#newClientName', `${RUN} Michels & Waldron Associates`);
  await page.fill('#projectName', `${RUN} Azura Phase 1`);
  await page.getByRole('button', { name: /start bid estimate/i }).click();
  await page.waitForURL(/\/estimates\/(?!new\/)[a-z0-9]+\/bid/, { timeout: 90_000 });
  const estimateId = page.url().match(/\/estimates\/([a-z0-9]+)\/bid/)![1]!;

  // ---- Step 1: project details autosave ----
  await expect(page.getByRole('heading', { name: /start with the project information/i })).toBeVisible();
  await page.fill('#project-address', '23 Main Street, Holmdel, NJ');
  await page.fill('#po-number', 'PO-2026-0451');
  await page.selectOption('#bid-source', 'Bid email');
  await expect(page.locator('.bidw-save')).toContainText(/Saved/, { timeout: 15_000 });
  await shot(page, '01-project-details');
  await page.getByRole('button', { name: /save and continue/i }).first().click();

  // ---- Step 2: upload takeoff + plans ----
  await expect(page.getByRole('heading', { name: /upload the takeoff/i })).toBeVisible();
  await page.setInputFiles('input[type="file"]', [TAKEOFF, PLANS]);
  await expect(page.getByText(/bid-azura-takeoff\.xlsx/)).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(/bid-marked-plans\.pdf/)).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('.summary-strip').first()).toContainText(/Rows read/, { timeout: 60_000 });
  // Headings ignored > 0, sign lines = 9 real sign types, service rows deferred.
  const summaryText = await page.locator('.summary-strip').first().innerText();
  expect(summaryText).toMatch(/Rows read\s*30/i);
  expect(summaryText).toMatch(/Sign lines\s*8/i);
  expect(summaryText).toMatch(/Headings ignored\s*8/i); // 6 headings + 2 header rows
  expect(summaryText).toMatch(/Takeoff quantity\s*340/i); // 103 + 140 + 36 + 12 + 46 + 1 + 1 + 1
  await shot(page, '02-upload-files');
  await page.getByRole('button', { name: /import and review/i }).first().click();

  // ---- Step 3: review pricing ----
  await expect(page.getByRole('heading', { name: /review what was priced/i })).toBeVisible();
  const table = page.locator('table.tbl').first();
  await expect(table).toContainText('Residential Unit ID Sign');
  // Quantities were combined across floors: 40 + 63 = 103 signs at $60.
  const unitRow = table.locator('tr', { hasText: 'Residential Unit ID Sign' }).first();
  await expect(unitRow).toContainText('103 signs');
  await expect(unitRow).toContainText('$60.00');
  await expect(unitRow).toContainText('$6,180.00');
  await expect(unitRow).toContainText(/Auto-priced/);
  // Per-character conversion: 1 set → 11 characters × $50.
  const buildingId = table.locator('tr', { hasText: 'Building ID' }).first();
  await expect(buildingId).toContainText('11 characters');
  await expect(buildingId).toContainText('$550.00');
  // Address: project price $250 on the takeoff conflicts with the $225 rule → office question.
  const address = table.locator('tr', { hasText: 'Building Address' }).first();
  await expect(address).toContainText(/Office question/);
  await expect(address).toContainText('12 characters');
  // Ambiguous stairwell sign → office question, unpriced.
  await expect(table.locator('tr', { hasText: 'Stairwell ID Sign' }).first()).toContainText(/Office question/);
  // Monument: nothing to go on → question.
  await expect(table.locator('tr', { hasText: 'Monument Sign' }).first()).toContainText(/Office question/);
  // Headings never became lines (they only appear as the section a line came from).
  const itemNames = await table.locator('.item-name').allInnerTexts();
  expect(itemNames).not.toContain('Interior Signage');
  expect(itemNames).not.toContain('Second Floor');
  expect(itemNames).not.toContain('Building A');
  expect(itemNames.some((n) => /subtotal|total investment|sales tax/i.test(n))).toBe(false);
  expect(itemNames).toHaveLength(8);
  // Explanation panel.
  await buildingId.getByRole('button', { name: /explain/i }).click();
  await expect(page.getByText(/converted to a character count/i)).toBeVisible();
  await shot(page, '03-review-pricing');
  await page.getByRole('button', { name: /^Continue →$/ }).first().click();

  // ---- Step 4: office questions ----
  await expect(page.getByRole('heading', { name: /resolve only the items that affect price/i })).toBeVisible();
  const conflict = page.locator('.qcard', { hasText: 'Building Address — pricing conflict' }).first();
  await expect(conflict).toContainText(/\$225\.00/);
  await expect(conflict).toContainText(/\$250\.00/);
  await shot(page, '04a-office-questions-open');
  // Dev login is an admin: pick "Use the price on the takeoff (project-specific)" and give a reason.
  await conflict.locator('.choice', { hasText: '$250.00' }).click();
  await conflict.locator('input[id^="note-"]').fill('Approved project rate per bid email');
  await conflict.getByRole('button', { name: /save answer/i }).click();
  // Once answered, the card leaves the open list and the decision shows in the history table.
  const history = page.locator('.card', { hasText: 'Resolved decision history' });
  await expect(history).toContainText('Approved project rate per bid email', { timeout: 30_000 });
  await expect(page.locator('.qcard', { hasText: 'Building Address — pricing conflict' })).toHaveCount(0, { timeout: 30_000 });
  // Ambiguous stairwell → choose the 12x18 sign.
  const stair = page.locator('.qcard', { hasText: 'Stairwell ID Sign — which standard sign applies?' }).first();
  await stair.locator('.choice', { hasText: 'Stairwell ID Sign 12x18' }).click();
  await stair.getByRole('button', { name: /save answer/i }).click();
  await expect(history).toContainText('Stairwell ID Sign 12x18', { timeout: 30_000 });
  // Building ID: the takeoff says acrylic, the standard sign is PVC → confirm the standard sign.
  const bidQ = page.locator('.qcard', { hasText: 'Building ID — confirm the standard sign' }).first();
  await bidQ.locator('.choice').first().click();
  await bidQ.getByRole('button', { name: /save answer/i }).click();
  await expect(page.locator('.qcard', { hasText: 'Building ID — confirm the standard sign' })).toHaveCount(0, { timeout: 30_000 });
  // Monument → exclude (not a sign line for this bid).
  const monument = page.locator('.qcard', { hasText: 'Monument Sign — no standard sign or price' }).first();
  await monument.locator('.choice', { hasText: 'Not a sign line' }).click();
  await monument.getByRole('button', { name: /save answer/i }).click();
  await expect(page.locator('.qcard', { hasText: 'Monument Sign — no standard sign or price' })).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByText(/No open office questions/)).toBeVisible({ timeout: 30_000 });
  await shot(page, '04-office-questions');
  await page.getByRole('button', { name: /continue to design/i }).first().click();

  // ---- Step 5: design ----
  await expect(page.getByRole('heading', { name: /estimate design and file preparation/i })).toBeVisible();
  await page.fill('#unique-layouts', '8');
  await page.fill('#variable-sets', '2');
  await page.fill('#design-hours', '12');
  await expect(page.locator('.calc-result strong')).toContainText('$1,800.00');
  await page.getByRole('button', { name: /include design/i }).click();
  await expect(page.getByText(/Design line saved/)).toBeVisible({ timeout: 30_000 });
  await shot(page, '05-design');
  await page.getByRole('button', { name: /continue to installation/i }).first().click();

  // ---- Step 6: installation ----
  await expect(page.getByRole('heading', { name: /estimate installation from the actual site work/i })).toBeVisible();
  await page.getByRole('button', { name: /price by day/i }).click();
  await page.fill('#install-amount', '4.5');
  await expect(page.locator('.calc-result strong')).toContainText('$12,600.00');
  await expect(page.getByText(/4\.5 days × \$2,800\.00 per 8-hour day/)).toBeVisible();
  await page.getByRole('button', { name: /include installation/i }).click();
  await expect(page.getByText(/Installation line saved/)).toBeVisible({ timeout: 30_000 });
  await shot(page, '06-installation');
  await page.getByRole('button', { name: /final review/i }).first().click();

  // ---- Step 7: estimate + QBME ----
  await expect(page.getByRole('heading', { name: /ready estimate and quickbooks output/i })).toBeVisible();
  const sheet = page.locator('.estimate-sheet');
  await expect(sheet).toContainText('Harriman, NY 10926');
  await expect(sheet).toContainText('845-238-0478');
  await expect(sheet).not.toContainText('407-');
  await expect(sheet).not.toContainText(/Florida/);
  await expect(sheet).toContainText('PO-2026-0451');
  await expect(sheet).toContainText('Residential Unit ID Signs');
  await expect(sheet).toContainText('Design');
  await expect(sheet).toContainText('Installation');
  await expect(sheet).toContainText(/Sales Tax \(8\.125%\)/);

  const qbme = await page.locator('#qbme-output').innerText();
  const lines = qbme.split('\n');
  expect(lines[0]).toBe('QB_ESTIMATE_START');
  expect(lines[lines.length - 1]).toBe('QB_ESTIMATE_END');
  const body = lines.slice(1, -1);
  // 7 sign lines (monument excluded) + design + installation = 9, one per estimate line.
  expect(body).toHaveLength(9);
  const allowed = new Set(['Wrapping', 'Sales', '3D Lettering', 'Design', 'Shipping', 'Installation', 'Channel Letters', 'Canopy']);
  let sum = 0;
  for (const raw of body) {
    expect(raw.startsWith('Line=')).toBe(true);
    expect(raw.endsWith('|')).toBe(true);
    const f = raw.slice(5).split('|');
    expect(f).toHaveLength(5);
    expect(allowed.has(f[0]!)).toBe(true);
    expect(f[4]).toBe(''); // AMOUNT empty
    expect(Number.isFinite(Number(f[2]))).toBe(true);
    expect(Number.isFinite(Number(f[3]))).toBe(true);
    sum += Math.round(Number(f[2]) * Number(f[3]) * 100);
  }
  expect(qbme).toContain('Line=3D Lettering|');
  expect(qbme).toContain('Line=Channel Letters|');
  expect(qbme).toContain('Line=Design|');
  expect(qbme).toContain('Line=Installation|');
  expect(qbme).not.toMatch(/tax/i);
  expect(qbme).not.toContain(RUN); // no customer / estimate number in the block
  // Reconciliation with the pre-tax subtotal:
  // 103×60 + 46×50 + 140×50 + 36×50 + 12×65 + 11×50 + 12×250 + 12×150 + 4.5×2800
  const expected = 618000 + 230000 + 700000 + 180000 + 78000 + 55000 + 300000 + 180000 + 1260000;
  expect(sum).toBe(expected);
  await expect(page.getByText(/reconciles with the pre-tax subtotal/)).toBeVisible();
  const cardTotal = await page.locator('.grand strong').innerText();
  expect(cardTotal).toBe(`$${((expected * 1.08125) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  await shot(page, '07-final-review');
  // The customer estimate and the QBME panel are taller than the viewport and
  // live inside the app's inner scroller — capture them by scrolling to each
  // and taking a full-page shot rather than an element shot (which would clip).
  await page.locator('.estimate-sheet').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, '08-customer-estimate.png'), fullPage: true });
  await page.locator('.qbme-card').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, '09-qbme.png'), fullPage: true });

  // Copy QBME (clipboard may be unavailable headless — button must not throw).
  await page.getByRole('button', { name: /copy qbme/i }).first().click();

  // ---- Leave and resume from the Estimates list ----
  await page.goto('/estimates');
  const row = page.locator('a', { hasText: `${RUN} Azura Phase 1` }).first();
  await expect(row).toBeVisible();
  await expect(page.getByText(/Bid · step 7 of 7/).first()).toBeVisible();
  await page.goto(`/estimates/${estimateId}/bid`);
  await expect(page.getByRole('heading', { name: /ready estimate and quickbooks output/i })).toBeVisible();
  // Prior files, decisions and calculations are all still there.
  await page.getByRole('button', { name: /upload files/i }).click();
  await expect(page.getByText(/bid-azura-takeoff\.xlsx/)).toBeVisible();
  await page.getByRole('button', { name: /ask the office/i }).click();
  await expect(page.getByText(/Approved project rate per bid email/)).toBeVisible();

  // ---- Existing surfaces still work for this estimate ----
  await page.goto(`/estimates/${estimateId}/qbme`);
  await expect(page.getByText(/one QBME line per customer estimate line/i)).toBeVisible();
  await expect(page.getByText(/Reconciled/)).toBeVisible();
  await page.goto(`/estimates/${estimateId}/preview`);
  await expect(page.locator('body')).toContainText('Harriman, NY 10926');
  const pdf = await page.request.get(`/estimates/${estimateId}/preview/pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()['content-type']).toContain('application/pdf');
  await page.goto(`/estimates/${estimateId}`);
  await expect(page.getByText(/Bid Estimator estimate/)).toBeVisible();
  await expect(page.getByText(/edit in the workflow/i).first()).toBeVisible();
});
