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
  test.setTimeout(90_000);
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
  actor.metrics.portraitCommand.stage = 'completed';
  for (const participant of [a, b]) {
    expect(participant.observed.errors).toEqual([]);
    expect(participant.observed.room.assisted).toBe(false);
    expect(participant.observed.room.opponentController).toBe('human');
  }
});
