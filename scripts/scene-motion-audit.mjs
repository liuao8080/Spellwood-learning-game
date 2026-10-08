/** Export real game animation coordinates for an offline Blender geometry audit.
 * No browser, WebGL execution, textures, HUD, particles or sound are claimed. */
import fs from "node:fs";
import path from "node:path";
import { Color, Matrix3, Vector3 } from "three";
import { ArenaScene } from "../src/arena3d/scene.mjs";

const destination = process.argv[2] || path.resolve("test-results", "motion-geometry");
fs.mkdirSync(destination, { recursive: true });
const faceDirectory = process.argv[4] ? path.resolve(process.argv[4]) : null;
const viewport = /^([0-9]{3,4})x([0-9]{3,4})$/.exec(process.argv[5] || "1280x800");
if (!viewport) throw Error("Viewport must be WIDTHxHEIGHT");
const viewWidth = Number(viewport[1]), viewHeight = Number(viewport[2]);
const callbacks = new Map(); let nextId = 0;
const context = new Proxy({}, { get(o, k) { if (k === "measureText") return (s) => ({ width: String(s).length * 26 }); if (String(k).startsWith("create")) return () => ({ addColorStop() {} }); return o[k] || (() => {}); } });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
globalThis.window = { addEventListener() {}, removeEventListener() {} };
globalThis.Image = class {};
globalThis.devicePixelRatio = 1;
globalThis.requestAnimationFrame = (fn) => { const id = ++nextId; callbacks.set(id, fn); return id; };
globalThis.cancelAnimationFrame = (id) => callbacks.delete(id);
const canvas = { dataset: {}, style: {}, getBoundingClientRect: () => ({ width: viewWidth, height: viewHeight, left: 0, top: 0 }), addEventListener() {}, removeEventListener() {} };
class GeometryScene extends ArenaScene {
  createRenderer() { return { shadowMap: {}, info: { render: { triangles: 0, calls: 0 } }, setPixelRatio() {}, setSize() {}, render(scene, camera) { scene.updateMatrixWorld(true); camera.updateMatrixWorld(true); }, dispose() {} }; }
}
const scene = new GeometryScene({ canvas, quality: "medium" });
function frame(now) { const [id, fn] = callbacks.entries().next().value; callbacks.delete(id); fn(now); }
const state = { active: 0, phase: "playing", players: [
  { hp: 18, hand: ["fox", "turtle", "owl", "spark", "bloom"], board: [
    { uid: "fox-attacker", cardId: "fox", atk: 2, hp: 2, maxHp: 2, ready: true },
    { uid: "turtle-ally", cardId: "turtle", atk: 1, hp: 5, maxHp: 5, ready: false },
    { uid: "dragon-ally", cardId: "dragon", atk: 4, hp: 5, maxHp: 5, ready: false },
  ] },
  { hp: 18, handCount: 4, board: [
    { uid: "rabbit-target", cardId: "rabbit", atk: 2, hp: 1, maxHp: 1, ready: true },
    { uid: "golem-neighbor", cardId: "golem", atk: 3, hp: 5, maxHp: 5, ready: true },
    { uid: "stag-enemy", cardId: "stag", atk: 3, hp: 4, maxHp: 4, ready: false },
  ] },
] };
scene.setBattle(state, 0); frame(performance.now());
const evidence = [];
function save(name, timeMs) {
  scene.scene.updateMatrixWorld(true);
  const meshes = [];
  scene.scene.traverse((m) => {
    if (!m.isMesh || m.isSprite || m.userData.pickProxy || m.material.visible === false || !m.visible) return;
    const g = m.geometry, p = g.getAttribute("position"), n = g.getAttribute("normal"), c = g.getAttribute("color");
    if (!p || !n) return;
    const uv = g.getAttribute("uv"), uvs = uv ? [...uv.array] : null;
    const textureId = m.material.map === scene.textures.back ? "back" : [...scene.textures.entries].find(([, entry]) => entry.texture === m.material.map)?.[0];
    const texture = faceDirectory && textureId ? path.join(faceDirectory, textureId + ".png") : null;
    if (texture && !fs.existsSync(texture)) throw Error("Missing offline card texture: " + textureId);
    const positions = [], normals = [], colors = [], normalMatrix = new Matrix3().getNormalMatrix(m.matrixWorld);
    for (let i = 0; i < p.count; i++) {
      positions.push(...new Vector3().fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld).toArray());
      normals.push(...new Vector3().fromBufferAttribute(n, i).applyNormalMatrix(normalMatrix).toArray());
      const color = c ? new Color(c.getX(i), c.getY(i), c.getZ(i)) : m.material.color || new Color(1, 1, 1);
      colors.push(color.r, color.g, color.b, m.material.opacity ?? 1);
    }
    meshes.push({ name: m.name || `mesh-${m.id}`, positions, normals, colors, uvs, indices: g.index ? [...g.index.array] : Array.from({ length: p.count }, (_, i) => i), material: { texture, roughness: m.material.roughness ?? .7, metalness: m.material.metalness ?? 0, emissive: m.material.emissive?.toArray() ?? [0, 0, 0], emissiveIntensity: m.material.emissiveIntensity ?? 0 } });
  });
  const cardMetrics = scene.cards.map(item => {
    const face = item.model.root.getObjectByName("card-front-art");
    const point = (x, y) => scene.project(face.localToWorld(new Vector3((x / 512 - .5) * 1.09, (.5 - y / 720) * 1.64, 0)));
    const fontHeight = (baseline, size) => { const a = point(256, baseline), b = point(256, baseline - size); return Math.hypot(a.x - b.x, a.y - b.y); };
    return { card: item.cardId, selected: scene.selected?.kind === "card" && scene.selected.index === item.index,
      titleEmPixels: fontHeight(440, 48), ruleEmPixels: fontHeight(551, 42), costEmPixels: fontHeight(81, 80),
      approximateFaceHeightPixels: Math.abs(point(256, 720).y - point(256, 0).y) };
  });
  const metadata = { cardMetrics, kind: "ACTUAL SCENE GEOMETRY / OFFLINE RENDER ONLY", mode: "battle", timeMs, source: process.argv[3] === "aim" ? "ArenaScene.updateTargets; renderer and canvas mocked" : process.argv[3] === "card" ? "ArenaScene.select settled pose; renderer and canvas mocked" : "ArenaScene.attack; renderer and canvas mocked", cardTextures: faceDirectory ? "actual CardTextures module painted with offline CPU Canvas" : "omitted", excluded: "Browser UI, WebGL shader output, particles, float text and audio", camera: { position: scene.camera.position.toArray(), target: scene.cameraLook.toArray(), verticalFovDegrees: scene.camera.fov, width: viewWidth, height: viewHeight }, units: [...scene.units].map(([uid, item]) => ({ uid, position: item.model.root.position.toArray() })) };
  fs.writeFileSync(path.join(destination, `${name}.json`), JSON.stringify({ metadata, meshes }));
  evidence.push({ name, ...metadata });
}
if (process.argv[3] === "card") {
  const index = Number(process.argv[6] || 2);
  scene.setReduced(true); scene.select({ kind: "card", index }); frame(performance.now());
  save("05-selected-card", 0);
  fs.writeFileSync(path.join(destination, "card-metrics.json"), JSON.stringify(evidence.at(-1), null, 2));
  scene.dispose(); console.log(JSON.stringify({ destination, frames: 1, scenario: "selected-card", metrics: evidence.at(-1).cardMetrics }));
} else if (process.argv[3] === "aim") {
  scene.select({ kind: "unit", uid: "fox-attacker" });
  scene.hoverTarget({ kind: "unit", uid: "golem-neighbor", seat: 1 });
  frame(performance.now());
  save("04-target-guide", 0);
  fs.writeFileSync(path.join(destination, "target-evidence.json"), JSON.stringify({ kind: "CPU THREE.JS TARGET GEOMETRY, NOT BROWSER RECORDING", frames: evidence }, null, 2));
  scene.dispose();
  console.log(JSON.stringify({ destination, frames: 1, scenario: "target-guide" }));
} else {
save("01-before", 0);
let hits = 0;
const motion = scene.attack("fox-attacker", "rabbit-target", () => hits++);
const start = [...scene.jobs][0].start;
frame(start + 350); save("02-contact", 350);
frame(start + 741); await motion; save("03-return", 741);
fs.writeFileSync(path.join(destination, "evidence.json"), JSON.stringify({ kind: "CPU THREE.JS GEOMETRY TRACE, NOT BROWSER RECORDING", hits, frames: evidence }, null, 2));
scene.dispose();
console.log(JSON.stringify({ destination, frames: evidence.length, hits }));

}
