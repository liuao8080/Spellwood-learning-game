/** Original Spellwood geometry helpers. Pure Three.js; no DOM or render loop. */
import {
  Box3,
  BufferGeometry,
  CatmullRomCurve3,
  Color,
  Euler,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Shape,
  SphereGeometry,
  Vector3,
} from "three";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

export const MODEL_STYLES = Object.freeze({
  matte: { roughness: 0.77, metalness: 0 },
  fur: { roughness: 0.67, metalness: 0 },
  leaf: { roughness: 0.57, metalness: 0 },
  metal: { roughness: 0.38, metalness: 0.82 },
  eye: { roughness: 0.2, metalness: 0 },
  glow: {
    roughness: 0.46,
    metalness: 0,
    emissive: 0xffcd72,
    emissiveIntensity: 0.3,
  },
});

export const clamp = (n, min, max) =>
  Math.min(max, Math.max(min, Number(n) || 0));

export function roundedRectShape(width, height, radius = 0.1) {
  const x = -width / 2,
    y = -height / 2;
  const r = Math.min(radius, width / 2, height / 2);
  const shape = new Shape();
  shape.moveTo(x + r, y);
  shape.lineTo(x + width - r, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + r);
  shape.lineTo(x + width, y + height - r);
  shape.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  shape.lineTo(x + r, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  return shape;
}

export function extrudeShape(shape, depth = 0.1, bevel = 0.025, detail = 4) {
  const geometry = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelSegments: 2,
    bevelThickness: bevel,
    bevelSize: bevel,
    steps: 1,
    curveSegments: detail,
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}

export function roundedSlab(width, height, depth, radius = 0.1, bevel = 0.025) {
  return extrudeShape(roundedRectShape(width, height, radius), depth, bevel);
}

export function polygonSolid(points, depth = 0.1, bevel = 0.015) {
  const shape = new Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (const p of points.slice(1)) shape.lineTo(p[0], p[1]);
  shape.closePath();
  return extrudeShape(shape, depth, bevel);
}

/** A plump leaf with a real ridge, volume, front, back, and sealed edges. */
export function leafSolid(length = 0.45, width = 0.23, thickness = 0.065) {
  const ring = [
    [0, 0, 0],
    [-width * 0.44, length * 0.25, 0],
    [-width / 2, length * 0.53, 0],
    [-width * 0.3, length * 0.82, 0],
    [0, length, 0],
    [width * 0.3, length * 0.82, 0],
    [width / 2, length * 0.53, 0],
    [width * 0.44, length * 0.25, 0],
  ];
  const vertices = [
    ...ring.flat(),
    0,
    length * 0.49,
    thickness,
    0,
    length * 0.49,
    -thickness * 0.45,
  ];
  const indices = [];
  for (let i = 0; i < 8; i++) {
    const next = (i + 1) % 8;
    indices.push(8, next, i, 9, i, next);
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/** Tapered, capped curve used for roots, tails and antlers. */
export function taperedTube(points, radii, segments = 18, sides = 7) {
  const curve = new CatmullRomCurve3(points.map((p) => new Vector3(...p)));
  const frames = curve.computeFrenetFrames(segments, false);
  const pos = [],
    indices = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments,
      p = curve.getPointAt(t);
    const ri = t * (radii.length - 1),
      lo = Math.floor(ri);
    const r =
      radii[lo] + ((radii[lo + 1] ?? radii[lo]) - radii[lo]) * (ri - lo);
    for (let j = 0; j < sides; j++) {
      const angle = (j / sides) * Math.PI * 2;
      const v = p
        .clone()
        .addScaledVector(frames.normals[i], Math.cos(angle) * r)
        .addScaledVector(frames.binormals[i], Math.sin(angle) * r);
      pos.push(v.x, v.y, v.z);
    }
  }
  for (let i = 0; i < segments; i++)
    for (let j = 0; j < sides; j++) {
      const a = i * sides + j,
        b = i * sides + ((j + 1) % sides);
      indices.push(a, b, a + sides, b, b + sides, a + sides);
    }
  const start = pos.length / 3,
    first = curve.getPointAt(0),
    last = curve.getPointAt(1);
  pos.push(first.x, first.y, first.z, last.x, last.y, last.z);
  for (let j = 0; j < sides; j++) {
    indices.push(start, (j + 1) % sides, j);
    indices.push(
      start + 1,
      segments * sides + j,
      segments * sides + ((j + 1) % sides),
    );
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

export function seededRandom(seed = 1) {
  let a = 2166136261;
  if (typeof seed === "string") {
    for (let i = 0; i < seed.length; i++)
      a = Math.imul(a ^ seed.charCodeAt(i), 16777619) >>> 0;
  } else a = (Number(seed) || 1) >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bake local transforms and linear vertex color, then merge by material style. */
export class ModelBuilder {
  constructor({ quality = "medium", palette = {} } = {}) {
    this.quality = quality;
    this.palette = palette;
    this.widthSegments = quality === "low" ? 10 : 14;
    this.heightSegments = quality === "low" ? 6 : 9;
    this.materials = new Map();
    this.geometries = new Set();
    this.parts = [];
    this.disposed = false;
  }
  material(style = "matte") {
    if (!this.materials.has(style)) {
      const material = new MeshStandardMaterial({
        ...MODEL_STYLES[style],
        vertexColors: true,
      });
      material.name = `spellwood-${style}`;
      // CPU compatibility uses the same authored smooth normals as WebGL.
      material.userData.cpuSmooth = true;
      material.userData.baseColor = material.color.clone();
      material.userData.baseEmissive = material.emissive.clone();
      material.userData.baseEmissiveIntensity = material.emissiveIntensity;
      this.materials.set(style, material);
    }
    return this.materials.get(style);
  }
  part(name, parent, position = [0, 0, 0]) {
    const group = new Group();
    group.name = name;
    group.position.set(...position);
    group.userData.bins = new Map();
    group.userData.basePosition = group.position.clone();
    group.userData.baseRotation = group.rotation.clone();
    if (parent) parent.add(group);
    this.parts.push(group);
    return group;
  }
  add(
    part,
    geometry,
    color,
    {
      position = [0, 0, 0],
      scale = [1, 1, 1],
      rotation = [0, 0, 0],
      style = "matte",
    } = {},
  ) {
    if (this.disposed) throw new Error("ModelBuilder disposed");
    const matrix = new Matrix4().compose(
      new Vector3(...position),
      new Quaternion().setFromEuler(new Euler(...rotation)),
      new Vector3(...scale),
    );
    geometry.applyMatrix4(matrix);
    const c = new Color(this.palette[color] ?? color);
    const count = geometry.getAttribute("position").count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) c.toArray(colors, i * 3);
    geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
    // All merged primitives have the same attributes. UVs belong only to card art.
    geometry.deleteAttribute("uv");
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    if (g !== geometry) geometry.dispose();
    const bins = part.userData.bins;
    if (!bins) throw new Error("Cannot add geometry after part compilation");
    if (!bins.has(style)) bins.set(style, []);
    bins.get(style).push(g);
    return g;
  }
  oval(part, color, position, scale, options = {}) {
    const radius = Math.max(...scale);
    const widthSegments =
      radius < 0.065
        ? 6
        : radius < 0.145
          ? 8
          : radius < 0.24
            ? 10
            : this.widthSegments;
    const heightSegments =
      radius < 0.065
        ? 5
        : radius < 0.145
          ? 6
          : radius < 0.24
            ? 7
            : this.heightSegments;
    return this.add(
      part,
      new SphereGeometry(1, widthSegments, heightSegments),
      color,
      { ...options, position, scale },
    );
  }
  compile() {
    for (const group of this.parts) {
      const bins = group.userData.bins;
      if (!bins) continue;
      for (const [style, pieces] of bins) {
        const merged = mergeGeometries(pieces, false);
        if (!merged) throw new Error(`Cannot merge ${group.name}/${style}`);
        // Preserve normal/color seams while sharing identical vertices. This
        // offsets the CPU cost of per-vertex light without adding polygons.
        const geometry = mergeVertices(merged, 0.0001);
        merged.dispose();
        pieces.forEach((g) => g.dispose());
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        this.geometries.add(geometry);
        const mesh = new Mesh(geometry, this.material(style));
        mesh.name = `${group.name}:${style}`;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
      }
      delete group.userData.bins;
    }
  }
  ownMesh(mesh) {
    this.geometries.add(mesh.geometry);
    return mesh;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const part of this.parts) {
      for (const pieces of part.userData.bins?.values() ?? [])
        pieces.forEach((g) => g.dispose());
      delete part.userData.bins;
    }
    this.geometries.forEach((g) => g.dispose());
    this.materials.forEach((m) => m.dispose());
    this.geometries.clear();
    this.materials.clear();
    this.parts.length = 0;
  }
}

export function geometryBudget(root) {
  let triangles = 0,
    meshes = 0,
    vertices = 0;
  root.traverse((obj) => {
    if (!obj.isMesh || obj.userData.pickProxy || obj.userData.effectOnly)
      return;
    meshes++;
    triangles +=
      (obj.geometry.index?.count ??
        obj.geometry.getAttribute("position").count) / 3;
    vertices += obj.geometry.getAttribute("position").count;
  });
  return { triangles, meshes, vertices };
}

export function localBounds(root) {
  root.updateMatrixWorld(true);
  return new Box3().setFromObject(root);
}
