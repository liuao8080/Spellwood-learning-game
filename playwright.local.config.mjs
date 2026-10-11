import { defineConfig } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareLocalSuite } from './tests/local/prepare-suite.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
if (process.cwd() !== root) throw new Error('Run local Playwright from the Spellwood repository root.');
const runId = process.env.SPELLWOOD_LOCAL_RUN_ID || `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
if (!/^[a-zA-Z0-9_-]{1,100}$/.test(runId)) throw new Error('Invalid local run ID');
process.env.SPELLWOOD_LOCAL_RUN_ID = runId;
const { directory, evidenceDirectory } = prepareLocalSuite(root, runId);
process.env.SPELLWOOD_LOCAL_EVIDENCE = evidenceDirectory;
const diagnosticSelection = process.argv.some(argument => /@frame-diagnostic|@draw-diagnostic|@draw-followup/.test(argument));

export default defineConfig({
  testDir: directory,
  testMatch: '**/*.spec.mjs',
  // Independent diagnostics require an explicit --grep selection.
  grepInvert: diagnosticSelection ? undefined : /@frame-diagnostic|@draw-diagnostic|@draw-followup/,
  fullyParallel: false, workers: 1, retries: 0, forbidOnly: true,
  timeout: 90_000, globalTimeout: 13 * 60_000, expect: { timeout: 12_000 },
  outputDir: path.join(root, 'test-results/local-playwright-internal', runId),
  reporter: [['list'], ['./tests/local/safe-reporter.mjs']],
  use: {
    browserName: 'chromium', channel: 'chrome', headless: false,
    launchOptions: {
      chromiumSandbox: true,
      ignoreDefaultArgs: ['--enable-unsafe-swiftshader', '--unsafely-disable-devtools-self-xss-warnings'],
    },
    viewport: { width: 1280, height: 800 }, locale: 'zh-CN',
    actionTimeout: 12_000, navigationTimeout: 20_000,
    trace: 'off', video: 'off', screenshot: 'off',
  },
});
