import test from "node:test";
import assert from "node:assert/strict";
import { Box3, Vector3 } from "three";
import { PackScene } from "../src/arena3d/pack-scene.mjs";

// Real Three geometry, raycasting, layout and animation. Canvas is stubbed;
// this exercises ownership/interruptions and is not claimed as browser QA.
function harness(t, options = {}) {
  const names = ["window", "document", "Image", "requestAnimationFrame", "cancelAnimationFrame", "devicePixelRatio", "ResizeObserver"];
  const originals = Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const raf = new Map(), listeners = new Map(), windowListeners = new Map(), documentListeners = new Map(), captures = new Set(); let id = 0, draws = 0, disposed = 0, releases = 0;
  const context = new Proxy({}, { get(o, key) { if (key === "measureText") return text => ({ width: text.length * 20 }); if (String(key).startsWith("create")) return () => ({ addColorStop() {} }); return o[key] || (() => {}); } });
  const box = { width: options.width || 760, height: options.height || 580, left: 0, top: 0 };
  const canvas = { dataset: {}, style: {}, getBoundingClientRect: () => box, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name),
    setPointerCapture: pointerId => captures.add(pointerId), hasPointerCapture: pointerId => captures.has(pointerId),
    releasePointerCapture: pointerId => { captures.delete(pointerId); releases++; if (options.synchronousCaptureLoss) listeners.get("lostpointercapture")?.({ pointerId }); } };
  const values = { window: { addEventListener: (name, fn) => windowListeners.set(name, fn), removeEventListener: name => windowListeners.delete(name) }, document: { hidden: false, createElement: () => ({ width: 0, height: 0, getContext: () => context }), addEventListener: (name, fn) => documentListeners.set(name, fn), removeEventListener: name => documentListeners.delete(name) }, Image: class {}, devicePixelRatio: 1, ResizeObserver: undefined,
    requestAnimationFrame: fn => { raf.set(++id, fn); return id; }, cancelAnimationFrame: key => raf.delete(key) };
  for (const [name, value] of Object.entries(values)) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  const renderer = { isSoftwareRenderer: !!options.software, setPixelRatio() {}, setSize(w,h) { this.width=w;this.height=h; }, render(scene,camera) { draws++;scene.updateMatrixWorld(true);camera.updateMatrixWorld(true); }, dispose() { disposed++; } };
  if(options.warm)renderer.textureData=()=>{ renderer.warmed=(renderer.warmed||0)+1; };
  class TestScene extends PackScene { createRenderer() { return renderer; } }
  const intents = [], sounds = [], statuses = []; let ready = 0, opens = 0;
  const scene = new TestScene({ canvas, reduced: !!options.reduced, onReveal: i => intents.push(i), onReady: () => ready++, onOpenRequested: () => opens++, onStatus: s => statuses.push(s), onSound: s => sounds.push(s) });
  t.after(() => { scene.dispose(); for (const [name, descriptor] of Object.entries(originals)) descriptor ? Object.defineProperty(globalThis,name,descriptor) : delete globalThis[name]; });
  const frame = (now = performance.now() + 100) => { const entry=raf.entries().next().value;assert(entry,"a frame is scheduled");raf.delete(entry[0]);entry[1](now); };
  const fire = (name, values = {}) => {
    const event = { clientX: 30, clientY: 30, pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0,
      buttons: name === "pointerup" ? 0 : 1, preventDefault() {}, ...values };
    listeners.get(name)?.(event); return event;
  };
  frame();
  return { scene, renderer, canvas, box, raf, frame, fire, listeners, windowListeners, documentListeners, captures, intents, sounds, statuses,
    get ready() {return ready;}, get opens() {return opens;}, get draws() {return draws;}, get disposed(){return disposed;}, get releases(){return releases;} };
}
const opening = (id = "saved-opening", revealed = 0) => ({id, revealed,cards:Array.from({length:10},(_,i)=>({cardId:["fox","turtle","owl","spark","bloom"][i%5],finish:["leaf","silver","star","gold"][i%4],duplicate:i%2===0,dust:0}))});
const allMeshes = scene => { const nodes=[];scene.traverse(n=>{if(n.isMesh)nodes.push(n);});return nodes; };

