import {test,expect,action,calmAnimations,prepareMatch,confirmOpening,sync,waitForBoard,safeScreenshot} from './helpers.mjs';
import {normalMotion,buildMeleeDeck,reachReadyMelee,publicState,startDomObservation,startArenaRecording} from './combat-motion-tools.mjs';
import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {extractCombatFrames} from '../../scripts/extract-combat-frames.mjs';

test('hedgehog face A/B fixture preserves geometry and submissions in idle and attack poses',async({page},testInfo)=>{
 testInfo.annotations.push({type:'coverage',description:'Isolated real WebGL model comparison, same camera/light/pose; not live gameplay or physical-device performance. A separate actual match records an ordinary hedgehog attack.'});
 const bundle=await build({stdin:{resolveDir:process.cwd(),contents:`
 import {Scene,PerspectiveCamera,WebGLRenderer,Color,HemisphereLight,DirectionalLight,ACESFilmicToneMapping,SRGBColorSpace} from 'three';
 import {createModelLibrary} from './src/arena3d/models.mjs';
 const canvas=document.querySelector('canvas'),renderer=new WebGLRenderer({canvas,antialias:true});renderer.setPixelRatio(1);renderer.outputColorSpace=SRGBColorSpace;renderer.toneMapping=ACESFilmicToneMapping;renderer.toneMappingExposure=1.08;
 const scene=new Scene();scene.background=new Color('#071b20');scene.add(new HemisphereLight(0xd6e7ce,0x233a2e,1.8));const light=new DirectionalLight(0xffe1ae,3);light.position.set(-3,5,4);scene.add(light);
 const camera=new PerspectiveCamera(34,1,.1,30);camera.position.set(0,3.4,3.6);camera.lookAt(0,.65,0);let model,library;
 window.renderHedgehog=({detail,quality,width,attackProgress})=>{model?.dispose();library?.dispose();renderer.renderLists.dispose();renderer.setSize(width,width);library=createModelLibrary({quality});model=library.createCreature({species:'hedgehog',faceDetail:detail,variantSeed:1});scene.add(model.root);model.applyPose({idlePhase:0,attackProgress});renderer.render(scene,camera);return{calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,vertices:model.metrics.vertices,meshes:model.metrics.meshes,buffer:[canvas.width,canvas.height]};};
 window.disposeHedgehog=()=>{model?.dispose();library?.dispose();renderer.dispose();};
 `},bundle:true,write:false,format:'iife',platform:'browser',logLevel:'silent'});
 await page.setViewportSize({width:400,height:430});await page.setContent('<style>body{margin:0;background:#071b20;color:#e3d4ad;font:13px sans-serif}p{margin:8px}canvas{display:block}</style><p>Isolated hedgehog reference, not gameplay</p><canvas></canvas>');await page.addScriptTag({content:bundle.outputFiles[0].text});
 const reports=[];await mkdir('test-results/browser-evidence',{recursive:true});
 try {
 for(const quality of ['low','medium'])for(const width of [384,96])for(const attackProgress of [0,.5]){
  const config={quality,width,attackProgress},name=`${quality}-${width}-${attackProgress?'attack':'idle'}`;
  const before=await page.evaluate(c=>window.renderHedgehog({...c,detail:false}),config);await safeScreenshot(page,testInfo,`${name}-before`);
  const after=await page.evaluate(c=>window.renderHedgehog({...c,detail:true}),config);await safeScreenshot(page,testInfo,`${name}-after`);
  reports.push({config,before,after});await writeFile('test-results/browser-evidence/hedgehog-face-submissions.json',JSON.stringify(reports));expect(after).toEqual(before);expect(after.calls).toBe(5);
 }
 } finally {await page.evaluate(()=>window.disposeHedgehog());}
});

test('hedgehog live face remains readable across viewports and an ordinary normal-motion attack',async({actors},testInfo)=>{
 test.setTimeout(150000);
 testInfo.annotations.push({type:'coverage',description:'An actual UI-built deck and real two-guest match. Same authoritative hedgehog at four viewports, followed by one trusted normal-motion attack and bounded native arena recording. Recording remains subject to independent visual review; this does not replace or relax the formal 250ms motion gate.'});
 const directory=path.resolve('test-results/browser-evidence');await mkdir(directory,{recursive:true});
 const evidence={status:'preparing',screenshots:[],caveat:'Normal WebGL match uses production adaptive quality. Isolated fixture separately covers low/medium authored geometry. Screenshots and decoded frames require visual review; no physical-phone smoothness claim.'};
 let writes=Promise.resolve();const checkpoint=()=>{const data=JSON.stringify(evidence,null,2);writes=writes.then(()=>writeFile(path.join(directory,'hedgehog-live-checkpoints.json'),data));return writes;};
 const a=await actors('hedgehog-A',{viewport:{width:1280,height:800},reducedMotion:'no-preference'}),b=await actors('hedgehog-B',{reducedMotion:'reduce'});
 await b.page.bringToFront();await calmAnimations(b);await a.page.bringToFront();await normalMotion(a);await buildMeleeDeck(a);await prepareMatch(a);await a.page.locator('#deck').selectOption('custom');await prepareMatch(b);
 await Promise.all([a,b].map(actor=>action(actor.page,'match').click()));await Promise.all([a,b].map(actor=>expect(action(actor.page,'opening-confirm')).toBeVisible()));await confirmOpening(a,b);
 const uid=await reachReadyMelee(a,b,['hedgehog'],14);await a.page.bringToFront();await waitForBoard(a);
 const seat=a.observed.room.youSeat,source=a.observed.room.players[seat].board.find(unit=>unit.uid===uid);expect(source.cardId).toBe('hedgehog');
 evidence.before=publicState(a);evidence.source={uid,cardId:source.cardId,attack:source.atk};
 expect(evidence.before.players[1-seat].armor,'Passive opponent has not played an armor card').toBe(0);
 for(const viewport of [{width:1280,height:800},{width:390,height:844},{width:320,height:568},{width:844,height:390}]){
  await a.page.setViewportSize(viewport);await expect(a.page.locator(`.unit-label[data-uid="${uid}"]`)).toBeVisible();
  await a.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  evidence.screenshots.push({viewport,file:await safeScreenshot(a.page,testInfo,`live-${viewport.width}x${viewport.height}-idle`)});await checkpoint();
 }
 await a.page.locator(`.unit-label[data-uid="${uid}"]`).click();await expect(a.page.locator('.target-command')).toBeVisible();
 await startDomObservation(a.page,uid,evidence,checkpoint);
 const videoPath=path.join(directory,'hedgehog-live-arena-only.webm'),capture=await startArenaRecording(a.page,evidence,videoPath,checkpoint);
 const commandStart=a.observed.commands.length;await action(a.page,'enemy-hero').click();expect(await capture.done).toBe('CAPTURE_COMPLETE');await sync(a,b);await waitForBoard(a);
 evidence.dom=await a.page.evaluate(()=>window.__combatMotionObservation.finish());evidence.after=publicState(a);
 expect(a.observed.commands.slice(commandStart).map(c=>c.action)).toEqual(['attack']);expect(evidence.after.players[1-seat].hp).toBe(evidence.before.players[1-seat].hp-source.atk);
 evidence.screenshots.push({file:await safeScreenshot(a.page,testInfo,'live-returned-after-attack')});
 evidence.decoded=await extractCombatFrames({videoPath,outputDirectory:directory,prefix:'hedgehog-live-arena',maximumFrames:12});evidence.status='interaction-passed-visual-review-required';await checkpoint();
 for(const actor of[a,b])expect(actor.observed.errors).toEqual([]);
});
