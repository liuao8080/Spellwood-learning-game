import test from "node:test";
import assert from "node:assert/strict";
import { Vector3 } from "three";
import { HandScene } from "../src/arena3d/hand-scene.mjs";
import { CardTextures, handRuleLines } from "../src/arena3d/card-textures.mjs";
import { CARD } from "../src/cards.mjs";

// Geometry, raycasting, ownership and scheduling are real. The canvas renderer
// is stubbed here; this does not claim pixel or physical touch-device coverage.
function harness(t, options = {}) {
  const names = ["window", "document", "Image", "requestAnimationFrame", "cancelAnimationFrame", "devicePixelRatio", "ResizeObserver"];
  const originals = Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const raf = new Map(), listeners = new Map(), captures = new Set(); let serial = 0, draws = 0, disposed = 0;
  const context = new Proxy({}, { get(object, key) { if (key === "measureText") return text => ({ width: text.length * 25 }); if (String(key).startsWith("create")) return () => ({ addColorStop() {} }); return object[key] || (() => {}); } });
  const box = { left: 8, top: 214, width: options.width || 828, height: options.height || 168 };
  const canvas = { dataset: {}, style: {}, getBoundingClientRect: () => box,
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name),
    setPointerCapture: id => captures.add(id), hasPointerCapture: id => captures.has(id), releasePointerCapture: id => captures.delete(id) };
  const values = { window: { addEventListener() {}, removeEventListener() {} }, document: { hidden: false, createElement: () => ({ width: 0, height: 0, getContext: () => context }), addEventListener() {}, removeEventListener() {} }, Image: class {}, devicePixelRatio: 2, ResizeObserver: undefined,
    requestAnimationFrame: fn => { raf.set(++serial, fn); return serial; }, cancelAnimationFrame: id => raf.delete(id) };
  for (const [name, value] of Object.entries(values)) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  const renderer = { isSoftwareRenderer: !!options.software, info: { render: {} }, resizes: 0, setPixelRatio(value) { this.ratio = value; }, setSize(w, h) { this.resizes++; this.width = w; this.height = h; }, render(scene, camera) { draws++; scene.updateMatrixWorld(true); camera.updateMatrixWorld(true); }, dispose() { disposed++; } };
  class TestHandScene extends HandScene { createRenderer() { return renderer; } }
  const selected = [], inspected = [], hovered = [], focused = [], layouts = [], statuses = [];
  const scene = new TestHandScene({ canvas, reduced: options.reduced ?? true,
    onSelect: value => selected.push(value), onInspect: value => inspected.push(value), onHover: value => hovered.push(value),
    onFocus: value => focused.push(value), onLayout: value => layouts.push(value), onStatus: value => statuses.push(value) });
  t.after(() => { scene.dispose(); for (const [name, descriptor] of Object.entries(originals)) descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]; });
  const frame = (now = performance.now() + 500) => { const entry = raf.entries().next().value; assert.ok(entry, "one scheduled frame exists"); raf.delete(entry[0]); entry[1](now); };
  frame();
  return { scene, canvas, box, renderer, raf, listeners, captures, frame, selected, inspected, hovered, focused, layouts, statuses,
    get draws() { return draws; }, get disposed() { return disposed; } };
}
const ids = ["fox", "turtle", "owl", "spark", "bloom", "moon", "rabbit"];
const point = (h, index) => { const rect = h.scene.getCardRects()[index]; return { clientX: h.box.left + rect.centerX, clientY: h.box.top + rect.centerY, pointerId: 1, pointerType: "touch", button: 0 }; };

test('owner draw enters the real hand window, terminates, and repeated visibility updates stay idle',t=>{
 const h=harness(t,{reduced:false,software:true});h.scene.setHand(ids);h.frame();
 h.scene.animateDraw(1);const last=h.scene.cards.at(-1),start=h.scene.motionStart;
 assert.ok(last.root.position.x>h.box.width/2);
 h.frame(Math.max(start+440,h.scene.lastFrame+50));
 assert.equal(last.root.position.x,last.target.x);assert.equal(h.raf.size,0);
 h.scene.setHidden(false);assert.equal(h.raf.size,0);
 h.scene.animateDraw(2);h.scene.setHidden(true);assert.equal(h.raf.size,0);assert.equal(h.scene.motionStart,null);
});