test("a saved batch is required and open gestures express intent without creating rewards", t=>{
  const h=harness(t);assert.equal(h.scene.launch(),false);assert.equal(h.scene.cards.length,0);
  h.fire("pointerdown");h.fire("pointerup");
  assert.equal(h.opens,1);assert.equal(h.scene.opening,null);assert.equal(h.scene.revealed,0);
  assert.throws(()=>h.scene.setOpening({id:"bad",cards:[]}),/exactly ten/);
});

for (const pointerType of ["mouse", "touch", "pen"]) test(`${pointerType} primary taps and drags request opening without changing saved rewards`, t => {
  const h = harness(t), saved = opening(), before = JSON.stringify(saved); h.scene.setOpening(saved);
  for (const distance of [0, 40, 20]) {
    h.fire("pointerdown", { pointerType }); h.fire("pointerup", { pointerType, clientX: 30 + distance });
  }
  assert.equal(h.opens, 2, "the existing tap and long drag work; the middle drag remains inert");
  assert.deepEqual(h.intents, []); assert.equal(h.scene.revealed, 0); assert.equal(JSON.stringify(saved), before);
  assert.equal(h.scene.phase, "sealed"); assert.equal(h.scene.down, null); assert.equal(h.captures.size, 0);
});

for (const [name, values] of [
  ["right mouse button", { button: 2, buttons: 2 }], ["middle mouse button", { button: 1, buttons: 4 }],
  ["secondary pointer", { isPrimary: false }], ["button chord", { buttons: 3 }],
  ["missing pointer identity", { pointerId: undefined }], ["invalid coordinates", { clientX: NaN }],
]) test(`opening ignores ${name} and its release`, t => {
  const h = harness(t); h.scene.setOpening(opening());
  h.fire("pointerdown", values); h.fire("pointerup", { ...values, buttons: 0 });
  assert.equal(h.opens, 0); assert.deepEqual(h.intents, []); assert.equal(h.scene.down, null); assert.equal(h.captures.size, 0);
});

test("a foreign release cannot finish the owning pointer, and a second finger cancels without taking ownership", t => {
  const h = harness(t); h.scene.setOpening(opening()); h.fire("pointerdown", { pointerType: "touch" });
  h.fire("pointerup", { pointerId: 2, pointerType: "touch", isPrimary: false });
  assert.equal(h.opens, 0); assert.equal(h.scene.down.id, 1); assert.equal(h.captures.size, 1);
  h.fire("pointerdown", { pointerId: 2, pointerType: "touch", isPrimary: false });
  h.fire("pointerup", { pointerId: 2, pointerType: "touch", isPrimary: false }); h.fire("pointerup", { pointerType: "touch" });
  assert.equal(h.opens, 0); assert.deepEqual(h.intents, []); assert.equal(h.scene.down, null); assert.equal(h.captures.size, 0);
});

for (const [name, values] of [
  ["wrong release button", { button: 2 }], ["nonprimary release", { isPrimary: false }],
  ["buttons still held", { buttons: 1 }], ["invalid release coordinates", { clientY: NaN }],
]) test(`${name} cancels an opening gesture`, t => {
  const h = harness(t); h.scene.setOpening(opening()); h.fire("pointerdown"); h.fire("pointerup", values); h.fire("pointerup");
  assert.equal(h.opens, 0); assert.deepEqual(h.intents, []); assert.equal(h.scene.down, null); assert.equal(h.captures.size, 0);
});

for (const interruption of ["pointercancel", "pointerleave", "lostpointercapture", "canvas-blur", "window-blur", "page-hidden", "scene-hidden", "context-loss", "resize", "replacement", "launch-and-skip", "reduced-motion", "render-fault"])
  test(`opening gesture cannot survive ${interruption}`, t => {
    const h = harness(t); h.scene.setOpening(opening()); h.fire("pointerdown");
    if (interruption === "canvas-blur") h.fire("blur");
    else if (interruption === "window-blur") h.windowListeners.get("blur")();
    else if (interruption === "page-hidden") {
      document.hidden = true; h.documentListeners.get("visibilitychange")();
      document.hidden = false; h.documentListeners.get("visibilitychange")();
    } else if (interruption === "scene-hidden") { h.scene.setHidden(true); h.scene.setHidden(false); }
    else if (interruption === "context-loss") { h.fire("webglcontextlost"); h.fire("webglcontextrestored"); }
    else if (interruption === "resize") h.scene.resize();
    else if (interruption === "replacement") h.scene.setOpening(opening("replacement"));
    else if (interruption === "launch-and-skip") { h.scene.launch(); h.scene.skip(); }
    else if (interruption === "reduced-motion") h.scene.setReduced(true);
    else if (interruption === "render-fault") { h.renderer.render = () => { throw new Error("test render fault"); }; h.frame(); }
    else h.fire(interruption);
    h.fire("pointerup");
    assert.equal(h.opens, 0); assert.deepEqual(h.intents, []); assert.equal(h.scene.revealed, 0);
    assert.equal(h.scene.down, null); assert.equal(h.captures.size, 0);
  });

