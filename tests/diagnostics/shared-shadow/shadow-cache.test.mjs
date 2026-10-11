import test from "node:test";
import assert from "node:assert/strict";
import {
  Scene,
  PerspectiveCamera,
  DirectionalLight,
  Mesh,
  BoxGeometry,
  MeshStandardMaterial,
  Sprite,
  SpriteMaterial,
  PCFShadowMap,
  BasicShadowMap,
  WebGLRenderTarget,
  DepthTexture,
  Group,
  Texture,
  VideoTexture,
  MeshDepthMaterial,
  BufferGeometry,
  Float32BufferAttribute,
  InterleavedBuffer,
  InterleavedBufferAttribute,
  InstancedMesh,
  InstancedBufferGeometry,
  InstancedBufferAttribute,
  ArrayCamera,
  SkinnedMesh,
  LOD,
} from "three";
import { ReducedShadowCache } from "./shadow-cache.mjs";

function fixture({ enabled = true } = {}) {
  const scene = new Scene(),
    camera = new PerspectiveCamera(36, 2, 0.1, 90);
  const light = new DirectionalLight();
  light.castShadow = true;
  light.position.set(-7, 14, 9);
  light.shadow.mapSize.set(512, 512);
  scene.add(light, light.target);
  const mesh = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
  mesh.castShadow = true;
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeBoundingSphere();
  scene.add(mesh);
  scene.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  light.shadow.updateMatrices(light);
  const renderer = {
    isWebGLRenderer: true,
    isSoftwareRenderer: false,
    shadowMap: {
      enabled: true,
      autoUpdate: true,
      needsUpdate: false,
      type: PCFShadowMap,
    },
    xr: { enabled: false, isPresenting: false },
    clippingPlanes: [],
    localClippingEnabled: false,
    colorCalls: 0,
    depthCalls: 0,
    render() {
      this.colorCalls++;
      if (
        this.shadowMap.enabled &&
        (this.shadowMap.autoUpdate || this.shadowMap.needsUpdate) &&
        (light.shadow.autoUpdate || light.shadow.needsUpdate)
      ) {
        this.depthCalls++;
        if (!light.shadow.map) {
          light.shadow.map = new WebGLRenderTarget(
            light.shadow.mapSize.x,
            light.shadow.mapSize.y,
          );
          light.shadow.map.depthTexture = new DepthTexture(
            light.shadow.mapSize.x,
            light.shadow.mapSize.y,
          );
        } else if (
          light.shadow.map.width !== light.shadow.mapSize.x ||
          light.shadow.map.height !== light.shadow.mapSize.y
        )
          light.shadow.map.setSize(
            light.shadow.mapSize.x,
            light.shadow.mapSize.y,
          );
        this.shadowMap.needsUpdate = false;
        light.shadow.needsUpdate = false;
      }
    },
  };
  const cache = new ReducedShadowCache({ enabled });
  const input = {
    renderer,
    scene,
    camera,
    reduced: true,
    contextEpoch: 0,
    resizeEpoch: 0,
  };
  const frame = (mutateAfterRender) => {
    const ticket = cache.beforeRender(input);
    renderer.render();
    mutateAfterRender?.();
    return { ticket, result: cache.afterRender(ticket, true) };
  };
  return { scene, camera, light, mesh, renderer, cache, input, frame };
}

test("two identical reduced real-Three inputs keep color draws but reuse the successful depth map", () => {
  const f = fixture();
  f.frame();
  f.frame();
  assert.equal(f.renderer.colorCalls, 2, "color must still render both frames");
  assert.equal(
    f.renderer.depthCalls,
    1,
    "the stable second shadow pass must reuse its still-valid depth map",
  );
});

export { fixture };

test("disabled baseline has identical key overhead and successful inputSame, while never changing flags", () => {
  const f = fixture({ enabled: false });
  const first = f.frame(),
    second = f.frame();
  assert.equal(first.result.committed, true);
  assert.equal(second.ticket.inputSame, true);
  assert.equal(second.ticket.reuse, false);
  assert.equal(second.ticket.applied, false);
  assert.equal(f.renderer.colorCalls, 2);
  assert.equal(f.renderer.depthCalls, 2);
  assert.equal(f.renderer.shadowMap.autoUpdate, true);
  assert.equal(f.renderer.shadowMap.needsUpdate, false);
});