test("seven real thick cards have a bounded shared geometry and material budget", t => {
  const h = harness(t); h.scene.setHand(ids, { revision: 7 }); h.frame();
  let triangles = 0;
  h.scene.scene.traverse(node => { if (node.isMesh) triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3; });
  assert.ok(triangles < 5000, `seven physical cards have ${triangles} triangles`);
  assert.equal(h.scene.cards.length, 7); assert.equal(h.scene.textures.entries.size, 7);
  assert.equal(h.scene.bodyGeometry, h.scene.cards[6].root.children[0].geometry);
  h.scene.bodyGeometry.computeBoundingBox(); assert.ok(h.scene.bodyGeometry.boundingBox.max.z - h.scene.bodyGeometry.boundingBox.min.z >= .1);
  assert.equal(h.raf.size, 0, "idle has no perpetual frames");
});
test("ordinary, hovered and selected cards stay inside each dedicated hand viewport", t => {
  const h = harness(t); h.scene.setHand(ids);
  for (const [width, height] of [[304, 182], [828, 168], [884, 249]]) {
    Object.assign(h.box, { width, height }); h.scene.resize();
    for (let index = 0; index < 7; index++) {
      h.scene.setHand(ids, { selectedIndex: index }); h.scene.scrollToIndex(index); h.scene.focus(index); h.frame();
      const rect = h.scene.getCardRects()[index];
      assert.ok(rect.x >= -.2 && rect.x + rect.width <= width + .2, `${width}: card ${index} horizontal fit ${rect.x}, ${rect.width}`);
      assert.ok(rect.y >= -.2 && rect.y + rect.height <= height + .2, `${width}: card ${index} vertical fit ${rect.y}, ${rect.height}`);
      assert.equal(rect.focused, true); assert.equal(h.scene.cards[index].focus.visible, true);
      assert.equal(h.scene.cards[index].focus.material, h.scene.focusMaterial);
    }
    h.scene.focus(null); h.scene.setHand(ids, { selectedIndex: null });
    h.scene.hover(3); h.frame(); const rect = h.scene.getCardRects()[3];
    assert.ok(rect.y >= 0 && rect.y + rect.height <= height); h.scene.hover(null);
  }
});
test("actual textured face projection meets 16px names and 14px descriptions in short landscape", t => {
  const h = harness(t); h.scene.setHand(ids); h.frame();
  for (const card of h.scene.cards) {
    const project = (font, baseline) => {
      const y = (.5 - baseline / 720) * 1.7;
      const a = card.face.localToWorld(new Vector3(0, y, 0)).project(h.scene.camera);
      const b = card.face.localToWorld(new Vector3(0, y + font / 720 * 1.7, 0)).project(h.scene.camera);
      return Math.hypot((a.x - b.x) * h.box.width / 2, (a.y - b.y) * h.box.height / 2);
    };
    assert.ok(project(78, 424) >= 16); assert.ok(project(70, 520) >= 14); assert.ok(project(100, 96) >= 20);
  }
});
test("seven-card desktop fan leaves both ends of every name and effect line unobscured", t => {
  const h = harness(t, { width: 884, height: 249 }); h.scene.setHand([...ids.slice(0, 6), "boar"]); h.frame();
  for (const card of h.scene.cards) {
    const summary = handRuleLines(card.cardId);
    const data = CARD[card.cardId];
    const lines = [[data.name, 78, 424, 256], ...summary.map((line, index) => [line, 70, (summary.length === 1 ? 560 : 520) + index * 77, 256]),
      [String(data.cost), 100, 96, 60], ...(data.type === "spell" ? [] : [[String(data.atk), 88, 695, 78], [String(data.hp), 88, 695, 434]])];
    for (const [text, font, baseline, center] of lines) for (const edge of [-1, 1]) {
      const texX = center + edge * [...text].length * font / 2;
      const location = card.face.localToWorld(new Vector3((texX / 512 - .5) * 1.15, (.5 - (baseline - font / 2) / 720) * 1.7, 0)).project(h.scene.camera);
      const picked = h.scene.pick({ clientX: h.box.left + (location.x + 1) * h.box.width / 2, clientY: h.box.top + (1 - location.y) * h.box.height / 2 });
      assert.equal(picked?.index, card.index, `${card.cardId}: ${text} edge ${edge} is obscured`);
    }
  }
});
test("real card raycasts select by intent only and inspection never mutates selection", t => {
  const h = harness(t); h.scene.setHand(ids, { revision: "room:42", selectedIndex: 1 }); h.frame();
  const event = point(h, 3); assert.equal(h.scene.pick(event).index, 3);
  h.listeners.get("pointerdown")(event); h.listeners.get("pointerup")(event);
  assert.equal(h.selected.length, 1); assert.equal(h.selected[0].revision, "room:42"); assert.equal(h.selected[0].cardId, "spark");
  assert.equal(h.scene.selectedIndex, 1); h.scene.inspect(5);
  assert.equal(h.inspected[0].cardId, "moon"); assert.equal(h.scene.selectedIndex, 1);
  assert.deepEqual(h.scene.ids, ids);
});
test("keyboard focus scrolls to card seven, has a visible frame and exposes equivalent intents", t => {
  const h = harness(t, { width: 304, height: 182 }); h.scene.setHand(ids, { revision: 9 }); h.frame();
  h.scene.focus(0); const key = name => ({ key: name, preventDefault() { this.prevented = true; } });
  const end = key("End"); assert.equal(h.scene.handleKey(end), true); assert.equal(end.prevented, true); h.frame();
  assert.equal(h.scene.focusedIndex, 6); assert.ok(h.scene.scroll > 500); assert.ok(h.scene.cards[6].focus.visible);
  h.scene.handleKey(key("Enter")); h.scene.handleKey(key("i"));
  assert.equal(h.selected[0].index, 6); assert.equal(h.inspected[0].index, 6); assert.equal(h.scene.selectedIndex, null);
  h.scene.handleKey(key("Escape")); assert.equal(h.scene.focusedIndex, null);
});
test('pointer focus transfer from semantic controls precedes the new hand gesture',t=>{
 const h=harness(t,{width:350,height:200,software:true});h.scene.setHand(ids,{revision:42});h.frame();
 h.scene.focus(0);h.scene.scrollToIndex(6);h.frame();
 let semanticFocused=true;
 h.canvas.focus=options=>{assert.equal(options.preventScroll,true);if(semanticFocused){semanticFocused=false;h.scene.focus(null);}};
 const event={...point(h,6),pointerType:'mouse'};
 h.listeners.get('pointerdown')(event);
 // The browser's default pointer focus transfer follows pointerdown handlers.
 // It must already have happened before HandInput captured this new intent.
 if(semanticFocused)h.canvas.focus({preventScroll:true});
 h.listeners.get('pointerup')(event);
 assert.equal(h.selected.length,1);assert.equal(h.selected[0].cardId,ids[6]);assert.equal(h.selected[0].revision,42);
 assert.equal(h.canvas.dataset.inputModality,'pointer');
 h.scene.handleKey({key:'End',preventDefault(){}});assert.equal(h.canvas.dataset.inputModality,'keyboard');
 assert.equal(h.scene.focusedIndex,6);assert.equal(h.scene.cards[6].focus.visible,true);
 h.scene.focus(0);h.frame();const next=point(h,0);h.listeners.get('pointerdown')(next);
 h.scene.focus(null);h.listeners.get('pointerup')(next);
 assert.equal(h.selected.length,1,'a later real focus departure still cancels the pending gesture');
});
test("hand revisions, resize, modal disable and hidden states cancel captured input", t => {
  const h = harness(t); h.scene.setHand(ids, { revision: 1 }); h.frame();
  for (const cancel of [() => h.scene.setHand(ids, { revision: 2 }), () => h.scene.resize(), () => h.scene.setInteractive(false), () => h.scene.setHidden(true)]) {
    h.scene.setInteractive(true); h.scene.setHidden(false); const event = point(h, 0);
    h.listeners.get("pointerdown")(event); assert.ok(h.scene.input.active); cancel(); h.listeners.get("pointerup")(event);
    assert.equal(h.selected.length, 0); assert.equal(h.inspected.length, 0); assert.equal(h.captures.size, 0);
  }
  assert.equal(h.raf.size, 0); h.scene.requestRender(); assert.equal(h.raf.size, 0); h.scene.setHidden(false); assert.equal(h.raf.size, 1);
});
test("hand textures are independent of full textures and switching finishes releases old maps", t => {
  const h = harness(t); const other = new CardTextures(); const opening = other.get("fox", "gold");
  let oldDisposed = 0, openingDisposed = 0; opening.addEventListener("dispose", () => openingDisposed++);
  h.scene.setHand(ids); const oldMaps = h.scene.cards.map(card => card.frontTexture);
  for (const map of oldMaps) map.addEventListener("dispose", () => oldDisposed++);
  for (const finish of ["leaf", "silver", "star", "gold", "base"]) {
    h.scene.setHand(ids, { finishes: Object.fromEntries(ids.map(id => [id, finish])) });
    assert.equal(h.scene.textures.entries.size, 7); assert.ok(h.scene.textures.images.size <= 7);
  }
  assert.equal(oldDisposed, 7); assert.equal(openingDisposed, 0); assert.notEqual(h.scene.cards[0].frontTexture, opening);
  h.scene.setHand([]); assert.equal(h.scene.textures.entries.size, 0); assert.equal(h.scene.textures.images.size, 0);
  h.scene.dispose(); assert.equal(openingDisposed, 0); other.dispose(); assert.equal(openingDisposed, 1);
});
test("CPU backing pixels are bounded, animations terminate and unchanged hand updates stay idle", t => {
  const h = harness(t, { software: true, reduced: false, width: 1600, height: 600 });
  assert.ok(h.renderer.width * h.renderer.height <= 241000); assert.equal(h.renderer.ratio, 1);
  h.scene.setHand(ids, { revision: 1 }); h.frame(); assert.equal(h.raf.size, 0);
  h.scene.setHand(ids, { revision: 1 }); assert.equal(h.raf.size, 0);
  h.scene.hover(3); const start = h.scene.motionStart; h.frame(Math.max(start + 170, h.scene.lastFrame + 50)); assert.equal(h.raf.size, 0);
  h.scene.setHidden(true); h.scene.hover(4); assert.equal(h.raf.size, 0);
});
test("hidden zero-size hand measurements preserve the last useful camera and scrolling", t => {
  const h = harness(t, { software: true, width: 390, height: 190 });
  h.scene.setHand(ids); h.scene.scrollToIndex(6); h.frame();
  const previous = { width:h.scene.width,height:h.scene.height,left:h.scene.camera.left,scroll:h.scene.scroll,resizes:h.renderer.resizes };
  h.scene.setHidden(true); Object.assign(h.box,{width:0,height:0}); h.scene.resize();
  assert.deepEqual({width:h.scene.width,height:h.scene.height,left:h.scene.camera.left,scroll:h.scene.scroll,resizes:h.renderer.resizes},previous);
  assert.equal(h.raf.size,0);
  Object.assign(h.box,{width:740,height:168}); h.scene.setHidden(false); h.frame();
  assert.equal(h.scene.width,740); assert.equal(h.scene.height,168);
  h.scene.scrollToIndex(6); if(h.raf.size)h.frame();
  assert.ok(h.scene.getCardRects()[6].visibleRect.width>100); assert.equal(h.scene.ids.length,7);
});
test("hand resize retains its backing image until painting and blocks stale-frame selection",t=>{
  const h=harness(t,{software:true,width:390,height:190});h.scene.setHand(ids);h.frame();
  const before=h.renderer.resizes;Object.assign(h.box,{width:430,height:190});h.scene.resize();
  assert.equal(h.renderer.resizes,before);assert.equal(h.renderer.width,390);assert.equal(h.scene.select(0,'pointer'),false);
  h.frame();assert.equal(h.renderer.width,430);assert.equal(h.renderer.resizes,before+1);assert.equal(h.scene.select(0),true);
  h.scene.resize();h.frame();assert.equal(h.renderer.resizes,before+1);
});

