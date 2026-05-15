import { defineConfig, devices } from '@playwright/test';

/**
 * Browser smoke — see smoke/core-workflow.spec.ts and docs/ai-context/DEBUGGING.md.
 * Screenshots/traces off by default so quote URLs are not persisted accidentally.
 */
const baseURL = process.env.BVISIBLE_BASE_URL?.trim() || 'http://127.0.0.1:3000';

export default defineConfig({
  testDir: './smoke',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    actionTimeout: 25_000,
    navigationTimeout: 45_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
