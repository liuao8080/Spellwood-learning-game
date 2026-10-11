import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { startPassiveFrameDiagnostics } from '../scripts/passive-frame-diagnostics.mjs';

function fixture(supported = ['longtask', 'long-animation-frame'], fail = false) {
  const instances = [];
  class Observer {
    static supportedEntryTypes = supported;
    constructor(callback) { this.callback = callback; this.pending = []; this.disconnected = false; instances.push(this); }
    observe(options) { if (fail) throw new Error('unsupported observer'); this.options = options; }
    takeRecords() { const records = this.pending; this.pending = []; return records; }
    disconnect() { this.disconnected = true; }
  }
  const context = vm.createContext({ PerformanceObserver: Observer, performance: { now: () => 100 } });
  vm.runInContext(`(${startPassiveFrameDiagnostics.toString()})()`, context);
  return { instances, finish: () => JSON.parse(JSON.stringify(context.__passiveFrameDiagnostics.finish())) };
}

test('records only bounded numeric timeline fields, excludes attribution and prior entries', () => {
  const f = fixture();
  f.instances[0].callback({ getEntries: () => [{ startTime: 90, duration: 99 }, { startTime: 120, duration: 60, name: 'secret', attribution: [{ name: 'private URL' }] }] });
  f.instances[1].pending = [{ startTime: 150, duration: 300, blockingDuration: 220, renderStart: 160, styleAndLayoutStart: 170,
    scripts: [{ duration: 60, forcedStyleAndLayoutDuration: 5, sourceURL: 'private', invoker: 'secret' }] }];
  const result = f.finish();
  assert.equal(result.entries.length, 2);
  assert.deepEqual(result.entries[0], { type: 'longtask', elapsedMs: 20, durationMs: 60 });
  assert.equal(result.entries[1].scriptDurationMs, 60);
  assert.equal(result.entries[1].forcedStyleAndLayoutMs, 5);
  assert(!JSON.stringify(result).includes('private')); assert(!JSON.stringify(result).includes('secret'));
  assert(f.instances.every(value => value.disconnected && value.options.buffered === false));
  assert.deepEqual(f.finish().entries, result.entries);
});
test('unsupported and failed observation stay explicit instead of reporting no stalls', () => {
  assert.deepEqual(fixture([]).finish().support, { longtask: 'unsupported', 'long-animation-frame': 'unsupported' });
  assert.deepEqual(fixture(undefined, true).finish().support, { longtask: 'failed', 'long-animation-frame': 'failed' });
});
test('entry cap bounds memory', () => {
  const f = fixture();
  f.instances[0].callback({ getEntries: () => Array.from({ length: 200 }, (_, i) => ({ startTime: 100 + i, duration: 60 })) });
  assert.equal(f.finish().entries.length, 96);
});
