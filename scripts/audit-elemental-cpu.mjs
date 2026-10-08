/** Runs the exact shipped CPU rasterizer with Canvas. This is offline pixel
 * evidence, not a browser, WebGL or full UI playtest. */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { Scene, PerspectiveCamera, Color, Vector3 } from "three";
import { createModelLibrary } from "../src/arena3d/models.mjs";
import { SoftwareRenderer } from "../src/arena3d/software-renderer.mjs";
import { createElementalCast } from "../src/arena3d/elemental-effects.mjs";
import { geometryBudget } from "../src/arena3d/model-utils.mjs";
const require=createRequire(import.meta.url),{createCanvas}=require("@napi-rs/canvas");
globalThis.document={createElement:()=>createCanvas(1,1)};
const out=path.resolve(process.argv[2]||"test-results/elemental-cpu");fs.mkdirSync(out,{recursive:true});
const scene=new Scene();scene.background=new Color(0x071b20);
const camera=new PerspectiveCamera(36,1280/800,.1,90);camera.position.set(0,16.4,18.6);camera.lookAt(0,0,.2);
const library=createModelLibrary({quality:"low"}),arena=library.createArena();arena.root.traverse(o=>o.userData.cpuStatic=true);scene.add(arena.root);
const ids=["fox","turtle","sprite","sprout","owl","dragon","stag"];
const models=ids.map((species,i)=>{const model=library.createCreature({species});model.root.position.set([-4.8,-1.6,1.6,4.8][i%4],.08,i<4?2:-2);model.root.scale.setScalar(1.3);model.applyPose({idlePhase:0});scene.add(model.root);return model;});
const canvas=createCanvas(1280,800),renderer=new SoftwareRenderer(canvas);renderer.setSize(1280,800);
function label(target){const ctx=target.getContext("2d");ctx.fillStyle="#efd9a5";ctx.font="16px sans-serif";ctx.fillText("OFFLINE CPU PIXEL AUDIT · shipped rasterizer · not a browser playtest",20,30);}
function save(name){renderer.render(scene,camera);label(canvas);fs.writeFileSync(path.join(out,name+".png"),canvas.toBuffer("image/png"));}
function bench(r){const times=[];for(let i=0;i<28;i++){r.render(scene,camera);if(i>5)times.push(r.lastRenderMs);}times.sort((a,b)=>a-b);return{medianMs:times[Math.floor(times.length/2)],p90Ms:times[Math.floor(times.length*.9)],triangles:r.info.render.triangles};}
const result={kind:"OFFLINE EXACT CPU RASTERIZER; NOT BROWSER PLAYTEST",viewport:[1280,800],models:Object.fromEntries(models.map(m=>[m.species,m.metrics])),effects:{}};
if(process.argv[3]){
  const {SoftwareRenderer:Before}=await import(pathToFileURL(path.resolve(process.argv[3])));
  const beforeCanvas=createCanvas(1280,800),before=new Before(beforeCanvas);before.setSize(1280,800);
  result.before=bench(before);label(beforeCanvas);fs.writeFileSync(path.join(out,"seven-models-before.png"),beforeCanvas.toBuffer("image/png"));before.dispose();
}
result.after=bench(renderer);save("seven-models-after");
const stages=[["charge",.11],["flight",.4],["impact",.76],["dissipate",.94]];
for(const element of ["fire","water","nature","arcane"]){
 const fx=createElementalCast({element,from:models[0].anchors.projectile.getWorldPosition(new Vector3()),to:models[6].anchors.impact.getWorldPosition(new Vector3())});scene.add(fx.root);
 result.effects[element]={...geometryBudget(fx.root),stages:[]};
 for(const [name,t] of stages){fx.update(t);save(`${element}-${name}`);let triangles=0,meshes=0;fx.root.traverseVisible(o=>{if(o.isMesh){triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;meshes++;}});result.effects[element].stages.push({name,phase:fx.root.userData.phase,triangles,meshes});}
 fx.update(.4);result.effects[element].flightRender=bench(renderer);fx.dispose();
}
fs.writeFileSync(path.join(out,"metrics.json"),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
library.dispose();renderer.dispose();
