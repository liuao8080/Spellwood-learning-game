import {
  test, expect, action, currentProgress, safeScreenshot, calmAnimations,
  confirmOpening, sync, uiCommand, waitForBoard,
} from './helpers.mjs';
import { readFile } from 'node:fs/promises';

const viewports = [
  { width: 1280, height: 800 }, { width: 844, height: 390 },
  { width: 740, height: 360 }, { width: 390, height: 844 },
  { width: 320, height: 568 },
];

test('@layout desktop label component keeps long names shields and three-digit stats inside narrow slots', async ({ page }, testInfo) => {
  await page.setViewportSize({ width:1280, height:800 });
  const css = (await Promise.all(['style.css','immersive.css','safe-area.css'].map(name => readFile(new URL(`../../src/network/${name}`, import.meta.url), 'utf8')))).join('\n');
  const widths = [44,52,68,90,128];
  await page.setContent(`<style>${css}</style><p>Isolated label component fixture, not gameplay evidence</p>` + widths.map((width,index) =>
    `<button class="unit-label" data-side="opponent" style="left:200px;top:${100+index*100}px;--unit-label-max-width:${width}px" aria-label="溪流海獭长名字，攻击99，生命999，有护盾"><b class="wide">99</b><span class="unit-name"><em>溪流海獭长名字</em><i class="unit-shield" aria-hidden="true">◇</i></span><b class="wide">999</b></button>`).join(''));
  const boxes = await page.locator('.unit-label').evaluateAll(elements => elements.map(element => {
    const box=element.getBoundingClientRect();
    const children=[...element.querySelectorAll('b,.unit-name,.unit-shield')].map(child => {
      const b=child.getBoundingClientRect();const range=document.createRange();range.selectNodeContents(child);
      const text=range.getBoundingClientRect();
      return { inside:b.left>=box.left && b.right<=box.right && b.top>=box.top && b.bottom<=box.bottom,
        textFits: !child.matches('b') || text.width<=b.width+1, visible:b.width>0&&b.height>0 };
    });
    return { width:box.width, height:box.height, children };
  }));
  await safeScreenshot(page,testInfo,'desktop-label-component-widths-44-to-128');
  expect(boxes.map(box=>box.width)).toEqual(widths);
  for(const box of boxes){expect(box.height).toBe(44);for(const child of box.children){expect(child.inside).toBe(true);expect(child.textFits).toBe(true);expect(child.visible).toBe(true);}}
});
// Every card is a cheap, non-damaging creature. The UI still builds and saves a
// legal 20-card deck, and the real server owns its ordinary unseeded shuffle.
const wanted = { sprout: 3, rabbit: 3, hedgehog: 3, firefly: 3, acorn_squirrel: 3, fox: 3, otter: 2 };
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

async function prepareCreatureDeck(actor) {
  const page = actor.page;
  await action(page, 'library').click();
  const names = await action(page, 'library-card').evaluateAll(elements => Object.fromEntries(elements.map(element =>
    [element.querySelector('strong').textContent, element.dataset.value])));
  const draft = (await action(page, 'library-slot').evaluateAll(elements => elements.map(element =>
    element.querySelector('span:not(.library-art)').textContent))).map(name => names[name]);
  const counts = () => draft.reduce((result, id) => ({ ...result, [id]: (result[id] || 0) + 1 }), {});
  for (let step = 0; step < 20; step += 1) {
    const held = counts(), replacement = Object.keys(wanted).find(id => (held[id] || 0) < wanted[id]);
    if (!replacement) break;
    const index = draft.findIndex(id => held[id] > (wanted[id] || 0));
    expect(index).toBeGreaterThanOrEqual(0);
    await page.locator(`[data-action="library-slot"][data-value="${index}"]`).click();
    await page.locator(`[data-action="library-card"][data-value="${replacement}"]`).click();
    draft[index] = replacement;
  }
  expect(counts()).toEqual(wanted);
  await action(page, 'library-save').click();
  await expect(page.locator('.card-library')).toBeHidden();
  await expect.poll(() => currentProgress(actor).customDeck).toEqual(draft);
  await action(page, 'match-setup').click();
  const bank = page.locator('[data-action="question-bank"][data-value="school"]');
  await bank.click();
  await expect(bank).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-action="grade"][data-value="1"]').click();
  await page.locator('#course').selectOption('s1-u1');
  await page.locator('#deck').selectOption('custom');
  await expect(action(page, 'match')).toBeEnabled();
}

