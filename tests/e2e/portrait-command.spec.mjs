import {
  test, expect, action, sleep, safeScreenshot, calmAnimations,
  matchPair, confirmOpening, sync, uiCommand, waitForBoard,
} from './helpers.mjs';

const portrait = { width: 320, height: 568 };
const landscape = { width: 844, height: 390 };
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

// Only this participant's ordinary received choices and visible buttons guide
// keyboard selection. No engine import, seeded shuffle, storage, or state write.
async function summonVisibleCreature(actor) {
  const page = actor.page, room = actor.observed.room;
  const choices = (room.selfLegalCardTargets || []).filter(choice => choice.untargeted)
    .sort((a, b) => room.selfHandCosts[a.index] - room.selfHandCosts[b.index]);
  for (const choice of choices) {
    await page.locator(`#hand-semantics [data-hand-index="${choice.index}"]`).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.card-command')).toBeVisible();
    const play = action(page, 'play');
    if (await play.count() && await play.isEnabled() && (await play.innerText()).includes('召唤')) {
      const count = room.players[room.youSeat].board.length;
      const command = await uiCommand(actor, () => play.click());
      expect(command.action).toBe('play');
      await expect.poll(() => actor.observed.room.players[room.youSeat].board.length).toBe(count + 1);
      actor.metrics.summons += 1;
      return true;
    }
    await action(page, 'clear').click();
  }
  return false;
}

async function selectCreatureCard(actor) {
  const page = actor.page;
  const indices = await page.locator('#hand-semantics [data-hand-index]').evaluateAll(elements =>
    elements.map(element => Number(element.dataset.handIndex)));
  for (const index of indices) {
    await page.locator(`#hand-semantics [data-hand-index="${index}"]`).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.card-command')).toBeVisible();
    const play = action(page, 'play');
    // A disabled Summon is still a real selected-card geometry case. Never click
    // it here: this phase must preserve authority, hand instances, and mana.
    if (await play.count() && (await play.innerText()).includes('召唤')) return index;
    await action(page, 'clear').click();
  }
  throw new Error('Coverage gap: the natural hand has no creature command bar');
}

function readOnlyState(actor) {
  const room = actor.observed.room;
  // These owner-only values are compared in memory, never written to evidence.
  return JSON.stringify({ revision: room.revision, activeSeat: room.activeSeat,
    phase: room.phase, players: room.players, handIds: room.selfHandIds,
    handCards: room.selfHandCards, handCosts: room.selfHandCosts,
    draw: room.selfDrawEnglish, rituals: room.selfRitualsLeft });
}

async function inspectScrollRegion(page, client, testInfo, actor) {
  const body=page.locator('.card-info-body'), footer=page.locator('.card-info-footer');
  const before=await body.evaluate(el=>({top:el.scrollTop,client:el.clientHeight,total:el.scrollHeight}));
  expect(before.total).toBeGreaterThan(before.client);
  const box=await body.boundingBox(), closeBefore=await footer.boundingBox();
  expect(box.y+box.height).toBeLessThanOrEqual(closeBefore.y+1);
  const point=y=>({x:box.x+box.width*.5,y,radiusX:5,radiusY:5,force:1,id:1});
  // Genuine Chromium touch scrolling, not an assignment to scrollTop.
  for(let swipe=0;swipe<5;swipe++){
    const current=await body.evaluate(el=>el.scrollTop+el.clientHeight>=el.scrollHeight-2);
    if(current)break;
    const start=box.y+box.height*.8,end=box.y+box.height*.2;
    await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(start)]});
    for(let step=1;step<=8;step++){
      await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(start+(end-start)*step/8)]});
      await page.waitForTimeout(30);
    }
    await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.waitForTimeout(150);
  }
  const after=await body.evaluate(el=>({top:el.scrollTop,client:el.clientHeight,total:el.scrollHeight}));
  expect(after.top).toBeGreaterThan(before.top+20);
  await expect(body.locator('.card-info-tip summary')).toBeInViewport();
  await body.locator('.card-info-tip summary').tap();
  await expect(body.locator('.card-info-tip')).toHaveAttribute('open','');
  // Browser-native scrollIntoView verifies the last expanded rule can be read.
  await body.locator('.card-info-tip p').last().scrollIntoViewIfNeeded();
  const last=await body.locator('.card-info-tip p').last().boundingBox(), closeAfter=await footer.boundingBox();
  expect(last.y+last.height).toBeLessThanOrEqual(closeAfter.y+1);
  expect(Math.abs(closeAfter.y-closeBefore.y)).toBeLessThan(1);
  const close=await action(page,'card-info-close').boundingBox();
  const receives=await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.closest('[data-action]')?.dataset.action,{x:close.x+close.width/2,y:close.y+close.height/2});
  expect(receives).toBe('card-info-close');
  actor.metrics.portraitCommand.readingScroll={before,after,footerY:closeAfter.y,lastRuleBottom:last.y+last.height,nativeTouch:true};
  await safeScreenshot(page,testInfo,'320x568-expanded-rules-above-fixed-return');
}

const overlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.x, b.x) > 1 &&
  Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 1;
const inside = (box, viewport) => box.x >= -1 && box.y >= -1 &&
  box.right <= viewport.width + 1 && box.bottom <= viewport.height + 1;

async function boardGeometry(actor, testInfo, name, selected) {
  const page = actor.page;
  await settle(page);
  const geometry = await page.evaluate(() => {
    const rect = element => {
      const b = element.getBoundingClientRect();
      return { x: b.x, y: b.y, width: b.width, height: b.height, right: b.right, bottom: b.bottom };
    };
    const visible = element => {
      const style = getComputedStyle(element), b = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && b.width > 0 && b.height > 0;
    };
    const sample = (element, name) => {
      const b = rect(element);
      const hit = [[.5, .5], [.2, .2], [.8, .2], [.2, .8], [.8, .8]].every(([x, y]) => {
        const at = document.elementFromPoint(b.x + x * b.width, b.y + y * b.height);
        return at === element || element.contains(at);
      });
      return { name, ...b, layoutWidth: element.offsetWidth, layoutHeight: element.offsetHeight, hit };
    };
    const all = selector => [...document.querySelectorAll(selector)].filter(visible);
    const command = all('.command-bar')[0];
    return {
      viewport: { width: innerWidth, height: innerHeight }, contentWidth: document.documentElement.scrollWidth,
      arena: rect(document.querySelector('#arena')),
      hand: sample(document.querySelector('#hand-canvas'), 'hand-canvas'),
      command: command ? { name: 'command-bar', ...rect(command) } : null,
      controls: all('.command-bar > button').map(element => sample(element, element.dataset.action)),
      labels: all('.unit-label').map(element => sample(element, `${element.dataset.side}-slot-${element.dataset.slot}`)),
      heroes: all('.hero-panel').map((element, index) => sample(element, `hero-${index}`)),
      actions: all('.rituals > button').map(element => sample(element, element.dataset.action || 'ritual')),
      reducedMotion: document.querySelector('#arena')?.dataset.reducedMotion || null,
    };
  });
  actor.metrics.portraitCommand.layouts.push({ name, ...geometry });
  // Preserve the exact failing state before any layout assertion or cancellation.
  await safeScreenshot(page, testInfo, name);
  expect(geometry.contentWidth).toBeLessThanOrEqual(geometry.viewport.width + 1);
  expect(geometry.reducedMotion).toBe('true');
  expect(geometry.labels.length, 'real units remain visible on both sides').toBeGreaterThanOrEqual(2);
  expect(geometry.labels.some(box => box.name.startsWith('self-'))).toBe(true);
  expect(geometry.labels.some(box => box.name.startsWith('opponent-'))).toBe(true);
  expect(Boolean(geometry.command)).toBe(selected);
  if (geometry.viewport.width === portrait.width) {
    expect(geometry.hand.height, 'portrait retains the full-size 190px hand').toBeGreaterThanOrEqual(190 - .001);
    expect(geometry.arena.height, 'selection does not consume the compact board').toBeGreaterThanOrEqual(220);
  }
  for (const box of [geometry.hand, ...geometry.labels, ...geometry.heroes, ...geometry.controls, ...geometry.actions]) {
    expect(inside(box, geometry.viewport), `${name}: ${box.name} is inside the viewport`).toBe(true);
    expect(box.hit, `${name}: ${box.name} remains directly hit-testable`).toBe(true);
  }
  for (const box of [...geometry.controls, ...geometry.labels, ...geometry.actions]) {
    expect(box.layoutWidth, `${name}: ${box.name} layout width`).toBeGreaterThanOrEqual(44);
    expect(box.layoutHeight, `${name}: ${box.name} layout height`).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44 - .001);
    expect(box.height).toBeGreaterThanOrEqual(44 - .001);
  }
  for (const box of geometry.actions) {
    expect(overlap(box, geometry.hand), `${name}: ${box.name}, including optional draw help, stays above the hand`).toBe(false);
    expect(overlap(box, geometry.arena), `${name}: ${box.name} stays outside the board`).toBe(false);
    for (const label of geometry.labels)
      expect(overlap(box, label), `${name}: ${box.name} does not cover a unit badge`).toBe(false);
  }
  if (!selected) expect(geometry.actions.length, 'ordinary rituals and End Turn remain present').toBeGreaterThanOrEqual(4);
  if (selected) {
    expect(geometry.controls.map(box => box.name).sort()).toEqual(['card-info', 'clear', 'play']);
    expect(inside(geometry.command, geometry.viewport)).toBe(true);
    for (const box of [geometry.arena, geometry.hand, ...geometry.labels, ...geometry.heroes])
      expect(overlap(geometry.command, box), `${name}: command bar stays outside board, hand, badges, and hero panels`).toBe(false);
    for (const box of geometry.controls) {
      expect(box.x >= geometry.command.x - 1 && box.y >= geometry.command.y - 1 &&
        box.right <= geometry.command.right + 1 && box.bottom <= geometry.command.bottom + 1,
      `${name}: ${box.name} fits inside its command bar`).toBe(true);
    }
  }
}