test("first render, explicit dirty, controller invalidation and resource disposal force fresh depths", () => {
  const f = fixture();
  assert.equal(f.frame().ticket.refresh, true);
  assert.equal(f.frame().ticket.reuse, true);
  f.renderer.shadowMap.needsUpdate = true;
  assert.equal(f.frame().ticket.refresh, true);
  f.light.shadow.needsUpdate = true;
  assert.equal(f.frame().ticket.refresh, true);
  f.cache.invalidate("frame-external-hidden-warmup");
  assert.equal(f.frame().ticket.refresh, true);
  f.light.shadow.map.dispose();
  assert.equal(f.frame().ticket.refresh, true);
  assert.equal(f.renderer.shadowMap.autoUpdate, true);
});

test("same input cannot reuse a replaced or missing depth target", () => {
  const f = fixture();
  f.frame();
  f.light.shadow.map = new WebGLRenderTarget(512, 512);
  f.light.shadow.map.depthTexture = new DepthTexture(512, 512);
  assert.equal(f.frame().ticket.reuse, false);
  assert.equal(f.frame().ticket.reuse, true);
  f.light.shadow.map = null;
  assert.equal(f.frame().ticket.reuse, false);
});

test("reduced noncaster float opacity changes do not suppress any color frame", () => {
  const f = fixture();
  const floating = new Sprite(new SpriteMaterial({ transparent: true }));
  f.scene.add(floating);
  f.frame();
  floating.material.opacity = 0.65;
  floating.position.y = 0.6;
  const second = f.frame();
  assert.equal(second.ticket.reuse, true);
  assert.equal(f.renderer.colorCalls, 2);
  assert.equal(f.renderer.depthCalls, 1);
});

test("parent layers do not prune visible caster children; hidden ancestors do prune", () => {
  const f = fixture(),
    group = new Group();
  group.layers.set(3);
  f.scene.remove(f.mesh);
  group.add(f.mesh);
  f.scene.add(group);
  const before = f.frame();
  assert.equal(before.ticket.casterCount, 1);
  group.visible = false;
  const hidden = f.frame();
  assert.equal(hidden.ticket.casterCount, 0);
  assert.equal(hidden.ticket.refresh, true);
  group.visible = true;
  assert.equal(f.frame().ticket.refresh, true);
});

for (const [name, mutate] of [
  [
    "caster insertion",
    (f) => {
      const m = new Mesh(new BoxGeometry(), new MeshStandardMaterial());
      m.castShadow = true;
      f.scene.add(m);
    },
  ],
  ["caster deletion", (f) => f.scene.remove(f.mesh)],
  [
    "caster translation",
    (f) => {
      f.mesh.position.x = 1;
    },
  ],
  [
    "caster visible",
    (f) => {
      f.mesh.visible = false;
    },
  ],
  [
    "caster layers",
    (f) => {
      f.mesh.layers.set(2);
    },
  ],
  [
    "camera actual layers",
    (f) => {
      f.camera.layers.enable(2);
    },
  ],
  [
    "geometry position version",
    (f) => {
      f.mesh.geometry.attributes.position.setX(0, 1);
      f.mesh.geometry.attributes.position.needsUpdate = true;
    },
  ],
  [
    "geometry index version",
    (f) => {
      f.mesh.geometry.index.needsUpdate = true;
    },
  ],
  [
    "geometry attribute replacement",
    (f) => {
      f.mesh.geometry.setAttribute(
        "position",
        f.mesh.geometry.attributes.position.clone(),
      );
    },
  ],
  ["draw range", (f) => f.mesh.geometry.setDrawRange(0, 12)],
  [
    "geometry groups",
    (f) => {
      f.mesh.geometry.groups[0].count = 3;
    },
  ],
  [
    "bounds",
    (f) => {
      f.mesh.geometry.boundingSphere.radius = 2;
    },
  ],
  [
    "material side",
    (f) => {
      f.mesh.material.side = 2;
    },
  ],
  [
    "material visibility",
    (f) => {
      f.mesh.material.visible = false;
    },
  ],
  [
    "material wireframe",
    (f) => {
      f.mesh.material.wireframe = true;
    },
  ],
  [
    "light matrix",
    (f) => {
      f.light.position.x = -4;
    },
  ],
  [
    "target matrix",
    (f) => {
      f.light.target.position.x = 1;
    },
  ],
  [
    "shadow bias",
    (f) => {
      f.light.shadow.bias = 0.01;
    },
  ],
  [
    "actual shadow sampling matrix",
    (f) => {
      f.light.shadow.matrix.elements[12] = 0.1;
    },
  ],
  [
    "shadow camera projection",
    (f) => {
      f.light.shadow.camera.left = -7;
      f.light.shadow.camera.updateProjectionMatrix();
    },
  ],
  ["shadow size", (f) => f.light.shadow.mapSize.set(256, 256)],
  [
    "context epoch",
    (f) => {
      f.input.contextEpoch++;
    },
  ],
  [
    "resize epoch",
    (f) => {
      f.input.resizeEpoch++;
    },
  ],
])
  test(`real Three changed ${name} invalidates the stable input`, () => {
    const f = fixture();
    f.frame();
    mutate(f);
    const changed = f.frame();
    assert.equal(changed.ticket.refresh, true, name);
    assert.equal(changed.ticket.reuse, false, name);
    assert.equal(f.renderer.colorCalls, 2);
    assert.equal(f.renderer.depthCalls, 2);
  });

