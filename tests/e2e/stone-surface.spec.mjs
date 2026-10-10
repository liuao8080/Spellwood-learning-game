import { test, expect, safeScreenshot } from './helpers.mjs';
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';

test('low geometry stone material A/B fixture preserves geometry and bounded render submissions', async ({ page }, testInfo) => {
  testInfo.annotations.push({type:'coverage',description:'Isolated real WebGL material fixture, not gameplay or physical-device performance. Both images use the same low geometry, camera, lights, viewport and renderer. Full game screenshots are covered independently by the populated layout test.'});
  const bundle = await build({stdin:{resolveDir:process.cwd(),contents:`
    import {Scene,PerspectiveCamera,WebGLRenderer,Color,HemisphereLight,DirectionalLight,PCFShadowMap,ACESFilmicToneMapping,SRGBColorSpace} from 'three';
    import {createModelLibrary} from './src/arena3d/models.mjs';
    const canvas=document.querySelector('canvas'), renderer=new WebGLRenderer({canvas,antialias:true});
    renderer.setSize(844,390);renderer.setPixelRatio(1);renderer.outputColorSpace=SRGBColorSpace;
    renderer.toneMapping=ACESFilmicToneMapping;renderer.toneMappingExposure=1.13;
    renderer.shadowMap.enabled=true;renderer.shadowMap.type=PCFShadowMap;
    const camera=new PerspectiveCamera(36,844/390,.1,90);camera.position.set(0,16.4,18.6);camera.lookAt(0,0,.2);
    let library;window.renderStone=mode=>{
      library?.dispose();renderer.renderLists.dispose();
      const scene=new Scene();scene.background=new Color(0x071b20);
      scene.add(new HemisphereLight(0xc5e6ec,0x314d31,1.8));
      const sun=new DirectionalLight(0xffe1ad,4.2);sun.position.set(-7,14,9);sun.castShadow=true;
      sun.shadow.mapSize.set(512,512);Object.assign(sun.shadow.camera,{left:-12,right:12,top:10,bottom:-10,near:1,far:40});
      sun.shadow.bias=-.0003;sun.shadow.normalBias=.025;scene.add(sun,sun.target);
      const rim=new DirectionalLight(0x85b8cf,2.2);rim.position.set(6,7,-10);scene.add(rim);
      library=createModelLibrary({quality:'low',arenaSurface:mode});const arena=library.createArena({seed:27});scene.add(arena.root);
      let main=0,shadow=0;arena.root.traverse(o=>{if(o.isMesh&&!o.userData.pickProxy){o.onBeforeRender=()=>main++;o.onBeforeShadow=()=>shadow++;}});
      renderer.render(scene,camera);main=0;shadow=0;renderer.render(scene,camera);
      const result={main,shadow,calls:renderer.info.render.calls,triangles:arena.metrics.triangles,meshes:arena.metrics.meshes,surface:arena.root.userData.arenaSurface,buffer:[canvas.width,canvas.height]};
      sun.shadow.map?.dispose();sun.shadow.mapPass?.dispose();return result;
    };
    window.disposeStone=()=>{library.dispose();renderer.dispose();};
  `},bundle:true,write:false,format:'iife',platform:'browser',logLevel:'silent'});
  await page.setViewportSize({width:844,height:430});
  await page.setContent('<style>body{margin:0;background:#071b20;color:#d9d5ac;font:14px sans-serif}p{margin:8px}canvas{display:block}</style><p>Isolated low-geometry material fixture, not gameplay</p><canvas></canvas>');
  await page.addScriptTag({content:bundle.outputFiles[0].text});
  const before = await page.evaluate(()=>window.renderStone('plain'));
  await safeScreenshot(page,testInfo,'low-geometry-plain-before');
  const after = await page.evaluate(()=>window.renderStone('stone'));
  await safeScreenshot(page,testInfo,'low-geometry-stone-after');
  await mkdir('test-results/browser-evidence',{recursive:true});
  await writeFile('test-results/browser-evidence/stone-material-submissions.json',JSON.stringify({before,after}));
  expect(after.buffer).toEqual(before.buffer);
  expect(after.triangles).toBe(before.triangles);
  expect(after.main).toBe(before.main+1);expect(after.shadow).toBe(before.shadow+1);
  expect(after.surface).toBe('stone');
  await page.evaluate(()=>window.disposeStone());
});
