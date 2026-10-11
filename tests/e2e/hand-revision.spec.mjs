import { test, expect, action, calmAnimations, prepareMatch, confirmOpening, sync, waitForBoard, uiCommand, safeScreenshot } from './helpers.mjs';
import { normalMotion, buildMeleeDeck, reachReadyMelee } from './combat-motion-tools.mjs';

test('@hand-revision normal-motion attack preserves fresh hand intents and subsequent legal play',async({actors},testInfo)=>{
 test.setTimeout(150000);
 testInfo.annotations.push({type:'coverage',description:'Normal-motion A and reduced-motion B use an actual UI-created deck and match. Attack changes the authoritative revision without changing A hand, then keyboard selection inspects that current hand. Up to three ordinary turn pairs reach a legal summon. This validates actual interaction, not frame-rate or physical-device smoothness.'});
 const a=await actors('revision-A',{viewport:{width:844,height:390},reducedMotion:'no-preference'}),b=await actors('revision-B',{reducedMotion:'reduce'});
 await b.page.bringToFront();await calmAnimations(b);await a.page.bringToFront();await normalMotion(a);await buildMeleeDeck(a);
 await prepareMatch(a);await a.page.locator('#deck').selectOption('custom');await prepareMatch(b);
 await Promise.all([a,b].map(actor=>action(actor.page,'match').click()));await Promise.all([a,b].map(actor=>expect(action(actor.page,'opening-confirm')).toBeVisible()));await confirmOpening(a,b);
 const uid=await reachReadyMelee(a,b);await a.page.bringToFront();await waitForBoard(a);
 const revision=a.observed.room.revision,hand=[...a.observed.room.selfHandCards],commands=a.observed.commands.length;
 await a.page.locator(`.unit-label[data-uid="${uid}"]`).click();
 await uiCommand(a,()=>action(a.page,'enemy-hero').click());await sync(a,b);await waitForBoard(a);
 expect(a.observed.room.revision).toBeGreaterThan(revision);expect(a.observed.room.selfHandCards).toEqual(hand);
 expect(a.observed.commands.slice(commands).map(c=>c.action)).toEqual(['attack']);
 const first=a.page.locator('#hand-semantics [data-hand-index="0"]');
 const name=(await first.getAttribute('aria-label')).split('，')[0];
 await first.focus();await a.page.keyboard.press('Enter');await expect(a.page.locator('.card-command > div > b')).toHaveText(name);await expect(a.page.locator('.card-resources')).toBeVisible();
 await safeScreenshot(a.page,testInfo,'normal-attack-current-hand-selection');
 await action(a.page,'clear').click();
 let played=false;
 for(let attempt=0;attempt<4;attempt++){
  const option=a.observed.room.selfLegalCardTargets.find(choice=>choice.untargeted);
  if(option){
   const cardId=a.observed.room.selfHandCards[option.index],count=a.observed.room.players[a.observed.room.youSeat].board.length,before=a.observed.commands.length;
   await a.page.locator(`#hand-semantics [data-hand-index="${option.index}"]`).focus();await a.page.keyboard.press('Enter');
   await expect(action(a.page,'play')).toContainText('召唤');await uiCommand(a,()=>action(a.page,'play').click());await sync(a,b);await waitForBoard(a);
   expect(a.observed.commands.slice(before).map(c=>c.action)).toEqual(['play']);
   const board=a.observed.room.players[a.observed.room.youSeat].board;expect(board).toHaveLength(count+1);expect(board.some(unit=>unit.cardId===cardId&&unit.uid!==uid)).toBe(true);
   a.metrics.normalHandRevision={attackRevision:revision,currentRevision:a.observed.room.revision,selectedAfterAttack:true,subsequentCard:cardId,ordinaryTurnPairs:attempt,normalMotion:true};
   await safeScreenshot(a.page,testInfo,'normal-attack-subsequent-legal-summon');played=true;break;
  }
  if(attempt<3){await uiCommand(a,()=>action(a.page,'end').click());await sync(a,b);await b.page.bringToFront();await waitForBoard(b);await uiCommand(b,()=>action(b.page,'end').click());await sync(a,b);await a.page.bringToFront();await waitForBoard(a);}
 }
 expect(played,'Coverage gap: no legal summon within three ordinary turn pairs').toBe(true);
 for(const actor of[a,b])expect(actor.observed.errors).toEqual([]);
});
