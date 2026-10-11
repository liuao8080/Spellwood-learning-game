import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { adaptLocalActorCleanup } from './cleanup.mjs';

const sha256 = value => createHash('sha256').update(value).digest('hex');

/** Make a transport-only copy at the same depth as tests/e2e. The original
 * tests and their CI-only fixture stay untouched. No assertion is rewritten.
 */
export function prepareLocalSuite(root, runId) {
  const sourceDirectory = path.join(root, 'tests/e2e');
  const directory = path.join(root, 'test-results/local-suite');
  const evidenceRelative = `test-results/local-browser-evidence/${runId}`;
  const port = Number(process.env.SPELLWOOD_LOCAL_PORT || 4184);
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 4173)
    throw new Error('Use a distinct unprivileged local test port; 4173 is reserved for manual play.');
  const evidenceDirectory = path.join(root, evidenceRelative);
  mkdirSync(directory, { recursive: true });
  mkdirSync(evidenceDirectory, { recursive: true });
  const manifestFile = path.join(evidenceDirectory, 'source-manifest.json');
  const existingManifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : null;
  if (!existingManifest) {
    for (const name of readdirSync(directory).filter(name => name.endsWith('.mjs'))) unlinkSync(path.join(directory, name));
  }
  const sources = [];
  for (const file of readdirSync(sourceDirectory).filter(name => name.endsWith('.mjs')).sort()) {
    const source = readFileSync(path.join(sourceDirectory, file), 'utf8');
    let generated = source.replaceAll('test-results/browser-evidence', evidenceRelative)
      .replaceAll('http://127.0.0.1:4173', `http://127.0.0.1:${port}`)
      .replaceAll('127\\.0\\.0\\.1:4173', `127\\.0\\.0\\.1:${port}`);
    if (/127(?:\\)?\.0(?:\\)?\.0(?:\\)?\.1:4173/.test(generated))
      throw new Error('An original CI origin remains in the generated local suite.');
    if (file === 'helpers.mjs') {
      generated = generated
        .replace("from '@playwright/test'", "from '../../tests/local/fixture.mjs'")
        .replace("from '../../scripts/e2e-server.mjs'", "from '../../tests/local/server.mjs'");
      generated = adaptLocalActorCleanup(generated);
    }
    if (!existingManifest) writeFileSync(path.join(directory, file), generated);
    sources.push({ file: `tests/e2e/${file}`, sha256: sha256(source), generatedSha256: sha256(generated) });
  }
  const localSpecifications = [];
  // Supplemental native-motion evidence has its own isolated 4185 config and
  // operator answer step; keep it separate from this acceptance suite.
  for (const name of readdirSync(path.join(root, 'tests/local')).filter(name => name.endsWith('.spec.mjs') && name !== 'motion-evidence.spec.mjs').sort()) {
    const file = `tests/local/${name}`;
    const source = readFileSync(path.join(root, file), 'utf8');
    if (!existingManifest) writeFileSync(path.join(directory, name), source);
    localSpecifications.push({ file, sha256: sha256(source) });
  }
  // Porcelain status starts with significant spaces; retain them before slice(3).
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trimEnd();
  const productSources = git(['ls-files', '--cached', '--others', '--exclude-standard', 'src', 'server']).split('\n').filter(Boolean)
    .map(file => ({ file, sha256: sha256(readFileSync(path.join(root, file))) }));
  const localInfrastructure = ['playwright.local.config.mjs', ...readdirSync(path.join(root, 'tests/local')).filter(name => name.endsWith('.mjs')).sort().map(name => `tests/local/${name}`)]
    .map(file => ({ file, sha256: sha256(readFileSync(path.join(root, file))) }));
  const selectedClientRoot = path.resolve(process.env.SPELLWOOD_LOCAL_CLIENT_DIST || path.join(root, 'client-dist'));
  const builtApplicationFile = path.join(selectedClientRoot, 'app.js');
  const builtApplicationSha256 = sha256(readFileSync(builtApplicationFile));
  if (existingManifest) {
    if (existingManifest.builtApplicationSha256 !== builtApplicationSha256 ||
        JSON.stringify(existingManifest.productSources) !== JSON.stringify(productSources) ||
        JSON.stringify(existingManifest.localInfrastructure) !== JSON.stringify(localInfrastructure) ||
        JSON.stringify(existingManifest.localSpecifications) !== JSON.stringify(localSpecifications) ||
        JSON.stringify(existingManifest.sources) !== JSON.stringify(sources))
      throw new Error('Product or test source changed during the local run; start a new run for attributable evidence.');
    if (sources.some(item => sha256(readFileSync(path.join(directory, path.basename(item.file)))) !== item.generatedSha256) ||
        localSpecifications.some(item => sha256(readFileSync(path.join(directory, path.basename(item.file)))) !== item.sha256))
      throw new Error('Generated local test modules changed during the run.');
    return { directory, evidenceDirectory };
  }
  const manifest = {
    schema: 1, runId, generatedAt: new Date().toISOString(),
    commit: git(['rev-parse', 'HEAD']), branch: git(['branch', '--show-current']),
    dirtyFiles: git(['status', '--porcelain']).split('\n').filter(Boolean).map(line => line.slice(3)),
    transformations: [
      'Explicit local fixture replaces Playwright base and the CI server import in the helper only',
      'Evidence directory changes from browser-evidence to the unique local run directory',
      'Original fixed CI navigation/error-source origin changes to the isolated local loopback port',
      'Local-only actor teardown bounds redacted screenshots, read-only diagnostics and context close; any cleanup failure remains a failure and owned server cleanup runs before propagation',
    ],
    assertionChanges: 0, motionMaximumFrameGapSeconds: 0.25,
    officialCIConfigSha256: sha256(readFileSync(path.join(root, 'playwright.config.mjs'))),
    officialCIServerSha256: sha256(readFileSync(path.join(root, 'scripts/e2e-server.mjs'))),
    builtApplicationFile: path.relative(root, builtApplicationFile),
    builtApplicationSha256, productSources, localInfrastructure, sources, localSpecifications,
  };
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
  return { directory, evidenceDirectory };
}