test("texture version/source and UV changes invalidate exact structural keys", () => {
  const f = fixture();
  f.mesh.material.map = new Texture({ width: 4, height: 4 });
  f.frame();
  f.mesh.material.map.needsUpdate = true;
  assert.equal(f.frame().ticket.refresh, true);
  f.mesh.material.map.offset.x = 0.1;
  assert.equal(f.frame().ticket.refresh, true);
  f.mesh.material.map.source.data = { width: 4, height: 4 };
  assert.equal(f.frame().ticket.refresh, true);
});

test("in-frame changed input or explicit invalidation cannot commit a success", () => {
  const f = fixture();
  const changed = f.frame(() => {
    f.mesh.position.x = 1;
  });
  assert.equal(changed.result.committed, false);
  assert.equal(f.renderer.shadowMap.needsUpdate, true);
  f.frame();
  const invalid = f.frame(() => f.cache.invalidate("mid-frame"));
  assert.equal(invalid.result.committed, false);
  assert.equal(f.renderer.shadowMap.needsUpdate, true);
});

test("render failure, unconsumed dirty flags and missing map redirty and never commit", () => {
  const f = fixture();
  const failed = f.cache.beforeRender(f.input);
  assert.equal(f.cache.afterRender(failed, false).committed, false);
  assert.equal(f.renderer.shadowMap.autoUpdate, true);
  assert.equal(f.renderer.shadowMap.needsUpdate, true);
  const noDraw = f.cache.beforeRender(f.input);
  assert.equal(f.cache.afterRender(noDraw, true).committed, false);
  const missing = f.cache.beforeRender(f.input);
  f.renderer.shadowMap.needsUpdate = false;
  f.light.shadow.needsUpdate = false;
  assert.equal(f.cache.afterRender(missing, true).committed, false);
});

