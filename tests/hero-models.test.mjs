import test from "node:test";
import assert from "node:assert/strict";
import { Vector3, Box3 } from "three";
import {
  ALL_HERO_SKINS,
  HERO_SKINS,
  HERO_SKIN,
  DEFAULT_HERO_SKIN,
} from "../src/hero-skins.mjs";
import { createHeroModel } from "../src/arena3d/hero-models.mjs";
const visible = (model) =>
  model.root.children.filter((o) => o.isMesh && o.material.visible);
const expected = [
  "leaf_ranger",
  "mushroom_keeper",
  "acorn_captain",
  "butterfly_scholar",
  "rain_traveler",
  "coral_listener",
  "river_boatkeeper",
  "snow_postkeeper",
  "ember_apprentice",
  "lantern_festival",
  "sun_clockmaker",
  "phoenix_courier",
  "moon_librarian",
  "star_cartographer",
  "cloud_pilot",
  "crystal_mason",
  "paper_adventurer",
  "tea_alchemist",
  "copper_gardener",
  "aurora_storyteller",
];
const within = (actual, want, tolerance = 1e-6) =>
  assert.ok(
    Math.abs(actual - want) <= tolerance,
    `${actual} is close to ${want}`,
  );
test("catalogue preserves all reward IDs, separate default, immutable cosmetic-only metadata", () => {
  assert.deepEqual(
    HERO_SKINS.map((s) => s.id),
    expected,
  );
  assert.equal(DEFAULT_HERO_SKIN, "forest_apprentice");
  assert.equal(ALL_HERO_SKINS.length, 21);
  assert.equal(Object.keys(HERO_SKIN).length, 21);
  for (const s of ALL_HERO_SKINS) {
    assert.ok(Object.isFrozen(s));
    assert.ok(["nature", "water", "fire", "arcane"].includes(s.element));
    assert.equal(s.element, s.visualElement);
    for (const forbidden of [
      "atk",
      "hp",
      "cost",
      "crit",
      "armor",
      "price",
      "probability",
      "rarity",
    ])
      assert.ok(!(forbidden in s));
  }
});
for (const quality of ["low", "medium", "high"])
  for (const skin of ALL_HERO_SKINS)
    test(`${skin.id} ${quality}: finite solid geometry, three surfaces and independent LOD limit`, () => {
      const model = createHeroModel(skin.id, { quality });
      try {
        assert.equal(model.skinId, skin.id);
        assert.equal(model.metrics.meshes, 3);
        assert.equal(visible(model).length, 3);
        assert.ok(
          model.metrics.triangles <= skin.budgets[quality],
          `${model.metrics.triangles} <= ${skin.budgets[quality]}`,
        );
        const box = new Box3();
        for (const mesh of visible(model)) {
          const g = mesh.geometry;
          assert.equal(g.groups.length, 0);
          assert.equal(Array.isArray(mesh.material), false);
          assert.equal(mesh.material.transparent, false);
          assert.ok(mesh.material.userData.cpuSmooth);
          assert.ok(g.index);
          assert.ok(g.boundingBox);
          box.union(g.boundingBox);
          for (const attr of Object.values(g.attributes))
            for (const value of attr.array) assert.ok(Number.isFinite(value));
          assert.equal(g.attributes.position.count, g.attributes.normal.count);
          assert.equal(g.attributes.position.count, g.attributes.color.count);
          for (let i = 0; i < g.attributes.normal.count; i++) {
            const x = g.attributes.normal.getX(i),
              y = g.attributes.normal.getY(i),
              z = g.attributes.normal.getZ(i);
            assert.ok(
              x * x + y * y + z * z > 0.8 && x * x + y * y + z * z < 1.2,
            );
          }
        }
        assert.ok(box.max.x - box.min.x <= 2.1);
        assert.ok(box.max.z - box.min.z <= 1.2);
        assert.ok(box.max.y <= 2.65);
        within(box.min.y, -0.07);
        assert.deepEqual(model.pickProxy.position.toArray(), [0, 1.05, 0]);
        assert.equal(model.pickProxy.geometry.parameters.width, 1.25);
        assert.equal(model.pickProxy.geometry.parameters.height, 2.1);
        assert.equal(model.pickProxy.geometry.parameters.depth, 1);
        assert.equal(model.pickProxy.material.visible, false);
        assert.ok(model.pickProxy.userData.pickProxy);
      } finally {
        model.dispose();
        model.dispose();
        assert.equal(model.disposed, true);
      }
    });
