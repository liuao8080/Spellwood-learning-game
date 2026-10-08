import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Deliberately excludes error text, DOM snapshots, network bodies and tokens. */
export default class SafeReporter {
  tests = [];
  onTestEnd(test, result) {
    this.tests.push({
      title: test.title,
      status: result.status,
      expectedStatus: test.expectedStatus,
      durationMs: result.duration,
      retry: result.retry,
      location: { file: path.relative(process.cwd(), test.location.file), line: test.location.line },
      errorCount: result.errors.length,
      annotations: test.annotations.filter(item => item.type === 'coverage').map(item => item.description),
    });
  }
  async onEnd(result) {
    if (process.argv.includes('--list')) return;
    const directory = path.resolve('test-results/browser-evidence');
    await mkdir(directory, { recursive: true });
    const suite = (process.env.E2E_SUITE || 'all').replace(/[^a-zA-Z0-9_-]/g, '');
    await writeFile(path.join(directory, `acceptance-${suite}.json`), JSON.stringify({
      schema: 1,
      suite,
      status: result.status,
      generatedAt: new Date().toISOString(),
      commit: process.env.GITHUB_SHA || null,
      environment: 'GitHub standard Ubuntu runner; official Playwright Chromium',
      evidencePolicy: 'Explicit safe screenshots and reduced observations only; no trace, HAR, video, cookies, recovery codes, database or raw network bodies',
      tests: this.tests,
    }, null, 2));
  }
}
