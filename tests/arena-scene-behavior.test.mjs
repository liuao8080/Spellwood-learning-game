import test from "node:test";
import assert from "node:assert/strict";
import { Vector3, PerspectiveCamera, Box3, Raycaster } from "three";
import { ArenaScene } from "../src/arena3d/scene.mjs";

// Geometry, raycasting, animation jobs and ownership are real Three.js objects.
// Canvas drawing and the renderer are mocked: this is NOT a WebGL pixel test.
function harness(t, options = {}) {
  const originals = Object.fromEntries(["document", "window", "Image", "requestAnimationFrame", "cancelAnimationFrame", "devicePixelRatio"].map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  const raf = new Map(); let serial = 0;
  const context = new Proxy({}, { get(o, k) { if (k === "measureText") return (s) => ({ width: String(s).length * 26 }); if (String(k).startsWith("create")) return () => ({ addColorStop() {} }); return o[k] || (() => {}); } });
  const handlers = new Map();
  const canvas = { dataset: {}, style: {}, width: 1280, height: 800, getContext: () => context, getBoundingClientRect: () => ({ width: options.width || 1280, height: options.height || 800, left: 0, top: 0 }), addEventListener: (k, fn) => handlers.set(k, fn), removeEventListener: (k) => handlers.delete(k) };
  const values = { document: { createElement: () => ({ width: 0, height: 0, getContext: () => context }) }, window: { addEventListener() {}, removeEventListener() {} }, Image: class {}, devicePixelRatio: 1, requestAnimationFrame: (fn) => { const id = ++serial; raf.set(id, fn); return id; }, cancelAnimationFrame: (id) => raf.delete(id) };
  for (const [k, v] of Object.entries(values)) Object.defineProperty(globalThis, k, { configurable: true, writable: true, value: v });
  const render = { isSoftwareRenderer: !!options.software, lastRenderMs: 10, shadowMap: {}, info: { render: { triangles: 0, calls: 0 } }, disposed: 0, setPixelRatio() {}, setSize(w,h) {this.outputSize=[w,h];}, render(scene, camera) { scene.updateMatrixWorld(true); camera.updateMatrixWorld(true); }, dispose() { this.disposed++; } };
  class CPUScene extends ArenaScene { createRenderer() { return render; } }
  const sounds = [], statuses = [];
  const scene = new CPUScene({ canvas, quality: "low", onSound: (s) => sounds.push(s), onStatus: (s) => statuses.push(s), ...options });
  t.after(() => { scene.dispose(); for (const [k, descriptor] of Object.entries(originals)) descriptor ? Object.defineProperty(globalThis, k, descriptor) : delete globalThis[k]; });
  function frame(now = performance.now()) { const entry = raf.entries().next().value; assert(entry, "one scheduled frame exists"); raf.delete(entry[0]); entry[1](now); }
  frame();
  return { scene, canvas, frame, raf, render, sounds, statuses, handlers };
}
function state() { return { active: 0, phase: "playing", players: [
  { hp: 18, hand: ["fox", "spark"], board: [{ uid: "attacker", cardId: "fox", atk: 2, hp: 2, maxHp: 2, ready: true }] },
  { hp: 18, handCount: 3, board: [{ uid: "defender", cardId: "turtle", atk: 1, hp: 2, maxHp: 5, ready: true }, { uid: "neighbor", cardId: "owl", atk: 3, hp: 3, maxHp: 3, ready: false }] },
] }; }
const tick = () => new Promise((r) => setImmediate(r));

test('bound arena handlers inspect on right click and discard a press across an authoritative revision', t => {
 const picked=[],inspected=[];let revision=7;
 const {scene,handlers}=harness(t,{onPick:value=>picked.push(value),onInspect:value=>inspected.push(value),getInputRevision:()=>revision});
 scene.setBattle(state(),0);scene.pick=()=>({kind:'unit',uid:'defender',seat:1});
 const pointer={pointerId:4,isPrimary:true,clientX:20,clientY:20,pointerType:'mouse'};
 handlers.get('pointerdown')({...pointer,button:2,buttons:2});
 handlers.get('pointerup')({...pointer,button:2,buttons:0});
 handlers.get('contextmenu')({...pointer,button:2,preventDefault(){},stopPropagation(){}});
 assert.equal(picked.length,0);assert.equal(inspected.length,1);assert.equal(inspected[0].revision,7);
 handlers.get('pointerdown')({...pointer,button:0,buttons:1});revision++;
 handlers.get('pointerup')({...pointer,button:0,buttons:0});
 assert.equal(picked.length,0);
});

test('external hand removes the old perspective cards and routes only owner draws to the new window',async t=>{
 const arrivals=[];const {scene}=harness(t,{externalHand:true,onHandDraw:detail=>arrivals.push(detail)});
 const next=state();scene.setBattle(next,0);
 assert.equal(scene.cards.length,0);assert.equal(scene.enemyCards.length,3);
 assert.equal(scene.pickables.some(root=>root.userData.pick?.kind==='card'),false);
 next.players[0].hand.push('owl');await scene.drawCards(next,0,1);
 assert.equal(arrivals.length,1);assert.equal(arrivals[0].count,1);assert.deepEqual(arrivals[0].ids,next.players[0].hand);
 assert.equal(scene.temporary.children.length,0);
});

test('short immersive fields leave separate hit badges for all four allied and enemy slots',t=>{
 const h=harness(t,{externalHand:true});const next=state();
 for(const [seat,player]of next.players.entries())player.board=Array.from({length:4},(_,i)=>({uid:`${seat}:${i}`,cardId:'fox',atk:2,hp:2,maxHp:2,ready:true}));
 for(const [w,hgt]of[[320,138],[320,160],[320,198],[390,292],[708,208],[604,178],[708,184],[604,154]]){
  h.canvas.getBoundingClientRect=()=>({width:w,height:hgt,left:0,top:0});h.scene.resize();h.scene.setBattle(next,0);h.scene.camera.updateMatrixWorld(true);
  for(const seat of[0,1]){const labels=next.players[seat].board.map(u=>h.scene.labelPoint(h.scene.units.get(u.uid)));const points=labels.map(point=>point.x);
   for(let i=1;i<4;i++)assert.ok(points[i]-points[i-1]>=56,`${w}x${hgt}, seat${seat}, spacing${points[i]-points[i-1]}`);
   assert.ok(points[0]>=28&&points[3]<=w-28,`${w}x${hgt}: four label centers fit`);
   assert.ok(labels.every(point=>point.y>=2&&point.y+44<=hgt-12),`${w}x${hgt}: full controls clear the overlapping hand canvas`);
  }
  const near=next.players[0].board.map(u=>h.scene.labelPoint(h.scene.units.get(u.uid)));
  const far=next.players[1].board.map(u=>h.scene.labelPoint(h.scene.units.get(u.uid)));
  for(const a of near)for(const b of far)if(Math.abs(a.x-b.x)<56)
   assert.ok(a.y-b.y>=50-1e-6,`${w}x${hgt}: opposing touch rows have a 6px gutter`);
 }
 const before=h.scene.heroes.map(hero=>hero.root.position.toArray());
 h.scene.setHeroSkins({self:'butterfly_scholar',opponent:'aurora_storyteller'});
 assert.equal(h.scene.heroes[1].root.position.z,before[1][2],'cosmetic replacement preserves the compact hero seat');
 assert.ok(h.scene.heroes[1].root.position.x>0,'opposing compact hero remains beside its side of the field');
});

test("elemental cast commits impact once and cancelled casts never commit", async t => {
  const {scene,frame}=harness(t);scene.setBattle(state(),0);let hits=0;
  const motion=scene.projectile("hero:0","defender",()=>hits++,"water");
  const start=[...scene.jobs][0].start;
  frame(start+100);assert.equal(hits,0);
  frame(start+400);assert.equal(hits,0);
  frame(start+510);assert.equal(hits,1);
  frame(start+700);assert.equal(hits,1);
  frame(start+821);await motion;assert.equal(scene.temporary.children.length,0);
  const cancelled=scene.projectile("hero:0","defender",()=>hits++,"fire");scene.cancel();await cancelled;assert.equal(hits,1);assert.equal(scene.temporary.children.length,0);
});

test("same server event is presented once and a consumed barrier is removed", async t => {
  const {scene,frame}=harness(t,{reduced:true});const next=state();next.players[1].board[0].shield=true;scene.setBattle(next,0);
  assert.equal(scene.barriers.size,1);let hits=0;
  const event={eventId:"room:99",kind:"attack",sourceUid:"attacker",targetUid:"defender",changes:[{seat:1,uid:"defender",hpDelta:0,shieldLost:true}]};
  const motion=scene.present(next,event,()=>hits++);assert.equal(scene.barriers.size,0);
  await scene.present(next,event,()=>hits++);assert.equal(hits,1);
  frame([...scene.jobs][0].start+621);await motion;assert.equal(scene.temporary.children.length,0);
});

test("a browser without either renderer can finish without starting victory geometry", async () => {
  const scene = Object.create(ArenaScene.prototype);
  scene.onSound = () => {};
  await assert.doesNotReject(scene.celebrate(true));
  assert.equal(scene.temporary, undefined);
});

test("CPU cadence admits light frames sooner and leaves room for expensive frames", (t) => {
  const { scene, frame, render } = harness(t);
  render.isSoftwareRenderer = true; render.lastRenderMs = 12;
  const original = render.render; let draws = 0;
  render.render = (...args) => { draws++; original(...args); };
  const start = performance.now(); scene.lastSoftwareFrame = start; scene.cpuRenderCost = 12;
  frame(start + 16); assert.equal(draws, 0);
  frame(start + 34); assert.equal(draws, 1);
  scene.cpuRenderCost = 60; render.lastRenderMs = 60;
  frame(start + 68); assert.equal(draws, 1);
  frame(start + 101); assert.equal(draws, 2);
});

test("CPU contact shadows follow creatures and release their per-unit materials", (t) => {
  const { scene, frame } = harness(t, { software: true });
  scene.setBattle(state(), 0); frame(performance.now() + 100);
  assert.equal(scene.contactShadows.size, 3);
  const unit = scene.units.get("attacker"), shadow = scene.contactShadows.get("attacker");
  assert.ok(Math.abs(shadow.position.x - unit.model.root.position.x - .12) < .00001);
  let releases = 0;
  for (const value of scene.contactShadows.values()) value.material.addEventListener("dispose", () => releases++);
  const next = state(); next.players[0].board = []; next.players[1].board = [];
  scene.setBattle(next, 0);
  assert.equal(scene.contactShadows.size, 0); assert.equal(releases, 3);
  let geometryReleases = 0;
  scene.contactShadowGeometry.addEventListener("dispose", () => geometryReleases++);
  scene.dispose(); scene.dispose(); assert.equal(geometryReleases, 1);
});

test("perspective scene builds volumetric figures and raycasts a real model", (t) => {
  const { scene, frame } = harness(t); scene.setBattle(state(), 0); frame();
  assert(scene.camera instanceof PerspectiveCamera);
  assert(scene.arena.bounds.max.y > scene.arena.bounds.min.y);
  const model = scene.units.get("attacker").model;
  assert(model.bounds.max.z - model.bounds.min.z > 0.5);
  assert.equal(scene.cards.length, 2); assert.equal(scene.enemyCards.length, 3);
  const p = scene.project(scene.units.get("attacker").base.clone().add(new Vector3(0, 1.1, 0)));
  assert.equal(scene.pick({ clientX: p.x, clientY: p.y })?.uid, "attacker");
});

test("attack travels from source toward target, contacts once, and returns in 740ms", async (t) => {
  const { scene, frame } = harness(t); scene.setBattle(state(), 0);
  const item = scene.units.get("attacker"), from = item.base.clone(); let impacts = 0;
  const motion = scene.attack("attacker", "defender", () => impacts++), start = [...scene.jobs][0].start;
  frame(start + 100); assert.equal(impacts, 0);
  frame(start + 360); assert.equal(impacts, 1); assert(item.model.root.position.distanceTo(from) > 2.5);
  frame(start + 500); assert.equal(impacts, 1);
  frame(start + 741); await motion;
  assert(item.model.root.position.distanceTo(from) < 1e-8); assert.equal(item.animating, false);
  assert.equal(scene.jobs.size, 0);
});

test("canceling a lethal hit restores opacity and scale before a fresh snapshot", async (t) => {
  const { scene, frame } = harness(t); const initial = state(); scene.setBattle(initial, 0);
  const next = structuredClone(initial); next.players[1].board.shift();
  const motion = scene.present(next, { kind: "attack", sourceUid: "attacker", targetUid: "defender", changes: [{ seat: 1, uid: "defender", hpDelta: -2, removed: true }] });
  const start = [...scene.jobs][0].start; frame(start + 360);
  const fadeStart = [...scene.jobs].find((j) => j.duration === 320).start;
  frame(fadeStart + 170);
  const item = scene.units.get("defender"); assert(item.fadeMaterials.some((x) => x.material.opacity < x.opacity));
  scene.cancel(); scene.setBattle(initial, 0); await motion;
  assert.equal(item.fadeMaterials, null); assert.equal(item.model.root.scale.x, scene.scaleFor("turtle"));
  item.model.root.traverse((o) => { if (o.material && o.material.visible !== false) assert.equal(o.material.opacity, 1); });
  assert.equal(scene.temporary.children.length, 0); assert.equal(scene.jobs.size, 0);
  assert.equal(scene.units.get("neighbor").base.x, -1.6, "cancel did not compact the old row");
});

test("summon cancellation removes the flying card and keeps the accepted unit", async (t) => {
  const { scene, frame } = harness(t); const next = state(); scene.setBattle(next, 0);
  next.players[0].board.push({ uid: "new-rabbit", cardId: "rabbit", atk: 2, hp: 1, maxHp: 1, ready: true });
  const motion = scene.summon(next, { actorSeat: 0, newUnitUid: "new-rabbit", cardId: "rabbit" });
  const start = [...scene.jobs][0].start; frame(start + 240); assert.equal(scene.temporary.children.length, 1);
  scene.cancel(); await motion;
  assert.equal(scene.temporary.children.length, 0); assert.equal(scene.jobs.size, 0);
  assert.equal(scene.units.get("new-rabbit").model.root.scale.x, scene.scaleFor("rabbit"));
});

test("hidden pages and lost contexts settle old actions without accumulating animation jobs", async (t) => {
  const { scene, raf, handlers } = harness(t); scene.setBattle(state(), 0);
  const motion = scene.attack("attacker", "defender"); scene.setHidden(true); await motion;
  assert.equal(scene.jobs.size, 0); assert.equal(raf.size, 0);
  await scene.present(state(), { kind: "play", cardId: "spark", actorSeat: 0, targetSeat: 1, changes: [{ seat: 1, hpDelta: -2 }] });
  assert.equal(scene.jobs.size, 0);
  scene.setHidden(false); assert.equal(raf.size, 1);
  let prevented = false; handlers.get("webglcontextlost")({ preventDefault() { prevented = true; } });
  assert(prevented); assert.equal(raf.size, 0); scene.requestRender(); assert.equal(raf.size, 0);
  handlers.get("webglcontextrestored")(); assert.equal(raf.size, 1);
});

test("reduced motion retains readable value feedback without projectile travel", async (t) => {
  const { scene, frame } = harness(t, { reduced: true }); scene.setBattle(state(), 0);
  const from = scene.units.get("attacker").model.root.position.clone();
  const p = scene.present(state(), { kind: "attack", actorSeat: 0, sourceUid: "attacker", targetUid: "defender", changes: [{ seat: 1, uid: "defender", hpDelta: -1 }] });
  assert.equal(scene.jobs.size, 1); assert.equal(scene.temporary.children[0].isSprite, true);
  const start = [...scene.jobs][0].start; frame(start + 250);
  assert(scene.units.get("attacker").model.root.position.equals(from));
  frame(start + 501); await p; assert.equal(scene.temporary.children.length, 0);
});

test("disposing twice frees owned geometry once, cancels jobs and removes listeners", async (t) => {
  const { scene, render, handlers, raf } = harness(t); scene.setBattle(state(), 0);
  const geometries = new Set(), disposed = new Map();
  scene.scene.traverse((o) => { if (o.geometry) geometries.add(o.geometry); });
  for (const g of geometries) g.addEventListener("dispose", () => disposed.set(g.uuid, (disposed.get(g.uuid) || 0) + 1));
  const p = scene.projectile("hero:0", "hero:1"); scene.dispose(); scene.dispose(); await p; await tick();
  assert.equal(render.disposed, 1); assert.equal(scene.jobs.size, 0); assert.equal(scene.scene.children.length, 0);
  assert.equal(raf.size, 0); assert.equal(handlers.size, 0);
  assert.equal(disposed.size, geometries.size); assert([...disposed.values()].every((n) => n === 1));
});

test("two drawn cards travel from the physical deck and reveal only the owner's faces", async (t) => {
  const { scene, frame } = harness(t); const before = state(); scene.setBattle(before, 0);
  const next = structuredClone(before); next.players[0].hand.push("moon", "bloom");
  const requested = [], get = scene.textures.get.bind(scene.textures); scene.textures.get = (id) => { requested.push(id); return get(id); };
  const motion = scene.drawCards(next, 0, 2); assert.deepEqual(requested, ["moon", "bloom"]);
  assert.equal(scene.temporary.children.length, 2);
  const start = Math.max(...[...scene.jobs].map((j) => j.start)); frame(start + 300);
  assert(scene.temporary.children.every((o) => o.position.y > 1.2), "both cards rise above the board");
  frame(start + 661); await motion; assert.equal(scene.temporary.children.length, 0);
  requested.length = 0; next.players[1].handCount = 5;
  const enemyMotion = scene.drawCards(next, 1, 2);
  assert.equal(requested.length, 0, "opponent draw never asks for a front face");
  scene.cancel(); await enemyMotion; assert.equal(scene.temporary.children.length, 0);
});

test("canceling an older draw cannot expose cards hidden by a newer draw", async (t) => {
  const { scene, frame } = harness(t); const next = state(); scene.setBattle(next, 0);
  const first = scene.drawCards(next, 0, 1); scene.cancel();
  const second = scene.drawCards(next, 0, 1); await first;
  assert.equal(scene.cards.at(-1).model.root.visible, false);
  const start = Math.max(...[...scene.jobs].map((j) => j.start)); frame(start + 551); await second;
  assert.equal(scene.cards.at(-1).model.root.visible, true); assert.equal(scene.jobs.size, 0);
});

test("victory geometry is finite, cancelable and does not retain effect resources", async (t) => {
  const { scene, frame, sounds } = harness(t); scene.setBattle(state(), 0);
  const motion = scene.celebrate(true), start = [...scene.jobs][0].start;
  frame(start + 500); assert(sounds.includes("win"));
  const group = scene.temporary.children[0]; assert.equal(group.children.length, 25);
  assert(group.children.every((o) => o.position.toArray().every(Number.isFinite)));
  scene.cancel(); await motion; assert.equal(scene.temporary.children.length, 0); assert.equal(scene.jobs.size, 0);
});

test("enlarged selected edge cards stay inside the narrow portrait canvas", (t) => {
  const { scene, frame } = harness(t, { width: 320, height: 568, reduced: true });
  const next = state(); next.players[0].hand = ["fox", "turtle", "owl", "spark", "bloom", "moon", "rabbit"]; scene.setBattle(next, 0);
  for (const index of [0, 6]) {
    scene.select({ kind: "card", index }); frame();
    const box = new Box3().setFromObject(scene.cards[index].model.root);
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
      const p = scene.project(new Vector3(x, y, z));
      assert(p.x >= 0 && p.x <= 320 && p.y >= 0 && p.y <= 568, `selected card corner clips: ${p.x},${p.y}`);
    }
  }
});

