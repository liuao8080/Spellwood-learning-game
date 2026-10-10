import test from 'node:test';
import assert from 'node:assert/strict';
import { MELEE_PHASES, playMeleeSequence } from '../src/arena3d/melee-sequence.mjs';

for (const interval of [16, 33, 120, 633, 2000]) test(`melee preserves contact and return at ${interval}ms simulated frame intervals`, async () => {
  const poses = [], durations = [], hits = []; let now = 0;
  await playMeleeSequence({ isCurrent: () => true, setPose: pose => poses.push({ ...pose, now }), impact: () => hits.push(poses.at(-1)),
    runPhase: async (duration, update) => {
      durations.push(duration);
      for (let elapsed = interval; ; elapsed += interval) {
        now += interval; update(Math.min(1, elapsed / duration));
        if (elapsed >= duration) break;
      }
    },
  });
  assert.equal(durations.reduce((a,b) => a+b, 0), 740);
  assert.equal(hits.length, 1); assert.equal(hits[0].phase, 'travel'); assert.equal(hits[0].travel, 1);
  assert.deepEqual([...new Set(poses.map(p => p.phase))], MELEE_PHASES.map(p => p.name));
  assert(poses.some(p => p.phase === 'anticipation' && p.travel < -.079), 'even a long frame retains a backwards anticipation pose');
  assert(poses.some(p => p.phase === 'contact' && p.travel === 1));
  assert.equal(poses.at(-1).travel, 0); assert.equal(poses.at(-1).progress, 1);
  assert(now >= 740, 'long frames may extend presentation, never claim a faster clock');
});

for (const cancelPhase of [0, 1, 2, 3]) test(`cancellation in phase ${cancelPhase} schedules no later phases`, async () => {
  let current = true, phases = 0, hits = 0; const poses = [];
  const result = await playMeleeSequence({ isCurrent: () => current, setPose: pose => poses.push(pose), impact: () => hits++,
    runPhase: async (_duration, update) => {
      const phase = phases++;
      if (phase === cancelPhase) { current = false; update(1); }
      else update(1);
    },
  });
  assert(result.cancelled); assert.equal(phases, cancelPhase + 1);
  assert.equal(hits, cancelPhase >= 2 ? 1 : 0);
  assert.equal(poses.length, cancelPhase);
});

test('repeated final frame never emits a second impact', async () => {
  let hits = 0;
  await playMeleeSequence({ isCurrent: () => true, setPose() {}, impact: () => hits++,
    runPhase: async (_duration, update) => { update(1); update(1); update(1); } });
  assert.equal(hits, 1);
});

test('rejected scene work propagates without scheduling another phase or impact', async () => {
  let phases = 0, hits = 0;
  await assert.rejects(playMeleeSequence({ isCurrent: () => true, setPose() {}, impact: () => hits++,
    runPhase: async () => { phases++; throw new Error('phase failed'); } }), /phase failed/);
  assert.equal(phases, 1); assert.equal(hits, 0);
});