test("synchronous lostpointercapture cleanup does not recurse or duplicate opening, and dispose removes listeners", t => {
  const h = harness(t, { synchronousCaptureLoss: true }); h.scene.setOpening(opening());
  h.fire("pointerdown"); h.fire("pointerup"); h.fire("pointerup");
  assert.equal(h.opens, 1); assert.equal(h.releases, 1); assert.equal(h.scene.down, null);
  h.fire("pointerdown"); h.scene.dispose();
  assert.equal(h.releases, 2); assert.equal(h.opens, 1); assert.equal(h.captures.size, 0);
  assert.equal(h.listeners.size, 0); assert.equal(h.windowListeners.size, 0); assert.equal(h.documentListeners.size, 0);
});

test("ten physical cards, gift and pooled light effects stay under the revised 7500-triangle detail budget", t=>{
  const {scene}=harness(t);const saved=opening();const copy=JSON.stringify(saved);scene.setOpening(saved);
  const triangles=allMeshes(scene.scene).reduce((n,m)=>n+(m.geometry.index?.count??m.geometry.attributes.position.count)/3,0);
  assert.ok(triangles<7500,`actual triangle budget: ${triangles}`);
  const box=new Box3().setFromObject(scene.cards[0].root);assert.ok(box.max.z-box.min.z>.07);
  assert.equal(scene.cards.length,10);scene.skip();scene.reveal(1);assert.equal(JSON.stringify(saved),copy);
});

test("opening progresses through charge, separate lid, staggered flight and ten backs", t=>{
  const h=harness(t);h.scene.setOpening(opening());assert.equal(h.scene.phase,"sealed");assert.equal(h.scene.launch(),true);
  const start=h.scene.startTime;h.frame(start+600);assert.equal(h.scene.phase,"charging");
  h.frame(start+1500);assert.equal(h.scene.phase,"opening");assert.ok(h.scene.lid.position.y>2.15);
  h.frame(start+1800);assert.equal(h.scene.phase,"dealing");assert.ok(h.scene.cards.some(c=>c.root.visible));assert.ok(h.scene.cards.some(c=>!c.root.visible));
  h.frame(start+3651);assert.equal(h.scene.phase,"ready");assert.equal(h.ready,1);assert.equal(h.scene.revealed,0);
  assert.ok(h.scene.cards.every(c=>c.root.visible&&c.angle===Math.PI));assert.equal(h.raf.size,0);
  h.scene.skip();assert.equal(h.ready,1);assert.deepEqual(h.sounds,["pack-charge","pack-open"]);
});

test("raycast selects a card but waits for a committed reveal mask before flipping",t=>{
  const h=harness(t);h.scene.setOpening(opening(),{intro:false});h.frame();
  const point=h.scene.cards[2].root.position.clone().project(h.scene.camera);
  const e={clientX:(point.x+1)*h.box.width/2,clientY:(1-point.y)*h.box.height/2};
  assert.equal(h.scene.pick(e),2);h.fire("pointerdown",e);h.fire("pointerup",e);
  assert.deepEqual(h.intents,[2]);assert.equal(h.scene.revealed,0);assert.equal(h.scene.focusedIndex,2);
  assert.ok(h.scene.revealLights.every(effect=>effect.index===null),"intent alone cannot launch a reveal burst");
  h.scene.setOpening(opening("saved-opening",4));assert.equal(h.scene.revealed,4);assert.equal(h.scene.animations.size,1);
  h.frame(performance.now()+700);assert.equal(h.scene.cards[2].angle,0);
  h.scene.setOpening({...opening("saved-opening",4),cards:opening().cards.map(x=>({...x,cardId:"owl"}))});
  assert.equal(h.scene.cards[0].data.cardId,"fox");
});