test("target rings and a spatial aim arc identify guards, refresh moved targets and release resources", (t) => {
  const { scene, frame } = harness(t); const next = state(); scene.setBattle(next, 0);
  scene.select({ kind: "unit", uid: "attacker" }); scene.hoverTarget({ kind: "unit", uid: "defender", seat: 1 }); frame();
  assert.deepEqual([...scene.targetRings.keys()], ["defender"]);
  assert.equal(scene.aimObjects.length, 2); assert.equal(scene.targetKey, "attacker>defender");
  assert(scene.aimObjects[0].geometry.boundingSphere === null || scene.aimObjects[0].geometry.boundingSphere.radius > 0);
  const old = scene.aimObjects[0].geometry; let freed = 0; old.addEventListener("dispose", () => freed++);
  next.players[1].board.reverse(); scene.setBattle(next, 0); frame();
  assert.equal(freed, 1); assert.equal(scene.targetRings.get("defender").position.x, -1.6);
  scene.select(null); frame(); assert.equal(scene.targetRings.size, 0); assert.equal(scene.aimObjects.length, 0);
});

test('reduced motion renders on changes, sleeps when idle, and completes value feedback', async t => {
  const { scene, raf, frame } = harness(t, { reduced: true });
  assert.equal(raf.size, 0, 'an idle reduced-motion scene does not keep an animation loop');
  scene.setBattle(state(), 0); assert.equal(raf.size, 1); frame(); assert.equal(raf.size, 0);
  scene.select({ kind: 'card', index: 0 }); frame();
  assert.equal(scene.cards[0].model.root.scale.x, 2.8); assert.equal(raf.size, 0);
  const effect = scene.floatText('defender', '-1'), start = [...scene.jobs][0].start;
  frame(start + 200); assert.equal(raf.size, 1);
  frame(start + 501); await effect; assert.equal(raf.size, 0); assert.equal(scene.temporary.children.length, 0);
  scene.setReduced(false); frame(); assert.equal(raf.size, 1);
  scene.setReduced(true); frame(); assert.equal(raf.size, 0);
  scene.setHidden(true); scene.requestRender(); assert.equal(raf.size, 0);
  scene.setHidden(false); frame(); assert.equal(raf.size, 0);
});

