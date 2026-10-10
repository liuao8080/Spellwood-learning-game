import test from "node:test";
import assert from "node:assert/strict";
import { Group, Scene, Sprite, SpriteMaterial, SRGBColorSpace, Vector2, Vector3, Vector4 } from "three";
import { createEffectWarmup, primeHiddenEffectCanvas } from "../src/arena3d/effect-warmup.mjs";
import { createElementalBurst, createElementalCast } from "../src/arena3d/elemental-effects.mjs";
import { ArenaScene } from "../src/arena3d/scene.mjs";

function canvasFactory() {
  const calls = [];
  const context = {
    measureText: text => ({ width: String(text).length * 26 }),
    strokeText: (...args) => calls.push(["strokeText", ...args]),
    fillText: (...args) => calls.push(["fillText", ...args]),
  };
  return { width: 0, height: 0, calls, context, getContext: kind => kind === "2d" ? context : null };
}
const elements = [["fire", "damage"], ["water", "heal"], ["nature", "grow"], ["arcane", "shield"]];
function materialSignature(material) {
  const fields = ["type", "transparent", "opacity", "depthTest", "depthWrite", "side", "blending", "alphaTest",
    "vertexColors", "fog", "toneMapped", "flatShading", "sizeAttenuation", "roughness", "metalness", "emissiveIntensity"];
  return {
    ...Object.fromEntries(fields.map(key => [key, material[key]])),
    color: material.color?.getHex(), emissive: material.emissive?.getHex(),
    map: material.map ? {
      canvas: material.map.isCanvasTexture, colorSpace: material.map.colorSpace,
      width: material.map.image.width, height: material.map.image.height,
      mapping: material.map.mapping, format: material.map.format, type: material.map.type,
      minFilter: material.map.minFilter, magFilter: material.map.magFilter,
      flipY: material.map.flipY, premultiplyAlpha: material.map.premultiplyAlpha,
      generateMipmaps: material.map.generateMipmaps,
    } : null,
  };
}
function signatures(root) {
  const materials = new Set();
  root.traverse(object => { if (object.material) materials.add(object.material); });
  return [...materials].map(materialSignature).map(value => JSON.stringify(value)).sort();
}

test("warmup stays detached/invisible with bounded resources and one actual-size SRGB texture", t => {
  let canvasCount = 0;
  const handle = createEffectWarmup({ createCanvas: () => { canvasCount++; return canvasFactory(); } });
  try {
    assert.equal(handle.root.parent, null);
    assert.equal(handle.root.visible, false);
    assert.equal(handle.root.children.length, 9);
    assert.equal(canvasCount, 1);
    assert.equal(handle.textures.length, 1);
    assert.equal(handle.textures[0].colorSpace, SRGBColorSpace);
    assert.equal(handle.textures[0].image.width, 384);
    assert.equal(handle.textures[0].image.height, 160);
    let meshes = 0, sprites = 0, visible = 0, triangles = 0;
    const geometries = new Set(), materials = new Set();
    handle.root.traverseVisible(() => visible++);
    handle.root.traverse(object => {
      if (object.isMesh) meshes++;
      if (object.isSprite) sprites++;
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) materials.add(object.material);
      if (object.isMesh) triangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
      assert.equal(Boolean(object.isLight || object.isCamera), false);
    });
    assert.equal(visible, 0);
    assert.equal(sprites, 1);
    assert.ok(meshes > 100 && meshes <= 160, `bounded mesh count: ${meshes}`);
    assert.ok(geometries.size <= 29, `bounded referenced geometries: ${geometries.size}`);
    assert.ok(materials.size <= 25, `bounded referenced materials: ${materials.size}`);
    assert.ok(triangles <= 6400, `bounded triangles: ${triangles}`);
    t.diagnostic(`${meshes} meshes, ${sprites} sprite, ${geometries.size} referenced geometries, ${materials.size} referenced materials, ${triangles} mesh triangles, ${handle.textures.length} texture`);
  } finally { handle.dispose(); }
});