for (const [name, mutate] of [
  [
    "normal motion",
    (f) => {
      f.input.reduced = false;
    },
  ],
  [
    "truthy unknown motion",
    (f) => {
      f.input.reduced = "false";
    },
  ],
  [
    "array camera",
    (f) => {
      f.input.camera = new ArrayCamera([f.camera]);
    },
  ],
  [
    "instanced geometry",
    (f) => {
      f.mesh.geometry = new InstancedBufferGeometry().copy(f.mesh.geometry);
    },
  ],
  [
    "instanced attribute",
    (f) => {
      f.mesh.geometry.setAttribute(
        "extra",
        new InstancedBufferAttribute(new Float32Array(3), 3),
      );
    },
  ],
  [
    "non-WebGL renderer",
    (f) => {
      f.renderer.isWebGLRenderer = false;
    },
  ],
  [
    "software fallback",
    (f) => {
      f.renderer.isSoftwareRenderer = true;
    },
  ],
  [
    "shadow disabled",
    (f) => {
      f.renderer.shadowMap.enabled = false;
    },
  ],
  [
    "wrong shadow type",
    (f) => {
      f.renderer.shadowMap.type = BasicShadowMap;
    },
  ],
  [
    "XR enabled",
    (f) => {
      f.renderer.xr.enabled = true;
    },
  ],
  [
    "renderer clipping",
    (f) => {
      f.renderer.clippingPlanes = [{}];
    },
  ],
  [
    "Scene render hook",
    (f) => {
      f.scene.onBeforeRender = () => {};
    },
  ],
  [
    "object shadow hook",
    (f) => {
      f.mesh.onBeforeShadow = () => {};
    },
  ],
  [
    "noncaster material render hook",
    (f) => {
      const sprite = new Sprite(new SpriteMaterial());
      sprite.material.onBeforeRender = () => {};
      f.scene.add(sprite);
    },
  ],
  [
    "custom depth",
    (f) => {
      f.mesh.customDepthMaterial = new MeshDepthMaterial();
    },
  ],
  [
    "material compile hook",
    (f) => {
      f.mesh.material.onBeforeCompile = () => {};
    },
  ],
  [
    "active alpha",
    (f) => {
      f.mesh.material.alphaTest = 0.1;
    },
  ],
  [
    "transparent caster",
    (f) => {
      f.mesh.material.transparent = true;
    },
  ],
  [
    "opacity caster",
    (f) => {
      f.mesh.material.opacity = 0.9;
    },
  ],
  [
    "displacement",
    (f) => {
      f.mesh.material.displacementMap = new Texture();
    },
  ],
  [
    "material clipping",
    (f) => {
      f.mesh.material.clippingPlanes = [{}];
    },
  ],
  [
    "video texture",
    (f) => {
      f.mesh.material.map = new VideoTexture({});
    },
  ],
  [
    "morph geometry",
    (f) => {
      f.mesh.geometry.morphAttributes.position = [
        f.mesh.geometry.attributes.position.clone(),
      ];
    },
  ],
  [
    "skinned mesh",
    (f) => {
      f.scene.remove(f.mesh);
      const m = new SkinnedMesh(new BoxGeometry(), new MeshStandardMaterial());
      m.castShadow = true;
      f.scene.add(m);
    },
  ],
  [
    "instanced mesh",
    (f) => {
      f.scene.remove(f.mesh);
      const m = new InstancedMesh(
        new BoxGeometry(),
        new MeshStandardMaterial(),
        1,
      );
      m.castShadow = true;
      f.scene.add(m);
    },
  ],
  [
    "batched unknown",
    (f) => {
      f.mesh.isBatchedMesh = true;
    },
  ],
  [
    "interleaved attribute",
    (f) => {
      f.mesh.geometry.setAttribute(
        "position",
        new InterleavedBufferAttribute(
          new InterleavedBuffer(new Float32Array(12), 3),
          3,
          0,
        ),
      );
    },
  ],
  [
    "GL attribute",
    (f) => {
      f.mesh.geometry.attributes.position.isGLBufferAttribute = true;
    },
  ],
  [
    "nonfinite world",
    (f) => {
      f.mesh.position.x = Infinity;
    },
  ],
  [
    "custom shadow camera method",
    (f) => {
      f.light.shadow.updateMatrices = () => {};
    },
  ],
  [
    "second shadow light",
    (f) => {
      const l = new DirectionalLight();
      l.castShadow = true;
      f.scene.add(l, l.target);
    },
  ],
])
  test(`strict unsupported ${name} preserves original shadow flags`, () => {
    const f = fixture();
    mutate(f);
    const before = { ...f.renderer.shadowMap },
      lightDirty = f.light.shadow.needsUpdate;
    const ticket = f.cache.beforeRender(f.input);
    assert.equal(ticket.eligible, false, name);
    assert.equal(ticket.applied, false);
    assert.deepEqual(f.renderer.shadowMap, before);
    assert.equal(f.light.shadow.needsUpdate, lightDirty);
    f.cache.afterRender(ticket, false);
    assert.deepEqual(f.renderer.shadowMap, before);
    assert.equal(f.light.shadow.needsUpdate, lightDirty);
  });

test("ticket key is primitive JSON-safe and ticket cannot be consumed twice", () => {
  const f = fixture();
  const ticket = f.cache.beforeRender(f.input);
  assert.deepEqual(JSON.parse(JSON.stringify(ticket.key)), ticket.key);
  f.renderer.render();
  f.cache.afterRender(ticket, true);
  assert.throws(() => f.cache.afterRender(ticket, true), /consumed/);
});