async function nativeHold(client, x, y) {
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1, radiusX: 2, radiusY: 2, force: 1 }] });
  try { await sleep(560); }
  finally { await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
}

test('@portrait-command compact card commands, native inspection and orientation preserve the live board', async ({ actors }, testInfo) => {
  test.setTimeout(120_000);
  testInfo.annotations.push({ type: 'coverage', description: 'Real isolated guests, ordinary unseeded Ember decks and at most eight real UI turns produce at least one unit per side. Reduced-motion geometry only: 320x568 three-button card command, cancel, 560ms Chromium CDP hand and unit-label holds, details dismissal, 844x390 orientation and portrait return. 44px controls, 190px portrait hand, board/badge hit testing, optional draw help when present, and zero new authority commands during inspection/cancellation/orientation. Screenshots need independent visual review. No normal-animation, fully populated-board, physical-device, storage/state injection, or local-browser claim.' });
  const a = await actors('portrait-command-A', { hasTouch: true });
  const b = await actors('portrait-command-B', { hasTouch: true });
  for (const actor of [a, b]) { await actor.page.bringToFront(); await calmAnimations(actor); }
  await matchPair(a, b); await confirmOpening(a, b);
  let reviewer;
  for (let turn = 0; turn < 8; turn++) {
    const actor = [a, b].find(item => item.observed.room.youSeat === a.observed.room.activeSeat);
    await actor.page.bringToFront(); await waitForBoard(actor);
    if (!actor.observed.room.players[actor.observed.room.youSeat].board.length) {
      await summonVisibleCreature(actor); await sync(a, b); await waitForBoard(actor);
    }
    if (actor.observed.room.players.every(player => player.board.length > 0)) {
      reviewer = actor; actor.metrics.turnsToPortraitCoverage = turn + 1; break;
    }
    if (turn < 7) { await uiCommand(actor, () => action(actor.page, 'end').click()); await sync(a, b); }
  }
  expect(Boolean(reviewer), 'coverage gap: natural play must populate both sides within eight turns').toBe(true);
  const actor = reviewer, page = actor.page;
  actor.metrics.portraitCommand = { stage: 'portrait-unselected', layouts: [], unchangedChecks: [],
    method: 'Native Chromium CDP touch holds and real keyboard/tap input; reduced-motion geometry, not animation or physical hardware' };
  const originalState = [a, b].map(readOnlyState), commandCounts = [a, b].map(item => item.observed.commands.length);
  async function unchanged(stage) {
    await sleep(350); // Let any accidental compatibility click or command surface.
    const deltas = [a, b].map((item, index) => item.observed.commands.length - commandCounts[index]);
    const preserved = [a, b].every((item, index) => readOnlyState(item) === originalState[index]);
    actor.metrics.portraitCommand.unchangedChecks.push({ stage, commandDeltas: deltas, preserved });
    expect(deltas, `${stage}: no unintended authority command`).toEqual([0, 0]);
    expect(preserved, `${stage}: board, mana, readiness, own hand and revision unchanged`).toBe(true);
  }
  await page.setViewportSize(portrait);
  await boardGeometry(actor, testInfo, '320x568-unselected', false);
  const selectedIndex = await selectCreatureCard(actor);
  const selectedName = await page.locator('.card-command > div > b').innerText();
  await boardGeometry(actor, testInfo, '320x568-selected-card-command', true);
  await action(page, 'clear').tap();
  await expect(page.locator('.command-bar')).toBeHidden();
  await unchanged('tap-cancel-selection');
  await boardGeometry(actor, testInfo, '320x568-cancelled-selection', false);

  const client = await actor.context.newCDPSession(page);
  try {
    actor.metrics.portraitCommand.stage = 'native-hand-longpress';
    const names = await page.locator('#hand-semantics [data-hand-index]').evaluateAll(elements =>
      elements.map(element => element.getAttribute('aria-label').split('，')[0]));
    const hand = await page.locator('#hand-canvas').boundingBox();
    expect(Boolean(hand)).toBe(true);
    await nativeHold(client, hand.x + hand.width * .5, hand.y + hand.height * .55);
    const dialog = page.locator('.card-info-dialog');
    await expect(dialog).toBeVisible();
    expect(names.includes(await dialog.locator('#card-info-title').innerText()), 'native hold inspects a card actually in this hand').toBe(true);
    await expect(dialog).not.toHaveClass(/board-card-info/);
    await safeScreenshot(page, testInfo, '320x568-native-hand-details');
    await action(page, 'card-info-close').scrollIntoViewIfNeeded();
    const close = await action(page, 'card-info-close').boundingBox();
    expect(close.width).toBeGreaterThanOrEqual(44); expect(close.height).toBeGreaterThanOrEqual(44);
    await action(page, 'card-info-close').tap();
    await expect(dialog).toBeHidden();
    await expect(page.locator('.command-bar')).toBeHidden();
    await unchanged('hand-longpress-dismiss');

    actor.metrics.portraitCommand.stage = 'native-unit-longpress';
    const ownUnit = actor.observed.room.players[actor.observed.room.youSeat].board[0];
    const label = page.locator(`.unit-label[data-uid="${ownUnit.uid}"]`);
    const unitName = (await label.getAttribute('aria-label')).split('，')[0];
    const box = await label.boundingBox();
    await nativeHold(client, box.x + box.width / 2, box.y + box.height / 2);
    await expect(dialog).toHaveClass(/board-card-info/);
    await expect(dialog.locator('#card-info-title')).toHaveText(unitName);
    await expect(dialog.locator('.unit-inspection-state')).toContainText('我方伙伴');
    await safeScreenshot(page, testInfo, '320x568-native-unit-details');
    await inspectScrollRegion(page,client,testInfo,actor);
    await action(page, 'card-info-close').tap();
    await expect(dialog).toBeHidden();
    await expect(page.locator('.command-bar')).toBeHidden();
    await unchanged('unit-longpress-dismiss');
  } finally { await client.detach(); }

  actor.metrics.portraitCommand.stage = 'selected-orientation-roundtrip';
  await page.locator(`#hand-semantics [data-hand-index="${selectedIndex}"]`).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.card-command > div > b')).toHaveText(selectedName);
  await page.setViewportSize(landscape);
  await boardGeometry(actor, testInfo, '844x390-selected-after-orientation', true);
  await page.setViewportSize(portrait);
  await expect(page.locator('.card-command > div > b')).toHaveText(selectedName);
  await boardGeometry(actor, testInfo, '320x568-selected-after-return', true);
  await action(page, 'clear').tap();
  await expect(page.locator('.command-bar')).toBeHidden();
  await boardGeometry(actor, testInfo, '320x568-final-cancelled', false);
  await unchanged('orientation-return-and-cancel');
  // A separate refresh phase intentionally sends exactly one End Turn per side.
  // The preceding inspection/cancel/orientation phase keeps all zero-command checks.
  const other=actor===a?b:a;
  await uiCommand(actor,()=>action(page,'end').click());await sync(a,b);
  await page.setViewportSize(landscape);
  const own=actor.observed.room.players[actor.observed.room.youSeat].board[0];
  await page.locator(`.unit-label[data-uid="${own.uid}"]`).click({button:'right'});
  const reading=page.locator('.card-info-body'),tip=page.locator('.card-info-tip');
  await expect(reading).toBeVisible();
  await tip.locator('summary').scrollIntoViewIfNeeded();await tip.locator('summary').click();
  await expect(tip).toHaveAttribute('open','');
  await reading.focus();await page.keyboard.press('End');await sleep(200);
  const scrollBefore=await reading.evaluate(el=>el.scrollTop);
  expect(scrollBefore).toBeGreaterThan(0);
  const refreshCounts=[a,b].map(item=>item.observed.commands.length),revision=actor.observed.room.revision;
  await other.page.bringToFront();await waitForBoard(other);
  await uiCommand(other,()=>action(other.page,'end').click());await sync(a,b);
  await page.bringToFront();await expect.poll(()=>actor.observed.room.revision).toBeGreaterThan(revision);
  await expect(page.locator('.card-info-tip')).toHaveAttribute('open','');
  await expect(reading).toBeFocused();
  const scrollAfter=await reading.evaluate(el=>el.scrollTop);
  expect(scrollAfter).toBeGreaterThanOrEqual(scrollBefore-2);
  const refreshDeltas=[a,b].map((item,index)=>item.observed.commands.length-refreshCounts[index]);
  expect(refreshDeltas).toEqual(actor===a?[0,1]:[1,0]);
  const readingBox=await reading.boundingBox(),footerBox=await page.locator('.card-info-footer').boundingBox();
  expect(readingBox.y+readingBox.height).toBeLessThanOrEqual(footerBox.y+1);
  await safeScreenshot(page,testInfo,'844x390-reading-state-after-opponent-turn');
  await page.keyboard.press('Home');await expect.poll(()=>reading.evaluate(el=>el.scrollTop)).toBe(0);
  await action(page,'card-info-close').click();await expect(reading).toBeHidden();
  actor.metrics.portraitCommand.readingRefresh={scrollBefore,scrollAfter,refreshDeltas,keyboardHome:true,expandedRetained:true};
  actor.metrics.portraitCommand.stage = 'completed';
  for (const participant of [a, b]) {
    expect(participant.observed.errors).toEqual([]);
    expect(participant.observed.room.assisted).toBe(false);
    expect(participant.observed.room.opponentController).toBe('human');
  }
});
