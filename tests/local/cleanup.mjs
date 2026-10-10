import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const failure = code => Object.assign(new Error(`Local browser cleanup: ${code}; see reduced cleanup stage evidence.`), { code });

async function bounded(operation, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation).then(value => ({ status: 'passed', value }), () => ({ status: 'failed' })),
      new Promise(resolve => { timer = setTimeout(() => resolve({ status: 'timedOut' }), timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}

/** Preserve real UI diagnostics and explicit redaction, while bounding only
 * teardown work. A timeout still fails; every owned context is attempted and
 * the owned server is closed in finally before the fixture error propagates.
 */
export async function cleanupLocalActors({ actors, testInfo, diagnostics, safeScreenshot, directory, filename, server, deadlines = {} }) {
  const limits = { screenshot: 5000, diagnostics: 2500, contextClose: 5000, serverClose: 12_000, ...deadlines };
  const records = [], operations = [], failures = [];
  let state = 'running';
  const checkpoint = () => writeFile(path.join(directory, filename), JSON.stringify({
    schema: 1, actors: records, cleanup: { state, operations, failures },
  }, null, 2));
  const persist = async () => {
    try { await checkpoint(); }
    catch { if (!failures.some(item => item.stage === 'evidenceWrite')) failures.push({ stage: 'evidenceWrite', label: 'local-evidence', status: 'failed' }); }
  };
  const measure = async (stage, label, operation) => {
    const record = { stage, label, startedAt: new Date().toISOString(), status: 'running' };
    const start = Date.now(); operations.push(record); await persist();
    const result = await bounded(operation, limits[stage]);
    record.status = result.status; record.durationMs = Date.now() - start;
    if (result.status !== 'passed') failures.push({ stage, label, status: result.status });
    await persist();
    return result;
  };
  try {
    try { await mkdir(directory, { recursive: true }); }
    catch { failures.push({ stage: 'evidenceWrite', label: 'local-evidence', status: 'failed' }); }
    await persist();
    for (const actor of actors) {
      const label = String(actor.label || 'actor').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 100);
      if (testInfo.status !== testInfo.expectedStatus || actor.observed.pageErrorCount)
        await measure('screenshot', label, () => safeScreenshot(actor.page, testInfo, `failure-${label}`));
      const sampled = await measure('diagnostics', label, () => diagnostics(actor));
      records.push(sampled.status === 'passed' ? sampled.value : {
        label, recordIncomplete: true, diagnosticStatus: sampled.status,
        pageErrorCount: actor.observed.pageErrorCount, pageErrors: actor.observed.pageErrors,
      });
      // Save the observations before close, so a browser close stall cannot
      // erase the completed body or mislabel its final page as its first stage.
      await persist();
      await measure('contextClose', label, () => actor.context.close());
    }
  } finally {
    // The actual production-entry process belongs solely to this test. Close
    // it even if diagnostics or a context never return; never reuse another.
    await measure('serverClose', 'owned-server', () => server.close());
    state = failures.length ? 'failed' : 'passed'; await persist();
  }
  if (failures.length) throw failure('LOCAL_ACTOR_CLEANUP_FAILED');
  return records;
}

/** The single shared local-only transformation used by both browser configs.
 * Original CI source and all body/page-error assertions remain unchanged.
 */
export function adaptLocalActorCleanup(source) {
  const original = [
    '    finally {',
    '      await mkdir(evidenceDirectory, { recursive: true });',
    '      const records = [];',
    '      for (const actor of actors) {',
    '        if (testInfo.status !== testInfo.expectedStatus || actor.observed.pageErrorCount)',
    '          await safeScreenshot(actor.page, testInfo, `failure-${actor.label}`).catch(() => {});',
    '        records.push(await diagnostics(actor));',
    '        await actor.context.close();',
    '      }',
    '      await writeFile(path.join(evidenceDirectory, `${slug(testInfo.title)}-observations.json`), JSON.stringify({',
    '        schema: 1, actors: records,',
    '      }, null, 2));',
    "      expect(records.reduce((n, record) => n + record.pageErrorCount, 0), 'Every tested browser flow must finish without unhandled page exceptions').toBe(0);",
    '    }',
  ].join('\n');
  if (source.split(original).length !== 2) throw new Error('The original actor teardown changed; review the explicit local cleanup adaptation.');
  const replacement = [
    '    finally {',
    '      const records = await cleanupLocalActors({ actors, testInfo, diagnostics, safeScreenshot,',
    '        directory: evidenceDirectory, filename: `${slug(testInfo.title)}-observations.json`, server });',
    "      expect(records.reduce((n, record) => n + record.pageErrorCount, 0), 'Every tested browser flow must finish without unhandled page exceptions').toBe(0);",
    '    }',
  ].join('\n');
  return "import { cleanupLocalActors } from '../../tests/local/cleanup.mjs';\n" + source.replace(original, replacement);
}
