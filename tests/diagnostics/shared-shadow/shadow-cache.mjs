import {
  Object3D,
  Camera,
  Material,
  Texture,
  Matrix3,
  BufferAttribute,
  DirectionalLight,
  OrthographicCamera,
  PerspectiveCamera,
  Mesh,
  PCFShadowMap,
} from "three";
// Compare with stock prototypes from the same public Three instance. Mixing
// src/ constructors with the package's bundled exports creates false unknowns.
const ordinaryShadow = new DirectionalLight().shadow;
const readFailureCodes = new Set([
  "material-hook",
  "dynamic-texture",
  "nonfinite-texture",
  "custom-texture-updater",
  "unsupported-attribute",
  "unsupported-geometry",
  "nonfinite-bounds",
  "unsupported-shadow-material",
  "unsupported-caster-type",
  "custom-frustum-hook",
  "nonfinite-matrix",
]);

// Lab only. No render/GL calls, game ownership, vendor sniffing or quality change.
// Keys are exact nested primitive arrays; a digest is never a reuse decision.
const exact = (a, b) =>
  Object.is(a, b) ||
  (Array.isArray(a) &&
    Array.isArray(b) &&
    a.length === b.length &&
    a.every((x, i) => exact(x, b[i])));
const finite = (values) => values.every(Number.isFinite);
const freeze = (value) => {
  if (Array.isArray(value)) {
    value.forEach(freeze);
    Object.freeze(value);
  }
  return value;
};
const serial = (value) =>
  Array.isArray(value)
    ? value.map(serial)
    : value === undefined
      ? null
      : Object.is(value, -0)
        ? "-0"
        : value;
const hooks = [
  "onBeforeRender",
  "onAfterRender",
  "onBeforeShadow",
  "onAfterShadow",
];
const noObjectHooks = (object) =>
  hooks.every((name) => object[name] === Object3D.prototype[name]);
const noMaterialHooks = (material) =>
  material.onBeforeRender === Material.prototype.onBeforeRender &&
  material.onBeforeCompile === Material.prototype.onBeforeCompile &&
  material.customProgramCacheKey === Material.prototype.customProgramCacheKey &&
  !material.onAfterRender &&
  !material.onBeforeShadow &&
  !material.onAfterShadow;
const matrix = (value) =>
  value?.elements && finite(value.elements) ? Array.from(value.elements) : null;
const vector = (value) =>
  value?.toArray && finite(value.toArray()) ? value.toArray() : null;
const bounds = (geometry) => [
  geometry.boundingBox
    ? [vector(geometry.boundingBox.min), vector(geometry.boundingBox.max)]
    : null,
  geometry.boundingSphere
    ? [vector(geometry.boundingSphere.center), geometry.boundingSphere.radius]
    : null,
];
// Matrix synchronization also visits hidden descendants. Validate the whole
// tree before invoking stock synchronization so diagnostic collection cannot
// invoke an application-defined updater even in a hidden branch.
const matrixTreeFailure = (object, visible = true) => {
  const stockCamera =
    object?.isCamera &&
    [PerspectiveCamera, OrthographicCamera].includes(object.constructor);
  if (
    !object?.isObject3D ||
    object.updateMatrix !== Object3D.prototype.updateMatrix ||
    object.updateMatrixWorld !==
      (stockCamera
        ? Camera.prototype.updateMatrixWorld
        : Object3D.prototype.updateMatrixWorld) ||
    object.updateWorldMatrix !==
      (stockCamera
        ? Camera.prototype.updateWorldMatrix
        : Object3D.prototype.updateWorldMatrix)
  )
    return "custom-matrix-updater";
  visible = visible && object.visible !== false;
  if (visible && object.isLOD) return "dynamic-lod";
  for (const child of object.children) {
    const failure = matrixTreeFailure(child, visible);
    if (failure) return failure;
  }
  return null;
};