test('target arrow tips remain above tall figures and wake a reduced-motion scene', t => {
  const { scene, frame, raf } = harness(t, { reduced: true });
  const next = state(); next.players[0].ritualsLeft = 4; next.players[1].board = ['golem', 'rabbit', 'stag'].map((cardId, i) => ({ uid: 'tall-' + i, cardId, hp: 4, maxHp: 4, atk: 2, ready: true }));
  scene.setBattle(next, 0); scene.select({ kind: 'ritual', ritual: 'spark' }); frame();
  for (const uid of ['tall-0', 'tall-1', 'tall-2']) {
    scene.hoverTarget({ kind: 'unit', uid, seat: 1 }); assert.equal(raf.size, 1); frame();
    assert([1, 2].includes(scene.aimObjects.length));
    assert.equal(scene.aimObjects.at(-1).geometry.type, "ConeGeometry", "crowded routes keep a clear target arrow even when their line is omitted");
    assert(scene.targetKey.endsWith(">" + uid));
    const bounds = new Box3().setFromObject(scene.units.get(uid).model.root);
    assert(scene.aimAnchor(uid, true).y > bounds.max.y, 'aim tip must clear the silhouette of ' + uid);
    assert.equal(raf.size, 0);
  }
  scene.hoverTarget(null); frame(); assert.equal(scene.aimObjects.length, 0);
});

