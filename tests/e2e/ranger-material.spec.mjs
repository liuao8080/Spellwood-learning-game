import { test, expect, safeScreenshot } from './helpers.mjs';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';

test('ranger clothing A/B fixture preserves submissions at preview and thumbnail sizes',async({page},testInfo)=>{
 testInfo.annotations.push({type:'coverage',description:'Isolated same-camera/light/pose real WebGL comparison of one hero. These are material reference images, not live match or physical-device performance; the wardrobe test separately redeems and equips the ranger through real UI before an actual match.'});
 const bundle=await build({stdin:{resolveDir:process.cwd(),contents:`
  import {Scene,PerspectiveCamera,WebGLRenderer,Color,HemisphereLight,DirectionalLight,ACESFilmicToneMapping,SRGBColorSpace} from 'three';
  import {createHeroModel} from './src/arena3d/hero-models.mjs';
  const canvas=document.querySelector('canvas'),renderer=new WebGLRenderer({canvas,antialias:true});
  renderer.setPixelRatio(1);renderer.outputColorSpace=SRGBColorSpace;renderer.toneMapping=ACESFilmicToneMapping;renderer.toneMappingExposure=1.08;
  const scene=new Scene();scene.background=new Color('#071b20');scene.add(new HemisphereLight(0xd6e7ce,0x233a2e,1.8));
  const key=new DirectionalLight(0xffe1ae,3);key.position.set(-3,5,4);scene.add(key);
  const rim=new DirectionalLight(0x91bfd5,1.2);rim.position.set(3,3,-2);scene.add(rim);
  const camera=new PerspectiveCamera(31,1,.1,40);camera.position.set(0,1.28,5.8);camera.lookAt(0,.95,0);
  let model;window.renderRanger=({detail,quality,width,height})=>{
   if(model){scene.remove(model.root);model.dispose();}renderer.renderLists.dispose();renderer.setSize(width,height);camera.aspect=width/height;camera.updateProjectionMatrix();
   model=createHeroModel('leaf_ranger',{quality,garmentDetail:detail});model.root.rotation.y=-.2;scene.add(model.root);
   renderer.render(scene,camera);
   return {calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,vertices:model.metrics.vertices,meshes:model.metrics.meshes,buffer:[canvas.width,canvas.height]};
  };
  window.disposeRanger=()=>{scene.remove(model.root);model.dispose();renderer.dispose();};
 `},bundle:true,write:false,format:'iife',platform:'browser',logLevel:'silent'});
 await page.setViewportSize({width:420,height:530});
 await page.setContent('<style>body{margin:0;background:#071b20;color:#e3d4ad;font:13px sans-serif}p{margin:8px}canvas{display:block}</style><p>Isolated ranger material reference, not gameplay</p><canvas></canvas>');
 await page.addScriptTag({content:bundle.outputFiles[0].text});
 const reports=[];
 for(const config of [{quality:'medium',width:384,height:480},{quality:'low',width:384,height:480},{quality:'low',width:96,height:120}]){
  const before=await page.evaluate(config=>window.renderRanger({...config,detail:false}),config);
  await safeScreenshot(page,testInfo,`${config.quality}-${config.width}-garment-before`);
  const after=await page.evaluate(config=>window.renderRanger({...config,detail:true}),config);
  await safeScreenshot(page,testInfo,`${config.quality}-${config.width}-garment-after`);
  reports.push({config,before,after});
  await mkdir('test-results/browser-evidence',{recursive:true});
  await writeFile('test-results/browser-evidence/ranger-material-submissions.json',JSON.stringify(reports));
  expect(after).toEqual(before);expect(after.calls).toBe(3);
 }
 await page.evaluate(()=>window.disposeRanger());
});
