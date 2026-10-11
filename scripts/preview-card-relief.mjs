// Offline CPU visual preparation only; not a gameplay or browser acceptance test.
import {createRequire} from 'node:module';
const {createCanvas,loadImage}=createRequire(import.meta.url)(process.env.SPELLWOOD_CANVAS_MODULE || '@napi-rs/canvas');
import {writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {CardTextures,cardArtPath} from '../src/arena3d/card-textures.mjs';
import {CARD} from '../src/cards.mjs';
globalThis.document={createElement:()=>createCanvas(512,720)};globalThis.Image=class{complete=false;};
const out=process.argv[2];await mkdir(out,{recursive:true});
for(const relief of [false,true]){
 const textures=new CardTextures({relief});const sheet=createCanvas(800,480),ctx=sheet.getContext('2d');ctx.fillStyle='#071b20';ctx.fillRect(0,0,800,480);
 for(const [i,finish]of ['base','leaf','silver','star','gold'].entries()){
  const id=['fox','turtle','owl','spark','bloom'][i],image=await loadImage(resolve('dist'+cardArtPath(CARD[id])));
  for(const [row,mode]of ['hand','full'].entries()){
   const tex=textures.get(id,finish,mode);const entry=[...textures.entries.values()].find(x=>x.texture===tex);textures.paint(id,entry,image);
   ctx.drawImage(entry.canvas,i*160,row*240,160,225);
  }
 }
 await writeFile(resolve(out,relief?'after.png':'before.png'),sheet.toBuffer('image/png'));textures.dispose();
}