test('a failed animation job settles, releases transient geometry and stops the faulty frame loop', async t => {
  const { scene, frame, raf, statuses } = harness(t); scene.setBattle(state(), 0);
  const effect = scene.projectile('hero:0', 'hero:1');
  const job = [...scene.jobs][0]; job.update = () => { throw new Error('injected frame job failure'); };
  assert.doesNotThrow(() => frame(job.start + 100)); await effect;
  assert.equal(scene.jobs.size, 0); assert.equal(scene.temporary.children.length, 0); assert.equal(raf.size, 0);
  assert.equal(statuses.at(-1).available, false); assert.equal(statuses.at(-1).reason, 'frame-error');
  scene.requestRender(); assert.equal(raf.size, 0, 'a bad renderer is not retried every frame');
  await scene.floatText('defender', '-1'); assert.equal(scene.temporary.children.length, 0);
});

test('a renderer exception settles active motion and reports a fallback instead of repeating errors', async t => {
  const { scene, frame, raf, render, statuses } = harness(t); scene.setBattle(state(), 0);
  const movement = scene.attack('attacker', 'defender'), start = [...scene.jobs][0].start;
  render.render = () => { throw new Error('injected renderer failure'); };
  assert.doesNotThrow(() => frame(start + 200)); await movement;
  assert.equal(scene.jobs.size, 0); assert.equal(raf.size, 0); assert.equal(statuses.at(-1).available, false);
  assert(scene.units.get('attacker').model.root.position.equals(scene.units.get('attacker').base));
  scene.setHidden(true); scene.setHidden(false); assert.equal(raf.size, 0);
});