test('semantic Enter and button selection survive a pending resize without admitting stale pointer hits', t => {
  const h = harness(t, { width: 390, height: 190 }); h.scene.setHand(ids, { revision: 9 }); h.frame();
  Object.assign(h.box, { width: 828, height: 168 }); h.scene.resize();
  assert(h.scene.pendingSize); assert.equal(h.scene.enabled(), false); h.scene.focus(4);
  const event = { key: 'Enter', repeat: false, preventDefault() { this.prevented = true; } };
  assert.equal(h.scene.handleKey(event), true); assert(event.prevented);
  assert.equal(h.selected.length, 1); assert.equal(h.selected[0].index, 4); assert.equal(h.selected[0].revision, 9);
  assert.equal(h.selected[0].cardId, ids[4]); assert.equal(h.selected[0].source, 'keyboard');
  assert.equal(h.scene.select(3, 'accessible-button'), true);
  assert.equal(h.scene.select(0, 'pointer'), false); assert.equal(h.scene.pick({ clientX: 20, clientY: 230 }), null);
  h.scene.handleKey({ ...event, repeat: true }); assert.equal(h.selected.length, 2);
  for (const field of ['hidden', 'pageHidden', 'contextLost', 'frameFault', 'destroyed']) {
    h.scene[field] = true; assert.equal(h.scene.handleKey(event), false); assert.equal(h.scene.select(4, 'accessible-button'), false); h.scene[field] = false;
  }
  h.scene.setInteractive(false); assert.equal(h.scene.handleKey(event), false);
  h.scene.setInteractive(true); h.frame(); assert.equal(h.scene.select(0, 'pointer'), true);
});
test("disposing twice removes listeners and releases shared resources exactly once", t => {
  const h = harness(t); h.scene.setHand(ids); const resources = [...h.scene.resources]; const counts = new Map();
  for (const resource of resources) resource.addEventListener("dispose", () => counts.set(resource, (counts.get(resource) || 0) + 1));
  h.scene.focus(3); h.scene.dispose(); h.scene.dispose();
  assert.equal(h.disposed, 1); assert.equal(h.raf.size, 0); assert.equal(h.listeners.size, 0); assert.equal(h.scene.resources.size, 0);
  assert.equal(counts.size, resources.length); assert.ok([...counts.values()].every(value => value === 1));
  h.scene.setHand(ids); assert.equal(h.scene.cards.length, 0);
});


