import { expect, action, safeScreenshot } from './helpers.mjs';

const settle=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));

/** Inspect the real 640px compatibility hand without changing its game state. */
export async function verifyCpuHandReachability(actor,peer,testInfo) {
 const page=actor.page,canvas=page.locator('#hand-canvas');
 expect(actor.observed.room.selfController).toBe('human');expect(actor.observed.room.opponentController).toBe('human');
 expect(actor.observed.room.activeSeat).toBe(actor.observed.room.youSeat);
 const peerCommands=peer.observed.commands.length;
 const first=page.locator('#hand-semantics [data-hand-index]').first();
 const last=page.locator('#hand-semantics [data-hand-index]').last();
 const lastName=await last.textContent(),commands=actor.observed.commands.length,revision=actor.observed.room.revision;
 const geometry=await page.evaluate(()=>{
  const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
  return {hand:rect('#hand-canvas'),rituals:rect('.rituals'),hero:rect('.hero-panel.mine')};
 });
 expect(geometry.hand.right).toBeLessThanOrEqual(geometry.rituals.x);
 expect(geometry.hero.right).toBeLessThanOrEqual(geometry.hand.x);
 actor.metrics.cpuHandReachability={viewport:{width:640,height:740},geometry,gapToRituals:geometry.rituals.x-geometry.hand.right,methods:[]};
 await page.evaluate(()=>{
  const events=[],canvas=document.querySelector('#hand-canvas');
  const focusOwner=()=>document.activeElement===canvas?'canvas':document.activeElement?.closest?.('#hand-semantics')?'semantics':'other';
  const record=e=>events.push({type:e.type,trusted:e.isTrusted,pointerType:e.pointerType||null,focus:focusOwner()});
  const focusRecord=e=>{if(e.target===canvas||e.target.closest?.('#hand-semantics'))record(e);};
  const types=['wheel','pointerdown','pointermove','pointerup'];types.forEach(type=>canvas.addEventListener(type,record,{passive:true}));
  document.addEventListener('focusin',focusRecord);document.addEventListener('focusout',focusRecord);
  window.__cpuHandInputEvidence={finish:()=>{types.forEach(type=>canvas.removeEventListener(type,record));document.removeEventListener('focusin',focusRecord);document.removeEventListener('focusout',focusRecord);delete window.__cpuHandInputEvidence;return events;}};
 });
 const client=await actor.context.newCDPSession(page);
 const reset=async()=>{await first.focus();await page.keyboard.press('Home');await settle(page);await expect(page.locator('#hand-prev')).toBeDisabled();};
 const inspectSelected=async(method)=>{
  await expect(page.locator('.card-command b').first()).toHaveText(lastName);
  await action(page,'card-info').click();await expect(page.locator('.card-info-dialog h2')).toHaveText(lastName);
  await safeScreenshot(page,testInfo,`cpu-last-card-${method}-details`);
  await action(page,'card-info-close').click();await action(page,'clear').click();
  actor.metrics.cpuHandReachability.methods.push(method);
 };
 const touch=x=>({x,y:geometry.hand.y+geometry.hand.height*.55,id:1,radiusX:2,radiusY:2,force:1});
 try {
  await first.focus();await page.keyboard.press('End');await settle(page);
  await expect(last).toBeFocused();await expect(page.locator('#hand-next')).toBeDisabled();
  await safeScreenshot(page,testInfo,'cpu-last-card-keyboard-visible');await page.keyboard.press('Enter');await inspectSelected('keyboard');
  await reset();await page.mouse.move(geometry.hand.x+geometry.hand.width*.5,geometry.hand.y+geometry.hand.height*.5);
  await page.mouse.wheel(2000,0);await settle(page);await expect(page.locator('#hand-next')).toBeDisabled();
  await safeScreenshot(page,testInfo,'cpu-last-card-wheel-visible');
  await canvas.click({position:{x:geometry.hand.width*.82,y:geometry.hand.height*.55}});await inspectSelected('wheel-pointer');
  await reset();
  let swipes=0;
  while(await page.locator('#hand-next').isEnabled()&&swipes<5){
   const start=geometry.hand.x+geometry.hand.width*.82,end=geometry.hand.x+geometry.hand.width*.18;
   await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch(start)]});
   try {for(let step=1;step<=6;step++){await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[touch(start+(end-start)*step/6)]});await settle(page);}}
   finally {await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});}
   await settle(page);swipes++;
  }
  expect(swipes).toBeGreaterThan(0);await expect(page.locator('#hand-next')).toBeDisabled();
  await expect(page.locator('.command-bar')).toBeHidden();await expect(page.locator('.card-info-dialog')).toBeHidden();
  await safeScreenshot(page,testInfo,'cpu-last-card-native-touch-visible');
  await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch(geometry.hand.x+geometry.hand.width*.82)]});
  await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await inspectSelected('native-touch');
  actor.metrics.cpuHandReachability.touchSwipes=swipes;
  expect(actor.observed.commands.slice(commands)).toEqual([]);expect(peer.observed.commands.slice(peerCommands)).toEqual([]);
  expect(actor.observed.room.selfController).toBe('human');expect(actor.observed.room.opponentController).toBe('human');
  expect(actor.observed.room.revision).toBe(revision);
 } finally {
  actor.metrics.cpuHandReachability.events=await page.evaluate(()=>window.__cpuHandInputEvidence.finish());
  await client.detach();
 }
 const events=actor.metrics.cpuHandReachability.events;
 expect(events.some(e=>e.type==='wheel'&&e.trusted)).toBe(true);
 expect(events.some(e=>e.type==='pointermove'&&e.pointerType==='touch'&&e.trusted)).toBe(true);
}