for (const [element, kind] of elements) test(`${element} warmup material parity with actual cast and ${kind} burst paths`, () => {
  const handle = createEffectWarmup({ createCanvas: canvasFactory });
  const cast = createElementalCast({ element, from: new Vector3(-1, 1, 0), to: new Vector3(1, 1, 0) });
  const burst = createElementalBurst({ element, kind, at: new Vector3(1, 1, 0) });
  try {
    assert.deepEqual(signatures(handle.root.getObjectByName(cast.root.name)), signatures(cast.root));
    assert.deepEqual(signatures(handle.root.getObjectByName(burst.root.name)), signatures(burst.root));
    // Compile traverses hidden branches too, so every phase's materials must
    // already be present without playing the effect or calling any game code.
    for (const phase of [.1, .4, .7, .94]) {
      cast.update(phase);
      assert.deepEqual(signatures(handle.root.getObjectByName(cast.root.name)), signatures(cast.root));
    }
  } finally { cast.dispose(); burst.dispose(); handle.dispose(); }
});

test("floating-text representative matches the material/texture actually made by ArenaScene.floatText", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { createElement: canvasFactory } });
  const handle = createEffectWarmup({ createCanvas: canvasFactory });
  let cleanup;
  try {
    const scene = Object.create(ArenaScene.prototype);
    Object.assign(scene, {
      anchor: () => new Vector3(), renderer: {}, floatLanes: new Map(), temporary: new Group(),
      containSprite() {}, addJob(duration, update, done) { cleanup = done; return Promise.resolve(); },
    });
    scene.floatText("hero:0", "-2", "#ffe2b6");
    const actual = scene.temporary.children[0];
    const representative = handle.root.getObjectByName("effect-warmup-floating-text");
    assert.deepEqual(materialSignature(representative.material), materialSignature(actual.material));
    assert.deepEqual(representative.material.map.image.calls, actual.material.map.image.calls);
    for (const key of ["textAlign", "font", "lineWidth", "strokeStyle", "lineJoin", "fillStyle"])
      assert.equal(representative.material.map.image.context[key], actual.material.map.image.context[key]);
    assert.deepEqual(representative.scale.toArray(), actual.scale.toArray());
    assert.equal(representative.renderOrder, actual.renderOrder);
  } finally {
    cleanup?.(); handle.dispose();
    if (original) Object.defineProperty(globalThis, "document", original); else delete globalThis.document;
  }
});

test("representative references remain alive until explicit disposal, then release exactly once", () => {
  const handle = createEffectWarmup({ createCanvas: canvasFactory });
  const owned = new Set(handle.textures);
  handle.root.traverse(object => {
    if (object.material) owned.add(object.material);
    if (object.isMesh) owned.add(object.geometry);
  });
  const releases = new Map([...owned].map(resource => [resource, 0]));
  for (const resource of owned) resource.addEventListener("dispose", () => releases.set(resource, releases.get(resource) + 1));
  const otherSprite = new Sprite(new SpriteMaterial());
  let sharedGeometryReleases = 0;
  const onSharedDispose = () => sharedGeometryReleases++;
  otherSprite.geometry.addEventListener("dispose", onSharedDispose);
  try {
    assert.ok([...releases.values()].every(count => count === 0));
    assert.equal(handle.disposed, false);
    const accidentalParent = new Scene(); accidentalParent.add(handle.root);
    handle.dispose(); handle.dispose();
    assert.equal(handle.disposed, true);
    assert.equal(handle.root.parent, null);
    assert.equal(handle.root.children.length, 0);
    assert.equal(accidentalParent.children.length, 0);
    assert.ok([...releases.values()].every(count => count === 1));
    assert.equal(sharedGeometryReleases, 0, "Three's shared Sprite geometry must remain intact");
  } finally {
    otherSprite.geometry.removeEventListener("dispose", onSharedDispose);
    otherSprite.material.dispose(); handle.dispose();
  }
});