test("a new correctly sized but unrendered map cannot be committed after a reuse frame", () => {
  const f = fixture();
  f.frame();
  const changed = f.frame(() => {
    f.light.shadow.map = new WebGLRenderTarget(512, 512);
    f.light.shadow.map.depthTexture = new DepthTexture(512, 512);
  });
  assert.equal(changed.ticket.reuse, true);
  assert.equal(changed.result.committed, false);
  assert.equal(changed.result.reason, "map-changed-during-render");
  assert.equal(f.renderer.shadowMap.needsUpdate, true);
  assert.equal(f.frame().ticket.refresh, true);
});

test("opaque diffuse color changes preserve depth input while color still renders", () => {
  const f = fixture();
  f.frame();
  f.mesh.material.color.set("#009977");
  const frame = f.frame();
  assert.equal(frame.ticket.inputSame, true);
  assert.equal(frame.ticket.reuse, true);
  assert.equal(f.renderer.colorCalls, 2);
  assert.equal(f.renderer.depthCalls, 1);
});

test("disabled baseline failure never mutates either owned shadow flag", () => {
  const f = fixture({ enabled: false }),
    ticket = f.cache.beforeRender(f.input),
    before = { ...f.renderer.shadowMap };
  f.cache.afterRender(ticket, false);
  assert.deepEqual(f.renderer.shadowMap, before);
  assert.equal(f.light.shadow.needsUpdate, false);
});

test("attribute upload callbacks are strict unknowns rather than eligibility exceptions", () => {
  const f = fixture();
  f.mesh.geometry.attributes.position.onUploadCallback = () => {};
  assert.equal(f.cache.beforeRender(f.input).eligible, false);
  assert.equal(f.renderer.shadowMap.autoUpdate, true);
});

test("texture source version alone invalidates otherwise identical opaque input", () => {
  const f = fixture();
  f.mesh.material.map = new Texture({ width: 8, height: 8 });
  f.frame();
  f.mesh.material.map.source.needsUpdate = true;
  const next = f.frame();
  assert.equal(next.ticket.refresh, true);
  assert.equal(next.ticket.inputSame, false);
});

test("Float64 GPU attribute and custom frustum hooks remain unsupported", () => {
  const f = fixture();
  f.mesh.geometry.setAttribute(
    "extra",
    new Float32BufferAttribute(new Float32Array(3), 3),
  );
  f.mesh.geometry.attributes.extra.array = new Float64Array(3);
  assert.equal(f.cache.beforeRender(f.input).eligible, false);
  const g = fixture();
  g.mesh.intersectsFrustum = () => true;
  assert.equal(g.cache.beforeRender(g.input).eligible, false);
});

test("a nonfinite actual shadow sampling matrix is not cacheable", () => {
  const f = fixture();
  f.light.shadow.matrix.elements[0] = Infinity;
  assert.equal(f.cache.beforeRender(f.input).eligible, false);
});

test("pre-existing manual shadow scheduling is an unsupported owner and remains untouched", () => {
  const f = fixture();
  f.renderer.shadowMap.autoUpdate = false;
  f.renderer.shadowMap.needsUpdate = true;
  const original = { ...f.renderer.shadowMap },
    ticket = f.cache.beforeRender(f.input);
  assert.equal(ticket.eligible, false);
  f.cache.afterRender(ticket, false);
  assert.deepEqual(f.renderer.shadowMap, original);
});

test("only explicit successful render may commit the ticket", () => {
  const f = fixture(),
    ticket = f.cache.beforeRender(f.input);
  f.renderer.render();
  assert.equal(f.cache.afterRender(ticket, "success").committed, false);
  assert.equal(f.renderer.shadowMap.needsUpdate, true);
});

test("custom matrix synchronizer falls back without invoking it or blocking caller color render", () => {
  const f = fixture();
  let calls = 0;
  f.scene.updateMatrixWorld = () => {
    calls++;
    f.mesh.position.x = 123;
  };
  const before = { ...f.renderer.shadowMap },
    ticket = f.cache.beforeRender(f.input);
  assert.equal(ticket.eligible, false);
  assert.equal(ticket.reason, "custom-matrix-updater");
  assert.equal(calls, 0);
  assert.equal(f.mesh.position.x, 0);
  assert.deepEqual(f.renderer.shadowMap, before);
  f.renderer.render();
  f.cache.afterRender(ticket, true);
  assert.equal(f.renderer.colorCalls, 1);
  assert.equal(f.renderer.shadowMap.autoUpdate, true);
});

