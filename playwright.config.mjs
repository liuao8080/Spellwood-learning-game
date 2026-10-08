import { defineConfig } from '@playwright/test';

if ((process.env.GITHUB_ACTIONS !== 'true' || process.env.SPELLWOOD_BROWSER_CI !== '1') && !process.argv.includes('--list')) {
  throw new Error('Only --list is authorized here. Execute browsers through the GitHub browser-acceptance workflow.');
}

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.mjs',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 90_000,
  globalTimeout: 13 * 60_000,
  expect: { timeout: 12_000 },
  outputDir: './test-results/playwright-internal',
  reporter: [['list'], ['./tests/e2e/safe-reporter.mjs']],
  use: {
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 800 },
    locale: 'zh-CN',
    actionTimeout: 12_000,
    navigationTimeout: 20_000,
    // Recovery codes may briefly be displayed by the real registration UI.
    // Only the explicit, redacted screenshots in helpers.mjs are published.
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
});
