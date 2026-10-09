import { test, expect, action, calmAnimations, prepareMatch, confirmOpening, sync, waitForBoard, uiCommand } from './helpers.mjs';
import { normalMotion, buildMeleeDeck, reachReadyMelee, publicState, startDomObservation } from './combat-motion-tools.mjs';
import { summarizeFrameWindow } from '../../scripts/frame-window-summary.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
async function snapshot(actor){
 return actor.page.evaluate(()=>{
  const read=id=>{const c=document.getElementById(id),d=c.dataset;return {variant:d.diagnosticVariant,updates:Number(d.diagnosticUpdates||0),draws:Number(d.diagnosticDraws||0),calls:Number(d.diagnosticCalls),triangles:Number(d.diagnosticTriangles),sceneState:d.sceneState,quality:d.qualityLevel,buffer:[c.width,c.height],hidden:c.hidden};};
  return {pageVisibility:document.visibilityState,arena:read('arena'),hand:read('hand-canvas')};
 });
}
for(const[index,variant]of ['baseline','arena-skipped','hand-skipped','hand-skipped','arena-skipped','baseline'].entries()){
 test(`@draw-diagnostic ${index} fixed ${variant} build isolates drawing with a real rabbit attack`,async({actors})=>{
  test.setTimeout(150000);
  const directory=path.resolve('test-results/browser-evidence');await mkdir(directory,{recursive:true});
  const report={kind:'draw-isolation-not-visual-acceptance',index,variant,status:'preparing',
   caveat:'Fixed lab build. No native recorder in any condition. Skipped canvas drawing is not a product fix. Matrix/model updates, game rules and actual UI commands remain. Independent legal openings are not seeded; hand and quality differences are retained.'};
  let writes=Promise.resolve();const checkpoint=()=>{const data=JSON.stringify(report,null,2);writes=writes.then(()=>writeFile(path.join(directory,`draw-diagnostic-${index}-${variant}.json`),data));return writes;};
  await checkpoint();
  const a=await actors('draw-A',{viewport:{width:844,height:390},reducedMotion:'no-preference',diagnosticEntry:`draw-diagnostic-${variant}.html`});
  const b=await actors('draw-B',{reducedMotion:'reduce',diagnosticEntry:'draw-diagnostic-baseline.html'});
  let observation=false;
  try{
   await b.page.bringToFront();await calmAnimations(b);await a.page.bringToFront();await normalMotion(a);await buildMeleeDeck(a);
   await prepareMatch(a);await a.page.locator('#deck').selectOption('custom');await prepareMatch(b);
   await Promise.all([a,b].map(actor=>action(actor.page,'match').click()));
   await Promise.all([a,b].map(actor=>expect(action(actor.page,'opening-confirm')).toBeVisible()));await confirmOpening(a,b);
   const uid=await reachReadyMelee(a,b,['rabbit']);await a.page.bringToFront();await waitForBoard(a);
   const seat=a.observed.room.youSeat;report.before=publicState(a);report.source=report.before.players[seat].board.find(unit=>unit.uid===uid);
   expect(report.source.cardId).toBe('rabbit');expect(report.source.atk).toBe(2);
   await a.page.locator(`.unit-label[data-uid="${uid}"]`).click();await expect(a.page.locator('.target-command')).toBeVisible();
   await action(a.page,'enemy-hero').hover();await a.page.waitForTimeout(1000);
   report.aBefore=await snapshot(a);report.bBefore=await snapshot(b);
   for(const kind of ['arena','hand']){
    expect(report.aBefore[kind].variant).toBe(variant);expect(report.bBefore[kind].variant).toBe('baseline');
    expect(report.aBefore[kind].updates).toBeGreaterThan(0);expect(report.bBefore[kind].draws).toBeGreaterThan(0);
    if(variant!==`${kind}-skipped`)expect(report.aBefore[kind].draws).toBeGreaterThan(0);
   }
   await checkpoint();
   await startDomObservation(a.page,uid,report,checkpoint);observation=true;
   const count=a.observed.commands.length;await uiCommand(a,()=>action(a.page,'enemy-hero').click());
   await a.page.waitForTimeout(3100);await sync(a,b);await waitForBoard(a);
   report.dom=await a.page.evaluate(()=>window.__combatMotionObservation.finish());observation=false;
   report.aAfter=await snapshot(a);report.bAfter=await snapshot(b);report.after=publicState(a);
   expect(report.after.players[1-seat].hp).toBe(report.before.players[1-seat].hp-2);
   expect(a.observed.commands.slice(count).map(command=>command.action)).toEqual(['attack']);
   const clicks=report.dom.clicks.filter(click=>click.trusted);expect(clicks).toHaveLength(1);
   report.summary=summarizeFrameWindow(report.dom.samples,clicks[0].elapsedMs);
   report.drawDeltas={aArena:report.aAfter.arena.draws-report.aBefore.arena.draws,aHand:report.aAfter.hand.draws-report.aBefore.hand.draws,bArena:report.bAfter.arena.draws-report.bBefore.arena.draws,bHand:report.bAfter.hand.draws-report.bBefore.hand.draws};
   if(variant==='arena-skipped')expect(report.drawDeltas.aArena).toBe(0);
   else expect(report.drawDeltas.aArena).toBeGreaterThan(0);
   report.handWindowNote=report.drawDeltas.aHand===0?'Hand had no draw in this attack interval; initial positive draw count separately proves baseline loaded':'Hand drew during interval';
   if(variant==='hand-skipped')expect(report.drawDeltas.aHand).toBe(0);
   report.status='diagnostic-complete-not-quality-acceptance';
  }finally{
   if(observation)try{report.dom=await a.page.evaluate(()=>window.__combatMotionObservation?.finish());}catch{}
   await checkpoint();
  }
 });
}
