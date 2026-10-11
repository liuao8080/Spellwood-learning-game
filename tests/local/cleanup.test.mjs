import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cleanupLocalActors } from './cleanup.mjs';

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'spellwood-cleanup-regression-'));
  const closed = [];
  const actor = label => ({ label, page: {}, observed: { pageErrorCount: 0, pageErrors: [] }, context: { close: async () => closed.push(label) } });
  const options = { actors: [], testInfo: { status: 'passed', expectedStatus: 'passed' },
    diagnostics: async value => ({ label: value.label, pageErrorCount: 0 }), safeScreenshot: async () => {},
    directory, filename: 'observations.json', server: { close: async () => closed.push('owned-server') },
    deadlines: { screenshot: 20, diagnostics: 20, contextClose: 20, serverClose: 20 } };
  return { directory, closed, actor, options, read: async () => JSON.parse(await readFile(path.join(directory, options.filename), 'utf8')),
    dispose: () => rm(directory, { recursive: true, force: true }) };
}

test('a hung close fails, retains completed observations and still closes every other context and the owned server', async () => {
  const f = await fixture();
  try {
    const a = f.actor('first'); a.context.close = () => new Promise(() => {});
    f.options.actors = [a, f.actor('second')];
    await assert.rejects(cleanupLocalActors(f.options), error => error.code === 'LOCAL_ACTOR_CLEANUP_FAILED');
    assert.deepEqual(f.closed, ['second', 'owned-server']);
    const evidence = await f.read();
    assert.equal(evidence.actors.length, 2); assert.equal(evidence.cleanup.state, 'failed');
    assert.deepEqual(evidence.cleanup.failures, [{ stage: 'contextClose', label: 'first', status: 'timedOut' }]);
    assert.equal(evidence.cleanup.operations.at(-1).stage, 'serverClose');
    assert.equal(evidence.cleanup.operations.at(-1).status, 'passed');
  } finally { await f.dispose(); }
});

test('a hung diagnostic fails without blocking context or owned-server cleanup and never invents complete observations', async () => {
  const f = await fixture();
  try {
    f.options.actors = [f.actor('first')]; f.options.diagnostics = () => new Promise(() => {});
    await assert.rejects(cleanupLocalActors(f.options), error => error.code === 'LOCAL_ACTOR_CLEANUP_FAILED');
    assert.deepEqual(f.closed, ['first', 'owned-server']);
    const evidence = await f.read();
    assert.equal(evidence.actors[0].recordIncomplete, true);
    assert.equal(evidence.cleanup.failures[0].stage, 'diagnostics');
  } finally { await f.dispose(); }
});

test('ordinary successful cleanup preserves the diagnostic record and reports no hidden timeout', async () => {
  const f = await fixture();
  try {
    f.options.actors = [f.actor('first')];
    assert.deepEqual(await cleanupLocalActors(f.options), [{ label: 'first', pageErrorCount: 0 }]);
    assert.deepEqual(f.closed, ['first', 'owned-server']);
    const evidence = await f.read(); assert.equal(evidence.cleanup.state, 'passed'); assert.deepEqual(evidence.cleanup.failures, []);
  } finally { await f.dispose(); }
});

test('an evidence-write failure cannot prevent owned-server cleanup', async () => {
  const f = await fixture();
  try {
    f.options.actors = [f.actor('first')]; f.options.filename = 'missing-directory/observations.json';
    await assert.rejects(cleanupLocalActors(f.options), error => error.code === 'LOCAL_ACTOR_CLEANUP_FAILED');
    assert.deepEqual(f.closed, ['first', 'owned-server']);
  } finally { await f.dispose(); }
});
