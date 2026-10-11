import test from 'node:test';
import assert from 'node:assert/strict';
import { CardTextures } from '../src/arena3d/card-textures.mjs';
import { CARD } from '../src/cards.mjs';

// Canvas operations are recorded, not rasterized. Browser A/B supplies pixels.
test('baked relief keeps all card text, art placement, costs and texture lifetime unchanged',t=>{
 const oldDocument=globalThis.document,oldImage=globalThis.Image;
 const canvases=[];
 globalThis.document={createElement(){const ops=[];const ctx=new Proxy({},{get(o,k){if(k==='measureText')return text=>({width:text.length*25});if(String(k).startsWith('create'))return ()=>({addColorStop(){}});return o[k]??((...args)=>{if(['fillText','drawImage'].includes(k))ops.push([k,...args]);});}});const canvas={width:0,height:0,getContext:()=>ctx,ops};canvases.push(canvas);return canvas;}};
 globalThis.Image=class {complete=false;};
 t.after(()=>{globalThis.document=oldDocument;globalThis.Image=oldImage;});
 const before=new CardTextures({relief:false}),after=new CardTextures();
 for(const mode of ['hand','full'])for(const finish of ['base','leaf','silver','star','gold'])for(const id of ['fox','spark','turtle']){
  const cost=Math.max(0,CARD[id].cost-1);
  const a=before.get(id,finish,mode,cost),b=after.get(id,finish,mode,cost);
  const art={naturalWidth:1536,naturalHeight:1024};
  before.paint(id,[...before.entries.values()].find(e=>e.texture===a),art);
  after.paint(id,[...after.entries.values()].find(e=>e.texture===b),art);
  assert.deepEqual([b.image.width,b.image.height],[512,720]);
  assert.deepEqual(b.image.ops,a.image.ops,'numbers, words and their positions stay unchanged');
  assert.equal(b.generateMipmaps,false);assert.equal(b.minFilter,a.minFilter);
  assert.equal(after.get(id,finish,mode,cost),b,'same card uses the existing cached texture');
 }
 let disposed=0;for(const entry of after.entries.values())entry.texture.addEventListener('dispose',()=>disposed++);
 const count=after.entries.size;after.retainTextures([]);assert.equal(disposed,count);assert.equal(after.entries.size,0);
 after.dispose();before.dispose();assert.equal(disposed,count,'retained-away fronts are not disposed twice');
});
