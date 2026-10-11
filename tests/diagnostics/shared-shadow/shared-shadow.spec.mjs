import { test, expect, action, safeScreenshot, prepareMatch, calmAnimations, confirmOpening, sync, waitForBoard, uiCommand } from './helpers.mjs';
import { normalMotion, buildMeleeDeck, reachReadyMelee, publicState, startDomObservation, startArenaRecording } from './combat-motion-tools.mjs';
import { extractCombatFrames } from '../../scripts/extract-combat-frames.mjs';
import { summarizeFrameWindow } from '../../scripts/frame-window-summary.mjs';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const fingerprint=value=>createHash('sha256').update(String(value)).digest('hex').slice(0,16);
const sequence=['baseline','candidate','candidate','baseline'];
const stateInputs=(a,b,uid)=>{
  const room=a.observed.room,source=room?.players?.[room.youSeat]?.board.find(unit=>unit.uid===uid);
  return {roomFingerprint:room?.roomId?fingerprint(room.roomId):null,revision:room?.revision,turn:room?.turn,phase:room?.phase,
    activeSeat:room?.activeSeat,aSeat:room?.youSeat,bSeat:b.observed.room?.youSeat,assisted:room?.assisted,
    source:source?{uidFingerprint:fingerprint(source.uid),cardId:source.cardId,atk:source.atk,hp:source.hp,ready:source.ready}:null,
    players:room?.players?.map(player=>({hp:player.hp,armor:player.armor,mana:player.mana,maxMana:player.maxMana,
      handCount:player.handCount,deckCount:player.deckCount,boardCount:player.board.length})),
    aVisibleHandCards:[...(room?.selfHandCards||[])],bOwnVisibleHandCount:b.observed.room?.selfHandCards?.length??null};
};
const readPrimitive=page=>page.evaluate(()=>{
  const finite=value=>{const n=Number.parseFloat(value);return Number.isFinite(n)?n:null;};
  const canvases=[...document.querySelectorAll('canvas')].map(canvas=>{
    const bounds=canvas.getBoundingClientRect(),gl=canvas.dataset.renderer==='WebGL2'?canvas.getContext('webgl2'):null;
    const extension=gl?.getExtension('WEBGL_debug_renderer_info');
    return {id:canvas.id,renderer:canvas.dataset.renderer||null,hidden:canvas.hidden,
      css:{x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height},buffer:{width:canvas.width,height:canvas.height},
      drawingBuffer:gl?{width:gl.drawingBufferWidth,height:gl.drawingBufferHeight}:null,
      unmaskedRenderer:extension?gl.getParameter(extension.UNMASKED_RENDERER_WEBGL):null,
      quality:{level:finite(canvas.dataset.qualityLevel),pixelScale:finite(canvas.dataset.pixelScale),shadowMapSize:finite(canvas.dataset.shadowMapSize)},
      reducedMotion:canvas.dataset.reducedMotion||null};
  });
  return {timeOrigin:performance.timeOrigin,absPerformanceTime:performance.now(),devicePixelRatio,innerWidth,innerHeight,
    visibility:document.visibilityState,canvases,lab:globalThis.__shadowLab||null};
});

