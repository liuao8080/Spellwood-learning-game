import test from "node:test";
import assert from "node:assert/strict";
import { AdaptiveQualityController } from "../src/arena3d/adaptive-quality.mjs";

function device(options) {
  const controller = new AdaptiveQualityController(options);
  let now = 0;
  const changes = [];
  function frame(frameIntervalMs = 16, renderMs = 8, extra = {}) {
    now += frameIntervalMs;
    const change = controller.sample({ now, frameIntervalMs, renderMs, ...extra });
    if (change) changes.push({ ...change, now });
    return change;
  }
  function frames(count, interval = 16, cost = 8, extra = {}) {
    for (let i = 0; i < count; i++) frame(interval, cost, extra);
  }
  return { controller, changes, frame, frames };
}

test("starts at the requested resolution and leaves a healthy device there", () => {
  const d = device({ baseShadowSize: 2048 });
  assert.deepEqual(d.controller.profile, { level: 0, shadowMapSize: 2048, pixelScale: 1 });
  d.frames(1500);
  assert.deepEqual(d.changes, []);
  assert.equal(d.controller.profile.level, 0);
  assert.equal(Object.isFrozen(d.controller.profile), true);
});

test("sustained measured load lowers shadows before arena resolution, one step at a time", () => {
  const d = device({ baseShadowSize: 2048 });
  d.frames(7, 100, 70);
  assert.equal(d.controller.profile.level, 0, "seven samples cannot change quality");
  assert.deepEqual(d.frame(100, 70), { level: 1, shadowMapSize: 512, pixelScale: 1 });
  d.frames(80, 100, 70);
  assert.deepEqual(d.changes.map(({ level, shadowMapSize, pixelScale }) => ({ level, shadowMapSize, pixelScale })), [
    { level: 1, shadowMapSize: 512, pixelScale: 1 },
    { level: 2, shadowMapSize: 512, pixelScale: .8 },
    { level: 3, shadowMapSize: 512, pixelScale: .65 },
  ]);
  for (let i = 1; i < d.changes.length; i++) assert.ok(d.changes[i].now - d.changes[i - 1].now >= 1500);
});

test("a transient startup/first-use stall does not lower an otherwise healthy device", () => {
  for (const stall of [640, 2000, 20000]) {
    const d = device();
    d.frames(20);
    d.frame(stall, stall);
    d.frames(200);
    assert.equal(d.controller.profile.level, 0);
    assert.deepEqual(d.changes, []);
  }
});

test("frame backpressure outside the render call also drives adaptation", () => {
  const d = device();
  d.frames(100, 80, 2);
  assert.equal(d.controller.profile.level, 3);
});

test("measured render cost can lower quality even when RAF callbacks arrive quickly", () => {
  const d = device();
  d.frames(300, 16, 35);
  assert.equal(d.controller.profile.level, 3);
});

test("occasional long frames and middling performance do not cause oscillation", () => {
  const d = device();
  for (let i = 0; i < 300; i++) d.frame(i % 4 === 0 ? 100 : 16, i % 4 === 0 ? 70 : 8);
  assert.equal(d.controller.profile.level, 0, "less than 60% overloaded samples retain quality");
  d.frames(100, 80, 60);
  const changes = d.changes.length;
  d.frames(1000, 32, 20);
  assert.equal(d.controller.profile.level, 3);
  assert.equal(d.changes.length, changes, "recovery needs genuine headroom");
});

test("sustained headroom restores the complete original quality slowly", () => {
  const d = device({ baseShadowSize: 2048 });
  d.frames(100, 80, 60);
  assert.equal(d.controller.profile.level, 3);
  d.frames(450);
  assert.equal(d.controller.profile.level, 3, "less than eight healthy seconds cannot upgrade");
  d.frames(1400);
  assert.deepEqual(d.changes.map(change => change.level), [1, 2, 3, 2, 1, 0]);
  const recovering = d.changes.slice(3);
  for (let i = 1; i < recovering.length; i++) assert.ok(recovering[i].now - recovering[i - 1].now >= 8000);
  assert.deepEqual(d.controller.profile, { level: 0, shadowMapSize: 2048, pixelScale: 1 });
});

test("a new hitch interrupts the consecutive healthy recovery window", () => {
  const d = device();
  d.frames(10, 80, 60);
  assert.equal(d.controller.profile.level, 1);
  d.frames(420);
  d.frame(640, 640);
  d.frames(420);
  assert.equal(d.controller.profile.level, 1);
  d.frames(160);
  assert.equal(d.controller.profile.level, 0);
});