test('accepted damage deforms the actual figure briefly and returns its rig to rest', async t => {
  const { scene, frame } = harness(t); scene.setBattle(state(), 0);
  const item = scene.units.get('defender'), base = item.base.clone(), body = item.model.root.getObjectByName('turtle-body');
  assert(body);
  const motion = scene.recoil('defender'), start = [...scene.jobs][0].start;
  frame(start + 160); assert(body.scale.y < .94); assert(body.rotation.x < 0);
  assert(item.model.root.position.equals(base), 'hit pose does not disturb its board slot');
  frame(start + 321); await motion; assert.equal(body.scale.y, 1); assert.equal(body.rotation.x, 0);
});

test('overlapping hero hits deform the actual hero and cancellation restores exact baseline', async t => {
  const { scene, frame } = harness(t); scene.setBattle(state(), 0);
  const hero = scene.heroes[1]; hero.model.reset();
  const mesh = hero.root.children.find(node => node.isMesh && !node.userData.pickProxy);
  const baseline = [...mesh.geometry.attributes.position.array], rootPosition = hero.root.position.clone();
  const first = scene.recoil('hero:1'), start = [...scene.jobs][0].start; frame(start + 160);
  assert.notDeepEqual([...mesh.geometry.attributes.position.array], baseline);
  assert(hero.poses.hitProgress > .4); assert(hero.root.position.equals(rootPosition));
  const second = scene.recoil('hero:1'); scene.cancel(); await Promise.all([first, second]);
  assert.deepEqual([...mesh.geometry.attributes.position.array], baseline);
  assert.deepEqual(hero.poses, {}); assert.deepEqual(hero.poseTokens, {});
  scene.setReduced(true); await scene.recoil('hero:1'); assert.equal(scene.jobs.size, 0);
});