test("matrix guard rejects custom updaters before synchronization including hidden descendants and stock-camera overrides", () => {
  for (const owner of ["hidden-mesh", "camera", "target", "shadow-camera"])
    for (const method of [
      "updateMatrix",
      "updateMatrixWorld",
      "updateWorldMatrix",
    ]) {
      const f = fixture();
      const object =
        owner === "camera"
          ? f.camera
          : owner === "target"
            ? f.light.target
            : owner === "shadow-camera"
              ? f.light.shadow.camera
              : f.mesh;
      if (owner === "hidden-mesh") object.visible = false;
      const originalX = object.position.x;
      let calls = 0;
      object[method] = () => {
        calls++;
        object.position.x = 123;
      };
      const ticket = f.cache.beforeRender(f.input);
      assert.equal(ticket.eligible, false, `${owner}/${method}`);
      assert.equal(calls, 0, `${owner}/${method}`);
      assert.equal(object.position.x, originalX, `${owner}/${method}`);
      assert.equal(f.renderer.shadowMap.autoUpdate, true);
    }
});

test("visible LOD is unsupported before renderer selection can change shadow casters", () => {
  const f = fixture(),
    lod = new LOD();
  lod.addLevel(new Mesh(new BoxGeometry(), new MeshStandardMaterial()), 0);
  f.scene.add(lod);
  let calls = 0;
  lod.update = () => {
    calls++;
  };
  const ticket = f.cache.beforeRender(f.input);
  assert.equal(ticket.eligible, false);
  assert.equal(ticket.reason, "dynamic-lod");
  assert.equal(calls, 0);
  assert.equal(f.renderer.shadowMap.autoUpdate, true);
});

test("UV collection predicts stock upload without changing texture matrix or calling custom updater", () => {
  const f = fixture(),
    texture = new Texture({ width: 4, height: 4 });
  f.mesh.material.map = texture;
  texture.offset.set(0.25, 0.125);
  const original = texture.matrix.toArray(),
    ticket = f.cache.beforeRender(f.input);
  assert.equal(ticket.eligible, true);
  assert.deepEqual(texture.matrix.toArray(), original);
  f.renderer.render();
  // Real WebGLMaterials performs this stock upload synchronization during the
  // render. Prospective pre/post keys stay equal across its derived write.
  texture.updateMatrix();
  assert.equal(f.cache.afterRender(ticket, true).committed, true);
  assert.equal(f.frame().ticket.reuse, true);
  let calls = 0;
  texture.updateMatrix = () => {
    calls++;
    texture.offset.x = 123;
  };
  const rejected = f.cache.beforeRender(f.input);
  assert.equal(rejected.eligible, false);
  assert.equal(rejected.reason, "custom-texture-updater");
  assert.equal(calls, 0);
  assert.equal(texture.offset.x, 0.25);
  assert.equal(f.renderer.shadowMap.autoUpdate, true);
});

test("collector honors manually owned scene/camera worlds and never synchronizes a detached target", () => {
  const f = fixture();
  f.scene.remove(f.light.target);
  f.scene.matrixWorldAutoUpdate = false;
  f.camera.matrixWorldAutoUpdate = false;
  f.frame();
  const meshWorld = f.mesh.matrixWorld.toArray(),
    cameraWorld = f.camera.matrixWorld.toArray(),
    targetWorld = f.light.target.matrixWorld.toArray();
  f.mesh.position.x = 2;
  f.camera.position.x = 2;
  f.light.target.position.x = 2;
  const second = f.frame();
  assert.equal(second.ticket.reuse, true);
  assert.deepEqual(f.mesh.matrixWorld.toArray(), meshWorld);
  assert.deepEqual(f.camera.matrixWorld.toArray(), cameraWorld);
  assert.deepEqual(f.light.target.matrixWorld.toArray(), targetWorld);
});

test("untrusted property exceptions retain a fixed diagnostic reason only", () => {
  const f = fixture();
  Object.defineProperty(f.mesh.material, "shadowSide", {
    get() {
      throw new Error("external private string");
    },
  });
  assert.equal(f.cache.beforeRender(f.input).reason, "unreadable-input");
  assert.equal(f.renderer.shadowMap.autoUpdate, true);
});
