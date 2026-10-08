/** Exact application CPU pixels. Offline QA, not browser or WebGL evidence. */
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {LobbyScene} from '../src/arena3d/lobby-scene.mjs';
import {SoftwareRenderer} from '../src/arena3d/software-renderer.mjs';
const require=createRequire(import.meta.url),{createCanvas,Image}=require('@napi-rs/canvas');
const out=path.resolve(process.argv[2]||'test-results/lobby-pixels');fs.mkdirSync(out,{recursive:true});
globalThis.Image=class extends Image{set src(v){super.src=fs.readFileSync(path.resolve('dist/assets',v.replace('/assets/','')));}};
globalThis.document={createElement:()=>createCanvas(1,1)};globalThis.window={addEventListener(){},removeEventListener(){}};globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
let width=1180,height=757;const canvas=createCanvas(width,height);canvas.dataset={};canvas.addEventListener=()=>{};canvas.removeEventListener=()=>{};canvas.getBoundingClientRect=()=>({width,height,left:0,top:0});
class CPU extends LobbyScene{createRenderer(){return new SoftwareRenderer(canvas);}}
const scene=new CPU({canvas});await new Promise(r=>setTimeout(r,80));const report={label:'OFFLINE EXACT CPU RENDER; NOT BROWSER',geometry:scene.world.metrics(),views:[]};
for(const [name,w,h]of[['desktop',1180,757],['landscape',844,390],['portrait',390,700]]){width=w;height=h;scene.resize();scene.flushResize();const times=[];for(let i=0;i<6;i++){scene.world.animate(2000+i*32);scene.renderer.render(scene.scene,scene.camera);times.push(scene.renderer.lastRenderMs);}fs.writeFileSync(path.join(out,name+'.png'),canvas.toBuffer('image/png'));report.views.push({name,css:[w,h],pixels:[canvas.width,canvas.height],firstMs:times[0],warmMs:times.slice(2),visibleTriangles:scene.renderer.info.render.triangles,cachedTriangles:scene.renderer.info.render.cachedTriangles});}
fs.writeFileSync(path.join(out,'metrics.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));scene.dispose();
