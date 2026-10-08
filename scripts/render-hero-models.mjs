/** Offline proof: actual application SoftwareRenderer and authored BufferGeometry.
 * Optional @napi-rs/canvas development dependency; never starts a browser.
 * Usage: node scripts/render-hero-models.mjs OUTPUT ID,ID QUALITY [views|detail|poses|contact]
 * Render at most six models per invocation. `contact` reads completed images only. */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { Scene, PerspectiveCamera } from "three";
import { ALL_HERO_SKINS, HERO_SKIN_VERSION } from "../src/hero-skins.mjs";
import { createHeroModel } from "../src/arena3d/hero-models.mjs";
import { SoftwareRenderer } from "../src/arena3d/software-renderer.mjs";
const require = createRequire(import.meta.url),
  { createCanvas, loadImage } = require(process.env.SPELLWOOD_CANVAS_MODULE || "@napi-rs/canvas");
const output = path.resolve(
  process.argv[2] || "test-results/hero-qa",
);
fs.mkdirSync(output, { recursive: true });
const mode = process.argv[5] || "views",
  quality = process.argv[4] || "high";
const ids = (
  process.argv[3] ||
  (mode === "contact" ? ALL_HERO_SKINS : ALL_HERO_SKINS.slice(0, 4))
    .map((s) => s.id)
    .join(",")
).split(",");
if (mode !== "contact" && ids.length > 6)
  throw Error(
    "Render at most six models per batch; assemble all completed images with contact mode",
  );
const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const save = (name, bytes) => {
  fs.writeFileSync(path.join(output, name), bytes);
  return { file: name, sha256: hash(bytes), bytes: bytes.length };
};
const dimensions = mode === "detail" ? [768, 768] : [384, 480],
  [width, height] = dimensions;
const canvas = createCanvas(width, height),
  renderer = new SoftwareRenderer(canvas);
renderer.setSize(width, height);
const scene = new Scene(),
  camera = new PerspectiveCamera(34, width / height, 0.1, 30);
