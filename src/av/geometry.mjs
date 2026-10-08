// Small original meshes, projected in software when WebGL2 is unavailable.
// Coordinates are normalized; +z faces the viewer and y follows screen space.
const crystalVertices = [
  [0, -1.2, 0],
  [0.7, 0, 0],
  [0, 0, 0.55],
  [-0.7, 0, 0],
  [0, 0, -0.55],
  [0, 1.2, 0],
];
const crystalFaces = [
  [0, 1, 2],
  [0, 2, 3],
  [0, 3, 4],
  [0, 4, 1],
  [5, 2, 1],
  [5, 3, 2],
  [5, 4, 3],
  [5, 1, 4],
];
const hexVertices = Array.from({ length: 12 }, (_, i) => {
  const a = -Math.PI / 2 + ((i % 6) * Math.PI) / 3;
  return [Math.cos(a), Math.sin(a), i < 6 ? 0.13 : -0.13];
});
const hexFaces = [
  [0, 1, 2, 3, 4, 5],
  [11, 10, 9, 8, 7, 6],
  ...Array.from({ length: 6 }, (_, i) => [
    i,
    (i + 1) % 6,
    ((i + 1) % 6) + 6,
    i + 6,
  ]),
];
export function projectMesh(kind, x, y, size, yaw = 0, roll = 0) {
  const vertices = kind === "shield" ? hexVertices : crystalVertices,
    faces = kind === "shield" ? hexFaces : crystalFaces;
  const cy = Math.cos(yaw),
    sy = Math.sin(yaw),
    cr = Math.cos(roll),
    sr = Math.sin(roll);
  const rotated = vertices.map(([a, b, c]) => {
    const xx = a * cy + c * sy,
      zz = -a * sy + c * cy;
    return [xx * cr - b * sr, xx * sr + b * cr, zz];
  });
  const points = rotated.map(([a, b, c]) => {
    const perspective = 4 / (4 - c);
    return [x + a * size * perspective, y + b * size * perspective];
  });
  return faces
    .map((indices) => {
      const a = rotated[indices[0]],
        b = rotated[indices[1]],
        c = rotated[indices[2]],
        u = b.map((v, i) => v - a[i]),
        v = c.map((n, i) => n - a[i]);
      const normal = [
          u[1] * v[2] - u[2] * v[1],
          u[2] * v[0] - u[0] * v[2],
          u[0] * v[1] - u[1] * v[0],
        ],
        length = Math.hypot(...normal) || 1;
      const light = Math.max(
        0,
        (-normal[0] * 0.35 - normal[1] * 0.55 + normal[2] * 0.75) / length,
      );
      return {
        points: indices.map((i) => points[i]),
        z: indices.reduce((n, i) => n + rotated[i][2], 0) / indices.length,
        front: normal[2] > 0,
        light: 0.22 + 0.78 * light,
      };
    })
    .filter((face) => face.front)
    .sort((a, b) => a.z - b.z);
}
export function drawMesh(
  context,
  kind,
  p,
  size,
  yaw,
  roll,
  color,
  opacity = 1,
) {
  const r = (color >> 16) & 255,
    g = (color >> 8) & 255,
    b = color & 255;
  context.save();
  context.globalCompositeOperation = "source-over";
  context.globalAlpha = opacity;
  for (const face of projectMesh(kind, p.x, p.y, size, yaw, roll)) {
    const brightness = face.light;
    context.beginPath();
    face.points.forEach(([x, y], i) =>
      i ? context.lineTo(x, y) : context.moveTo(x, y),
    );
    context.closePath();
    context.fillStyle = `rgb(${Math.round(r * brightness)},${Math.round(g * brightness)},${Math.round(b * brightness)})`;
    context.fill();
    context.lineWidth = kind === "shield" ? 2 : 0.7;
    context.strokeStyle =
      kind === "shield" ? "#c6f2ff" : "rgba(255,250,219,.55)";
    context.stroke();
  }
  context.restore();
}