test("all eight poses bake into ordinary CPU-readable buffers, reset exactly, and keep fixed anchors/proxy/placement", () => {
  for (const skin of ALL_HERO_SKINS) {
    const model = createHeroModel(skin.id, { quality: "low" }),
      meshes = visible(model),
      bind = meshes.map((m) => m.geometry.attributes.position.array.slice());
    model.root.position.set(4, 0.2, -3);
    model.root.rotation.y = 0.12;
    const fixed = Object.fromEntries(
      ["feet", "impact", "label"].map((k) => [
        k,
        model.anchors[k].position.toArray(),
      ]),
    );
    const attrs = meshes.map((m) => [
      m.geometry.attributes.position,
      m.geometry.attributes.normal,
    ]);
    for (const action of [
      "idle",
      "charge",
      "cast",
      "hit",
      "heal",
      "armor",
      "win",
      "lose",
    ])
      for (const p of [0, 0.2, 0.59, 1]) {
        model.applyPose(
          action === "idle"
            ? { idlePhase: p * 3, time: p }
            : { action, progress: p },
        );
        assert.deepEqual(model.root.position.toArray(), [4, 0.2, -3]);
        assert.equal(model.root.rotation.y, 0.12);
        assert.deepEqual(model.pickProxy.position.toArray(), [0, 1.05, 0]);
        for (const [key, value] of Object.entries(fixed))
          assert.deepEqual(model.anchors[key].position.toArray(), value);
        const origin = model.anchors.projectile.position;
        assert.ok(
          origin.x >= 0.35 &&
            origin.x <= 0.62 &&
            origin.y >= 1.2 &&
            origin.y <= 1.65 &&
            origin.z >= 0.32 &&
            origin.z <= 0.68,
        );
        meshes.forEach((m, index) => {
          assert.equal(m.geometry.attributes.position, attrs[index][0]);
          assert.equal(m.geometry.attributes.normal, attrs[index][1]);
          for (const value of m.geometry.attributes.position.array)
            assert.ok(Number.isFinite(value));
          const box = m.geometry.boundingBox;
          assert.ok(box.max.x - box.min.x < 2.11);
          assert.ok(box.max.y <= 2.66);
        });
      }
    model.applyPose({ action: "cast", progress: 0.59 });
    assert.ok(
      meshes.some((m, i) =>
        m.geometry.attributes.position.array.some(
          (n, k) => Math.abs(n - bind[i][k]) > 0.01,
        ),
      ),
    );
    model.reset();
    meshes.forEach((m, i) =>
      assert.deepEqual(m.geometry.attributes.position.array, bind[i]),
    );
    model.applyPose({
      hitProgress: NaN,
      idlePhase: Infinity,
      castProgress: Infinity,
    });
    model.reset();
    model.applyPose({ action: "cast", progress: 0.59, reducedMotion: true });
    meshes.forEach((m, i) =>
      assert.deepEqual(m.geometry.attributes.position.array, bind[i]),
    );
    model.dispose();
  }
});
test("idle geometry updates are limited to 12Hz when the caller supplies seconds", () => {
  const m = createHeroModel();
  try {
    m.applyPose({ time: 0.1, idlePhase: 0.1 });
    const version = visible(m)[0].geometry.attributes.position.version;
    m.applyPose({ time: 0.101, idlePhase: 0.2 });
    assert.equal(visible(m)[0].geometry.attributes.position.version, version);
    m.applyPose({ time: 0.19, idlePhase: 0.3 });
    assert.ok(visible(m)[0].geometry.attributes.position.version > version);
    m.cancel();
  } finally {
    m.dispose();
  }
});
test("unknown skins safely fall back; peer resources and poses stay independent; cleanup is exact and idempotent", () => {
  for (const id of [
    "__old_unknown__",
    "constructor",
    "toString",
    "__proto__",
    null,
    123,
    {},
  ]) {
    const fallback = createHeroModel(id);
    assert.equal(fallback.skinId, DEFAULT_HERO_SKIN);
    fallback.dispose();
  }
  const a = createHeroModel("butterfly_scholar"),
    b = createHeroModel("butterfly_scholar");
  const original = visible(b)[0].geometry.attributes.position.array.slice(),
    materials = visible(b).map((m) => m.material);
  let geometries = 0,
    disposedMaterials = 0;
  a.root.traverse((o) => {
    if (o.isMesh) {
      o.geometry.addEventListener("dispose", () => geometries++);
      o.material.addEventListener("dispose", () => disposedMaterials++);
    }
  });
  a.applyPose({ castProgress: 0.59 });
  a.setVisualState({ damaged: true });
  assert.deepEqual(visible(b)[0].geometry.attributes.position.array, original);
  assert.ok(visible(a).every((m) => !materials.includes(m.material)));
  assert.ok(materials.every((m) => m.emissive.getHex() === 0));
  a.dispose();
  a.dispose();
  a.reset();
  a.applyPose({ castProgress: 0.5 });
  assert.equal(geometries, 4);
  assert.equal(disposedMaterials, 4);
  assert.equal(a.root.children.length, 0);
  assert.equal(b.disposed, false);
  b.dispose();
});
test("all twenty rewards have different authored geometric silhouettes, not palette-only copies", () => {
  const signatures = new Set();
  for (const s of ALL_HERO_SKINS) {
    const m = createHeroModel(s.id, { quality: "low" });
    const body = visible(m)[0].geometry.attributes.position.array;
    let signature = 0;
    for (let i = 0; i < body.length; i++)
      signature = (Math.imul(signature, 31) + Math.round(body[i] * 10000)) | 0;
    signatures.add(`${body.length}:${signature}`);
    m.dispose();
  }
  assert.equal(signatures.size, 21);
});
test("three rounds of switching dispose every created resource without shared geometry or timers", () => {
  let created = 0,
    disposed = 0;
  for (let round = 0; round < 3; round++)
    for (const s of ALL_HERO_SKINS) {
      const m = createHeroModel(s.id, { quality: "low" });
      m.root.traverse((o) => {
        if (o.isMesh) {
          created += 2;
          o.geometry.addEventListener("dispose", () => disposed++);
          o.material.addEventListener("dispose", () => disposed++);
        }
      });
      m.applyPose({ hitProgress: 0.2 });
      m.dispose();
    }
  assert.equal(created, 21 * 3 * 8);
  assert.equal(disposed, created);
});
