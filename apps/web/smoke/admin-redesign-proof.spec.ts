import { expect, test } from '@playwright/test';
import { randomBytes, createHash } from 'node:crypto';
import { prisma, Role } from '@bvisible/db';
import { loadSmokeEnvFromFile } from './load-smoke-env';

const routes: ReadonlyArray<{ path: string; heading: RegExp; screenshot: string }> = [
  { path: '/admin/users', heading: /^Users$/, screenshot: 'admin-users.png' },
  { path: '/admin/email-ingestion', heading: /^Email ingestion$/, screenshot: 'admin-email-ingestion.png' },
  { path: '/admin/ocr-review', heading: /^Receipt OCR review$/, screenshot: 'admin-receipt-ocr.png' },
  { path: '/admin/reconciliation', heading: /^PO reconciliation inbox$/, screenshot: 'admin-po-reconciliation.png' },
  { path: '/admin/tenants', heading: /^Company settings$/, screenshot: 'admin-company-settings.png' },
  { path: '/admin/email-ingestion/inboxes', heading: /^Email inboxes$/, screenshot: 'admin-inboxes.png' },
  { path: '/settings/email-test', heading: /^Email test$/, screenshot: 'settings-email-test.png' },
];

test.describe.serial('admin redesign proof', () => {
  test('redesigned admin routes render and capture screenshots', async ({ page }) => {
    const session = await createProofSession();
    const origin = new URL(process.env.BVISIBLE_BASE_URL?.trim() || 'http://127.0.0.1:3000').origin;

    await page.context().addCookies([
      {
        name: 'bv_session',
        value: session.token,
        url: origin,
        httpOnly: true,
        sameSite: 'Lax',
        expires: Math.floor(session.expiresAt.getTime() / 1000),
      },
    ]);

    for (const route of routes) {
      await page.goto(route.path);
      await expect(page.getByRole('heading', { level: 1, name: route.heading })).toBeVisible({
        timeout: 45_000,
      });
      await expect(page.locator('.rounded-\\[24px\\]').first()).toBeVisible({ timeout: 20_000 });
      await page.screenshot({
        path: `test-results/admin-redesign/${route.screenshot}`,
        fullPage: true,
      });
    }

    await prisma.session.updateMany({
      where: { tokenHash: session.tokenHash },
      data: { revokedAt: new Date() },
    });
  });
});

async function createProofSession() {
  loadSmokeEnvFromFile();
  const user = await prisma.user.findFirst({
    where: { role: Role.SUPER_ADMIN, disabledAt: null },
    select: { id: true },
  });
  if (!user) throw new Error('[admin-redesign-proof] No active SUPER_ADMIN user found.');

  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt,
      userAgent: 'admin-redesign-proof',
    },
  });

  return { token, tokenHash, expiresAt };
}
