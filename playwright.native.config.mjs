import { defineConfig } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareLocalSuite } from './tests/local/prepare-suite.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
if (process.cwd() !== root) throw new Error('Run the native-DPR observation from the repository root.');
const runId = process.env.SPELLWOOD_NATIVE_RUN_ID || `native-dpr-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
if (!/^[a-zA-Z0-9_-]{1,100}$/.test(runId)) throw new Error('Invalid native-DPR run ID.');
process.env.SPELLWOOD_NATIVE_RUN_ID = runId;
process.env.SPELLWOOD_LOCAL_RUN_ID = runId;
process.env.SPELLWOOD_LOCAL_PORT = '4184';
const evidenceDirectory = path.join(root, 'test-results/local-browser-evidence', runId);
process.env.SPELLWOOD_LOCAL_EVIDENCE = evidenceDirectory;
const directory = path.join(root, 'test-results', `native-suite-${runId}`);
const manifestFile = path.join(evidenceDirectory, 'source-manifest.json');
const hash = text => createHash('sha256').update(text).digest('hex');
if (!existsSync(manifestFile)) {
  const generated = prepareLocalSuite(root, runId);
  cpSync(generated.directory, directory, { recursive: true });
  const helperFile = path.join(directory, 'helpers.mjs');
  let helper = readFileSync(helperFile, 'utf8');
  helper = helper.replace('simulateMissingWebGL = false, diagnosticEntry = null, ...contextOptions', 'simulateMissingWebGL = false, diagnosticEntry = null, nativeWindowBounds = null, ...contextOptions');
  helper = helper.replace('      const page = await context.newPage();', `      const page = await context.newPage();
      if (nativeWindowBounds) {
        const nativeSession = await context.newCDPSession(page);
        try {
          const { windowId } = await nativeSession.send('Browser.getWindowForTarget');
          await nativeSession.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal', ...nativeWindowBounds } });
        } finally { await nativeSession.detach(); }
      }`);
  writeFileSync(helperFile, helper);
  const specFile = path.join(directory, 'combat-motion.spec.mjs');
  let spec = readFileSync(specFile, 'utf8');
  const originalActor = "a = await actors('motion-guest-A', { viewport: { width: 844, height: 390 }, reducedMotion: 'no-preference' });";
  if (!spec.includes(originalActor)) throw new Error('Review the original combat setup before applying the native-DPR transport change.');
  spec = spec.replace(originalActor, `a = await actors('motion-guest-A', { viewport: null, nativeWindowBounds: { width: 844, height: 493 }, reducedMotion: 'no-preference' });
      evidence.nativeDesktop = await a.page.evaluate(() => ({ innerWidth, innerHeight, devicePixelRatio,
        screenCss: { width: screen.width, height: screen.height }, viewportSource: 'Native owned desktop window; no device-metrics/DPR override',
        canvases: ['arena','hand-canvas'].map(id => { const canvas = document.getElementById(id), box = canvas.getBoundingClientRect(); return { id, css: {width:box.width,height:box.height}, buffer:{width:canvas.width,height:canvas.height} }; }) }));
      evidence.coverage.viewport = { width: evidence.nativeDesktop.innerWidth, height: evidence.nativeDesktop.innerHeight };
      a.metrics.nativeDesktop = evidence.nativeDesktop;`);
  spec = spec.replace('A uses normal motion at 844x390', 'A uses normal motion in an owned native desktop window at actual OS devicePixelRatio');
  spec = spec.replace("viewport: { width: 844, height: 390 }, otherParticipantReducedMotion", "viewport: null, otherParticipantReducedMotion");
  spec = spec.replace("test('@combat-motion normal", "test('@native-dpr @combat-motion normal");
  spec = spec.replace('    const before = evidence.before = publicState(a)', `    evidence.nativeDesktop.battleReady = await a.page.evaluate(() => ({ innerWidth, innerHeight, devicePixelRatio,
      canvases: ['arena','hand-canvas'].map(id => { const c = document.getElementById(id), r = c.getBoundingClientRect(); return {id,css:{width:r.width,height:r.height},buffer:{width:c.width,height:c.height},qualityLevel:c.dataset.qualityLevel||null,pixelScale:c.dataset.pixelScale||null,shadowMapSize:c.dataset.shadowMapSize||null}; }) }));
    const before = evidence.before = publicState(a)`);
  writeFileSync(specFile, spec);
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  for (const item of manifest.sources) item.generatedSha256 = hash(readFileSync(path.join(directory, path.basename(item.file))));
  manifest.generatedSuiteDirectory = path.relative(root, directory);
  manifest.localInfrastructure.push({ file: 'playwright.native.config.mjs', sha256: hash(readFileSync(fileURLToPath(import.meta.url))) });
  manifest.nativeDesktopProbe = { actualDpr: 'Observed from OS-native window after creation', requestedWindowBounds: { width: 844, height: 493 }, assertionsModified: 0,
    limits: 'Original capture byte/pixel/time limits and 250ms motion gate retained; default production quality retained; B uses original reduced-motion setup' };
  manifest.transformations.push('Supplemental native-DPR A context uses viewport:null and resizes only its owned window before game load; metadata records actual dimensions/DPR. Original combat body assertions are unchanged.');
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
}

export default defineConfig({
  testDir: directory, testMatch: '**/combat-motion.spec.mjs', workers: 1, fullyParallel: false, retries: 0, forbidOnly: true,
  timeout: 120_000, globalTimeout: 5 * 60_000, expect: { timeout: 12_000 },
  outputDir: path.join(root, 'test-results/local-playwright-internal', runId),
  reporter: [['list'], ['./tests/local/safe-reporter.mjs']],
  use: { browserName: 'chromium', channel: 'chrome', headless: false, viewport: { width: 1280, height: 800 }, locale: 'zh-CN',
    launchOptions: { chromiumSandbox: true, ignoreDefaultArgs: ['--enable-unsafe-swiftshader', '--unsafely-disable-devtools-self-xss-warnings'] },
    actionTimeout: 12_000, navigationTimeout: 20_000, trace: 'off', video: 'off', screenshot: 'off' },
});
