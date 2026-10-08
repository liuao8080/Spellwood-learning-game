import assert from "node:assert/strict";
import test from "node:test";
import { Color, Raycaster, Texture, Vector3 } from "three";
import {
  createModelLibrary,
  SUPPORTED_SPECIES,
} from "../src/arena3d/models.mjs";
import { seededRandom } from "../src/arena3d/model-utils.mjs";
import { CARDS } from "../src/cards.mjs";

function meshes(model) {
  const result = [];
  model.root.traverse((o) => {
    if (o.isMesh && !o.userData.pickProxy) result.push(o);
  });
  return result;
}

for (const quality of ["low", "medium", "high"])
  for (const species of SUPPORTED_SPECIES) {
    test(`${quality} ${species}: finite solid geometry, anchors, foot origin and budget`, () => {
      const library = createModelLibrary({ quality });
      const model = library.createCreature({ species });
      assert.ok(model.root.isGroup);
      assert.ok(Math.abs(model.bounds.min.y) < 1e-6);
      assert.ok(
        model.bounds.max.z - model.bounds.min.z > 0.5,
        "model has real depth",
      );
      assert.ok(model.metrics.triangles < 5000);
      assert.ok(model.metrics.meshes <= 12);
      for (const key of ["feet", "head", "impact", "label", "projectile"])
        assert.ok(model.anchors[key]?.isObject3D);
      assert.ok(model.pickProxy.userData.pickProxy);
      for (const mesh of meshes(model)) {
        assert.ok(mesh.castShadow);
        for (const attr of Object.values(mesh.geometry.attributes)) {
          assert.ok(
            [...attr.array].every(Number.isFinite),
            `${mesh.name} has finite attributes`,
          );
        }
        assert.ok(mesh.geometry.getAttribute("normal"));
        assert.ok(mesh.geometry.getAttribute("color"));
        assert.ok(mesh.geometry.boundingBox);
      }
      library.dispose();
    });
  }

test("arena supplies eight local slot anchors, a real sidewall and compact merged meshes", () => {
  const library = createModelLibrary();
  const arena = library.createArena();
  assert.equal(arena.slots.length, 2);
  assert.equal(arena.slots[0].length, 4);
  assert.equal(arena.slots[1].length, 4);
  assert.ok(arena.bounds.min.y < -0.7);
  assert.ok(arena.bounds.max.y > 1);
  assert.ok(arena.metrics.triangles < 14000);
  assert.ok(arena.metrics.meshes <= 6);
  assert.ok(arena.slots[0].every((a) => a.position.z > 0));
  assert.ok(arena.slots[1].every((a) => a.position.z < 0));
  library.dispose();
});

test("pose never overwrites root placement and cannot inject NaN transforms", () => {
  const library = createModelLibrary();
  const model = library.createCreature({ species: "owl" });
  model.root.position.set(4, 0.2, -3);
  model.root.rotation.y = 0.7;
  model.applyPose({
    idlePhase: 1.5,
    lift: 0.7,
    lean: 0.2,
    attackProgress: 0.5,
  });
  assert.deepEqual(model.root.position.toArray(), [4, 0.2, -3]);
  assert.equal(model.root.rotation.y, 0.7);
  const feet = model.anchors.feet.getWorldPosition(new Vector3());
  assert.ok(feet.y > 0.8);
  model.applyPose({
    idlePhase: NaN,
    lift: Infinity,
    lean: NaN,
    hitProgress: NaN,
  });
  model.root.traverse((o) =>
    assert.ok(
      [...o.position, ...o.scale, ...o.quaternion].every(Number.isFinite),
    ),
  );
  library.dispose();
});

test("inset tabletop remains visibly stone and is not covered by the bronze support plate", () => {
  const library = createModelLibrary();
  const arena = library.createArena();
  arena.root.updateMatrixWorld(true);
  const ray = new Raycaster(new Vector3(0, 4, 0), new Vector3(0, -1, 0));
  const hit = ray.intersectObjects(meshes(arena), false)[0];
  assert.ok(hit);
  assert.equal(hit.object.material.name, "spellwood-matte");
  assert.ok(Math.abs(hit.point.y) < 0.005);
  const attr = hit.object.geometry.getAttribute("color");
  const color = new Color().fromBufferAttribute(attr, hit.face.a);
  assert.equal(color.getHex(), new Color("#355b55").getHex());
  library.dispose();
});

test("visual state and materials are independent for two instances of a species", () => {
  const library = createModelLibrary();
  const a = library.createCreature({ species: "fox" });
  const b = library.createCreature({ species: "fox" });
  const before = meshes(b).map((m) => [
    m.material.color.getHex(),
    m.material.emissive.getHex(),
  ]);
  a.setVisualState({ damaged: true, exhausted: true });
  assert.deepEqual(
    meshes(b).map((m) => [
      m.material.color.getHex(),
      m.material.emissive.getHex(),
    ]),
    before,
  );
  const bMaterials = new Set(meshes(b).map((m) => m.material));
  assert.ok(meshes(a).every((m) => !bMaterials.has(m.material)));
  a.dispose();
  assert.equal(library.activeCount, 1);
  assert.equal(b.disposed, false);
  library.dispose();
});

