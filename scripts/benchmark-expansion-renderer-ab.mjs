/** Same-process renderer A/B. Run serially with bounded development resources.
 * One scene/pose per pair; alternates first renderer; each case gets 15 warmups
 * and 24 measured frames per renderer. Optional canvas module path matches render-expansion-visuals. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { Vector3 } from 'three';
import { CARD } from '../src/cards.mjs';
import { ArenaScene } from '../src/arena3d/scene.mjs';
import { SoftwareRenderer as CurrentRenderer } from '../src/arena3d/software-renderer.mjs';
import { createElementalCast } from '../src/arena3d/elemental-effects.mjs';

const require = createRequire(import.meta.url), canvasModulePath = require.resolve(process.env.SPELLWOOD_CANVAS_MODULE || '@napi-rs/canvas'), canvasModule = require(canvasModulePath);
const createCanvas = canvasModule.createCanvas || ((w, h) => new canvasModule.Canvas(w, h));
const output = path.resolve(process.argv[2] || 'test-results/renderer-ab');
const beforeFile = process.argv[3];
if (!beforeFile) throw Error('Pass a baseline source file: node scripts/benchmark-expansion-renderer-ab.mjs [output-directory] baseline-renderer.mjs');
fs.mkdirSync(output, { recursive: true });
const rawFile = path.join(output, `samples-${Date.now()}.jsonl`);
fs.appendFileSync(rawFile, JSON.stringify({ kind: 'start', execArgv: process.execArgv, viewport: [960, 600] }) + '\n');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const beforeSource = fs.readFileSync(beforeFile, 'utf8');
let instrumented = beforeSource.replace(/from ["']three["']/, `from ${JSON.stringify(pathToFileURL(path.resolve('node_modules/three/build/three.module.js')).href)}`);
const replaceOnce = (from, to) => { if (instrumented.split(from).length !== 2) throw Error(`Instrumentation marker must occur once: ${from}`); instrumented = instrumented.replace(from, to); };
if (!beforeSource.includes('this.lastRenderBreakdown =')) {
replaceOnce('    // Opaque and textured geometry use per-pixel depth,', '    const geometryFinished = performance.now();\n    // Opaque and textured geometry use per-pixel depth,');
replaceOnce('    const translucent = [], overlays = [];', '    const staticFinished = performance.now();\n    const translucent = [], overlays = [];');
replaceOnce('    ctx.putImageData(this.frame, 0, 0);', '    const rasterFinished = performance.now();\n    ctx.putImageData(this.frame, 0, 0);');
replaceOnce('    this.lastRenderMs = performance.now() - start;', '    const finished = performance.now();\n    this.lastRenderMs = finished - start;\n    this.lastRenderBreakdown = { geometryMs: geometryFinished - start, staticMs: staticFinished - geometryFinished, dynamicRasterMs: rasterFinished - staticFinished, presentMs: finished - rasterFinished };');
}
const { SoftwareRenderer: BeforeRenderer } = await import(`data:text/javascript;base64,${Buffer.from(instrumented).toString('base64')}`);

globalThis.document = { createElement: () => createCanvas(1, 1), visibilityState: 'visible' };
globalThis.Image = class {};
globalThis.window = { addEventListener() {}, removeEventListener() {} };
globalThis.devicePixelRatio = 1;
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};
const makeCanvas = () => Object.assign(createCanvas(960, 600), { dataset: {}, style: {}, getBoundingClientRect: () => ({ width: 960, height: 600, left: 0, top: 0 }), addEventListener() {}, removeEventListener() {} });
const currentCanvas = makeCanvas(), beforeCanvas = makeCanvas();
class OfflineArena extends ArenaScene { createRenderer() { return new CurrentRenderer(currentCanvas); } }
const arena = new OfflineArena({ canvas: currentCanvas, quality: 'low', externalHand: true, reduced: true, heroSkins: { self: 'forest_apprentice', opponent: 'butterfly_scholar' } });
const units = Object.values(CARD).filter(card => card.artPath && card.type !== 'spell');
arena.setBattle({ active: 0, phase: 'playing', players: [0, 1].map(seat => ({ hp: 18, hand: [], handCount: 3, board: units.slice(seat * 4, seat * 4 + 4).map((card, i) => ({ uid: `qa-${seat}-${i}`, cardId: card.id, atk: card.atk, hp: card.hp, maxHp: card.hp, ready: true })) })) }, 0);
for (const [uid, shadow] of arena.contactShadows) { const item = arena.units.get(uid); shadow.position.set(item.base.x + .12, .035, item.base.z + .13); shadow.scale.setScalar(arena.scaleFor(item.unit.cardId) / 1.3); }
const renderers = { before: new BeforeRenderer(beforeCanvas), current: arena.renderer };
renderers.before.setSize(960, 600);
const stats = values => { const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2); return { median: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2, p95: sorted[Math.ceil(sorted.length * .95) - 1], min: sorted[0], max: sorted.at(-1) }; };
const report = { kind: 'same-process-paired-application-cpu-renderer-ab', viewport: [960, 600], warmupFramesPerRenderer: 15, sampledFramesPerRenderer: 24, browserVerified: false, webglVerified: false,
  sourceSha256: { benchmark: hash(fs.readFileSync(new URL(import.meta.url))), beforeRenderer: hash(beforeSource), instrumentedBefore: hash(instrumented), currentRenderer: hash(fs.readFileSync(new URL('../src/arena3d/software-renderer.mjs', import.meta.url))), expansionModels: hash(fs.readFileSync(new URL('../src/arena3d/creature-expansion-v4.mjs', import.meta.url))), scene: hash(fs.readFileSync(new URL('../src/arena3d/scene.mjs', import.meta.url))), heroModels: hash(fs.readFileSync(new URL('../src/arena3d/hero-models.mjs', import.meta.url))) },
  unitIds: units.map(card => card.id), unitTriangles: [...arena.units.values()].reduce((n, item) => n + item.model.metrics.triangles, 0), heroTriangles: arena.heroes.reduce((n, hero) => n + hero.model.metrics.triangles, 0), cases: [],
  canvasModulePath, beforeRendererPath: path.resolve(beforeFile), nodeExecArgv: process.execArgv, rawSamplesFile: path.basename(rawFile),
  method: 'One complete scene reused by both renderers. Pose applied once before each pair. Alternating before/current first gives 12 sampled first positions each. Same camera, eight units, two heroes, card backs, deck stacks, shadows, fireflies. Old source gets matching performance-clock markers only when not already instrumented. Canvas contexts reset before each complete opaque frame, outside timing, to release the offline Skia display-list history. Sampled canvas hashes include overlays; complete float32 depth hashes are also compared outside render timing. Process CPU usage includes the process and its native threads; it supplements wall time and is not browser frame time. Median averages middle pair; p95 nearest-rank. No browser, DOM, compositor, RAF or device FPS claim.' };

for (const mode of ['idle', 'cast']) {
  const fx = mode === 'cast' ? createElementalCast({ element: 'fire', from: arena.heroes[0].model.anchors.projectile.getWorldPosition(new Vector3()), to: [...arena.units.values()][5].model.anchors.impact.getWorldPosition(new Vector3()) }) : null;
  if (fx) arena.temporary.add(fx.root);
  const rows = [], warmups = [];
  for (let frame = 0; frame < 39; frame++) {
    const poseStart = performance.now(), phase = (frame % 13) / 12;
    for (const item of arena.units.values()) item.model.applyPose({ idlePhase: frame * .1, attackProgress: 0 });
    for (const hero of arena.heroes) hero.model.applyPose({ time: frame * .1, ...(fx ? { castProgress: phase } : {}) });
    fx?.update(phase);
    const row = { frame, poseMs: performance.now() - poseStart, first: frame % 2 ? 'before' : 'current' };
    for (const name of row.first === 'before' ? ['before', 'current'] : ['current', 'before']) {
      const renderer = renderers[name];
      // Browser canvas is immediate; Skia keeps an offline display list. Every
      // renderer frame is opaque and complete, so old canvas commands are dead.
      renderer.context.reset();
      const cpuStart = process.cpuUsage();
      renderer.render(arena.scene, arena.camera);
      const cpuUsed = process.cpuUsage(cpuStart);
      row[name] = { totalMs: renderer.lastRenderMs, cpuMs: (cpuUsed.user + cpuUsed.system) / 1000, ...renderer.lastRenderBreakdown, renderCounts: { ...renderer.info.render } };
    }
    if ([15, 22, 30, 38].includes(frame)) {
      const pixels = canvas => canvas.getContext('2d').getImageData(0, 0, 960, 600).data;
      row.canvasHashes = { before: hash(pixels(beforeCanvas)), current: hash(pixels(currentCanvas)) };
      row.pixelsEqual = row.canvasHashes.before === row.canvasHashes.current;
      row.depthHashes = Object.fromEntries(Object.entries(renderers).map(([name, renderer]) => [name, hash(new Uint8Array(renderer.depths.buffer))]));
      row.depthsEqual = row.depthHashes.before === row.depthHashes.current;
    }
    (frame < 15 ? warmups : rows).push(row);
    fs.appendFileSync(rawFile, JSON.stringify({ mode, warmup: frame < 15, ...row }) + '\n');
  }
  const summary = Object.fromEntries(['before', 'current'].map(name => [name, Object.fromEntries(['totalMs', 'cpuMs', 'geometryMs', 'staticMs', 'dynamicRasterMs', 'presentMs'].map(key => [key, stats(rows.map(row => row[name][key]))]))]));
  const result = { mode, summary, pairedTotalDifferenceMs: stats(rows.map(row => row.current.totalMs - row.before.totalMs)), pairedCpuDifferenceMs: stats(rows.map(row => row.current.cpuMs - row.before.cpuMs)), poseMs: stats(rows.map(row => row.poseMs)), allComparedPixelsEqual: rows.filter(row => row.canvasHashes).every(row => row.pixelsEqual), allComparedDepthsEqual: rows.filter(row => row.depthHashes).every(row => row.depthsEqual), warmups, samples: rows };
  report.cases.push(result); fs.writeFileSync(path.join(output, 'renderer-ab.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ mode, summary, pairedTotalDifferenceMs: result.pairedTotalDifferenceMs, pairedCpuDifferenceMs: result.pairedCpuDifferenceMs, allComparedPixelsEqual: result.allComparedPixelsEqual, allComparedDepthsEqual: result.allComparedDepthsEqual }));
  fs.writeFileSync(path.join(output, `${mode}-current.png`), await currentCanvas.toBuffer(canvasModule.createCanvas ? 'image/png' : 'png'));
  fx?.dispose();
}
renderers.before.dispose(); arena.dispose();
report.cleanup = Object.fromEntries(Object.entries(renderers).map(([name, renderer]) => [name, {
  frameReleased: renderer.frame === null && renderer.pixels === null && renderer.depths === null,
  staticFrameReleased: renderer.staticFrame === null,
  trianglePoolReleased: !renderer.trianglePool || renderer.trianglePool.length === 0,
}]));
report.allComparedRenderCountsEqual = report.cases.every(item => item.samples.every(row => JSON.stringify(row.before.renderCounts) === JSON.stringify(row.current.renderCounts)));
report.complete = true;
if (!report.allComparedRenderCountsEqual || report.cases.some(item => !item.allComparedPixelsEqual || !item.allComparedDepthsEqual) || Object.values(report.cleanup).some(item => Object.values(item).some(value => !value))) process.exitCode = 1;
fs.writeFileSync(path.join(output, 'renderer-ab.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ output, sourceSha256: report.sourceSha256, complete: true }));