test('hero skins replace only cosmetic models, preserve targeting and dispose once', t => {
  const { scene } = harness(t); const next = state(); scene.setBattle(next, 1);
  const before = structuredClone(next), old = scene.heroes[0], counts = new Map();
  old.root.traverse(node => { for (const resource of [node.geometry, node.material].filter(Boolean)) { counts.set(resource, 0); resource.addEventListener('dispose', () => counts.set(resource, counts.get(resource) + 1)); } });
  assert(scene.heroes.every(hero => hero.skinId === 'forest_apprentice' && hero.model.quality === 'low'));
  scene.setHeroSkins({ self: 'butterfly_scholar', opponent: 'aurora_storyteller' });
  assert.equal(old.model.disposed, true); assert([...counts.values()].every(count => count === 1));
  assert.equal(scene.heroFor('hero:1').skinId, 'butterfly_scholar');
  assert.equal(scene.heroFor('hero:0').skinId, 'aurora_storyteller');
  assert.deepEqual(next, before); assert.equal(scene.heroes.length, 2);
  assert.equal(scene.pickables.includes(old.root), false);
  assert.equal(scene.heroFor('hero:2'), null);
  const hero = scene.heroes[0], root = hero.root;
  scene.setHeroSkins({ self: 'butterfly_scholar' }); assert.equal(scene.heroes[0].root, root);
  const point = scene.project(hero.model.anchors.impact.getWorldPosition(new Vector3()));
  assert.deepEqual(scene.pick({ clientX: point.x, clientY: point.y }), { kind: 'hero', relativeSeat: 0 });
  assert(scene.aimAnchor('hero:1', false).equals(hero.model.anchors.projectile.getWorldPosition(new Vector3())));
  scene.setHeroSkins({ self: 'toString' }); assert.equal(scene.heroes[0].skinId, 'forest_apprentice');
  assert.equal(scene.heroes[1].skinId, 'aurora_storyteller');
  assert(scene.heroes.reduce((n, h) => n + h.model.metrics.triangles, 0) <= 3664);
});

test('hero cast, heal and victory poses are owned by the scene and interrupted safely', async t => {
  const { scene, frame } = harness(t); scene.setBattle(state(), 0);
  const hero = scene.heroes[0], anchor = hero.model.anchors.impact.position.clone();
  const motions = [scene.projectile('hero:0', 'hero:1'), scene.pulse('hero:0', 'heal'), scene.celebrate(true)];
  frame([...scene.jobs][0].start + 220);
  assert(hero.poses.castProgress > 0); assert(hero.poses.healProgress > 0); assert(hero.poses.winProgress > 0);
  assert(hero.model.anchors.impact.position.equals(anchor));
  scene.setHeroSkins({ self: 'leaf_ranger' }); assert(hero.model.disposed);
  scene.cancel(); await Promise.all(motions);
  assert.equal(scene.jobs.size, 0); assert.equal(scene.temporary.children.length, 0);
  assert(scene.heroes.every(h => Object.keys(h.poses).length === 0));
});

test('neutral draw celebration never invents a hero winner', async t => {
  const { scene, frame } = harness(t); scene.setBattle(state(), 0);
  const motion = scene.celebrate(null); frame([...scene.jobs][0].start + 250);
  assert(scene.heroes.every(hero => Object.keys(hero.poses).length === 0));
  scene.cancel(); await motion;
});

