/** Offline CPU pixels from actual application consumers. No browser/GPU/FPS claim.
 * SPELLWOOD_CANVAS_MODULE may point at an installed @napi-rs/canvas or skia-canvas.
 * Run through heavy_job.py. Modes: units, arena, arena-idle, arena-cast,
 * arena-baseline, or art OUTPUT [batch 0|1]. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { Scene, PerspectiveCamera } from 'three';
import { CARD } from '../src/cards.mjs';
import { CardTextures } from '../src/arena3d/card-textures.mjs';
import { createModelLibrary } from '../src/arena3d/models.mjs';
import { ArenaScene } from '../src/arena3d/scene.mjs';
import { SoftwareRenderer } from '../src/arena3d/software-renderer.mjs';
import { createElementalCast } from '../src/arena3d/elemental-effects.mjs';
import { Vector3 } from 'three';

const require = createRequire(import.meta.url);
const canvasModule = require(process.env.SPELLWOOD_CANVAS_MODULE || '@napi-rs/canvas');
const createCanvas = canvasModule.createCanvas || ((w, h) => new canvasModule.Canvas(w, h));
const { loadImage } = canvasModule;
const mode = process.argv[2] || 'units', output = path.resolve(process.argv[3] || 'test-results/expansion-qa');
fs.mkdirSync(output, { recursive: true });
const write = async (name, canvas) => fs.writeFileSync(path.join(output, name), await canvas.toBuffer(canvasModule.createCanvas ? 'image/png' : 'png'));
const units = Object.values(CARD).filter(card => card.artPath && card.type !== 'spell');
globalThis.document = { createElement: () => createCanvas(1, 1), visibilityState: 'visible' };
globalThis.Image = class {};
globalThis.window = { addEventListener() {}, removeEventListener() {} };
globalThis.devicePixelRatio = 1;
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};
const report = { kind: 'offline-application-cpu-pixels', mode, browserVerified: false, webglVerified: false,
  sourceSha256: Object.fromEntries(['software-renderer.mjs', 'creature-expansion-v4.mjs', 'scene.mjs'].map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(new URL(`../src/arena3d/${file}`, import.meta.url))).digest('hex')])), rows: [] };

if (mode === 'units') {
  const canvas = createCanvas(240, 272), renderer = new SoftwareRenderer(canvas);
  renderer.setSize(240, 272);
  const scene = new Scene(), camera = new PerspectiveCamera(35, 240 / 272, .1, 30);
  camera.position.set(2.7, 2.65, 4.6); camera.lookAt(0, .94, 0);
  const sheet = createCanvas(960, 612), ctx = sheet.getContext('2d');
  ctx.fillStyle = '#eee6d6'; ctx.fillRect(0, 0, 960, 612);
  for (const [i, card] of units.entries()) {
    const library = createModelLibrary({ quality: 'low' }), model = library.createCreature({ species: card.id });
    scene.add(model.root); model.applyPose({ idlePhase: 0 }); renderer.render(scene, camera);
    ctx.drawImage(canvas, i % 4 * 240, Math.floor(i / 4) * 306);
    ctx.fillStyle = '#233d39'; ctx.font = '16px sans-serif'; ctx.fillText(card.en, i % 4 * 240 + 8, Math.floor(i / 4) * 306 + 294);
    report.rows.push({ id: card.id, ...model.metrics });
    library.dispose();
  }
  await write('units-low-contact.png', sheet); renderer.dispose();
} else if (mode.startsWith('arena')) {
  const canvas = createCanvas(960, 600);
  Object.assign(canvas, { dataset: {}, style: {}, getBoundingClientRect: () => ({ width: 960, height: 600, left: 0, top: 0 }), addEventListener() {}, removeEventListener() {} });
  class OfflineArena extends ArenaScene { createRenderer() { return new SoftwareRenderer(canvas); } }
  const arena = new OfflineArena({ canvas, quality: 'low', externalHand: true, reduced: true, heroSkins: { self: 'forest_apprentice', opponent: 'butterfly_scholar' } });
  const fieldCards = mode === 'arena-baseline' ? ['fox', 'sprite', 'sprout', 'turtle', 'owl', 'bear', 'stag', 'dragon'].map(id => CARD[id]) : units;
  arena.setBattle({ active: 0, phase: 'playing', players: [0, 1].map(seat => ({ hp: 18, hand: [], handCount: 3, board: fieldCards.slice(seat * 4, seat * 4 + 4).map((card, i) => ({ uid: `qa-${seat}-${i}`, cardId: card.id, atk: card.atk, hp: card.hp, maxHp: card.hp, ready: true })) })) }, 0);
  for (const [uid, shadow] of arena.contactShadows) { const item = arena.units.get(uid); shadow.position.set(item.base.x + .12, .035, item.base.z + .13); shadow.scale.setScalar(arena.scaleFor(item.unit.cardId) / 1.3); }
  const benchmark = mode !== 'arena', cast = mode === 'arena-cast';
  const fx = cast ? createElementalCast({ element: 'fire', from: arena.heroes[0].model.anchors.projectile.getWorldPosition(new Vector3()), to: [...arena.units.values()][5].model.anchors.impact.getWorldPosition(new Vector3()) }) : null;
  if (fx) arena.temporary.add(fx.root);
  const renderSamples = [], poseSamples = [];
  for (let frame = 0; frame < (benchmark ? 15 : 1); frame++) {
    const poseStart = performance.now();
    if (benchmark) {
      for (const item of arena.units.values()) item.model.applyPose({ idlePhase: frame * .1, attackProgress: 0 });
      for (const hero of arena.heroes) hero.model.applyPose({ time: frame * .1, ...(cast ? { castProgress: frame / 14 } : {}) });
      fx?.update(frame / 14);
    }
    const poseMs = performance.now() - poseStart;
    arena.renderer.render(arena.scene, arena.camera);
    if (frame >= 3) { renderSamples.push(arena.renderer.lastRenderMs); poseSamples.push(poseMs); }
  }
  const sorted = [...renderSamples].sort((a, b) => a - b), poseSorted = [...poseSamples].sort((a, b) => a - b);
  report.rows.push({ viewport: [960, 600], renderMs: arena.renderer.lastRenderMs, ...arena.renderer.info.render, unitIds: fieldCards.map(card => card.id), unitTriangles: [...arena.units.values()].reduce((n, item) => n + item.model.metrics.triangles, 0), heroTriangles: arena.heroes.reduce((n, hero) => n + hero.model.metrics.triangles, 0),
    ...(benchmark ? { sampleFrames: 12, warmupFrames: 3, medianRenderMs: (sorted[5] + sorted[6]) / 2, p95RenderMs: sorted[11], medianPoseMs: (poseSorted[5] + poseSorted[6]) / 2, samplesMs: renderSamples, quantiles: 'Median averages the middle pair; p95 is nearest-rank (12 samples).',
      sampling: 'Full arena, eight units, two heroes, three enemy card backs, deck stacks, contact shadows and fireflies. Direct semantic poses; cast includes a real fire effect. Node CPU render-only time excludes pose, browser, DOM and frame scheduling; no FPS claim.' } : {}) });
  await write(benchmark ? `${mode}.png` : 'arena-eight-units-two-heroes.png', canvas); fx?.dispose(); arena.dispose();
} else if (mode === 'art') {
  const batch = Number(process.argv[4] || 0), cards = Object.values(CARD).filter(card => card.artPath).slice(batch * 6, batch * 6 + 6);
  if (cards.length !== 6) throw Error('Art batch must be 0 or 1');
  for (const face of ['full', 'hand']) {
    const sheet = createCanvas(768, 720), ctx = sheet.getContext('2d'), textures = new CardTextures();
    for (const [i, card] of cards.entries()) {
      textures.get(card.id, 'base', face);
      const entry = textures.entries.get(face === 'hand' ? `${card.id}:base:hand` : `${card.id}:base`);
      const image = await loadImage(path.resolve('dist', card.artPath.slice(1)));
      if (!image.naturalWidth) Object.defineProperties(image, { naturalWidth: { value: image.width }, naturalHeight: { value: image.height } });
      textures.paint(card.id, entry, image);
      ctx.drawImage(entry.canvas, i % 3 * 256, Math.floor(i / 3) * 360, 256, 360);
    }
    await write(`art-${face}-${batch}.png`, sheet); textures.dispose();
  }
  report.rows = cards.map(card => ({ id: card.id, path: card.artPath, fit: 'contain-full-source' }));
} else throw Error('Unknown mode');
fs.writeFileSync(path.join(output, `${mode}${mode === 'art' ? '-' + (process.argv[4] || 0) : ''}.json`), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