test("resource disposal is idempotent, disposes all instance geometry and preserves supplied textures", () => {
  const library = createModelLibrary();
  const frontTexture = new Texture(),
    backTexture = new Texture();
  let texturesDisposed = 0;
  frontTexture.addEventListener("dispose", () => texturesDisposed++);
  backTexture.addEventListener("dispose", () => texturesDisposed++);
  const card = library.createCard({ frontTexture, backTexture });
  let geometryDisposals = 0,
    materialDisposals = 0;
  const materials = new Set();
  card.root.traverse((m) => {
    if (!m.isMesh) return;
    m.geometry.addEventListener("dispose", () => geometryDisposals++);
    materials.add(m.material);
  });
  materials.forEach((m) =>
    m.addEventListener("dispose", () => materialDisposals++),
  );
  const expectedGeometries = meshes(card).length + 1;
  assert.ok(card.bounds.max.z - card.bounds.min.z > 0.1);
  card.dispose();
  card.dispose();
  library.dispose();
  library.dispose();
  assert.equal(geometryDisposals, expectedGeometries);
  assert.equal(materialDisposals, materials.size);
  assert.equal(texturesDisposed, 0);
  assert.equal(library.activeCount, 0);
  assert.throws(() => library.createCreature(), /disposed/);
  assert.throws(() => library.createArena(), /disposed/);
});

test("unknown species and unknown quality fail explicitly", () => {
  assert.throws(() => createModelLibrary({ quality: "ultra" }), /quality/);
  const library = createModelLibrary();
  assert.throws(
    () => library.createCreature({ species: "not-a-species" }),
    /Unsupported species/,
  );
  assert.equal(library.activeCount, 0);
  library.dispose();
});

test("all nine creature cards have a supported original solid model", () => {
  const cardSpecies = CARDS.filter((card) => card.type !== "spell")
    .map((card) => card.id)
    .sort();
  assert.deepEqual([...SUPPORTED_SPECIES].sort(), cardSpecies);
});

test("string instance seeds produce stable and distinct resting phases", () => {
  assert.equal(seededRandom("unit-fox-1")(), seededRandom("unit-fox-1")());
  assert.notEqual(seededRandom("unit-fox-1")(), seededRandom("unit-fox-2")());
});

test("sprite eye remains visible beneath its cap at the default three-quarter view", () => {
  const library = createModelLibrary();
  const model = library.createCreature({ species: "sprite" });
  model.applyPose({ idlePhase: 0 });
  const head = model.root.getObjectByName("sprite-cap-and-face");
  const target = new Vector3(0.135, 0.08, 0.41).applyMatrix4(head.matrixWorld);
  const camera = new Vector3(0, 10, 12);
  const ray = new Raycaster(camera, target.clone().sub(camera).normalize());
  const hit = ray.intersectObjects(meshes(model), false)[0];
  assert.equal(hit.object.material.name, "spellwood-eye");
  library.dispose();
});

test("golem chest crystal sits in front of its stone chest rather than inside it", () => {
  const library = createModelLibrary();
  const model = library.createCreature({ species: "golem" });
  model.applyPose({ idlePhase: 0 });
  const body = model.root.getObjectByName("golem-body");
  const target = new Vector3(0, 0.95, 0.47).applyMatrix4(body.matrixWorld);
  const ray = new Raycaster(
    target.clone().add(new Vector3(0, 0, 3)),
    new Vector3(0, 0, -1),
  );
  const hit = ray.intersectObjects(meshes(model), false)[0];
  assert.equal(hit.object.material.name, "spellwood-glow");
  library.dispose();
});

test('thick card art is the visible front and back surface, with its bronze rim still raised', () => {
  const library = createModelLibrary(), front = new Texture(), back = new Texture();
  const card = library.createCard({ frontTexture: front, backTexture: back });
  card.root.updateMatrixWorld(true);
  const first = (from, target) => new Raycaster(from, target.clone().sub(from).normalize()).intersectObject(card.root, true)
    .find(hit => !hit.object.userData.pickProxy && hit.object.material.visible !== false);
  for (const side of [1, -1]) for (const offset of [-.8, 0, .8]) {
    const hit = first(new Vector3(offset, .5, side * 3), new Vector3(0, 0, side * .064));
    assert.equal(hit.object.name, side === 1 ? 'card-front-art' : 'card-back-art');
    assert.equal(hit.object.material.map, side === 1 ? front : back);
  }
  const rim = first(new Vector3(.58, 0, 2), new Vector3(.58, 0, 0));
  assert.equal(rim.object.material.map, null); assert(rim.point.z > .064, 'the edge remains a physical raised frame');
  card.dispose(); library.dispose(); front.dispose(); back.dispose();
});