test("real card raycasting reveals once per primary touch gesture and does not commit a reveal itself", t => {
  const h = harness(t), saved = opening(), before = JSON.stringify(saved); h.scene.setOpening(saved, { intro: false }); h.frame();
  const point = h.scene.cards[2].root.position.clone().project(h.scene.camera);
  const values = { clientX: (point.x + 1) * h.box.width / 2, clientY: (1 - point.y) * h.box.height / 2, pointerType: "touch" };
  h.fire("pointerdown", values); h.fire("pointerup", values); h.fire("pointerup", values);
  assert.deepEqual(h.intents, [2]); assert.equal(h.scene.focusedIndex, 2); assert.equal(h.scene.revealed, 0);
  assert.equal(JSON.stringify(saved), before); assert.equal(h.scene.animations.size, 0); assert.equal(h.captures.size, 0);
});

test("a press over one card cannot reveal a different card moved under its release", t => {
  const h = harness(t); h.scene.setOpening(opening(), { intro: false }); h.frame();
  const point = h.scene.cards[2].root.position.clone().project(h.scene.camera);
  const values = { clientX: (point.x + 1) * h.box.width / 2, clientY: (1 - point.y) * h.box.height / 2 };
  assert.equal(h.scene.pick(values), 2); h.fire("pointerdown", values);
  h.scene.focus(4); h.scene.animate(performance.now() + 600);
  assert.notEqual(h.scene.pick(values), 2, "the real focus layout changed the raycast target");
  h.fire("pointerup", values); assert.deepEqual(h.intents, []); assert.equal(h.scene.revealed, 0);
});

test("skip/reduced motion never reveal, while restored masks immediately show committed fronts",t=>{
  const h=harness(t);h.scene.setOpening(opening());h.scene.launch();h.scene.skip();assert.equal(h.scene.revealed,0);
  h.scene.setOpening(opening("restored",513),{intro:true});assert.equal(h.scene.phase,"ready");assert.equal(h.scene.cards[0].angle,0);assert.equal(h.scene.cards[9].angle,0);assert.equal(h.scene.cards[1].angle,Math.PI);
  h.scene.setOpening(opening("reduced"));h.scene.launch();h.scene.setReduced(true);assert.equal(h.scene.phase,"ready");assert.equal(h.scene.revealed,0);
  h.scene.setOpening(opening("reduced",1023));h.frame();assert.equal(h.scene.phase,"complete");assert.ok(h.scene.cards.every(c=>c.angle===0));assert.equal(h.raf.size,0);
});

test("hidden work schedules no frames and resumes the same saved batch",t=>{
  const h=harness(t);h.scene.setOpening(opening());h.scene.launch();h.scene.setHidden(true);
  assert.equal(h.raf.size,0);h.scene.requestRender();assert.equal(h.raf.size,0);
  h.scene.setHidden(false);assert.equal(h.raf.size,1);assert.equal(h.scene.opening.id,"saved-opening");
  h.scene.skip();h.frame();assert.equal(h.raf.size,0);
});

test("a focused front fits 320–430px portraits and short landscape without depending on drag",t=>{
  const h=harness(t,{reduced:true});h.scene.setOpening(opening("fit",1023),{intro:false});
  for(const [width,height] of [[320,430],[360,560],[390,500],[430,600],[740,270]]){
    Object.assign(h.box,{width,height});h.scene.resize();h.scene.focus(4);h.frame();
    const box=new Box3().setFromObject(h.scene.cards[4].root);
    for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
      const p=new Vector3(x,y,z).project(h.scene.camera);assert.ok(Math.abs(p.x)<.95&&Math.abs(p.y)<.95,`${width}x${height}: ${p.x}, ${p.y}`);
    }
    h.scene.focus(null);assert.equal(h.scene.focusedIndex,null);
  }
});

test("repeated batches release card resources exactly once; dispose stops callbacks",t=>{
  const h=harness(t);h.scene.setOpening(opening());const objects=[...h.scene.cards.flatMap(c=>[...c.resources])];
  const counts=new Map();for(const object of objects)object.addEventListener("dispose",()=>counts.set(object,(counts.get(object)||0)+1));
  for(let i=0;i<12;i++)h.scene.setOpening(opening(`repeat-${i}`),{intro:false});
  assert.equal(h.scene.cards.length,10);assert.ok([...counts.values()].every(v=>v===1));assert.equal(counts.size,objects.length);
  h.scene.dispose();h.scene.dispose();assert.equal(h.disposed,1);assert.equal(h.raf.size,0);assert.equal(h.listeners.size,0);assert.equal(h.scene.resources.size,0);
  h.scene.setOpening(opening());assert.equal(h.scene.cards.length,0);
});

