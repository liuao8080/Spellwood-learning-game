/** Original solid geometry compiler. One mesh per surface, CPU-readable pose baking. */
import {
  BufferGeometry,
  Float32BufferAttribute,
  SphereGeometry,
  CylinderGeometry,
  BoxGeometry,
  LatheGeometry,
  Vector2,
  Vector3,
  Matrix4,
  Euler,
  Quaternion,
  Color,
  Mesh,
  MeshStandardMaterial,
  Shape,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  leafSolid,
  polygonSolid,
  taperedTube,
  extrudeShape,
} from "./model-utils.mjs";
export class HeroGeometry {
  constructor(quality) {
    this.quality = quality;
    this.parts = { body: [], accent: [], plinth: [] };
    this.ranges = { body: [], accent: [], plinth: [] };
    this.sides = quality === "low" ? 8 : quality === "medium" ? 12 : 20;
  }
  add(
    g,
    color,
    position = [0, 0, 0],
    scale = [1, 1, 1],
    rotation = [0, 0, 0],
    joint = "body",
    surface = "body",
  ) {
    g.applyMatrix4(
      new Matrix4().compose(
        new Vector3(...position),
        new Quaternion().setFromEuler(new Euler(...rotation)),
        new Vector3(...scale),
      ),
    );
    g.deleteAttribute("uv");
    if (!g.index) {
      const indexed = Array.from(
        { length: g.attributes.position.count },
        (_, i) => i,
      );
      g.setIndex(indexed);
    }
    const c = new Color(color),
      colors = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) c.toArray(colors, i);
    g.setAttribute("color", new Float32BufferAttribute(colors, 3));
    this.parts[surface].push(g);
    this.ranges[surface].push({ joint, count: g.attributes.position.count });
    return g;
  }
  oval(
    color,
    p,
    s,
    j = "body",
    surface = "body",
    detail = "normal",
    rot = [0, 0, 0],
  ) {
    const high = this.quality === "high",
      low = this.quality === "low";
    const w =
      detail === "face"
        ? low
          ? 12
          : high
            ? 24
            : 18
        : detail === "tiny"
          ? low
            ? 4
            : high
              ? 10
              : 6
          : low
            ? 6
            : high
              ? 12
              : 8;
    const h =
      detail === "face"
        ? low
          ? 8
          : high
            ? 16
            : 12
        : detail === "tiny"
          ? low
            ? 3
            : high
              ? 7
              : 4
          : low
            ? 3
            : high
              ? 8
              : 6;
    return this.add(new SphereGeometry(1, w, h), color, p, s, rot, j, surface);
  }
  box(color, p, s, j = "body", rot = [0, 0, 0], surface = "body") {
    return this.add(
      new BoxGeometry(...s),
      color,
      p,
      [1, 1, 1],
      rot,
      j,
      surface,
    );
  }
  profile(
    color,
    points,
    p = [0, 0, 0],
    scale = [1, 1, 1],
    j = "body",
    surface = "body",
    sides = this.sides,
  ) {
    return this.add(
      new LatheGeometry(
        points.map((v) => new Vector2(...v)),
        sides,
      ),
      color,
      p,
      scale,
      [0, 0, 0],
      j,
      surface,
    );
  }
  rod(color, a, b, r = 0.035, j = "body", surface = "body", sides) {
    const start = new Vector3(...a),
      end = new Vector3(...b),
      direction = end.clone().sub(start);
    const q = new Quaternion().setFromUnitVectors(
      new Vector3(0, 1, 0),
      direction.clone().normalize(),
    );
    const g = new CylinderGeometry(
      r,
      r,
      direction.length(),
      sides ?? (this.quality === "low" ? 5 : 8),
    );
    g.applyQuaternion(q);
    return this.add(
      g,
      color,
      start.add(end).multiplyScalar(0.5).toArray(),
      [1, 1, 1],
      [0, 0, 0],
      j,
      surface,
    );
  }
  taper(color, points, radii, j = "body", surface = "body") {
    return this.add(
      taperedTube(
        points,
        radii,
        this.quality === "low" ? 5 : 10,
        this.quality === "low" ? 6 : 10,
      ),
      color,
      [0, 0, 0],
      [1, 1, 1],
      [0, 0, 0],
      j,
      surface,
    );
  }
  tube(color, points, r = 0.03, j = "body", surface = "body", segments) {
    return this.add(
      taperedTube(
        points,
        [r, r * 0.85],
        segments ?? (this.quality === "low" ? 4 : 8),
        this.quality === "low" ? 4 : 6,
      ),
      color,
      [0, 0, 0],
      [1, 1, 1],
      [0, 0, 0],
      j,
      surface,
    );
  }
  softPanel(
    color,
    points,
    p = [0, 0, 0],
    depth = 0.065,
    j = "body",
    rot = [0, 0, 0],
    surface = "body",
    round = 0.5,
  ) {
    const shape = new Shape(),
      first = points[0],
      last = points[points.length - 1];
    shape.moveTo(
      first[0] + (last[0] - first[0]) * round,
      first[1] + (last[1] - first[1]) * round,
    );
    for (let i = 0; i < points.length; i++) {
      const a = points[i],
        prev = points[(i + points.length - 1) % points.length],
        next = points[(i + 1) % points.length];
      shape.lineTo(
        a[0] + (prev[0] - a[0]) * round,
        a[1] + (prev[1] - a[1]) * round,
      );
      shape.quadraticCurveTo(
        a[0],
        a[1],
        a[0] + (next[0] - a[0]) * round,
        a[1] + (next[1] - a[1]) * round,
      );
    }
    shape.closePath();
    return this.add(
      extrudeShape(shape, depth, 0, this.quality === "low" ? 2 : 5),
      color,
      p,
      [1, 1, 1],
      rot,
      j,
      surface,
    );
  }
  boot(color, p, j = "body") {
    const n = this.quality === "low" ? 8 : this.quality === "high" ? 16 : 12,
      positions = [],
      indices = [],
      rings = [
        [0, 0.13, 0.17, 0.055],
        [0.06, 0.155, 0.215, 0.065],
        [0.15, 0.155, 0.22, 0.06],
        [0.22, 0.126, 0.13, 0],
        [0.33, 0.123, 0.13, 0],
      ];
    for (const [y, rx, rz, cz] of rings)
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        positions.push(Math.cos(a) * rx, y, Math.sin(a) * rz + cz);
      }
    const start = positions.length / 3;
    positions.push(0, 0, 0.055, 0, 0.33, 0);
    for (let r = 0; r < rings.length - 1; r++)
      for (let k = 0; k < n; k++) {
        const a = r * n + k,
          z = r * n + ((k + 1) % n);
        indices.push(a, z, a + n, z, z + n, a + n);
      }
    for (let k = 0; k < n; k++) {
      indices.push(start, (k + 1) % n, k);
      const o = (rings.length - 1) * n;
      indices.push(start + 1, o + k, o + ((k + 1) % n));
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(positions, 3));
    for (let i = 0; i < indices.length; i += 3) {
      const t = indices[i + 1];
      indices[i + 1] = indices[i + 2];
      indices[i + 2] = t;
    }
    g.setIndex(indices);
    g.computeVertexNormals();
    const added = this.add(g, color, p, [1, 1, 1], [0, 0, 0], j),
      shade = new Color(color).multiplyScalar(0.57),
      pos = added.attributes.position,
      colors = added.attributes.color;
    for (let k = 0; k < pos.count; k++)
      if (pos.getY(k) < p[1] + 0.065) shade.toArray(colors.array, k * 3);
    return added;
  }
  panel(
    color,
    points,
    p = [0, 0, 0],
    depth = 0.065,
    j = "body",
    rot = [0, 0, 0],
    surface = "body",
  ) {
    return this.add(
      polygonSolid(points, depth, 0),
      color,
      p,
      [1, 1, 1],
      rot,
      j,
      surface,
    );
  }
  leaf(color, p, length, width, j = "body", rot = [0, 0, 0], surface = "body") {
    return this.add(
      leafSolid(length, width, 0.04),
      color,
      p,
      [1, 1, 1],
      rot,
      j,
      surface,
    );
  }
  arc(
    color,
    p,
    radius,
    start,
    end,
    j = "body",
    surface = "accent",
    thickness = 0.035,
  ) {
    const n = this.quality === "low" ? 8 : 14,
      points = [];
    for (let i = 0; i <= n; i++) {
      const a = start + ((end - start) * i) / n;
      points.push([
        p[0] + Math.cos(a) * radius,
        p[1] + Math.sin(a) * radius,
        p[2],
      ]);
    }
    return this.tube(color, points, thickness, j, surface, n);
  }
  compile(root) {
    const compiled = [];
    for (const surface of ["body", "accent", "plinth"]) {
      const chunks = this.parts[surface],
        geometry = mergeGeometries(chunks, false);
      chunks.forEach((g) => g.dispose());
      geometry.clearGroups();
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const material = new MeshStandardMaterial({
        vertexColors: true,
        roughness: surface === "accent" ? 0.42 : 0.78,
        metalness: surface === "accent" ? 0.1 : 0,
      });
      material.name = `hero-${surface}`;
      material.userData.cpuSmooth = true;
      const mesh = new Mesh(geometry, material);
      mesh.name = `hero-${surface}`;
      mesh.castShadow = surface === "body";
      mesh.receiveShadow = true;
      root.add(mesh);
      let start = 0;
      const ranges = this.ranges[surface].map((r) => {
        const v = { ...r, start };
        start += r.count;
        return v;
      });
      compiled.push({
        mesh,
        ranges,
        bindPosition: geometry.attributes.position.array.slice(),
        bindNormal: geometry.attributes.normal.array.slice(),
      });
    }
    this.parts = null;
    return compiled;
  }
}