async function summonOne(actor, other) {
  const room = actor.observed.room;
  if (room.players[room.youSeat].board.length >= 4) return false;
  // Only this participant's own received legal choices and visible hand labels
  // guide real keyboard selection and the actual Summon button.
  const choice = room.selfLegalCardTargets
    .filter(option => option.untargeted && wanted[room.selfHandCards[option.index]])
    .sort((a, b) => room.selfHandCosts[a.index] - room.selfHandCosts[b.index])[0];
  if (!choice) return false;
  const count = room.players[room.youSeat].board.length;
  await actor.page.locator(`#hand-semantics [data-hand-index="${choice.index}"]`).focus();
  await actor.page.keyboard.press('Enter');
  await expect(actor.page.locator('.card-command')).toBeVisible();
  await expect(action(actor.page, 'play')).toContainText('召唤');
  await uiCommand(actor, () => action(actor.page, 'play').click());
  await sync(actor, other);
  expect(actor.observed.room.players[room.youSeat].board).toHaveLength(count + 1);
  actor.metrics.summons += 1;
  return true;
}

function overlap(a, b) {
  return Math.min(a.right, b.right) - Math.max(a.x, b.x) > 1 &&
    Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 1;
}
function inside(rect, bounds) {
  return rect.x >= bounds.x - 1 && rect.y >= bounds.y - 1 &&
    rect.right <= bounds.right + 1 && rect.bottom <= bounds.bottom + 1;
}

async function populatedLayout(actor, testInfo, viewport) {
  const page = actor.page, size = `${viewport.width}x${viewport.height}`;
  await page.setViewportSize(viewport);
  await expect(page.locator('.command-bar')).toBeHidden();
  await expect(page.locator('.unit-label')).toHaveCount(8);
  await settle(page);
  const expectedUnits = actor.observed.room.players.flatMap(player => player.board.map(unit => unit.uid)).sort();
  expect(await page.locator('.unit-label').evaluateAll(elements => elements.map(element => element.dataset.uid).sort())).toEqual(expectedUnits);
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
      // Insets avoid rounded corners; sample the centre and four inner corners.
      const hit = [[.5, .5], [.2, .2], [.8, .2], [.2, .8], [.8, .8]].every(([x, y]) => {
        const at = document.elementFromPoint(b.x + b.width * x, b.y + b.height * y);
        return element === at || element.contains(at);
      });
      return { name, ...b, layoutWidth:element.offsetWidth, layoutHeight:element.offsetHeight, hit };
    };
    const all = selector => [...document.querySelectorAll(selector)].filter(visible);
    const stats = all('.hero-panel .hero-gem, .hero-panel .mana b').map((element, index) => sample(element, `hero-stat-${index}`));
    const panels = all('.hero-panel').map((element, index) => sample(element, `hero-panel-${index}`));
    const actions = all('.rituals > button').map(element => sample(element, element.dataset.action + (element.dataset.value ? `-${element.dataset.value}` : '')));
    const labels = all('.unit-label').map(element => sample(element, `${element.dataset.side}-slot-${element.dataset.slot}`));
    const obstacles = all('.top, .hero-panel, .rituals, .battle-context, .turn-banner, .leave, #hand-stage').map((element, index) => ({ name: `obstacle-${index}`, ...rect(element) }));
    return {
      viewport: { x: 0, y: 0, right: innerWidth, bottom: innerHeight },
      contentWidth: document.documentElement.scrollWidth,
      arena: rect(document.querySelector('#arena')),
      hand: sample(document.querySelector('#hand-canvas'), 'hand-canvas'),
      stats, panels, actions, labels, obstacles,
    };
  });
  actor.metrics.populatedLayouts ??= [];
  actor.metrics.populatedLayouts.push({ size, ...geometry });
  // Save before assertions so a geometry failure has exact-state pixel evidence.
  await safeScreenshot(page, testInfo, `${size}-eight-units-seven-card-hand`);
  expect(geometry.labels, `${size}: the field is populated, not an empty-board pass`).toHaveLength(8);
  expect(geometry.stats, `${size}: both heroes expose HP and mana`).toHaveLength(4);
  expect(geometry.actions.length, `${size}: rituals and End Turn remain visible`).toBeGreaterThanOrEqual(4);
  expect(geometry.contentWidth).toBeLessThanOrEqual(viewport.width + 1);
  if (size === '320x568') expect(geometry.arena.height, 'small portrait reserves at least 190 CSS px for the unselected field').toBeGreaterThanOrEqual(190);
  for (const box of [geometry.hand, ...geometry.panels, ...geometry.stats, ...geometry.actions, ...geometry.labels]) {
    expect(inside(box, geometry.viewport), `${size}: ${box.name} fits the viewport`).toBe(true);
    expect(box.hit, `${size}: ${box.name} is not occluded`).toBe(true);
  }
  for (const box of [...geometry.actions, ...geometry.labels]) {
    expect(box.layoutWidth, `${size}: ${box.name} layout target width`).toBeGreaterThanOrEqual(44);
    expect(box.layoutHeight, `${size}: ${box.name} layout target height`).toBeGreaterThanOrEqual(44);
    // Translating a 44px box may subtract to43.999984 in DOMRect float32.
    // Keep44px layout and accept only sub-thousandth-pixel coordinate noise.
    expect(box.width, `${size}: ${box.name} projected target width`).toBeGreaterThanOrEqual(44-.001);
    expect(box.height, `${size}: ${box.name} projected target height`).toBeGreaterThanOrEqual(44-.001);
  }
  for (const box of geometry.labels) {
    expect(inside(box, geometry.arena), `${size}: ${box.name} stays inside the field`).toBe(true);
    for (const other of geometry.obstacles) expect(overlap(box, other), `${size}: ${box.name} does not overlap ${other.name}`).toBe(false);
  }
  for (const boxes of [geometry.labels, [...geometry.panels, geometry.hand, ...geometry.actions]]) {
    for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1)
      expect(overlap(boxes[i], boxes[j]), `${size}: ${boxes[i].name} and ${boxes[j].name} remain separate`).toBe(false);
  }
}

