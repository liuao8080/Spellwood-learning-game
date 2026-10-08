import test from "node:test";
import assert from "node:assert/strict";
import { projectMesh } from "../src/av/geometry.mjs";
test("software 3D crystal and shield projections stay finite under a full rotation", () => {
  for (const kind of ["crystal", "shield"])
    for (let i = 0; i < 36; i++) {
      const faces = projectMesh(kind, 200, 120, 70, (i * Math.PI) / 18, 0.2);
      assert.ok(faces.length > 0 && faces.length <= 8);
      for (const face of faces) {
        assert.ok(face.front);
        assert.ok(face.light >= 0.22 && face.light <= 1.01);
        for (const point of face.points)
          assert.ok(point.every(Number.isFinite));
      }
    }
});
test("mesh projection is deterministic, depth sorted and anchored to the requested target", () => {
  const a = projectMesh("crystal", 200, 120, 70, 0.3, 0.2),
    b = projectMesh("crystal", 240, 150, 70, 0.3, 0.2);
  assert.deepEqual(a, projectMesh("crystal", 200, 120, 70, 0.3, 0.2));
  for (let i = 0; i < a.length; i++) {
    if (i) assert.ok(a[i].z >= a[i - 1].z);
    for (let j = 0; j < a[i].points.length; j++) {
      assert.ok(Math.abs(b[i].points[j][0] - a[i].points[j][0] - 40) < 1e-8);
      assert.ok(Math.abs(b[i].points[j][1] - a[i].points[j][1] - 30) < 1e-8);
    }
  }
});
test("Canvas final frame and cancellation clear their drawn pixels", async () => {
  const { BattleEffects } = await import("../src/av/effects.mjs");
  const oldRAF = globalThis.requestAnimationFrame,
    oldDocument = globalThis.document;
  try {
    let frame;
    const events = [];
    globalThis.requestAnimationFrame = (f) => {
      frame = f;
      return 1;
    };
    globalThis.document = { querySelectorAll: () => [] };
    const fx = new BattleEffects();
    fx.width = 200;
    fx.height = 100;
    fx.fallback = { clearRect: () => events.push("clear") };
    fx.jobs = [
      {
        start: performance.now() - 100,
        duration: 1,
        update: () => events.push("draw"),
        dispose: () => events.push("dispose"),
      },
    ];
    fx.loop();
    frame();
    assert.deepEqual(events, ["clear", "draw", "dispose", "clear"]);
    events.length = 0;
    fx.cancel();
    assert.deepEqual(events, ["clear"]);
  } finally {
    globalThis.requestAnimationFrame = oldRAF;
    globalThis.document = oldDocument;
  }
});
test("music ducking keeps the saved level and a hidden page cannot restart playback", async () => {
  const { AudioDirector } = await import("../src/av/audio.mjs");
  const audio = new AudioDirector();
  let plays = 0;
  audio.unlocked = true;
  audio.music = {
    volume: 0,
    paused: false,
    pause() {
      this.paused = true;
    },
    play() {
      plays++;
      this.paused = false;
      return Promise.resolve();
    },
  };
  audio.sync({ music: true, musicVolume: 40 });
  assert.equal(audio.music.volume, 0.2);
  audio.duckSpeech(true);
  assert.equal(audio.music.volume, 0.05);
  assert.equal(audio.settings.musicVolume, 40);
  audio.visibility(true);
  audio.duckSpeech(false);
  audio.sync({ musicVolume: 60 });
  assert.equal(plays, 0);
  assert.equal(audio.music.paused, true);
  audio.visibility(false);
  assert.equal(plays, 1);
  assert.equal(audio.music.volume, 0.3);
});
test("growth feedback belongs only to the unit whose attack actually increased", async () => {
  const { BattleEffects } = await import("../src/av/effects.mjs");
  const previous = globalThis.document,
    events = [];
  const nodes = new Map();
  for (const id of ["u1", "u2"])
    nodes.set(`[data-target="${id}"]`, {
      getBoundingClientRect: () => ({
        left: id === "u1" ? 20 : 200,
        top: 50,
        width: 80,
        height: 100,
      }),
      animate: () => events.push("pulse"),
    });
  const hero = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 30, height: 30 }),
  };
  globalThis.document = { querySelector: (s) => nodes.get(s) || hero };
  try {
    const fx = new BattleEffects();
    fx.growth = (p, n) => events.push({ x: p.x, amount: n });
    const before = {
      players: [
        { hp: 18, armor: 0, board: [{ uid: "u1", atk: 1, hp: 3 }] },
        { hp: 18, armor: 0, board: [{ uid: "u2", atk: 2, hp: 2 }] },
      ],
    };
    const after = structuredClone(before);
    after.players[0].board[0].atk = 2;
    fx.after(before, after, { type: "end" }, (k) => events.push(k));
    assert.deepEqual(events, [{ x: 60, amount: 1 }, "growth", "pulse"]);
    events.length = 0;
    fx.after(after, after, { type: "end" }, (k) => events.push(k));
    assert.deepEqual(events, []);
    fx.reduced = true;
    events.length = 0;
    fx.after(before, after, { type: "end" }, (k) => events.push(k));
    assert.deepEqual(events, [{ x: 60, amount: 1 }, "growth"]);
  } finally {
    globalThis.document = previous;
  }
});
test("growth uses a short original rising chime and obeys sound disable", async () => {
  const { AudioDirector } = await import("../src/av/audio.mjs");
  const audio = new AudioDirector();
  audio.unlocked = true;
  const notes = [];
  audio.tone = (f, t, d) => notes.push({ f, t, d });
  audio.play("growth");
  assert.equal(notes.length, 3);
  assert.ok(notes.every((n) => n.d === 0.35));
  assert.ok(notes[2].f > notes[0].f);
  audio.settings.sound = false;
  audio.play("growth");
  assert.equal(notes.length, 3);
});
test("a defeated unit damage number fades before neighbors begin moving into its slot", async () => {
  const { BattleEffects, FX_TIMING } = await import("../src/av/effects.mjs");
  const previous = globalThis.document,
    labels = [],
    shifts = [];
  const unit = {
    getBoundingClientRect: () => ({
      left: 60,
      top: 20,
      width: 80,
      height: 100,
    }),
    animate: (frames, options) => shifts.push({ frames, options }),
  };
  const hero = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 20, height: 20 }),
  };
  globalThis.document = {
    querySelector: (s) => (s === '[data-target="u2"]' ? unit : hero),
  };
  try {
    const fx = new BattleEffects();
    fx.positions = {
      u1: { x: 100, y: 70, w: 80, h: 100 },
      u2: { x: 240, y: 70, w: 80, h: 100 },
    };
    fx.label = (p, text, kind, duration) =>
      labels.push({ p, text, kind, duration });
    fx.death = () => {};
    const before = {
      active: 1,
      players: [
        {
          hp: 18,
          armor: 0,
          board: [
            { uid: "u1", atk: 2, hp: 3 },
            { uid: "u2", atk: 2, hp: 2 },
          ],
        },
        { hp: 18, armor: 0, board: [] },
      ],
    };
    const after = structuredClone(before);
    after.players[0].board.shift();
    fx.after(before, after, { type: "play", target: "u1" }, () => {});
    assert.equal(labels.length, 1);
    assert.equal(labels[0].text, "−3");
    assert.equal(labels[0].p.x, 100);
    assert.equal(labels[0].duration, FX_TIMING.deathNumber);
    assert.equal(shifts.length, 1);
    assert.equal(shifts[0].options.easing, "linear");
    assert.equal(shifts[0].frames[1].easing, "ease-out");
    assert.ok(
      labels[0].duration <
        shifts[0].frames[1].offset * shifts[0].options.duration,
    );
  } finally {
    globalThis.document = previous;
  }
});
test("death numbers have matching short visual and removal duration without shortening other feedback", async () => {
  const { BattleEffects, FX_TIMING } = await import("../src/av/effects.mjs");
  const previous = {
    document: globalThis.document,
    setTimeout: globalThis.setTimeout,
  };
  const nodes = [],
    timers = [];
  globalThis.document = {
    createElement: () => ({ style: {}, remove() {} }),
    body: { appendChild: (n) => nodes.push(n) },
  };
  globalThis.setTimeout = (f, ms) => timers.push(ms);
  try {
    const fx = new BattleEffects();
    fx.label(
      { x: 10, y: 20 },
      "−3",
      "damage death-damage",
      FX_TIMING.deathNumber,
    );
    fx.label({ x: 10, y: 20 }, "−2");
    assert.equal(nodes[0].style.animationDuration, "420ms");
    assert.equal(timers[0], 420);
    assert.equal(nodes[1].style.animationDuration, undefined);
    assert.equal(timers[1], 1300);
  } finally {
    Object.assign(globalThis, previous);
  }
});
for (const reduced of [false, true])
  test(`row reflow removes earlier unit labels before they can move onto another portrait (${reduced ? "reduced" : "normal"})`, async () => {
    const { BattleEffects } = await import("../src/av/effects.mjs");
    const previous = {
      document: globalThis.document,
      setTimeout: globalThis.setTimeout,
    };
    const nodes = [],
      timers = [];
    const hero = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 20, height: 20 }),
    };
    const survivor = {
      getBoundingClientRect: () => ({
        left: 60,
        top: 20,
        width: 80,
        height: 100,
      }),
      animate() {},
    };
    globalThis.document = {
      querySelector: (s) => (s === '[data-target="u2"]' ? survivor : hero),
      createElement: () => ({
        style: {},
        dataset: {},
        remove() {
          this.removed = true;
        },
      }),
      body: { appendChild: (n) => nodes.push(n) },
    };
    globalThis.setTimeout = (f, ms) => {
      timers.push({ f, ms });
      return timers.length;
    };
    try {
      const fx = new BattleEffects();
      fx.reduced = reduced;
      fx.death = () => {};
      fx.positions = {
        u1: { x: 100, y: 70, w: 80, h: 100 },
        u2: { x: 240, y: 70, w: 80, h: 100 },
      };
      fx.label({ x: 100, y: 70 }, "−3", "damage", undefined, "u1");
      fx.label({ x: 240, y: 70 }, "+1攻击", "growth", undefined, "u2");
      const before = {
        active: 1,
        players: [
          {
            hp: 18,
            armor: 0,
            board: [
              { uid: "u1", atk: 1, hp: 2 },
              { uid: "u2", atk: 1, hp: 3 },
            ],
          },
          { hp: 18, armor: 0, board: [] },
        ],
      };
      const after = structuredClone(before);
      after.players[0].board.shift();
      fx.after(before, after, { type: "play", target: "u1" }, () => {});
      assert.equal(nodes[0].removed, true);
      assert.equal(nodes[1].removed, true);
      assert.equal(fx.labels.size, reduced ? 0 : 1);
      if (!reduced) assert.equal(nodes[2].dataset.fxOwner, "u1");
      timers[0].f();
      timers[1].f();
      assert.equal(fx.labels.size, reduced ? 0 : 1);
    } finally {
      Object.assign(globalThis, previous);
    }
  });
