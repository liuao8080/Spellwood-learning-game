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
const cases=[...['baseline','arena-skipped','hand-skipped','hand-skipped','arena-skipped','baseline'].map((variant,index)=>({index,variant,partnerVariant:'baseline',tag:'@draw-diagnostic'})),
 ...[['baseline','baseline'],['baseline','arena-skipped'],['baseline','arena-skipped'],['baseline','baseline'],['arena-skipped','baseline']].map(([variant,partnerVariant],index)=>({index:index+6,variant,partnerVariant,tag:'@draw-followup'}))];
for(const {index,variant,partnerVariant,tag} of cases){
 test(`${tag} ${index} fixed A-${variant} B-${partnerVariant} builds isolate drawing with a real rabbit attack`,async({actors})=>{
  test.setTimeout(150000);
  const directory=path.resolve('test-results/browser-evidence');await mkdir(directory,{recursive:true});
  const report={kind:'draw-isolation-not-visual-acceptance',index,variant,partnerVariant,status:'preparing',
   caveat:'Fixed lab build. No native recorder in any condition. Skipped canvas drawing is not a product fix. Matrix/model updates, game rules and actual UI commands remain. Independent legal openings are not seeded; hand and quality differences are retained.'};
  let writes=Promise.resolve();const checkpoint=()=>{const data=JSON.stringify(report,null,2);writes=writes.then(()=>writeFile(path.join(directory,`draw-diagnostic-${index}-${variant}.json`),data));return writes;};
  await checkpoint();
  const a=await actors('draw-A',{viewport:{width:844,height:390},reducedMotion:'no-preference',diagnosticEntry:`draw-diagnostic-${variant}.html`});
  const b=await actors('draw-B',{reducedMotion:'reduce',diagnosticEntry:`draw-diagnostic-${partnerVariant}.html`});
  let observation=false;
  try{
   await b.page.bringToFront();await calmAnimations(b);await a.page.bringToFront();await normalMotion(a);await buildMeleeDeck(a);
   await prepareMatch(a);await a.page.locator('#deck').selectOption('custom');await prepareMatch(b);
   await Promise.all([a,b].map(actor=>action(actor.page,'match').click()));
   await Promise.all([a,b].map(actor=>expect(action(actor.page,'opening-confirm')).toBeVisible()));
   if(tag==='@draw-followup'){
    const choices=await action(a.page,'opening-card').evaluateAll(elements=>elements.map(el=>({index:el.dataset.index,name:el.querySelector('strong').textContent})));
    report.mulliganIndices=choices.filter(card=>card.name!=='月光兔').slice(0,2).map(card=>card.index);
    for(const index of report.mulliganIndices)await a.page.locator(`[data-action="opening-card"][data-index="${index}"]`).click();
   }
   await confirmOpening(a,b);
   const uid=await reachReadyMelee(a,b,['rabbit'],tag==='@draw-followup'?14:10);await a.page.bringToFront();await waitForBoard(a);
   const seat=a.observed.room.youSeat;report.before=publicState(a);report.source=report.before.players[seat].board.find(unit=>unit.uid===uid);
   for(const player of report.before.players)expect(player.deckCount).toBeGreaterThan(0);
   expect(report.source.cardId).toBe('rabbit');expect(report.source.atk).toBe(2);
   await a.page.locator(`.unit-label[data-uid="${uid}"]`).click();await expect(a.page.locator('.target-command')).toBeVisible();
   await action(a.page,'enemy-hero').hover();await a.page.waitForTimeout(1000);
   report.aBefore=await snapshot(a);report.bBefore=await snapshot(b);
   for(const kind of ['arena','hand']){
    expect(report.aBefore[kind].variant).toBe(variant);expect(report.bBefore[kind].variant).toBe(partnerVariant);
    expect(report.aBefore[kind].updates).toBeGreaterThan(0);expect(report.bBefore[kind].updates).toBeGreaterThan(0);
    if(partnerVariant!==`${kind}-skipped`)expect(report.bBefore[kind].draws).toBeGreaterThan(0);
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
   if(partnerVariant==='arena-skipped')expect(report.drawDeltas.bArena).toBe(0);
   if(variant==='hand-skipped')expect(report.drawDeltas.aHand).toBe(0);
   report.status='diagnostic-complete-not-quality-acceptance';
  }finally{
   if(observation)try{report.dom=await a.page.evaluate(()=>window.__combatMotionObservation?.finish());}catch{}
   await checkpoint();
  }
 });
}
