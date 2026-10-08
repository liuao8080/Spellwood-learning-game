/** Offline model audit input, NOT a browser or game screenshot. */
import fs from "node:fs";
import path from "node:path";
import { Color, Group, Matrix3, Vector3 } from "three";
import { createModelLibrary } from "../src/arena3d/models.mjs";

const output =
  process.argv[2] ?? path.resolve("test-results", "model-preview-scene.json");
const mode = process.argv[3] ?? "arena";
const library = createModelLibrary();
const root = new Group();
const metadata = {
  kind: "OFFLINE MODEL PREVIEW, NOT BROWSER SCREENSHOT",
  models: {},
  mode,
};
if (mode === "arena" || mode === "battle") {
  const arena = library.createArena();
  root.add(arena.root);
  metadata.models.arena = arena.metrics;
}
let i = 0;
const speciesList =
  mode === "battle"
    ? ["rabbit", "stag", "sprite", "golem", "fox", "turtle", "owl", "dragon"]
    : mode === "collection"
      ? library.supportedSpecies
      : ["fox", "turtle", "owl"];
for (const species of speciesList) {
  const model = library.createCreature({ species, variantSeed: 1 });
  model.applyPose({ idlePhase: 0 });
  if (mode === "battle") {
    model.root.position.set(
      [-4.8, -1.6, 1.6, 4.8][i % 4],
      0.08,
      i < 4 ? -2 : 2,
    );
    model.root.scale.setScalar(1.3);
  } else if (mode === "collection")
    model.root.position.set(
      ((i % 3) - 1) * 2.9,
      0,
      (Math.floor(i / 3) - 1) * 3.1,
    );
  else
    model.root.position.set(
      (i - 1) * (mode === "arena" ? 3.15 : 2.55),
      mode === "arena" ? 0.03 : 0,
      mode === "arena" ? 1.0 : 0,
    );
  model.root.rotation.y =
    mode === "battle" ? (i < 4 ? 0.12 : -0.12) : [0.18, -0.1, -0.16][i % 3];
  root.add(model.root);
  metadata.models[species] = model.metrics;
  i++;
}
if (mode === "arena") {
  const card = library.createCard();
  card.root.position.set(4.9, 0.55, 4.25);
  card.root.rotation.set(-Math.PI / 2 + 0.2, 0, -0.3);
  root.add(card.root);
  metadata.models.card = card.metrics;
}
if (mode === "battle") {
  metadata.camera = {
    position: [0, 16.4, 18.6],
    target: [0, 0, 0.2],
    verticalFovDegrees: 36,
    width: 1280,
    height: 800,
  };
  metadata.cardCount = 7;
  metadata.cardFaces =
    "Untextured geometry placeholders for layout, not final game card faces";
  metadata.unitScale = 1.3;
  for (let index = 0; index < 7; index++) {
    const center = index - 3;
    const card = library.createCard();
    card.root.position.set(
      center * 1.63,
      0.72 - Math.abs(center) * 0.035,
      6.5 + Math.abs(center) * 0.045,
    );
    card.root.scale.setScalar(1.46);
    card.root.rotation.set(-0.91, center * -0.017, center * -0.035);
    root.add(card.root);
    metadata.models.card = card.metrics;
  }
}
root.updateMatrixWorld(true);
const meshes = [];
root.traverse((m) => {
  if (!m.isMesh || m.userData.pickProxy || !m.material.visible) return;
  const g = m.geometry,
    p = g.getAttribute("position"),
    n = g.getAttribute("normal"),
    c = g.getAttribute("color");
  const positions = [],
    normals = [],
    colors = [];
  const normalMatrix = new Matrix3().getNormalMatrix(m.matrixWorld);
  for (let i = 0; i < p.count; i++) {
    positions.push(
      ...new Vector3()
        .fromBufferAttribute(p, i)
        .applyMatrix4(m.matrixWorld)
        .toArray(),
    );
    normals.push(
      ...new Vector3()
        .fromBufferAttribute(n, i)
        .applyNormalMatrix(normalMatrix)
        .toArray(),
    );
    const color = c
      ? new Color(c.getX(i), c.getY(i), c.getZ(i))
      : m.material.color;
    colors.push(color.r, color.g, color.b, 1);
  }
  meshes.push({
    name: m.name,
    positions,
    normals,
    colors,
    indices: g.index
      ? [...g.index.array]
      : Array.from({ length: p.count }, (_, i) => i),
    material: {
      roughness: m.material.roughness ?? 0.7,
      metalness: m.material.metalness ?? 0,
      emissive: m.material.emissive?.toArray() ?? [0, 0, 0],
      emissiveIntensity: m.material.emissiveIntensity ?? 0,
    },
  });
});
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, JSON.stringify({ metadata, meshes }));
console.log(JSON.stringify({ output, metadata, meshCount: meshes.length }));
library.dispose();
