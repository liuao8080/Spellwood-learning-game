// Isolated authored-model CPU reference, not browser or live-game acceptance.
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Scene,PerspectiveCamera} from 'three';
import {createModelLibrary} from '../src/arena3d/models.mjs';
import {SoftwareRenderer} from '../src/arena3d/software-renderer.mjs';
const {createCanvas}=createRequire(import.meta.url)(process.env.SPELLWOOD_CANVAS_MODULE||'@napi-rs/canvas');
const out=resolve(process.argv[2]),quality=process.argv[3]||'low';await mkdir(out,{recursive:true});
const canvas=createCanvas(240,240),renderer=new SoftwareRenderer(canvas);renderer.setSize(240,240);
const scene=new Scene(),camera=new PerspectiveCamera(34,1,.1,30),library=createModelLibrary({quality});
// Battlefield-like downward reference, not the actual game camera; shared by both candidates.
camera.position.set(0,3.4,3.6);camera.lookAt(0,.65,0);
const reports=[];
for(const faceDetail of [false,true])for(const attackProgress of [0,.5]){
 const model=library.createCreature({species:'hedgehog',faceDetail,variantSeed:1});scene.add(model.root);model.applyPose({idlePhase:0,attackProgress});
 renderer.render(scene,camera);
 const name=`${quality}-${faceDetail?'after':'before'}-${attackProgress?'attack':'idle'}.png`;
 await writeFile(resolve(out,name),canvas.toBuffer('image/png'));reports.push({name,...model.metrics,min:model.bounds.min.toArray(),max:model.bounds.max.toArray()});
 model.dispose();
}
renderer.dispose();library.dispose();await writeFile(resolve(out,`${quality}-metrics.json`),JSON.stringify(reports,null,2));
