import test from 'node:test';
import assert from 'node:assert/strict';
import {Box3,Vector3} from 'three';
import {LobbyScene} from '../src/arena3d/lobby-scene.mjs';

function harness(t){
 const names=['document','window','Image','requestAnimationFrame','cancelAnimationFrame','ResizeObserver'];
 const before=Object.fromEntries(names.map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]));
 const raf=new Map(),events=new Map();let id=0,draws=0,disposed=0;
 const ctx=new Proxy({},{get:(o,k)=>String(k).startsWith('create')?()=>({addColorStop(){}}):o[k]||(()=>{})});
 let observer;
 const values={document:{createElement:()=>({width:0,height:0,getContext:()=>ctx})},window:{addEventListener(){},removeEventListener(){}},Image:class{},requestAnimationFrame:fn=>{raf.set(++id,fn);return id;},cancelAnimationFrame:id=>raf.delete(id),ResizeObserver:class{constructor(callback){this.callback=callback;observer=this;}observe(target){this.target=target;}disconnect(){this.disconnected=true;}}};
 for(const [key,value]of Object.entries(values))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
 const box={width:844,height:390,left:0,top:0};const canvas={dataset:{},getBoundingClientRect:()=>box,addEventListener:(name,fn)=>events.set(name,fn),removeEventListener:name=>events.delete(name)};
 const renderer={isSoftwareRenderer:true,shadowMap:{},info:{render:{triangles:100,cachedTriangles:100}},setPixelRatio(){},setSize(w,h){this.width=w;this.height=h;this.resizes=(this.resizes||0)+1;},render(){draws++;},dispose(){disposed++;}};
 class View extends LobbyScene{createRenderer(){return renderer;}}
 const states=[];const view=new View({canvas,onStatus:s=>states.push(s)});
 let clock=performance.now();const frame=()=>{const [key,fn]=raf.entries().next().value;raf.delete(key);clock+=100;fn(clock);};
 t.after(()=>{view.dispose();for(const [key,value]of Object.entries(before))value?Object.defineProperty(globalThis,key,value):delete globalThis[key];});
 return{view,raf,events,states,frame,box,renderer,observer,get draws(){return draws;},get disposed(){return disposed;}};
}

test('the lobby sleeps behind a panel and reduced motion renders once without accumulating loops',t=>{
 const h=harness(t);h.frame();assert.ok(h.raf.size);
 h.view.setHidden(true);assert.equal(h.raf.size,0);h.view.requestRender();assert.equal(h.raf.size,0);
 h.view.setReduced(true);h.view.setHidden(false);assert.equal(h.raf.size,1);h.frame();assert.equal(h.raf.size,0);
 h.view.setHidden(false);assert.equal(h.raf.size,0);
});

test('a lost lobby context stops input and frames until normal restoration, with no security changes',t=>{
 const h=harness(t);let prevented=false;h.events.get('webglcontextlost')({preventDefault(){prevented=true;}});
 assert.equal(prevented,true);assert.equal(h.raf.size,0);assert.equal(h.states.at(-1).available,false);
 h.view.requestRender();assert.equal(h.raf.size,0);h.events.get('webglcontextrestored')();assert.equal(h.raf.size,1);assert.equal(h.states.at(-1).available,true);
 h.view.dispose();h.view.dispose();assert.equal(h.disposed,1);assert.equal(h.raf.size,0);assert.equal(h.events.size,0);
});

test('resizing retains the previous backing canvas until the next complete paint',t=>{
 const h=harness(t);assert.equal(h.renderer.resizes,undefined);h.frame();const count=h.renderer.resizes;
 Object.assign(h.box,{width:390,height:700});h.view.resize();assert.equal(h.renderer.resizes,count);assert.ok(h.view.pendingSize);
 h.frame();assert.equal(h.renderer.width,390);assert.equal(h.renderer.height,700);assert.equal(h.view.pendingSize,null);
});

test('a hidden zero-sized lobby preserves its camera then refits when returning from a resized battle',t=>{
 const h=harness(t);h.frame();h.view.setHidden(true);const aspect=h.view.camera.aspect;
 Object.assign(h.box,{width:0,height:0});h.view.resize();assert.equal(h.view.camera.aspect,aspect);assert.equal(h.raf.size,0);
 Object.assign(h.box,{width:390,height:700});h.view.setHidden(false);h.frame();assert.equal(h.view.camera.aspect,390/700);assert.equal(h.renderer.width,390);assert.equal(h.renderer.height,700);
});

test('portrait companions stay outside the matching button and below the side navigation',t=>{
 const h=harness(t);
 for(const [width,height]of[[320,568],[390,700],[430,740],[500,702],[390,844],[430,932]]){
  Object.assign(h.box,{width,height});h.view.resize();h.frame();const buttonWidth=Math.min(240,width-100),left=(width-buttonWidth)/2;
  for(const [index,buddy]of h.view.world.buddies.entries()){
   h.view.world.root.updateMatrixWorld(true);const b=new Box3().setFromObject(buddy.root),points=[];
   for(const x of[b.min.x,b.max.x])for(const y of[b.min.y,b.max.y])for(const z of[b.min.z,b.max.z]){const p=new Vector3(x,y,z).project(h.view.camera);points.push({x:(p.x+1)*width/2,y:(1-p.y)*height/2});}
   const minX=Math.min(...points.map(p=>p.x)),maxX=Math.max(...points.map(p=>p.x)),minY=Math.min(...points.map(p=>p.y));
   assert.ok(minX>=2&&maxX<=width-2,`${width}: companion is within the viewport`);
   assert.ok(index?minX>=width-left+3:maxX<=left-3,`${width}: companion clears the central button`);
   assert.ok(minY>=height-Math.max(172,height*.26)+3,`${width}x${height}: companion clears side navigation: ${minY}`);
  }
 }
});

test('inset-only canvas changes refit the lobby without a window resize and release observation',t=>{
 const h=harness(t);h.frame();h.view.setReduced(true);h.frame();
 Object.assign(h.box,{width:390,height:763,left:0,top:47});h.observer.callback();h.frame();
 assert.equal(h.view.camera.aspect,390/763);assert.equal(h.renderer.width,390);assert.equal(h.renderer.height,763);
 h.view.setHidden(true);Object.assign(h.box,{width:0,height:0});h.observer.callback();assert.equal(h.raf.size,0);
 Object.assign(h.box,{width:750,height:369,left:47,top:0});h.view.setHidden(false);h.frame();assert.equal(h.view.camera.aspect,750/369);
 h.view.dispose();assert.equal(h.observer.disconnected,true);
});