test("warmup clearly fails without canvas support before allocating effect resources", () => {
  assert.throws(() => createEffectWarmup({ createCanvas: () => null }), /requires a canvas/);
  assert.throws(() => createEffectWarmup({ createCanvas: () => ({ getContext: () => null }) }), /requires a 2D canvas context/);
});


function hiddenDrawFixture() {
  const canvas = canvasFactory();
  const handle = createEffectWarmup({ createCanvas: () => canvas });
  const scene = new Scene(), retained = new Group(); scene.add(retained);
  const camera = { marker: "existing-camera" };
  const size = new Vector2(708, 208), viewport = new Vector4(2, 3, 700, 200), scissor = new Vector4(4, 5, 690, 190);
  const calls = [];
  const renderer = {
    isSoftwareRenderer: false, size, viewport, scissor, scissorTest: true,
    getRenderTarget: () => null,
    getContext: () => ({ isContextLost: () => false, flush: () => calls.push(["flush"]) }),
    getSize: into => into.copy(size), getViewport: into => into.copy(viewport), getScissor: into => into.copy(scissor),
    getScissorTest() { return this.scissorTest; },
    setSize(w, h, style) { calls.push(["size", w, h, style]); size.set(w, h); viewport.set(0, 0, w, h); },
    setViewport: value => viewport.copy(value), setScissor: value => scissor.copy(value),
    setScissorTest(value) { this.scissorTest = value; },
    render(s, c) {
      assert.equal(s, scene); assert.equal(c, camera);
      assert.equal(handle.root.parent, scene); assert.equal(handle.root.visible, true);
      handle.root.traverse(object => assert.equal(object.visible, true));
      assert.deepEqual(size.toArray(), [8, 8]); assert.equal(this.scissorTest, false);
      calls.push(["render"]);
    },
  };
  const input = { renderer, scene, camera, canvas: { hidden: true }, handle };
  return { input, calls, retained };
}

for (const fail of [false, true]) test(`hidden default-canvas preparation restores every owner state${fail ? " after a render failure" : " after one bounded mocked renderer invocation"}`, () => {
  const { input, calls, retained } = hiddenDrawFixture();
  const { renderer, handle, scene } = input;
  const before = []; handle.root.traverse(object => before.push([object, object.visible]));
  if (fail) renderer.render = () => { throw new Error("driver test failure"); };
  try {
    if (fail) assert.throws(() => primeHiddenEffectCanvas(input), /driver test failure/);
    else assert.deepEqual(primeHiddenEffectCanvas(input), { status: "performed", width: 8, height: 8 });
    assert.equal(handle.root.parent, null); assert.deepEqual(scene.children, [retained]);
    for (const [object, visible] of before) assert.equal(object.visible, visible);
    assert.deepEqual(renderer.size.toArray(), [708, 208]);
    assert.deepEqual(renderer.viewport.toArray(), [2, 3, 700, 200]);
    assert.deepEqual(renderer.scissor.toArray(), [4, 5, 690, 190]); assert.equal(renderer.scissorTest, true);
    assert.equal(calls.filter(call => call[0] === "size").length, 2);
    assert.equal(handle.disposed, false, "program references stay alive after initialization");
  } finally { handle.dispose(); }
});

for (const scenario of ["visible", "software", "owned-target", "owned-root", "disposed", "context-lost", "unsupported"]) {
  test(`hidden preparation performs no renderer mutations for ${scenario}`, () => {
    const { input, calls } = hiddenDrawFixture();
    try {
      if (scenario === "visible") input.canvas.hidden = false;
      if (scenario === "software") input.renderer.isSoftwareRenderer = true;
      if (scenario === "owned-target") input.renderer.getRenderTarget = () => ({ existing: true });
      if (scenario === "owned-root") new Group().add(input.handle.root);
      if (scenario === "disposed") input.handle.dispose();
      if (scenario === "context-lost") input.renderer.getContext = () => ({ isContextLost: () => true });
      if (scenario === "unsupported") delete input.renderer.getViewport;
      assert.equal(primeHiddenEffectCanvas(input).status, "skipped");
      assert.deepEqual(calls, []);
    } finally { input.handle.dispose(); }
  });
}