test('real hero silhouettes remain inside the immersive battlefield viewport', t => {
  const { scene, canvas } = harness(t, { externalHand: true });
  scene.setHeroSkins({ self: 'forest_apprentice', opponent: 'butterfly_scholar' });
  for (const [width, height] of [[960, 600], [390, 292], [708, 184], [320, 160]]) {
    canvas.getBoundingClientRect = () => ({ width, height, left: 0, top: 0 }); scene.resize();
    scene.scene.updateMatrixWorld(true); scene.camera.updateMatrixWorld(true);
    for (const hero of scene.heroes) {
      const bounds = hero.model.bounds;
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
        const p = scene.project(new Vector3(x, y, z).applyMatrix4(hero.root.matrixWorld));
        assert(p.x >= 2 && p.x <= width - 2 && p.y >= 2 && p.y <= height - 2, `${width}x${height} hero${hero.relativeSeat} ${p.x},${p.y}`);
      }
    }
  }
});

test('authoritative recall returns toward its own hero without damage or death and cancels cleanly', async t => {
  const { scene, frame, sounds } = harness(t); scene.setBattle(state(), 0);
  const item = scene.units.get('attacker'), base = item.base.clone(), destination = scene.anchor('hero:0', .9);
  const motion = scene.impacts([{ seat: 0, uid: 'attacker', returned: true, removed: false, hpDelta: 0, atkDelta: 0 }], 'water');
  frame([...scene.jobs][0].start + 200);
  assert(item.model.root.position.distanceTo(destination) < base.distanceTo(destination));
  assert(item.model.root.scale.x < scene.scaleFor('fox')); assert.equal(item.fadeMaterials, undefined);
  assert.equal(sounds.includes('death'), false); assert.equal(sounds.includes('hit'), false);
  scene.cancel(); await motion;
  assert(item.model.root.position.equals(base)); assert.equal(item.model.root.scale.x, scene.scaleFor('fox'));
  const next = state(); next.players[0].board = []; scene.setBattle(next, 0);
  assert(item.model.disposed); assert.equal(scene.units.has('attacker'), false);
});

test('authoritative shield gain and max-health growth remain visible with reduced motion', async t => {
  const { scene, frame } = harness(t, { reduced: true }); scene.setBattle(state(), 0);
  const labels = [], floatText = scene.floatText.bind(scene); scene.floatText = (key, value, ...args) => { labels.push(value); return floatText(key, value, ...args); };
  const motion = scene.impacts([{ seat: 0, uid: 'attacker', shieldGained: true, maxHpDelta: 2, hpDelta: 2 }], 'nature');
  assert(scene.barriers.has('attacker')); assert(labels.includes('获得护盾')); assert(labels.includes('+2生命上限')); assert(labels.includes('+2'));
  assert.equal(scene.units.get('attacker').animating, undefined);
  frame([...scene.jobs][0].start + 800); await motion;
  const next = state(); Object.assign(next.players[0].board[0], { shield: true, maxHp: 4, hp: 4 }); scene.setBattle(next, 0);
  assert(scene.barriers.has('attacker'));
  scene.setBattle(state(), 0); assert.equal(scene.barriers.has('attacker'), false);
});

test('recall never presents the returned card as a draw from the deck', async t => {
  const { scene, frame } = harness(t, { reduced: true }); const before = state(); before.players[0].hand = ['tidal_recall', 'spark']; scene.setBattle(before, 0);
  const next = structuredClone(before); next.players[0].board = []; next.players[0].hand = ['spark', 'fox'];
  const draws = []; scene.drawCards = async (_next, seat, count) => draws.push({ seat, count });
  const event = { kind: 'play', actorSeat: 0, cardId: 'tidal_recall', targetUid: 'attacker', changes: [{ seat: 0, uid: 'attacker', returned: true, removed: false, hpDelta: 0, atkDelta: 0 }] };
  const motion = scene.present(next, event); await tick();
  frame([...scene.jobs][0].start + 501); await motion;
  assert.deepEqual(draws, [{ seat: 0, count: 0 }, { seat: 1, count: 0 }]);
});

test('authoritative legal card targets override legacy cost and enemy-only hints', t => {
  const { scene } = harness(t); const next = state();
  next.players[0].hand = ['mushroom_medic', 'spark']; next.players[0].mana = 0;
  next.players[0].legalCardTargets = [{ index: 0, targets: [{ target: 'attacker', seat: 0 }], untargeted: false }, { index: 1, targets: [{ target: 'hero', seat: 1 }], untargeted: false }];
  scene.setBattle(next, 0); scene.select({ kind: 'card', index: 0 }); scene.updateTargets();
  assert.deepEqual([...scene.targetRings.keys()], ['attacker']);
  scene.select({ kind: 'card', index: 1 }); scene.updateTargets(); assert.deepEqual([...scene.targetRings.keys()], ['hero:1']);
  next.players[0].legalCardTargets = []; scene.setBattle(next, 0); scene.updateTargets(); assert.equal(scene.targetRings.size, 0);
});

