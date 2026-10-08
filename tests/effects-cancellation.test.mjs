import test from "node:test";
import assert from "node:assert/strict";
import { BattleEffects } from "../src/av/effects.mjs";

for (const action of [
  { type: "attack" },
  { type: "play" },
  { type: "power", kind: "spark" },
]) {
  test(`leaving during ${action.type} travel cannot create a late impact or sound`, async () => {
    const previous = globalThis.document;
    globalThis.document = { querySelectorAll: () => [] };
    try {
      const fx = new BattleEffects();
      let release;
      const events = [];
      const traveling = new Promise((r) => (release = r));
      fx.capture = () => ({
        source: {},
        a: { x: 10, y: 10 },
        b: { x: 20, y: 20 },
      });
      fx.lunge = () => traveling;
      fx.projectile = () => traveling;
      for (const name of ["glow", "ring", "burst"])
        fx[name] = () => events.push(name);
      const done = fx.before({}, action, { keyword: "damage" }, (kind) =>
        events.push(kind),
      );
      assert.ok(events.includes(action.type === "attack" ? "attack" : "spark"));
      fx.cancel();
      events.length = 0;
      release();
      await done;
      assert.deepEqual(events, []);
    } finally {
      globalThis.document = previous;
    }
  });
}
test("leaving a victory cancels future confetti, while the next victory still works", () => {
  const previous = {
    document: globalThis.document,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    innerWidth: globalThis.innerWidth,
    innerHeight: globalThis.innerHeight,
  };
  globalThis.innerWidth = 1000;
  globalThis.innerHeight = 700;
  const timers = new Map();
  let id = 0;
  globalThis.document = { querySelectorAll: () => [] };
  globalThis.setTimeout = (f) => {
    const key = ++id;
    timers.set(key, () => {
      timers.delete(key);
      f();
    });
    return key;
  };
  globalThis.clearTimeout = (key) => timers.delete(key);
  try {
    const fx = new BattleEffects();
    let bursts = 0;
    fx.burst = () => bursts++;
    fx.victory();
    const stale = [...timers.values()];
    fx.cancel();
    for (const f of stale) f();
    assert.equal(bursts, 0);
    assert.equal(timers.size, 0);
    fx.victory();
    for (const f of [...timers.values()]) f();
    assert.equal(bursts, 6);
    assert.equal(timers.size, 0);
  } finally {
    Object.assign(globalThis, previous);
  }
});
test("canceling a forward lunge restores the original unit visibility", () => {
  const previous = globalThis.document;
  globalThis.document = { querySelectorAll: () => [] };
  try {
    const fx = new BattleEffects();
    let canceled = 0,
      removed = 0;
    const original = { style: { visibility: "hidden" } };
    fx.flight = {
      original,
      wrapper: {
        getAnimations: () => [{ cancel: () => canceled++ }],
        remove: () => removed++,
      },
    };
    fx.cancel();
    assert.equal(original.style.visibility, "");
    assert.equal(canceled, 1);
    assert.equal(removed, 1);
    assert.equal(fx.flight, null);
  } finally {
    globalThis.document = previous;
  }
});