function readOnlyState(actor) {
  const room = actor.observed.room;
  return structuredClone({ revision: room.revision, players: room.players,
    handIds: room.selfHandIds, handCards: room.selfHandCards, handCosts: room.selfHandCosts,
    draw: room.selfDrawEnglish, rituals: room.selfRitualsLeft });
}

async function compactHandGestures(actor, testInfo) {
  const page = actor.page;
  await page.setViewportSize({ width: 320, height: 568 });
  await settle(page);
  await expect(page.locator('#hand-semantics [data-hand-index]')).toHaveCount(7);
  await expect(page.locator('body')).toHaveClass(/hand-overflow/);
  const before = readOnlyState(actor), commands = actor.observed.commands.length;
  await page.evaluate(() => {
    const canvas = document.querySelector('#hand-canvas'), events = [];
    const record = event => events.push({ type: event.type, trusted: event.isTrusted,
      pointerType: ['touch', 'mouse', 'pen'].includes(event.pointerType) ? event.pointerType : null,
      deltaX: event.type === 'wheel' ? event.deltaX : null, deltaY: event.type === 'wheel' ? event.deltaY : null });
    const types = ['wheel', 'pointerdown', 'pointermove', 'pointerup', 'pointercancel'];
    for (const type of types) canvas.addEventListener(type, record, { passive: true });
    window.__compactInputEvidence = {
      count: () => events.filter(event => event.type === 'wheel').length,
      finish: () => { for (const type of types) canvas.removeEventListener(type, record); delete window.__compactInputEvidence; return events; },
    };
  });
  const canvas = page.locator('#hand-canvas'), bounds = await canvas.boundingBox();
  const wheel = async delta => {
    const count = await page.evaluate(() => window.__compactInputEvidence.count());
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.mouse.wheel(delta, 0);
    await expect.poll(() => page.evaluate(() => window.__compactInputEvidence.count())).toBeGreaterThan(count);
    await settle(page);
  };
  const client = await actor.context.newCDPSession(page);
  try {
    await wheel(-2000);
    await expect(page.locator('#hand-prev')).toBeDisabled();
    await expect(page.locator('#hand-next')).toBeEnabled();
    await safeScreenshot(page, testInfo, '320x568-hand-wheel-window-0');
    let windows = 1;
    // Overlapping half-window steps make the full seven-card strip reviewable,
    // including repeated names. Endpoints come from public navigation controls;
    // no renderer layout, picking API or hidden card coordinates are consulted.
    for (let step = 1; step <= 8 && await page.locator('#hand-next').isEnabled(); step += 1) {
      await wheel(bounds.width / 2);
      await expect(page.locator('#hand-prev')).toBeEnabled();
      await expect(page.locator('.command-bar, .card-info-dialog')).toBeHidden();
      await safeScreenshot(page, testInfo, `320x568-hand-wheel-window-${step}`);
      windows += 1;
    }
    await expect(page.locator('#hand-next')).toBeDisabled();
    expect(windows).toBeGreaterThan(1);
    const startX = bounds.x + bounds.width * .18, endX = bounds.x + bounds.width * .82;
    const y = bounds.y + bounds.height * .52;
    const point = x => ({ x, y, id: 1, radiusX: 2, radiusY: 2, force: 1 });
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(startX)] });
    try {
      for (let step = 1; step <= 6; step += 1) {
        await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(startX + (endX - startX) * step / 6)] });
        await settle(page);
      }
    } finally { await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
    await expect(page.locator('#hand-next'), 'a real Chromium touch swipe moved away from the last-card endpoint').toBeEnabled();
    await settle(page);
    await expect(page.locator('.command-bar, .card-info-dialog')).toBeHidden();
    expect(JSON.stringify(readOnlyState(actor)) === JSON.stringify(before), 'wheel and touch panning preserve the complete own received state').toBe(true);
    expect(actor.observed.commands.slice(commands)).toEqual([]);
    await safeScreenshot(page, testInfo, '320x568-hand-after-chromium-touch-swipe');
    actor.metrics.compactHandGestures = {
      method: 'Playwright native mouse wheel and Chromium CDP touchStart/touchMove/touchEnd; no physical-device claim',
      naturalHandCount: 7, overlappingWheelWindows: windows,
      firstAndLastEndpointsReached: true, touchPanMovedFromLastEndpoint: true,
      selectionOpened: false, gameCommandsSent: 0, gameStateUnchanged: true,
      reachabilityEvidence: 'Seven semantic cards plus overlapping actual wheel screenshots for pixel review; individual duplicate card identities are not inferred from renderer internals',
    };
  } finally {
    actor.metrics.compactInputEvents = await page.evaluate(() => window.__compactInputEvidence.finish());
    await client.detach();
  }
  expect(actor.metrics.compactInputEvents.some(event => event.type === 'wheel' && event.trusted)).toBe(true);
  expect(actor.metrics.compactInputEvents.some(event => event.type === 'pointermove' && event.pointerType === 'touch' && event.trusted)).toBe(true);
}

