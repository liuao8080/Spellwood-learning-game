/** Exact application CPU pixels, synthetic saved cards. Not browser evidence. */
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {PackScene} from '../src/arena3d/pack-scene.mjs';
import {SoftwareRenderer} from '../src/arena3d/software-renderer.mjs';
import {geometryBudget} from '../src/arena3d/model-utils.mjs';
const require=createRequire(import.meta.url),{createCanvas,Image}=require('@napi-rs/canvas');
const out=path.resolve(process.argv[2]||'test-results/pack-cpu');fs.mkdirSync(out,{recursive:true});
globalThis.Image=class extends Image{set src(v){super.src=fs.readFileSync(path.resolve('dist/assets',v.replace('/assets/','')));}};
globalThis.document={createElement:()=>createCanvas(1,1),addEventListener(){},removeEventListener(){}};
globalThis.window={addEventListener(){},removeEventListener(){}};globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
let width=1180,height=557;
const canvas=createCanvas(width,height);canvas.dataset={};canvas.style={};canvas.addEventListener=()=>{};canvas.removeEventListener=()=>{};canvas.getBoundingClientRect=()=>({width,height,left:0,top:0});
class CPU extends PackScene{createRenderer(){return new SoftwareRenderer(canvas);}}
const scene=new CPU({canvas});
const cards=Array.from({length:10},(_,i)=>({cardId:['fox','turtle','owl','spark','bloom','otter','crane','rabbit','sprite','unicorn'][i],finish:['leaf','silver','star','gold'][i%4]}));
scene.setOpening({id:'offline-art-audit',cards,revealed:0});await new Promise(r=>setTimeout(r,80));
const report={kind:'OFFLINE EXACT APPLICATION CPU; NOT BROWSER',geometry:geometryBudget(scene.scene),views:[]};
for(const [name,w,h]of[['desktop',1180,557],['landscape',844,251],['portrait',390,464]]){
 width=w;height=h;scene.resize();scene.setOpening({id:`offline-${name}`,cards,revealed:0});scene.animate(0);scene.renderer.render(scene.scene,scene.camera);fs.writeFileSync(path.join(out,`${name}-sealed.png`),canvas.toBuffer('image/png'));
 scene.launch();const start=scene.startTime;
 const view={name,css:[w,h],pixels:[canvas.width,canvas.height],stages:[]};
 for(const [stage,elapsed]of[['charge',830],['release',1460],['deal',2350]]){scene.animate(start+elapsed);scene.renderer.render(scene.scene,scene.camera);const cost=scene.renderer.lastRenderMs;fs.writeFileSync(path.join(out,`${name}-${stage}.png`),canvas.toBuffer('image/png'));view.stages.push({stage,renderMs:cost,triangles:scene.renderer.info.render.triangles,cached:scene.renderer.info.render.cachedTriangles});}
 scene.skip();scene.setOpening({id:`offline-${name}`,cards,revealed:1023});scene.animate(performance.now()+800);scene.renderer.render(scene.scene,scene.camera);fs.writeFileSync(path.join(out,`${name}-ten.png`),canvas.toBuffer('image/png'));
 report.views.push(view);
}
fs.writeFileSync(path.join(out,'metrics.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));scene.dispose();