test("CPU backing pixels are bounded and animation cadence avoids a perpetual idle loop",t=>{
  const h=harness(t,{software:true,width:1600,height:1000});assert.ok(h.renderer.width*h.renderer.height<=291000);
  h.scene.setOpening(opening());h.scene.launch();const start=h.scene.startTime;h.frame(start+100);const draws=h.draws;
  h.frame(start+116);assert.equal(h.draws,draws);h.frame(start+135);assert.equal(h.draws,draws+1);
  h.scene.skip();h.frame(start+4000);assert.equal(h.raf.size,0);
});

test("the separated lid and flying cards stay in frame across portrait and short landscape",t=>{
  const h=harness(t),p=new Vector3();
  for(const [width,height] of [[760,580],[360,520],[740,270]]){
    Object.assign(h.box,{width,height});h.scene.resize();h.scene.setOpening(opening(`${width}-flight`));h.scene.launch();const start=h.scene.startTime;
    for(const elapsed of [1300,1580,1780,2200,2400,2700,3100]){
      h.scene.animate(start+elapsed);h.scene.scene.updateMatrixWorld(true);h.scene.camera.updateMatrixWorld(true);
      const targets=[h.scene.lid,...h.scene.cards.filter(c=>c.root.visible).map(c=>c.root)];
      for(const target of targets)target.traverse(o=>{
        if(!o.isMesh)return;const positions=o.geometry.attributes.position;
        for(let i=0;i<positions.count;i++){
          p.fromBufferAttribute(positions,i).applyMatrix4(o.matrixWorld).project(h.scene.camera);
          assert.ok(Math.abs(p.x)<1.015&&Math.abs(p.y)<1.015,`${width}x${height} at ${elapsed}: ${target.name||'lid'} (${p.x},${p.y})`);
        }
      });
    }
  }
});

test("onReady can synchronously close the scene without rendering disposed buffers",t=>{
  const h=harness(t);h.scene.setOpening(opening());h.scene.onReady=()=>h.scene.dispose();h.scene.launch();
  const start=h.scene.startTime,draws=h.draws;h.frame(start+4000);
  assert.equal(h.disposed,1);assert.equal(h.draws,draws);assert.equal(h.raf.size,0);
});

test("charge light accumulates once and three small solid rays escape the opening box",t=>{
  const h=harness(t);h.scene.setOpening(opening());h.scene.launch();const start=h.scene.startTime;
  h.scene.animate(start+200);const early=h.scene.seamLightMaterial.opacity;
  h.scene.animate(start+800);assert.ok(h.scene.seamLightMaterial.opacity>early);
  assert.equal(h.scene.chargeLight.visible,true);assert.equal(h.scene.boxRays.visible,false);
  h.scene.animate(start+1500);assert.equal(h.scene.boxRays.visible,true);assert.equal(h.scene.boxRays.children.length,3);
  assert.ok(h.scene.boxRays.children.every(ray=>ray.children.length===2&&ray.children.every(m=>m.geometry.type==="CylinderGeometry")));
  assert.ok(h.scene.rayShellMaterial.opacity<=.23);assert.ok(h.scene.rayCoreMaterial.opacity<=.74);
  h.scene.animate(start+2600);assert.equal(h.scene.boxRays.visible,false);assert.equal(h.scene.chargeLight.visible,false);
  h.scene.skip();assert.equal(h.scene.revealed,0);assert.ok(h.scene.revealLights.every(e=>!e.root.visible));
});

test("persisted finishes color a short halo and nine solid leaf/stars, ending with the flip",t=>{
  const h=harness(t);h.scene.setOpening(opening(),{intro:false});
  for(const [index,color] of [[0,0x92c987],[1,0xbfdfed],[2,0xba9ce8],[3,0xf2ce75]]){
    h.scene.reveal(index);const start=h.scene.animations.get(index).start;
    h.scene.animate(start+100);assert.ok(h.scene.revealLights.every(e=>!e.root.visible));
    h.scene.animate(start+300);const effect=h.scene.revealLights.find(e=>e.index===index);
    assert.equal(effect.root.visible,true);assert.equal(effect.moteMaterial.color.getHex(),color);
    assert.equal(effect.motes.length,9);assert.equal(effect.rings.length,2);
    assert.ok(effect.haloMaterial.opacity>0&&effect.haloMaterial.opacity<=.22);
    assert.ok(effect.root.position.distanceTo(h.scene.cards[index].root.position)<1e-8);
    h.scene.animate(start+541);assert.ok(h.scene.revealLights.every(e=>e.index===null&&!e.root.visible));
    assert.equal(h.scene.animations.size,0);
  }
});

