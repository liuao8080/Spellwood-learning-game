import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

/** Retain status and safe coverage only, without arbitrary errors or snapshots. */
export default class LocalSafeReporter {
  tests = [];
  onTestEnd(test, result) {
    this.tests.push({
      title: test.title, status: result.status, expectedStatus: test.expectedStatus,
      durationMs: result.duration, retry: result.retry,
      location: { file: path.basename(test.location.file), line: test.location.line },
      errorCount: result.errors.length,
      annotations: test.annotations.filter(item => item.type === 'coverage').map(item => item.description),
    });
  }
  async onEnd(result) {
    if (process.argv.includes('--list')) return;
    const directory = process.env.SPELLWOOD_LOCAL_EVIDENCE;
    const manifest = JSON.parse(await readFile(path.join(directory, 'source-manifest.json'), 'utf8'));
    const matches = async (file, expected) => {
      try { return createHash('sha256').update(await readFile(file)).digest('hex') === expected; }
      catch { return false; }
    };
    const groupMatches = async items => (await Promise.all(items.map(item => matches(item.file, item.sha256)))).every(Boolean);
    const generatedDirectory = manifest.generatedSuiteDirectory || 'test-results/local-suite';
    const sourceIntegrity = {
      productAndBundleUnchanged: await groupMatches(manifest.productSources) && await matches(manifest.builtApplicationFile || 'client-dist/app.js', manifest.builtApplicationSha256),
      originalE2EUnchanged: await groupMatches(manifest.sources),
      localInfrastructureUnchanged: await groupMatches(manifest.localInfrastructure),
      officialCIUnchanged: await matches('playwright.config.mjs', manifest.officialCIConfigSha256) && await matches('scripts/e2e-server.mjs', manifest.officialCIServerSha256),
      generatedSuiteUnchanged: (await Promise.all([
        ...manifest.sources.map(item => matches(path.join(generatedDirectory, path.basename(item.file)), item.generatedSha256)),
        ...(manifest.localSpecifications || []).map(item => matches(path.join(generatedDirectory, path.basename(item.file)), item.sha256)),
      ])).every(Boolean),
    };
    const attributable = Object.values(sourceIntegrity).every(Boolean);
    await writeFile(path.join(directory, 'acceptance-local.json'), JSON.stringify({
      schema: 1, runId: process.env.SPELLWOOD_LOCAL_RUN_ID, status: attributable ? result.status : 'failed',
      sourceIntegrity, attributable, executionStatus: result.status,
      generatedAt: new Date().toISOString(), commit: manifest.commit, dirtyFiles: manifest.dirtyFiles,
      environment: 'User-authorized local installed Google Chrome, headed; see environment-worker JSON for actual GPU capability',
      evidencePolicy: 'Reduced observations, explicit redacted screenshots and bounded anonymous arena-only clips; no profiles, cookies, DB, HAR, traces or whole-session video',
      motionMaximumFrameGapSeconds: 0.25, tests: this.tests,
    }, null, 2));
    if (!attributable) return { status: 'failed' };
  }
}