test('lethal arrival keeps its target until the salamander projectile lands', async t => {
  const { scene, frame } = harness(t); const before = state(); before.players[0].hand = ['ember_salamander']; scene.setBattle(before, 0);
  const next = structuredClone(before); next.players[0].hand = []; next.players[0].board.push({ uid: 'new-salamander', cardId: 'ember_salamander', atk: 3, hp: 5, maxHp: 5, ready: false }); next.players[1].board.shift();
  let impacts = 0;
  const motion = scene.present(next, { kind: 'play', actorSeat: 0, cardId: 'ember_salamander', newUnitUid: 'new-salamander', targetUid: 'defender', changes: [{ seat: 1, uid: 'defender', hpDelta: -2, removed: true }] }, () => impacts++);
  const target = scene.units.get('defender'); assert(target && !target.model.disposed); assert.equal(impacts, 0);
  frame(Math.max(...[...scene.jobs].map(job => job.start)) + 681); await tick();
  assert.equal(impacts, 0); assert(scene.temporary.children.some(root => root.name.includes('cast')));
  frame(Math.max(...[...scene.jobs].map(job => job.start)) + 1000); await motion;
  assert.equal(impacts, 1); scene.setBattle(next, 0); assert(target.model.disposed);
});


test('every normal hand card exposes its energy cost from the active camera', t => {
  const { scene, frame } = harness(t, { reduced: true });
  const next = state(); next.players[0].hand = ["fox", "turtle", "owl", "spark", "bloom", "moon", "rabbit"];
  scene.setBattle(next, 0); frame();
  for (const card of scene.cards) {
    const face = card.model.root.getObjectByName('card-front-art');
    const target = face.localToWorld(new Vector3((48 / 512 - .5) * 1.09, (.5 - 52 / 720) * 1.64, 0));
    const origin = scene.camera.getWorldPosition(new Vector3());
    const hit = new Raycaster(origin, target.clone().sub(origin).normalize()).intersectObjects(scene.cards.map(card => card.model.root), true)
      .find(hit => !hit.object.userData.pickProxy && hit.object.material.visible !== false);
    assert.equal(hit?.object.uuid, face.uuid, 'cost hidden on card index ' + card.index + ' by ' + hit?.object.name + ' on ' + scene.cards.find(other => other.model.root.getObjectById(hit?.object.id))?.index);
  }
});

test('drawn cards land on their current visible hand slots without a final position or rotation jump', async t => {
  const { scene } = harness(t);
  const next = state(); next.players[0].hand = ['fox', 'turtle', 'owl', 'spark', 'bloom', 'moon', 'rabbit']; next.players[1].handCount = 7;
  scene.setBattle(next, 0);
  for (const seat of [0, 1]) {
    const staticCards = seat ? scene.enemyCards.map(card => card.root) : scene.cards.map(card => card.model.root);
    const destinations = staticCards.slice(-2).map(root => ({ position: root.position.clone(), rotation: root.quaternion.clone(), scale: root.scale.clone() }));
    const motion = scene.drawCards(next, seat, 2), flying = [...scene.temporary.children], jobs = [...scene.jobs];
    jobs.forEach(job => job.update(1));
    flying.forEach((root, index) => {
      assert(root.position.distanceTo(destinations[index].position) < 1e-8);
      assert(root.quaternion.angleTo(destinations[index].rotation) < 1e-7);
      assert(root.scale.distanceTo(destinations[index].scale) < 1e-8);
    });
    scene.cancel(); await motion;
    assert(staticCards.slice(-2).every(root => root.visible));
  }
});

for (const [width, height] of [[320, 568], [390, 844]]) test(`hero value labels stay wholly inside the ${width}px view`, async t => {
  const { scene, frame } = harness(t, { width, height }); scene.setBattle(state(), 0);
  const motions = [scene.floatText('hero:0', '+1护甲', '#fff', 500), scene.floatText('hero:0', '-2', '#fff', 500), scene.floatText('hero:1', '-3', '#fff', 500)];
  const start = Math.max(...[...scene.jobs].map(job => job.start));
  for (const ms of [1, 180, 400]) {
    frame(start + ms);
    for (const sprite of scene.temporary.children.filter(o => o.isSprite)) {
      const right = new Vector3().setFromMatrixColumn(scene.camera.matrixWorld, 0).multiplyScalar(sprite.scale.x / 2);
      const up = new Vector3().setFromMatrixColumn(scene.camera.matrixWorld, 1).multiplyScalar(sprite.scale.y / 2);
      for (const x of [-1, 1]) for (const y of [-1, 1]) {
        const point = scene.project(sprite.position.clone().addScaledVector(right, x).addScaledVector(up, y));
        assert(point.x >= 9.99 && point.x <= width - 9.99, 'whole value label stays within horizontal padding');
        assert(point.y >= 9.99 && point.y <= height - 9.99, 'whole value label stays within vertical padding');
      }
    }
  }
  frame(start + 501); await Promise.all(motions); assert.equal(scene.temporary.children.length, 0);
});

for(const software of [true,false])test(`large ${software?'CPU':'GPU'} canvas keeps input coordinates while respecting its pixel policy`,t=>{
 const {scene,render}=harness(t,{width:1920,height:1080,software});
 assert.equal(scene.width,1920);assert.equal(scene.height,1080);
 assert.equal(scene.camera.aspect,1920/1080);
 if(software)assert.ok(render.outputSize[0]*render.outputSize[1]<=722000);
 else assert.deepEqual(render.outputSize,[1920,1080]);
});