test("reveal-all uses at most two fixed bursts, preserves the focus burst, and reduced motion clears them",t=>{
  const h=harness(t);h.scene.setOpening(opening(),{intro:false});h.scene.focus(0);
  const resources=h.scene.resources.size,roots=h.scene.revealLights.map(e=>e.root);
  h.scene.setOpening(opening("saved-opening",1023));
  assert.equal(h.scene.revealLights.filter(e=>e.index!==null).length,2);
  assert.ok(h.scene.revealLights.some(e=>e.index===0));assert.equal(h.scene.resources.size,resources);
  h.scene.animate(Math.max(...h.scene.revealLights.map(e=>e.start))+300);assert.ok(h.scene.revealLights.every(e=>e.root.visible));
  h.scene.setReduced(true);assert.equal(h.scene.revealed,1023);
  assert.ok(h.scene.revealLights.every(e=>e.index===null&&!e.root.visible));assert.equal(h.scene.animations.size,0);
  h.scene.setOpening(opening("next"));h.scene.launch();assert.equal(h.scene.phase,"ready");
  h.scene.reveal(0);assert.ok(h.scene.revealLights.every(e=>e.index===null));assert.deepEqual(h.scene.revealLights.map(e=>e.root),roots);
});

test("skip, batch replacement and dispose release or reset every light resource",t=>{
  const h=harness(t);h.scene.setOpening(opening(),{intro:false});h.scene.reveal(0);
  h.scene.animate(h.scene.animations.get(0).start+300);assert.ok(h.scene.revealLights.some(e=>e.root.visible));
  h.scene.skip();assert.ok(h.scene.revealLights.every(e=>e.index===null&&!e.root.visible));
  const tracked=[h.scene.chargeRing.geometry,h.scene.rayShellMaterial,h.scene.revealLights[0].rings[0].geometry,h.scene.revealLights[1].moteMaterial];
  const released=new Map();for(const r of tracked)r.addEventListener("dispose",()=>released.set(r,(released.get(r)||0)+1));
  h.scene.setOpening(opening("another"));assert.ok(h.scene.revealLights.every(e=>e.index===null));
  h.scene.dispose();h.scene.dispose();assert.equal(released.size,tracked.length);assert.ok([...released.values()].every(n=>n===1));
});

test("CPU card textures warm one per callback and pausing or disposing cancels preparation",t=>{
 const h=harness(t,{software:true,warm:true});h.scene.setOpening(opening());
 let steps=0;while(h.raf.size&&steps++<30){const before=h.renderer.warmed||0;h.frame(performance.now()+steps*40);assert.ok((h.renderer.warmed||0)-before<=1);}
 assert.ok(h.renderer.warmed>=6);assert.equal(h.raf.size,0);
 h.scene.queueTextureWarmup();assert.ok(h.raf.size);h.scene.setHidden(true);assert.equal(h.raf.size,0);
 h.scene.setHidden(false);assert.ok(h.raf.size);h.scene.dispose();assert.equal(h.raf.size,0);
});

test("new local opening light stays bounded and reduced motion clears ribbons and glow",t=>{
 const h=harness(t);h.scene.setOpening(opening());h.scene.launch();const start=h.scene.startTime;
 for(const elapsed of[0,200,500,900,1300,1800,2300]){h.scene.animate(start+elapsed);assert.ok(h.scene.packGlowMaterial.opacity>=0&&h.scene.packGlowMaterial.opacity<=.44);assert.ok(h.scene.ribbonMaterial.opacity>=0&&h.scene.ribbonMaterial.opacity<=.59);}
 h.scene.setReduced(true);assert.equal(h.scene.ribbons.visible,false);assert.equal(h.scene.packGlowMaterial.opacity,0);assert.equal(h.scene.revealed,0);
});