test("same-name hand instances show their own saved costs and reset without growing texture caches",t=>{
 const h=harness(t);h.scene.setHand(['fox','fox'],{revision:1,costs:[CARD.fox.cost-1,CARD.fox.cost]});
 assert.deepEqual(h.scene.costs,[CARD.fox.cost-1,CARD.fox.cost]);assert.notEqual(h.scene.cards[0].frontTexture,h.scene.cards[1].frontTexture);assert.equal(h.scene.textures.entries.size,2);
 const discounted=h.scene.cards[0].frontTexture;let disposed=0;discounted.addEventListener('dispose',()=>disposed++);
 h.scene.setHand(['fox','fox'],{revision:2,costs:[CARD.fox.cost,CARD.fox.cost-1]});assert.equal(h.scene.cards[1].frontTexture,discounted);assert.equal(h.scene.textures.entries.size,2);
 h.scene.setHand(['fox','fox'],{revision:3,costs:[CARD.fox.cost,CARD.fox.cost]});assert.equal(disposed,1);assert.equal(h.scene.cards[0].frontTexture,h.scene.cards[1].frontTexture);assert.equal(h.scene.textures.entries.size,1);
 h.scene.setHand(['fox'],{revision:4,costs:[-1]});assert.deepEqual(h.scene.costs,[CARD.fox.cost]);h.scene.setHand([]);assert.equal(h.scene.textures.entries.size,0);
});

