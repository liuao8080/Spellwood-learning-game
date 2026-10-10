import { test, expect, action, calmAnimations, prepareMatch, confirmOpening, sync, waitForBoard, uiCommand } from './helpers.mjs';
import { normalMotion, buildMeleeDeck, reachReadyMelee, publicState, startDomObservation, startArenaRecording } from './combat-motion-tools.mjs';
import { summarizeFrameWindow } from '../../scripts/frame-window-summary.mjs';
import { createSafeTraceSummary } from '../../scripts/safe-trace-summary.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

async function traceBrowser(page) {
  const session = await page.context().newCDPSession(page), summary=createSafeTraceSummary();
  session.on('Tracing.dataCollected',packet=>summary.add(packet.value||[]));
  try { await session.send('Tracing.start',{categories:'devtools.timeline,blink,cc,gpu,viz',transferMode:'ReportEvents',options:'record-until-full'}); }
  catch (error) { await session.detach(); throw error; }
  let stopped=false;
  return async()=>{
    if(stopped)return summary.result();stopped=true;
    let timer;const complete=new Promise(resolve=>session.once('Tracing.tracingComplete',()=>resolve(true)));
    try{await session.send('Tracing.end');const finished=await Promise.race([complete,new Promise(resolve=>{timer=setTimeout(()=>resolve(false),5000);})]);return {...summary.result(),complete:finished};}
    finally{clearTimeout(timer);await session.detach();}
  };
}

// This is a controlled renderer diagnostic, never substituted for the original
// normal-motion acceptance. Only condition changes are capture creation and
// visibility:hidden on labels; no game/rule/clock/quality state is injected.
test('@frame-diagnostic paired recording and label-paint controls on one actual melee unit',async({actors},testInfo)=>{
  test.setTimeout(360_000);
  const directory=path.resolve('test-results/browser-evidence');await mkdir(directory,{recursive:true});
  const report={kind:'controlled-diagnostic-not-acceptance',conditions:[],order:['baseline','no-recorder','labels-invisible','labels-invisible','no-recorder','baseline'],
    caveats:['Same actual unit and room, not seeded state. Turns and hands naturally change and are recorded.',
      'visibility:hidden suppresses label paint/hit-testing; DOM anchor updates and layout remain.',
      'Native captureStream/MediaRecorder is never created in no-recorder trials. Playwright full-session video remains off.',
      'Trace overhead is present in every trial. Software-GPU data does not establish physical-device performance.']};
  let writes=Promise.resolve();
  const checkpoint=()=>{const data=JSON.stringify(report,null,2);writes=writes.then(()=>writeFile(path.join(directory,'paired-frame-diagnostics.json'),data));return writes;};
  await checkpoint();
  const a=await actors('diagnostic-A',{viewport:{width:844,height:390},reducedMotion:'no-preference'}),b=await actors('diagnostic-B',{reducedMotion:'reduce'});
  await calmAnimations(b);await normalMotion(a);await buildMeleeDeck(a);
  await prepareMatch(a);await a.page.locator('#deck').selectOption('custom');await prepareMatch(b);
  await Promise.all([a,b].map(actor=>action(actor.page,'match').click()));
  await Promise.all([a,b].map(actor=>expect(action(actor.page,'opening-confirm')).toBeVisible()));await confirmOpening(a,b);
  const uid=await reachReadyMelee(a,b,['rabbit','hedgehog','acorn_squirrel','fox','turtle']);
  const seat=a.observed.room.youSeat,enemySeat=1-seat,source=a.observed.room.players[seat].board.find(unit=>unit.uid===uid);
  expect(source.atk).toBeLessThanOrEqual(2);expect(source.atk).toBeGreaterThan(0);
  report.source={uid,cardId:source.cardId,attack:source.atk};
  for(const [index,condition]of report.order.entries()){
    await a.page.bringToFront();await waitForBoard(a);
    const evidence={condition,index,status:'preparing',before:publicState(a)};report.conditions.push(evidence);await checkpoint();
    expect(evidence.before.players[seat].board).toHaveLength(1);expect(evidence.before.players[enemySeat].board).toHaveLength(0);
    expect(evidence.before.players[seat].board[0].uid).toBe(uid);
    await a.page.locator(`.unit-label[data-uid="${uid}"]`).click();await expect(a.page.locator('.target-command')).toBeVisible();
    await action(a.page,'enemy-hero').hover();
    let style=null,stopTrace=null,observation=false;
    try{
      if(condition==='labels-invisible')style=await a.page.addStyleTag({content:'#unit-labels { visibility:hidden !important; }'});
      await a.page.waitForTimeout(1000);
      evidence.display=await a.page.evaluate(()=>({viewport:[innerWidth,innerHeight],visibility:document.visibilityState,
        labelsVisibility:getComputedStyle(document.querySelector('#unit-labels')).visibility,
        arenaRenderer:document.querySelector('#arena').dataset.renderer,quality:document.querySelector('#arena').dataset.qualityLevel,
        captureAlreadyActive:typeof window.__combatCaptureStop==='function'}));
      expect(evidence.display.captureAlreadyActive).toBe(false);
      stopTrace=await traceBrowser(a.page);
      await startDomObservation(a.page,uid,evidence,checkpoint,`__diagnosticMotionBatch${index}`);observation=true;
      let recordingDone;
      if(condition!=='no-recorder')recordingDone=(await startArenaRecording(a.page,evidence,path.join(directory,`diagnostic-${index}-${condition}-arena-only.webm`),checkpoint,`__diagnosticRecordingComplete${index}`)).done;
      else evidence.recording={created:false,scope:'No captureStream or MediaRecorder created'};
      const previousCommands=a.observed.commands.length;
      await uiCommand(a,()=>action(a.page,'enemy-hero').click());
      if(recordingDone)expect(await recordingDone).toBe('CAPTURE_COMPLETE');else await a.page.waitForTimeout(3100);
      await sync(a,b);await waitForBoard(a);
      evidence.dom=await a.page.evaluate(()=>window.__combatMotionObservation.finish());observation=false;
      evidence.trace=await stopTrace();stopTrace=null;
      evidence.after=publicState(a);expect(evidence.after.players[enemySeat].hp).toBe(evidence.before.players[enemySeat].hp-source.atk);
      expect(a.observed.commands.slice(previousCommands).map(c=>c.action)).toEqual(['attack']);
      const trustedClicks=evidence.dom.clicks.filter(click=>click.trusted);
      expect(trustedClicks).toHaveLength(1);
      evidence.summary=summarizeFrameWindow(evidence.dom.samples,trustedClicks[0].elapsedMs);
      evidence.trace.scope='Whole observer session including recording transfer, encoding and sync cleanup; totals are not equal-window comparisons';
      evidence.status='diagnostic-complete-not-quality-acceptance';
    }finally{
      if(observation)try{evidence.dom=await a.page.evaluate(()=>{window.__combatCaptureStop?.();return window.__combatMotionObservation?.finish();});}catch{}
      if(stopTrace)try{evidence.trace=await stopTrace();}catch{evidence.trace={complete:false};}
      if(style)await style.evaluate(element=>element.remove());await checkpoint();
    }
    if(index<report.order.length-1){
      await uiCommand(a,()=>action(a.page,'end').click());await sync(a,b);await b.page.bringToFront();await waitForBoard(b);
      await uiCommand(b,()=>action(b.page,'end').click());await sync(a,b);
    }
  }
  report.status='six-paired-trials-complete';await checkpoint();
});
