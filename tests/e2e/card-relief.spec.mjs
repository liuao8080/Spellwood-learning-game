import { test, expect, safeScreenshot } from './helpers.mjs';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';

test('card relief A/B keeps texture size submissions and legible faces across five finishes',async({page,server},testInfo)=>{
 testInfo.annotations.push({type:'coverage',description:'Isolated real WebGL card-face reference with identical art, costs and camera before/after. This is not a live hand or pack; existing real-match and pack tests remain separate.'});
 const bundle=await build({stdin:{resolveDir:process.cwd(),contents:`
  import {Scene,OrthographicCamera,WebGLRenderer,Mesh,PlaneGeometry,MeshBasicMaterial,SRGBColorSpace,Color} from 'three';
  import {CardTextures} from './src/arena3d/card-textures.mjs';
  import {CARD} from './src/cards.mjs';
  const canvas=document.querySelector('canvas'),renderer=new WebGLRenderer({canvas,antialias:true});renderer.setPixelRatio(1);renderer.outputColorSpace=SRGBColorSpace;
  const scene=new Scene();scene.background=new Color('#071b20');let materials=[],textures;
  const geometry=new PlaneGeometry(1,1);const camera=new OrthographicCamera(0,800,480,0,.1,100);camera.position.z=10;
  window.renderCards=async({relief,width})=>{
   scene.clear();materials.forEach(m=>m.dispose());materials=[];textures?.dispose();textures=new CardTextures({relief});
   renderer.setSize(width,Math.round(width*.6));
   for(const[i,finish]of ['base','leaf','silver','star','gold'].entries())for(const[row,mode]of ['hand','full'].entries()){
    const id=['fox','turtle','owl','spark','bloom'][i],map=textures.get(id,finish,mode,Math.max(0,CARD[id].cost-1));
    const material=new MeshBasicMaterial({map});materials.push(material);const mesh=new Mesh(geometry,material);mesh.scale.set(160,225,1);mesh.position.set(i*160+80,480-row*240-112.5,0);scene.add(mesh);
   }
   await Promise.all([...textures.images.values()].map(image=>image.decode()));
   // onload repaints the same cached faces; no new texture entries are created.
   for(const entry of textures.entries.values())textures.paint(entry.cardId,entry,textures.images.get(entry.path));
   renderer.info.reset();renderer.render(scene,camera);
   return {decodedImages:[...textures.images.values()].map(image=>[image.naturalWidth,image.naturalHeight]),calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,textureCount:textures.entries.size,dimensions:[...textures.entries.values()].map(e=>[e.canvas.width,e.canvas.height]),buffer:[canvas.width,canvas.height]};
  };
  window.disposeCards=()=>{scene.clear();materials.forEach(m=>m.dispose());textures.dispose();geometry.dispose();renderer.dispose();};
 `},bundle:true,write:false,format:'iife',platform:'browser',logLevel:'silent'});
 await page.route('**/card-relief-fixture',route=>route.fulfill({contentType:'text/html',body:'<style>body{margin:0;background:#071b20;color:#e3d4ad;font:13px sans-serif}p{margin:8px}canvas{display:block}</style><p>Isolated card material reference, not gameplay</p><canvas></canvas>'}));
 await page.goto(new URL('/card-relief-fixture',server.origin).href);await page.addScriptTag({content:bundle.outputFiles[0].text});
 const reports=[];
 await mkdir('test-results/browser-evidence',{recursive:true});
 try {
 for(const width of [800,480]){
  await page.setViewportSize({width:Math.max(500,width),height:Math.round(width*.6)+40});
  const before=await page.evaluate(width=>window.renderCards({relief:false,width}),width);
  await safeScreenshot(page,testInfo,`${width}-card-relief-before`);
  const after=await page.evaluate(width=>window.renderCards({relief:true,width}),width);
  await safeScreenshot(page,testInfo,`${width}-card-relief-after`);
  reports.push({width,before,after});
  await writeFile('test-results/browser-evidence/card-relief-submissions.json',JSON.stringify(reports));
  expect(after).toEqual(before);expect(after.calls).toBe(10);expect(after.triangles).toBe(20);expect(after.textureCount).toBe(10);
  expect(after.dimensions).toEqual(Array.from({length:10},()=>[512,720]));
  expect(after.decodedImages.length).toBeGreaterThan(0);expect(after.decodedImages.every(([w,h])=>w>0&&h>0)).toBe(true);
 }
 } finally { await page.evaluate(()=>window.disposeCards()); }
});