test('@layout populated compact field keeps eight units separate and a natural seven-card hand scrolls safely', async ({ actors }, testInfo) => {
  test.setTimeout(150_000);
  testInfo.annotations.push({ type: 'coverage', description: 'Two isolated human contexts independently build legal cheap-creature decks and select the same school scope. At most 14 real UI turns fill both four-unit fields and naturally draw seven cards. Five populated viewports check label separation, hero HP/mana, hand and action hit testing, 44px targets, and 190px minimum 320x568 arena. Overlapping native-wheel screenshots traverse the seven-card strip; one Chromium CDP touch swipe must pan without selecting or spending. No seed, storage or game-state manipulation; screenshots require separate pixel review.' });
  const a = await actors('layout-A', { hasTouch: true }), b = await actors('layout-B', { hasTouch: true });
  for (const actor of [a, b]) { await calmAnimations(actor); await prepareCreatureDeck(actor); }
  expect(a.context).not.toBe(b.context);
  expect(a.observed.player.playerId).not.toBe(b.observed.player.playerId);
  await Promise.all([a, b].map(actor => action(actor.page, 'match').click()));
  await Promise.all([a, b].map(actor => expect(action(actor.page, 'opening-confirm')).toBeVisible()));
  await expect.poll(() => Boolean(a.observed.room?.roomId && a.observed.room.roomId === b.observed.room?.roomId)).toBe(true);
  for (const actor of [a, b]) {
    expect(actor.observed.room.opponentController).toBe('human');
    expect(actor.observed.queueScope).toEqual({ bank: 'school', grade: 1, course: 's1-u1' });
  }
  await confirmOpening(a, b);
  let reviewer;
  for (let turn = 0; turn < 14; turn += 1) {
    const actor = [a, b].find(item => item.observed.room.youSeat === a.observed.room.activeSeat), other = actor === a ? b : a;
    await actor.page.bringToFront();
    await waitForBoard(actor);
    for (let move = 0; move < 4; move += 1) {
      if (!await summonOne(actor, other)) break;
      await waitForBoard(actor);
    }
    if (actor.observed.room.players.every(player => player.board.length === 4) && actor.observed.room.selfHandCards.length === 7) {
      reviewer = actor; actor.metrics.turnsToFullCoverage = turn + 1; break;
    }
    if (turn < 13) { await uiCommand(actor, () => action(actor.page, 'end').click()); await sync(a, b); }
  }
  expect(a.observed.room.players.map(player => player.board.length), 'coverage gap: both fields must genuinely contain four units within 14 UI turns').toEqual([4, 4]);
  expect(Boolean(reviewer), 'coverage gap: an active player must naturally hold seven cards within 14 UI turns').toBe(true);
  const layoutErrors=[];
  for (const viewport of viewports) {
    try { await populatedLayout(reviewer, testInfo, viewport); }
    catch(error) { layoutErrors.push({viewport,message:String(error.message)}); }
  }
  reviewer.metrics.layoutErrors=layoutErrors;
  await compactHandGestures(reviewer, testInfo);
  expect(layoutErrors,'all five viewports must pass; screenshots are retained even after an earlier size fails').toEqual([]);
  for (const actor of [a, b]) {
    expect(actor.observed.room.assisted).toBe(false);
    expect(actor.observed.errors).toEqual([]);
    expect(actor.metrics.summons).toBe(4);
  }
});