test('@shared-shadow diagnostic ABBA repeats four real hero attacks with baseline A and reloaded baseline/cache B',async({actors,server},testInfo)=>{
  test.setTimeout(300000);
  testInfo.annotations.push({type:'coverage',description:'Independent diagnostic only. ABBA B bundles switch through actual fixed public HTML navigation and genuine same-room reconnect. A is always baseline with normal motion. Real UI, ordinary turns and default adaptive quality; no state/clock injection. Original native250ms gap is reported per segment without replacing or silencing formal acceptance.'});
  const runId=process.env.SPELLWOOD_SHARED_SHADOW_RUN_ID,directory=path.resolve('test-results/shared-shadow-evidence');
  await mkdir(directory,{recursive:true});
  const evidence={schema:1,runId,status:'preparing',formalAcceptance:false,sequence,stages:[],segments:[],
    initialGuestLimitMs:25000,nativeMaximumFrameGapMs:250,
    limits:['ABBA uses one real room/unit but ordinary turns change HP, hands, mana and deck contents; these are confounds, not identical scenes',
      'Every B segment reloads even when mode repeats. Browser/driver/shader caches can remain warm across segments',
      'Instrumented bookkeeping/helper CPU costs are not GPU completion times',
      'A/B document clock epochs and native-media PTS are distinct; screenshots do not establish fluidity',
      'This diagnostic does not establish unchanged shadow pixels or invalidation completeness; isolated GPU fixture validation is separate']};
  let writes=Promise.resolve(),a,b,uid;
  const checkpoint=()=>{const content=JSON.stringify(evidence,null,2);writes=writes.then(()=>writeFile(path.join(directory,`shared-shadow-${runId}-checkpoints.json`),content));return writes;};
  const stage=async(name,limitMs,work)=>{
    const record={name,limitMs,status:'running'},started=Date.now();evidence.stages.push(record);await checkpoint();let timer;
    try{const value=await Promise.race([work(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`Shared-shadow coverage deadline: ${name}`)),limitMs);})]);record.status='passed';return value;}
    catch(error){record.status='failed';evidence.status='diagnostic-incomplete';evidence.failedStage=name;throw error;}
    finally{clearTimeout(timer);record.elapsedMs=Date.now()-started;await checkpoint();}
  };
  try{
    await stage('isolated-guests-original-budget',25000,async()=>{
      a=await actors('shared-shadow-A',{viewport:{width:844,height:390},reducedMotion:'no-preference'});
      b=await actors('shared-shadow-B',{reducedMotion:'reduce'});
      expect(a.context).not.toBe(b.context);expect(a.observed.player.playerId).not.toBe(b.observed.player.playerId);
    });
    await stage('settings-and-legal-deck',30000,async()=>{
      await b.page.bringToFront();await calmAnimations(b);await a.page.bringToFront();await normalMotion(a);
      await buildMeleeDeck(a);await prepareMatch(a);await a.page.locator('#deck').selectOption('custom');await prepareMatch(b);
    });
    await stage('real-match-and-opening',15000,async()=>{
      await Promise.all([a,b].map(actor=>action(actor.page,'match').click()));
      await Promise.all([a,b].map(actor=>expect(action(actor.page,'opening-confirm')).toBeVisible()));
      await expect.poll(()=>Boolean(a.observed.room?.roomId&&a.observed.room.roomId===b.observed.room?.roomId)).toBe(true);
      for(const actor of[a,b]){expect(actor.observed.player.kind).toBe('guest');expect(actor.observed.room.opponentController).toBe('human');}
      await confirmOpening(a,b);
    });
    uid=await stage('ordinary-turns-to-low-attack-source',18000,()=>reachReadyMelee(a,b,['rabbit','acorn_squirrel'],10));
    const roomId=a.observed.room.roomId,seat=a.observed.room.youSeat,enemySeat=1-seat;
    const firstSource=a.observed.room.players[seat].board.find(unit=>unit.uid===uid);
    expect(firstSource.atk).toBeGreaterThan(0);
    expect(a.observed.room.players[enemySeat].hp,'coverage requires one source surviving four nonlethal hero attacks').toBeGreaterThan(firstSource.atk*4);
    evidence.source={uidFingerprint:fingerprint(uid),cardId:firstSource.cardId,initialAttack:firstSource.atk,roomFingerprint:fingerprint(roomId)};
    for(let index=0;index<4;index++){
      const variant=sequence[index],segment={index:index+1,variant,status:'preparing',stages:[],screenshots:[],nativeGapVerdict:'unmeasured'};
      evidence.segments.push(segment);await checkpoint();
      await stage(`segment-${index+1}-B-real-reload-and-equal-preparation`,25000,async()=>{
        const identity=b.observed.player.playerId,oldSessions=b.observed.sessions,oldMessages=b.observed.roomMessages;
        await b.page.bringToFront();await b.page.goto(server.origin+`/lab-${variant}.html`);
        await expect.poll(()=>b.observed.sessions).toBeGreaterThan(oldSessions);
        await expect.poll(()=>b.observed.roomMessages).toBeGreaterThan(oldMessages);
        await expect(b.page.locator('.connection')).toHaveClass(/online/);await sync(a,b);
        expect(b.observed.player.playerId).toBe(identity);expect(b.observed.room.roomId).toBe(roomId);expect(b.observed.room.youSeat).toBe(enemySeat);
        expect(b.observed.room.assisted).toBe(false);await calmAnimations(b);
        await expect(b.page.locator('#arena')).toHaveAttribute('data-reduced-motion','true');
        await expect(b.page.locator('#arena')).toHaveAttribute('data-renderer','WebGL2');
        await expect.poll(()=>b.page.evaluate(()=>globalThis.__shadowLab?.variant)).toBe(variant);
        await b.page.waitForTimeout(300); // Equal real-time UI settling, no clock replacement or extra game command.
        await a.page.bringToFront();await waitForBoard(a);
        expect(a.observed.room.roomId).toBe(roomId);expect(a.observed.room.activeSeat).toBe(seat);
        const source=a.observed.room.players[seat].board.find(unit=>unit.uid===uid);
        expect(source.ready).toBe(true);expect(source.cardId).toBe(firstSource.cardId);expect(source.atk).toBe(firstSource.atk);
        expect(a.observed.room.players[enemySeat].board).toHaveLength(0);expect(a.observed.room.players[enemySeat].armor).toBe(0);
        await expect(a.page.locator('#arena')).toHaveAttribute('data-reduced-motion','false');
        await expect.poll(()=>a.page.evaluate(()=>globalThis.__shadowLab?.variant)).toBe('baseline');
        segment.before=stateInputs(a,b,uid);
        await a.page.locator(`.unit-label[data-uid="${uid}"]`).click();await expect(a.page.locator('.target-command')).toBeVisible();
        await action(a.page,'enemy-hero').hover();
        segment.screenshots.push(await safeScreenshot(a.page,testInfo,`segment-${index+1}-${variant}-before`));
      });
      const before=publicState(a),source=before.players[seat].board.find(unit=>unit.uid===uid);
      const commandStart=a.observed.commands.length,otherCommands=b.observed.commands.length,events=new Set(a.observed.events.keys());
      await stage(`segment-${index+1}-native-observer-and-recorder`,5000,async()=>{
        await startDomObservation(a.page,uid,segment,checkpoint,`__sharedShadowDom${index}`);
      });
      let recordingDone;
      const videoFile=`shared-shadow-${runId}-segment-${index+1}-${variant}-arena-only.webm`;
      await stage(`segment-${index+1}-start-native-capture`,5000,async()=>{
        recordingDone=(await startArenaRecording(a.page,segment,path.join(directory,videoFile),checkpoint,`__sharedShadowCapture${index}`)).done;
      });
      await stage(`segment-${index+1}-single-trusted-real-attack`,3500,()=>action(a.page,'enemy-hero').click());
      await stage(`segment-${index+1}-native-completion`,8000,async()=>{
        expect(await recordingDone).toBe('CAPTURE_COMPLETE');await sync(a,b);await waitForBoard(a);
        segment.dom=await a.page.evaluate(()=>window.__combatMotionObservation.finish());
      });
      const after=publicState(a),expected=structuredClone(before);
      expected.revision++;expected.players[enemySeat].hp-=source.atk;expected.players[seat].board.find(unit=>unit.uid===uid).ready=false;
      expect(after,'one accepted attack changes only enemy HP and attacker ready').toEqual(expected);expect(publicState(b)).toEqual(expected);
      const commands=a.observed.commands.slice(commandStart).map(command=>({type:command.type,action:command.action,accepted:a.observed.acknowledgements.get(command.id)?.ok===true}));
      expect(commands).toEqual([{type:'battle.action',action:'attack',accepted:true}]);expect(b.observed.commands.slice(otherCommands)).toEqual([]);
      expect([...a.observed.events.entries()].filter(([id])=>!events.has(id)).map(([,event])=>event.kind)).toEqual(['attack']);
      expect(segment.dom.clicks).toHaveLength(1);expect(segment.dom.clicks[0].trusted).toBe(true);
      await stage(`segment-${index+1}-decode-original-native-recording`,22000,async()=>{
        segment.decoded=await extractCombatFrames({videoPath:path.join(directory,videoFile),outputDirectory:directory,prefix:`shared-shadow-${runId}-segment-${index+1}-${variant}-frame`});
        // Diagnostic verdict only: keep the original limit, preserve red, and
        // continue ABBA. This does not modify any formal test or its assertion.
        segment.nativeGapVerdict=segment.decoded.video.maximumFrameGapSeconds<=.25?'passed':'failed';
      });
      segment.after=stateInputs(a,b,uid);segment.commands=commands;
      segment.a=await readPrimitive(a.page);segment.b=await readPrimitive(b.page);
      segment.rafWindow=summarizeFrameWindow(segment.dom.samples,segment.dom.clicks[0].elapsedMs,3000);
      segment.fullColorFloatFrames=(segment.b.lab?.samples||[]).filter(row=>row.scope==='scene-frame'&&row.reducedMotion&&!row.hidden&&row.temporarySprites===1&&row.activeJobs===1);
      segment.keyEligibilityReasons=[...new Set(segment.fullColorFloatFrames.map(row=>row.ticket?.reason||'no-ticket'))];
      segment.depthDrawsPerFloatFrame=[...new Set(segment.fullColorFloatFrames.map(row=>row.actualDepthDraws))];
      segment.colorDrawsPerFloatFrame=[...new Set(segment.fullColorFloatFrames.map(row=>row.actualColorDraws))];
      segment.confounds={hpChanged:true,turn:segment.before.turn,aHandCards:segment.before.aVisibleHandCards,bHandCount:segment.before.bOwnVisibleHandCount,
        actualAQuality:segment.a.canvases.find(canvas=>canvas.id==='arena')?.quality,
        actualBQuality:segment.b.canvases.find(canvas=>canvas.id==='arena')?.quality,BDocumentTimeOrigin:segment.b.timeOrigin,
        actualCasterCounts:[...new Set(segment.fullColorFloatFrames.map(row=>row.actualDrawnCasters))],
        caveat:'Native turn/reload/preparation and caches are observable confounds, not normalized by hidden state or quality overrides'};
      segment.screenshots.push(await safeScreenshot(a.page,testInfo,`segment-${index+1}-${variant}-after`));
      segment.status='measured';await checkpoint();
      if(index<3)await stage(`segment-${index+1}-ordinary-turns-reset-same-source`,18000,async()=>{
        await uiCommand(a,()=>action(a.page,'end').click());await sync(a,b);await b.page.bringToFront();await waitForBoard(b);
        await uiCommand(b,()=>action(b.page,'end').click());await sync(a,b);await a.page.bringToFront();await waitForBoard(a);
        expect(a.observed.room.players[seat].board.find(unit=>unit.uid===uid)?.ready).toBe(true);
      });
    }
    evidence.status='diagnostic-completed';
  }finally{
    if(a&&b&&uid)evidence.latest=stateInputs(a,b,uid);
    if(a)await a.page.evaluate(()=>{window.__combatCaptureStop?.();window.__combatMotionObservation?.finish();}).catch(()=>{});
    await checkpoint();
  }
});