test('an authority-only revision cancels old gestures without repainting an unchanged hand',t=>{
 const h=harness(t,{reduced:false});h.scene.setHand(ids,{revision:1});h.frame();
 const draws=h.draws,inputRevision=h.scene.inputRevision,event=point(h,0);
 h.listeners.get('pointerdown')(event);assert.ok(h.scene.input.active);
 h.scene.setHand(ids,{revision:2});
 assert.equal(h.scene.revision,2);assert.equal(h.scene.inputRevision,inputRevision+1);
 assert.equal(h.scene.input.active,null);assert.equal(h.raf.size,0);assert.equal(h.draws,draws);
 h.listeners.get('pointerup')(event);assert.equal(h.selected.length,0);
 h.scene.select(0,'keyboard');assert.equal(h.selected.length,1);assert.equal(h.selected[0].revision,2);assert.equal(h.selected[0].cardId,ids[0]);
});
test('selection cost finish hover and resize still schedule the necessary hand redraw',t=>{
 const h=harness(t,{reduced:false});h.scene.setHand(ids,{revision:1});h.frame();
 h.scene.setHand(ids,{revision:2,selectedIndex:1});assert.equal(h.raf.size,1);h.frame();
 h.scene.setHand(ids,{revision:3,selectedIndex:1,costs:[CARD.fox.cost-1]});assert.equal(h.raf.size,1);h.frame();
 h.scene.setHand(ids,{revision:4,selectedIndex:1,costs:[CARD.fox.cost-1],finishes:{fox:'leaf'}});assert.equal(h.raf.size,1);h.frame();
 h.scene.hover(2);assert.equal(h.raf.size,1);h.frame();
 h.box.width-=10;h.scene.resize();assert.equal(h.raf.size,1);h.frame();
 h.scene.setInteractive(false);assert.equal(h.scene.select(0,'keyboard'),false);
 h.scene.setInteractive(true);h.scene.select(0,'keyboard');assert.equal(h.selected.at(-1).revision,4);
});