camera.position.set(0, 2.05, 5.4);
camera.lookAt(0, 1.23, 0);
const rows = [];
if (mode === "contact") {
  renderer.dispose();
  const cols = 5,
    cellWidth = 240,
    cellHeight = 328,
    sheet = createCanvas(
      cols * cellWidth,
      Math.ceil(ids.length / cols) * cellHeight,
    ),
    ctx = sheet.getContext("2d");
  ctx.fillStyle = "#f0ebdf";
  ctx.fillRect(0, 0, sheet.width, sheet.height);
  const silhouette = createCanvas(
      cols * 160,
      Math.ceil(ids.length / cols) * 146,
    ),
    sil = silhouette.getContext("2d");
  sil.fillStyle = "#f0ebdf";
  sil.fillRect(0, 0, silhouette.width, silhouette.height);
  const tile = createCanvas(77, 96),
    tileContext = tile.getContext("2d");
  const manifest = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i],
      image = await loadImage(path.join(output, `${id}-${quality}-front.png`));
    ctx.drawImage(
      image,
      (i % cols) * cellWidth,
      Math.floor(i / cols) * cellHeight,
      cellWidth,
      300,
    );
    ctx.fillStyle = "#233d39";
    ctx.font = "13px sans-serif";
    ctx.fillText(
      id,
      (i % cols) * cellWidth + 8,
      Math.floor(i / cols) * cellHeight + 319,
    );
    tileContext.clearRect(0, 0, 77, 96);
    tileContext.drawImage(image, 0, 0, 77, 96);
    const pixels = tileContext.getImageData(0, 0, 77, 96);
    for (let p = 0; p < pixels.data.length; p += 4) {
      const isBackground =
        pixels.data[p] === 7 &&
        pixels.data[p + 1] === 27 &&
        pixels.data[p + 2] === 32;
      pixels.data[p] = isBackground ? 240 : 13;
      pixels.data[p + 1] = isBackground ? 235 : 13;
      pixels.data[p + 2] = isBackground ? 223 : 13;
      pixels.data[p + 3] = 255;
    }
    sil.putImageData(
      pixels,
      (i % cols) * 160 + 41,
      Math.floor(i / cols) * 146 + 4,
    );
    sil.fillStyle = "#233d39";
    sil.font = "11px sans-serif";
    sil.fillText(id, (i % cols) * 160 + 5, Math.floor(i / cols) * 146 + 125);
    const buffers = {};
    for (const format of ["thumb.webp", "portrait.webp"]) {
      const name = `${id}-${format}`,
        bytes = fs.readFileSync(path.join(output, name));
      buffers[format] = {
        file: name,
        bytes: bytes.length,
        sha256: hash(bytes),
      };
    }
    manifest.push({
      skinId: id,
      assetVersion: HERO_SKIN_VERSION,
      source: "original-authored-3d-model-offline-application-cpu-render",
      modelKey: id,
      quality,
      thumb: { width: 192, height: 256, ...buffers["thumb.webp"] },
      portrait: { width: 384, height: 480, ...buffers["portrait.webp"] },
    });
  }
  save(`contact-${quality}-${ids.length}.png`, sheet.toBuffer("image/png"));
  save(`silhouettes-96px-${ids.length}.png`, silhouette.toBuffer("image/png"));
  save("asset-manifest.json", Buffer.from(JSON.stringify(manifest, null, 2)));
  console.log(
    JSON.stringify({
      kind: "offline-cpu-model-contact",
      models: ids.length,
      output,
    }),
  );
} else {
  const small = createCanvas(192, 256);
  for (const id of ids) {
    const model = createHeroModel(id, { quality });
    scene.add(model.root);
    const result = { ...model.metrics, views: [] };
    let views = [
      ["front", 0],
      ["side", Math.PI / 2],
      ["back", Math.PI],
    ];
    if (mode === "detail") {
      views = [["face", 0]];
      camera.position.set(0, 1.86, 1.72);
      camera.lookAt(0, 1.76, 0.03);
    }
    if (mode === "poses")
      views = [
        "idle",
        "charge",
        "cast",
        "hit",
        "heal",
        "armor",
        "win",
        "lose",
      ].map((action) => [action, 0]);
    for (const [view, angle] of views) {
      model.reset();
      model.root.rotation.y = angle;
      if (mode === "poses")
        model.applyPose({ action: view, progress: 0.59, idlePhase: 0.8 });
      renderer.render(scene, camera);
      const filename = `${id}-${quality}-${view}.png`,
        record = save(filename, canvas.toBuffer("image/png"));
      result.views.push({
        view,
        ...record,
        renderMs: renderer.lastRenderMs,
        submittedTriangles: renderer.info.render.triangles,
      });
      if (mode === "views" && view === "front") {
        small.getContext("2d").drawImage(canvas, 0, 0, 192, 256);
        save(`${id}-${quality}-thumb.webp`, small.toBuffer("image/webp"));
        save(`${id}-${quality}-portrait.webp`, canvas.toBuffer("image/webp"));
        if (quality === "high") {
          save(`${id}-thumb.webp`, small.toBuffer("image/webp"));
          save(`${id}-portrait.webp`, canvas.toBuffer("image/webp"));
        }
      }
    }
    model.dispose();
    rows.push(result);
    console.log(
      JSON.stringify({
        id,
        quality,
        triangles: result.triangles,
        meshes: result.meshes,
      }),
    );
  }
  renderer.dispose();
  if (mode === "views") {
    const sheet = createCanvas(width * 3, (height + 28) * ids.length),
      ctx = sheet.getContext("2d");
    ctx.fillStyle = "#f1ecdf";
    ctx.fillRect(0, 0, sheet.width, sheet.height);
    for (let row = 0; row < ids.length; row++)
      for (let col = 0; col < 3; col++) {
        const view = ["front", "side", "back"][col],
          bitmap = await loadImage(
            path.join(output, `${ids[row]}-${quality}-${view}.png`),
          );
        ctx.drawImage(bitmap, col * width, row * (height + 28));
        ctx.fillStyle = "#1c3938";
        ctx.font = "16px sans-serif";
        ctx.fillText(
          `${ids[row]} / ${view}`,
          col * width + 8,
          row * (height + 28) + height + 20,
        );
      }
    save(
      `views-${quality}-${ids[0]}-${ids.at(-1)}.png`,
      sheet.toBuffer("image/png"),
    );
  }
  save(
    `metrics-${mode}-${quality}-${ids[0]}-${ids.at(-1)}.json`,
    Buffer.from(
      JSON.stringify(
        {
          kind: "offline-application-cpu-render",
          browserVerified: false,
          webglVerified: false,
          models: rows,
        },
        null,
        2,
      ),
    ),
  );
}
fs.writeFileSync(
  path.join(output, "README.txt"),
  "These images use the actual application SoftwareRenderer and actual hero BufferGeometry in an offline Node canvas. They prove authored solid geometry under the CPU path. They do not prove browser/WebGL performance, scene integration, reward ownership, or deployment. Models are created and released one at a time; contact sheets assemble saved images.\n",
);