test("hidden/on-demand frames neither degrade quality nor count toward recovery", () => {
  const d = device();
  d.frames(20, 1000, 500, { active: false });
  assert.equal(d.controller.profile.level, 0);
  d.frames(10, 80, 60);
  assert.equal(d.controller.profile.level, 1);
  d.frames(420);
  d.frame(60000, 0, { active: false });
  d.frames(420);
  assert.equal(d.controller.profile.level, 1, "pause erased previous partial recovery evidence");
});

test("sample reset preserves quality and requires fresh performance evidence", () => {
  const d = device();
  d.frames(10, 80, 60);
  assert.equal(d.controller.profile.level, 1);
  d.controller.resetSamples();
  d.frames(7, 100, 70);
  assert.equal(d.controller.profile.level, 1);
  d.frame(100, 70);
  assert.equal(d.controller.profile.level, 2);
});

test("invalid timings cannot affect quality; a clock discontinuity clears evidence", () => {
  const d = device();
  for (const invalid of [NaN, Infinity, -Infinity]) {
    assert.equal(d.controller.sample({ now: invalid, frameIntervalMs: 80, renderMs: 60 }), null);
    assert.equal(d.controller.sample({ now: 80, frameIntervalMs: invalid, renderMs: 60 }), null);
    assert.equal(d.controller.sample({ now: 80, frameIntervalMs: 80, renderMs: invalid }), null);
  }
  assert.equal(d.controller.sample({ now: 80, frameIntervalMs: 0, renderMs: 60 }), null);
  assert.equal(d.controller.sample({ now: 80, frameIntervalMs: -1, renderMs: 60 }), null);
  assert.equal(d.controller.sample({ now: 80, frameIntervalMs: 80, renderMs: -1 }), null);
  d.frames(7, 100, 70);
  assert.equal(d.controller.sample({ now: 100, frameIntervalMs: 100, renderMs: 70 }), null);
  d.frames(7, 100, 70);
  assert.equal(d.controller.profile.level, 0);
  d.frame(100, 70);
  assert.equal(d.controller.profile.level, 1);
});

test("adaptation never increases a caller's existing shadow-map ceiling", () => {
  const d = device({ baseShadowSize: 256 });
  d.frames(100, 80, 60);
  assert.equal(d.controller.profile.shadowMapSize, 256);
  assert.ok(d.changes.every(change => change.shadowMapSize <= 256));
  for (const value of [0, -1, 1.5, NaN, Infinity, "1024"]) {
    assert.throws(() => new AdaptiveQualityController({ baseShadowSize: value }), RangeError);
  }
});

test("missing measurements cannot bridge two separate healthy periods into recovery", () => {
  const d = device();
  d.frames(10, 80, 60);
  d.frames(420);
  d.frame(60000, NaN);
  d.frames(420);
  assert.equal(d.controller.profile.level, 1);
});

test("a deferred profile's cooldown begins when it is applied, not when requested", () => {
  const controller = new AdaptiveQualityController();
  for (let now = 100; now <= 800; now += 100) controller.sample({ now, frameIntervalMs: 100, renderMs: 70 });
  assert.equal(controller.profile.level, 1);
  // The caller leaves the original profile active while visual jobs run, and
  // does not submit more samples until the deferred level can actually apply.
  controller.resetSamples({ appliedAt: 5000 });
  assert.equal(controller.sample({ now: 5000, frameIntervalMs: 640, renderMs: 300 }), null);
  for (let now = 5100; now <= 6500; now += 100) {
    assert.equal(controller.sample({ now, frameIntervalMs: 100, renderMs: 70 }), null);
  }
  assert.equal(controller.profile.level, 1);
  assert.deepEqual(controller.sample({ now: 6600, frameIntervalMs: 100, renderMs: 70 }),
    { level: 2, shadowMapSize: 512, pixelScale: .8 });
});

test("applying a profile discards previous-quality recovery and crossing-frame samples", () => {
  const controller = new AdaptiveQualityController();
  for (let now = 100; now <= 800; now += 100) controller.sample({ now, frameIntervalMs: 100, renderMs: 70 });
  for (let now = 816; now <= 7520; now += 16) controller.sample({ now, frameIntervalMs: 16, renderMs: 8 });
  assert.equal(controller.profile.level, 1);
  controller.resetSamples({ appliedAt: 8000 });
  assert.equal(controller.sample({ now: 8000, frameIntervalMs: 0, renderMs: 8 }), null);
  assert.equal(controller.sample({ now: 8016, frameIntervalMs: 640, renderMs: 8 }), null);
  for (let now = 8032; now <= 15376; now += 16) {
    assert.equal(controller.sample({ now, frameIntervalMs: 16, renderMs: 8 }), null);
  }
  assert.equal(controller.profile.level, 1, "old healthy windows cannot complete new-profile recovery");
  for (let now = 15392; now <= 16800; now += 16) controller.sample({ now, frameIntervalMs: 16, renderMs: 8 });
  assert.equal(controller.profile.level, 0);
});