export class ReducedShadowCache {
  constructor({ enabled = true } = {}) {
    this.enabled = !!enabled;
    this.previous = null;
    this.dirty = true;
    this.revision = 0;
    this.identities = new WeakMap();
    this.nextIdentity = 1;
    this.tickets = new WeakMap();
    this.maps = new WeakMap();
    this.lastInvalidation = "fresh";
  }
  identity(value) {
    if (!value || typeof value !== "object") return null;
    if (!this.identities.has(value))
      this.identities.set(value, this.nextIdentity++);
    return this.identities.get(value);
  }
  invalidate(reason = "explicit") {
    this.dirty = true;
    this.previous = null;
    this.revision++;
    this.lastInvalidation = String(reason);
  }
  watchMap(map) {
    if (!map) return null;
    let state = this.maps.get(map);
    if (!state) {
      state = { generation: 0 };
      this.maps.set(map, state);
      const dispose = () => {
        state.generation++;
        this.invalidate("map-resource-disposed");
      };
      for (const resource of [map, map.texture, map.depthTexture])
        resource?.addEventListener?.("dispose", dispose);
    }
    return state;
  }
  mapDescriptor(light) {
    const map = light?.shadow?.map;
    if (
      !map?.isWebGLRenderTarget ||
      map.isWebGLCubeRenderTarget ||
      !map.texture?.isTexture ||
      !map.depthTexture?.isDepthTexture ||
      map.width !== light.shadow.mapSize.x ||
      map.height !== light.shadow.mapSize.y
    )
      return null;
    const watched = this.watchMap(map);
    return [
      this.identity(map),
      watched.generation,
      map.width,
      map.height,
      this.identity(map.texture),
      map.texture.version,
      this.identity(map.depthTexture),
      map.depthTexture.version,
      this.identity(map.depthTexture.source),
      map.depthTexture.source?.version ?? 0,
    ];
  }
  texture(texture) {
    if (!texture) return null;
    if (
      !texture.isTexture ||
      texture.isVideoTexture ||
      texture.isVideoFrameTexture ||
      texture.isExternalTexture
    )
      throw new Error("dynamic-texture");
    if (texture.updateMatrix !== Texture.prototype.updateMatrix)
      throw new Error("custom-texture-updater");
    // Predict the stock upload's UV matrix without changing the texture or
    // calling its updater. Both baseline and candidate pay this same cost.
    const uv = texture.matrixAutoUpdate
      ? matrix(
          new Matrix3().setUvTransform(
            texture.offset.x,
            texture.offset.y,
            texture.repeat.x,
            texture.repeat.y,
            texture.rotation,
            texture.center.x,
            texture.center.y,
          ),
        )
      : matrix(texture.matrix);
    if (!uv) throw new Error("nonfinite-texture");
    return [
      this.identity(texture),
      texture.version,
      this.identity(texture.source),
      texture.source?.version ?? 0,
      this.identity(texture.source?.data),
      texture.source?.data?.width ?? null,
      texture.source?.data?.height ?? null,
      texture.channel,
      texture.mapping,
      texture.wrapS,
      texture.wrapT,
      texture.flipY,
      texture.matrixAutoUpdate,
      uv,
    ];
  }
  attribute(attribute) {
    if (
      !attribute?.isBufferAttribute ||
      attribute.isInterleavedBufferAttribute ||
      attribute.isInstancedBufferAttribute ||
      attribute.isFloat16BufferAttribute ||
      attribute.isGLBufferAttribute ||
      !ArrayBuffer.isView(attribute.array) ||
      ![
        "Float32Array",
        "Int8Array",
        "Uint8Array",
        "Uint8ClampedArray",
        "Int16Array",
        "Uint16Array",
        "Int32Array",
        "Uint32Array",
      ].includes(attribute.array.constructor.name) ||
      attribute.onUploadCallback !== BufferAttribute.prototype.onUploadCallback
    )
      throw new Error("unsupported-attribute");
    return [
      this.identity(attribute),
      attribute.version,
      this.identity(attribute.array),
      attribute.array.constructor.name,
      attribute.array.byteOffset,
      attribute.array.byteLength,
      attribute.itemSize,
      attribute.count,
      attribute.normalized,
      attribute.usage,
      attribute.gpuType,
    ];
  }
  geometry(geometry) {
    if (
      !geometry?.isBufferGeometry ||
      geometry.isInstancedBufferGeometry ||
      geometry.morphTargetsRelative ||
      Object.values(geometry.morphAttributes || {}).some((list) => list.length)
    )
      throw new Error("unsupported-geometry");
    if (
      geometry.boundingBox &&
      (!vector(geometry.boundingBox.min) || !vector(geometry.boundingBox.max))
    )
      throw new Error("nonfinite-bounds");
    if (
      geometry.boundingSphere &&
      (!vector(geometry.boundingSphere.center) ||
        !Number.isFinite(geometry.boundingSphere.radius))
    )
      throw new Error("nonfinite-bounds");
    return [
      this.identity(geometry),
      Object.keys(geometry.attributes)
        .sort()
        .map((name) => [name, this.attribute(geometry.attributes[name])]),
      geometry.index ? this.attribute(geometry.index) : null,
      [
        geometry.drawRange.start,
        geometry.drawRange.count === Infinity
          ? "Infinity"
          : geometry.drawRange.count,
      ],
      geometry.groups.map((g) => [g.start, g.count, g.materialIndex]),
      bounds(geometry),
    ];
  }
  material(material, caster) {
    if (!material?.isMaterial || !noMaterialHooks(material))
      throw new Error("material-hook");
    // Hook/video discovery covers the full visible tree, including noncasters.
    for (const value of Object.values(material))
      if (
        value?.isTexture &&
        (value.isVideoTexture ||
          value.isVideoFrameTexture ||
          value.isExternalTexture)
      )
        throw new Error("dynamic-texture");
    if (!caster) return null;
    if (
      !(material.isMeshStandardMaterial || material.isMeshBasicMaterial) ||
      material.isMeshPhysicalMaterial ||
      material.transparent ||
      material.opacity !== 1 ||
      material.alphaTest !== 0 ||
      material.alphaHash ||
      material.alphaToCoverage ||
      material.clippingPlanes?.length ||
      material.clipShadows ||
      (material.displacementMap && material.displacementScale !== 0)
    )
      throw new Error("unsupported-shadow-material");
    return [
      this.identity(material),
      material.type,
      material.version,
      material.visible,
      material.side,
      material.shadowSide,
      material.wireframe,
      material.wireframeLinewidth,
      material.linewidth,
      material.alphaTest,
      material.opacity,
      material.transparent,
      this.texture(material.map),
      this.texture(material.alphaMap),
      this.texture(material.displacementMap),
      material.displacementScale,
      material.displacementBias,
    ];
  }
  snapshot(input) {
    const {
      renderer,
      scene,
      camera,
      reduced,
      contextEpoch = 0,
      resizeEpoch = 0,
    } = input;
    const reject = (reason) => ({
      eligible: false,
      reason,
      key: null,
      light: null,
    });
    if (reduced !== true)
      return reject(reduced === false ? "normal-motion" : "unknown-motion");
    if (
      renderer?.isWebGLRenderer !== true ||
      renderer.isSoftwareRenderer ||
      !renderer.shadowMap?.enabled
    )
      return reject("not-real-webgl-shadow");
    if (
      renderer.shadowMap.type !== PCFShadowMap ||
      renderer.shadowMap.autoUpdate !== true ||
      renderer.xr?.enabled ||
      renderer.xr?.isPresenting ||
      renderer.clippingPlanes?.length
    )
      return reject("unsupported-renderer");
    if (
      !scene?.isScene ||
      !camera?.isCamera ||
      ![PerspectiveCamera, OrthographicCamera].includes(camera.constructor) ||
      !Number.isFinite(contextEpoch) ||
      !Number.isFinite(resizeEpoch)
    )
      return reject("invalid-input");
    const casters = [],
      lights = [];
    let failure = null;
    const matrixFailure = matrixTreeFailure(scene) || matrixTreeFailure(camera);
    if (matrixFailure) return reject(matrixFailure);
    // Mirror renderer-owned stock synchronization, including manual matrix
    // ownership. Never force an update or synchronize a detached light target.
    if (scene.matrixWorldAutoUpdate === true) scene.updateMatrixWorld();
    if (!camera.parent && camera.matrixWorldAutoUpdate === true)
      camera.updateMatrixWorld();
    const visit = (object) => {
      if (object.visible === false || failure) return;
      if (
        !noObjectHooks(object) ||
        object.customDepthMaterial ||
        object.customDistanceMaterial
      ) {
        failure = "object-hook-or-custom-depth";
        return;
      }
      if (
        object.isSkinnedMesh ||
        object.isInstancedMesh ||
        object.isBatchedMesh ||
        object.morphTargetInfluences ||
        object.morphTargetDictionary
      ) {
        failure = "dynamic-object";
        return;
      }
      if (
        object.isLight &&
        object.castShadow &&
        object.layers.test(camera.layers)
      )
        lights.push(object);
      try {
        const materials = object.material
          ? Array.isArray(object.material)
            ? object.material
            : [object.material]
          : [];
        const caster =
          !!object.castShadow &&
          (object.isMesh || object.isLine || object.isPoints);
        const materialKeys = materials.map((material) =>
          this.material(material, caster),
        );
        if (caster) {
          if (!object.isMesh) throw new Error("unsupported-caster-type");
          if (object.intersectsFrustum !== Mesh.prototype.intersectsFrustum)
            throw new Error("custom-frustum-hook");
          const world = matrix(object.matrixWorld);
          if (!world) throw new Error("nonfinite-matrix");
          casters.push([
            this.identity(object),
            object.layers.mask,
            world,
            object.frustumCulled,
            this.geometry(object.geometry),
            materialKeys,
          ]);
        }
      } catch (error) {
        failure = readFailureCodes.has(error?.message)
          ? error.message
          : "unreadable-input";
        return;
      }
      // Parent layers do not prune children: Three tests each object's layers.
      for (const child of object.children) visit(child);
    };
    visit(scene);
    if (failure) return reject(failure);
    if (lights.length !== 1 || lights[0].constructor !== DirectionalLight)
      return reject("unsupported-shadow-lights");
    const light = lights[0],
      shadow = light.shadow;
    if (
      shadow.constructor !== ordinaryShadow.constructor ||
      shadow.camera.constructor !== OrthographicCamera ||
      shadow.updateMatrices !== ordinaryShadow.updateMatrices ||
      shadow.getViewport !== ordinaryShadow.getViewport ||
      shadow.getViewportCount !== ordinaryShadow.getViewportCount ||
      shadow.getFrameExtents !== ordinaryShadow.getFrameExtents ||
      shadow._updateMatrix !== ordinaryShadow._updateMatrix ||
      matrixTreeFailure(shadow.camera) ||
      matrixTreeFailure(light.target) ||
      shadow.getViewportCount() !== 1 ||
      !shadow.autoUpdate
    )
      return reject("unsupported-shadow-camera");
    if (
      ![
        camera.matrixWorld,
        camera.projectionMatrix,
        light.matrixWorld,
        light.target.matrixWorld,
        shadow.camera.matrixWorld,
        shadow.camera.projectionMatrix,
        shadow.matrix,
      ].every((value) => matrix(value))
    )
      return reject("nonfinite-camera-or-light");
    const key = [
      this.identity(renderer),
      this.identity(scene),
      this.identity(camera),
      contextEpoch,
      resizeEpoch,
      camera.layers.mask,
      matrix(camera.matrixWorld),
      matrix(camera.projectionMatrix),
      camera.near,
      camera.far,
      renderer.shadowMap.type,
      casters,
      [
        this.identity(light),
        light.layers.mask,
        matrix(light.matrixWorld),
        this.identity(light.target),
        matrix(light.target.matrixWorld),
        this.identity(shadow),
        vector(shadow.mapSize),
        shadow.bias,
        shadow.normalBias,
        shadow.radius,
        shadow.intensity,
        matrix(shadow.matrix),
        matrix(shadow.camera.matrixWorld),
        matrix(shadow.camera.projectionMatrix),
        shadow.camera.near,
        shadow.camera.far,
        shadow.camera.left,
        shadow.camera.right,
        shadow.camera.top,
        shadow.camera.bottom,
        shadow.camera.layers.mask,
        vector(shadow.getFrameExtents()),
        shadow.getViewportCount(),
      ],
    ];
    const invalid = (value) =>
      Array.isArray(value)
        ? value.some(invalid)
        : typeof value === "number"
          ? !Number.isFinite(value)
          : value !== null &&
            value !== undefined &&
            !["string", "boolean"].includes(typeof value);
    if (invalid(key)) return reject("nonfinite-key");
    return {
      eligible: true,
      reason: "opaque-pcf-directional",
      key: freeze(serial(key)),
      light,
    };
  }
  safeSnapshot(input) {
    try {
      return this.snapshot(input);
    } catch {
      return {
        eligible: false,
        reason: "unreadable-input",
        key: null,
        light: null,
      };
    }
  }
  beforeRender(input) {
    const before = this.safeSnapshot(input),
      light = before.light,
      renderer = input.renderer;
    const map = before.eligible ? this.mapDescriptor(light) : null;
    const inputSame =
      !!before.key && !!this.previous && exact(before.key, this.previous.key);
    const mapSame = !!map && !!this.previous && exact(map, this.previous.map);
    const explicitDirty =
      !!renderer?.shadowMap?.needsUpdate || !!light?.shadow?.needsUpdate;
    const reuse =
      before.eligible && inputSame && mapSame && !this.dirty && !explicitDirty;
    const applied = this.enabled && before.eligible;
    const ticket = Object.freeze({
      eligible: before.eligible,
      reason: !before.eligible
        ? before.reason
        : !this.enabled
          ? "baseline-disabled"
          : reuse
            ? "same-successful-key"
            : "refresh-required",
      inputSame,
      mapSame,
      explicitDirty,
      casterCount: before.eligible ? before.key[11].length : null,
      reuse: applied && reuse,
      refresh: applied && !reuse,
      applied,
      key: before.key,
    });
    const state = {
      input,
      before,
      originalAuto: renderer?.shadowMap?.autoUpdate,
      revision: this.revision,
      mapBefore: map,
      consumed: false,
    };
    this.tickets.set(ticket, state);
    if (applied) {
      renderer.shadowMap.autoUpdate = false;
      if (!reuse) {
        renderer.shadowMap.needsUpdate = true;
        light.shadow.needsUpdate = true;
      }
    }
    return ticket;
  }
  afterRender(ticket, success) {
    const state = this.tickets.get(ticket);
    if (!state || state.consumed)
      throw new Error("Unknown or consumed shadow ticket");
    state.consumed = true;
    const { input, before } = state,
      renderer = input.renderer,
      light = before.light;
    if (ticket.applied) renderer.shadowMap.autoUpdate = state.originalAuto;
    const succeeded = success === true;
    const post = succeeded ? this.safeSnapshot(input) : null;
    const map = post?.eligible ? this.mapDescriptor(post.light) : null;
    const stable = !!post?.eligible && exact(before.key, post.key);
    // A map replaced after the depth draw is not proven initialized merely
    // because it has the right dimensions. Only a first allocation may appear.
    const mapStable =
      !!map && (!state.mapBefore || exact(state.mapBefore, map));
    const consumed =
      !renderer?.shadowMap?.needsUpdate && !light?.shadow?.needsUpdate;
    const valid =
      succeeded &&
      stable &&
      consumed &&
      mapStable &&
      state.revision === this.revision;
    if (valid) {
      this.previous = { key: post.key, map };
      this.dirty = false;
      return {
        committed: true,
        reused: ticket.reuse,
        reason: "successful-stable-input",
        key: post.key,
      };
    }
    this.invalidate(
      !succeeded
        ? "render-failed"
        : !stable
          ? "input-changed-during-render"
          : !map
            ? "missing-valid-map"
            : !mapStable
              ? "map-changed-during-render"
              : !consumed
                ? "dirty-not-consumed"
                : "invalidated-during-render",
    );
    if (ticket.applied) {
      renderer.shadowMap.needsUpdate = true;
      if (light) light.shadow.needsUpdate = true;
    }
    return {
      committed: false,
      reused: false,
      reason: this.lastInvalidation,
      key: post?.key ?? null,
    };
  }
}
