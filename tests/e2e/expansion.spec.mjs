import {
  test, expect, action, sleep, currentProgress, safeScreenshot,
  fictionalUsername, calmAnimations, studyOne, register,
  prepareMatch, confirmOpening, sync, uiCommand, waitForBoard,
  matchPair, canvasAndKeyboard,
  playOneVisibleCard,
} from './helpers.mjs';

const skin = (page, name, value) => page.locator(`[data-skin-action="${name}"]${value === undefined ? '' : `[data-value="${value}"]`}`);
const journey = actor => currentProgress(actor).journey;
const officialWallet = actor => structuredClone({
  tickets: journey(actor).skinTickets, owned: journey(actor).official,
  dust: currentProgress(actor).collection.earned.dust,
  cardCollection: currentProgress(actor).collection,
});

async function buildExpansionDeck(actor) {
  const page = actor.page;
  await action(page, 'library').click();
  const names = await action(page, 'library-card').evaluateAll(elements => Object.fromEntries(elements.map(element =>
    [element.querySelector('strong').textContent, element.dataset.value])));
  const draft = (await action(page, 'library-slot').evaluateAll(elements => elements.map(element =>
    element.querySelector('span:not(.library-art)').textContent))).map(name => names[name]);
  const wanted = { acorn_squirrel: 2, reed_frog: 3, ember_salamander: 3, sunseed_blessing: 3, tidal_recall: 3, fox: 3, lantern: 3 };
  const counts = () => draft.reduce((totals, id) => ({ ...totals, [id]: (totals[id] || 0) + 1 }), {});
  // Replace an excess card with a deficit card. Every intermediate deck remains
  // legal, including presets that already contain two copies of a desired card.
  for (let step = 0; step < 20; step += 1) {
    const held = counts();
    const replacement = Object.keys(wanted).find(id => (held[id] || 0) < wanted[id]);
    if (!replacement) break;
    const index = draft.findIndex(id => held[id] > (wanted[id] || 0));
    expect(index).toBeGreaterThanOrEqual(0);
    await page.locator(`[data-action="library-slot"][data-value="${index}"]`).click();
    await page.locator(`[data-action="library-card"][data-value="${replacement}"]`).click();
    draft[index] = replacement;
  }
  expect(counts()).toEqual(wanted);
  const savedRevision = actor.observed.progress.get(actor.observed.player.playerId).revision;
  await action(page, 'library-save').click();
  await expect(page.locator('.card-library')).toBeHidden();
  await expect.poll(() => actor.observed.progress.get(actor.observed.player.playerId).revision).toBeGreaterThan(savedRevision);
  await expect.poll(() => currentProgress(actor).chosenDeckId).toBe('custom');
  await expect.poll(() => currentProgress(actor).customDeck).toEqual(draft);
}

async function playExpansionChoice(actor, other, testInfo) {
  const page = actor.page, room = actor.observed.room;
  const ownBoard = room.players[room.youSeat].board;
  const options = room.selfLegalCardTargets.map(option => ({ ...option, card: room.selfHandCards[option.index] }));
  const targeted = options.find(option => ['reed_frog', 'ember_salamander'].includes(option.card) && option.targets.length)
    || options.find(option => option.card === 'sunseed_blessing' && option.targets.length)
    || options.find(option => option.card === 'tidal_recall' && option.targets.length && ownBoard.length >= 3);
  const untargeted = options.find(option => ['acorn_squirrel', 'fox'].includes(option.card) && option.untargeted && ownBoard.length < 3)
    || options.find(option => option.card === 'lantern' && option.untargeted)
    || options.find(option => option.card === 'reed_frog' && option.untargeted && ownBoard.length === 0);
  const chosen = targeted || untargeted;
  if (!chosen) return null;
  await page.locator(`#hand-semantics [data-hand-index="${chosen.index}"]`).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.card-command')).toBeVisible();
  if (!targeted) {
    await uiCommand(actor, () => action(page, 'play').click());
    await sync(actor, other);
    return { kind: 'setup' };
  }
  const target = chosen.targets[0];
  const before = structuredClone(room.players[target.seat].board.find(unit => unit.uid === target.target));
  const side = target.seat === room.youSeat ? 'friendly' : 'enemy';
  const capture = `${actor.label}-${(actor.metrics.newTargetActions?.length || 0) + 1}-${chosen.card}-${side}`;
  expect(side).toBe(['reed_frog', 'ember_salamander'].includes(chosen.card) ? 'enemy' : 'friendly');
  const advertised = chosen.targets.filter(item => item.target !== 'hero').map(item => `${item.seat}:${item.target}`).sort();
  await expect.poll(() => page.locator('.unit-label.targetable').evaluateAll(elements =>
    elements.map(element => `${element.dataset.seat}:${element.dataset.uid}`).sort())).toEqual(advertised);
  await safeScreenshot(page, testInfo, `${capture}-legal-targets`);
  await uiCommand(actor, () => page.locator(`.unit-label.targetable[data-seat="${target.seat}"][data-uid="${target.target}"]`).click());
  await sync(actor, other);
  expect(actor.observed.room.selfHandIds.includes(chosen.handId), 'the accepted targeted play consumed its own hand instance').toBe(false);
  const after = actor.observed.room.players[target.seat].board.find(unit => unit.uid === target.target);
  if (chosen.card === 'reed_frog') {
    expect(after.atk).toBe(Math.max(0, before.atk - 1));
    expect(after.hp).toBe(before.hp);
  } else if (chosen.card === 'ember_salamander') {
    if (before.hp <= 2) expect(after).toBeUndefined();
    else { expect(after.hp).toBe(before.hp - 2); expect(after.atk).toBe(before.atk); }
  } else if (chosen.card === 'sunseed_blessing') {
    expect(after.maxHp).toBe(before.maxHp + 2);
    expect(after.hp).toBe(Math.min(before.hp + 2, before.maxHp + 2));
  } else expect(after).toBeUndefined();
  actor.metrics.newTargetActions ??= [];
  const publicStats = unit => unit ? { attack: unit.atk, health: unit.hp, maximumHealth: unit.maxHp, shield: unit.shield } : null;
  actor.metrics.newTargetActions.push({ card: chosen.card, side, before: publicStats(before), after: publicStats(after) });
  await waitForBoard(actor);
  await safeScreenshot(page, testInfo, `${capture}-accepted-effect`);
  return { kind: side };
}

test('UI-built expansion decks apply one real friendly and one real enemy targeted effect', async ({ actors }, testInfo) => {
  test.setTimeout(180_000);
  testInfo.annotations.push({ type: 'coverage', description: 'Both players construct legal 20-card decks through visible two-click replacements. Own advertised legal actions guide real selections, highlighted targets must match their seat/UID, and resulting public attack/health/recall changes are verified. At most 24 alternating turns, with no opponent hand access, shuffle control, injected actions, or claim of a full match.' });
  const a = await actors('targets-A'), b = await actors('targets-B');
  for (const actor of [a, b]) {
    await calmAnimations(actor);
    await buildExpansionDeck(actor);
    await action(actor.page, 'match-setup').click();
  }
  await Promise.all([a, b].map(actor => action(actor.page, 'match').click()));
  await Promise.all([a, b].map(actor => expect(action(actor.page, 'opening-confirm')).toBeVisible()));
  await confirmOpening(a, b);
  const seen = new Set();
  for (let turn = 0; turn < 24 && seen.size < 2; turn += 1) {
    const actor = [a, b].find(item => item.observed.room.youSeat === a.observed.room.activeSeat), other = actor === a ? b : a;
    await actor.page.bringToFront();
    for (let move = 0; move < 12 && seen.size < 2; move += 1) {
      await waitForBoard(actor);
      if (actor.observed.room.phase === 'finished') break;
      const played = await playExpansionChoice(actor, other, testInfo);
      if (!played) break;
      if (played.kind !== 'setup') seen.add(played.kind);
    }
    if (seen.size === 2 || actor.observed.room.phase === 'finished') break;
    await uiCommand(actor, () => action(actor.page, 'end').click());
    await sync(a, b);
  }
  expect([...seen].sort(), 'natural UI play must actually cover both target directions; otherwise this is an explicit coverage gap').toEqual(['enemy', 'friendly']);
  for (const actor of [a, b]) {
    expect(actor.observed.errors).toEqual([]);
    expect(actor.observed.room.assisted).toBe(false);
  }
});

test('simulated unavailable WebGL uses the real CPU wardrobe and responsive live hand', async ({ actors }, testInfo) => {
  test.setTimeout(120_000);
  testInfo.annotations.push({ type: 'coverage', description: 'Compatibility simulation only: an isolated Chromium context reports null for WebGL contexts while native 2D remains untouched. The real CPU renderer opens/reveals a skin and responds to live-match hand pointer and keyboard input. A short continuous RAF interval series and observed UI acknowledgement durations are diagnostic samples, not device FPS, real GPU-absence evidence or a performance pass.' });
  const actor = await actors('simulated-no-webgl', { simulateMissingWebGL: true, viewport: { width: 640, height: 740 } });
  const other = await actors('cpu-peer');
  const page = actor.page;
  await calmAnimations(actor);
  await calmAnimations(other);
  await page.bringToFront();
  await action(page, 'wardrobe').click();
  await expect(page.locator('.hero-preview canvas')).toHaveAttribute('data-renderer', /CPU/);
  await skin(page, 'mode', 'test').click();
  const intervals = page.evaluate(() => new Promise(resolve => {
    const samples = []; let previous;
    function frame(now) {
      if (previous !== undefined) samples.push(now - previous);
      previous = now;
      if (samples.length === 24) resolve(samples);
      else requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }));
  const openedAt = Date.now();
  await skin(page, 'open', 1).click();
  await expect(page.locator('.skin-source')).toContainText('已揭开 0/1');
  const savedAt = Date.now();
  await skin(page, 'reveal').click();
  await expect(page.locator('.skin-source')).toContainText('已揭开 1/1');
  actor.metrics.cpuInteractionSample = { openToSavedUiMs: savedAt - openedAt, revealToSavedUiMs: Date.now() - savedAt };
  actor.metrics.cpuRafSample = { intervalsMs: await intervals, includes: 'visible wardrobe open/reveal UI; scheduling includes application work, no frame-rate threshold asserted' };
  expect(actor.metrics.cpuRafSample.intervalsMs).toHaveLength(24);
  expect(actor.metrics.cpuRafSample.intervalsMs.every(value => value > 0 && Number.isFinite(value))).toBe(true);
  await expect(page.locator('.hero-preview canvas')).toHaveAttribute('data-renderer', /CPU/);
  await expect(page.locator('.hero-preview canvas')).toHaveAttribute('data-model-count', '1');
  await expect(page.locator('.hero-preview canvas')).toHaveAttribute('data-model-quality', 'low');
  await safeScreenshot(page, testInfo, 'cpu-skin-revealed');
  await skin(page, 'finish').click();
  await skin(page, 'close').click();
  await matchPair(actor, other);
  await confirmOpening(actor, other);
  if (actor.observed.room.activeSeat !== actor.observed.room.youSeat) {
    await waitForBoard(other);
    await uiCommand(other, () => action(other.page, 'end').click());
    await sync(actor, other);
  }
  await expect(page.locator('#hand-canvas')).toHaveAttribute('data-renderer', /CPU/);
  await expect(page.locator('#arena')).toHaveAttribute('data-renderer', /CPU/);
  await expect(page.locator('#arena')).toHaveAttribute('data-arena-surface', 'plain');
  const selectedAt = Date.now();
  await canvasAndKeyboard(actor, testInfo);
  actor.metrics.cpuInteractionSample.pointerAndKeyboardMs = Date.now() - selectedAt;
  expect(actor.metrics.canvasPointerSelection).toBe(true);
  expect(actor.metrics.keyboardDescriptionAndSelection).toBe(true);
  await safeScreenshot(page, testInfo, 'cpu-live-match-hand');
  expect(actor.observed.room.assisted).toBe(false);
});
const viewports = [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 844, height: 390 }];

/** Real layout and hit testing only. Scroll each control into view, then ensure
 * its centre receives the pointer and it has a 44px target in both dimensions.
 * This catches occluding sticky panels as well as undersized controls. */
async function touchTargets(page, controls) {
  for (let index = 0, count = await controls.count(); index < count; index += 1) {
    const control = controls.nth(index);
    if (!await control.isVisible() || !await control.isEnabled()) continue;
    await control.scrollIntoViewIfNeeded();
    await expect(control).toBeInViewport();
    const size = await control.evaluate(element => {
      const b = element.getBoundingClientRect();
      const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      return { width: b.width, height: b.height, hit: element === hit || element.contains(hit), control: element.dataset.action || element.dataset.skinAction || element.tagName };
    });
    expect(size.width, `${size.control} interactive width`).toBeGreaterThanOrEqual(44);
    expect(size.height, `${size.control} interactive height`).toBeGreaterThanOrEqual(44);
    expect(size.hit, `${size.control} centre is not occluded by another element`).toBe(true);
  }
  const sizes = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth }));
  expect(sizes.content).toBeLessThanOrEqual(sizes.viewport + 2);
}

async function reloadSaved(actor) {
  const sessions = actor.observed.sessions;
  await actor.page.reload();
  await expect.poll(() => actor.observed.sessions).toBeGreaterThan(sessions);
  await expect(actor.page.locator('.connection')).toHaveClass(/online/);
}

/** Passive DOM + browser Resource Timing evidence, without interception,
 * fabricated latency, storage mutation, or game internals. Only timestamps and
 * the public sealed/revealed state are retained. */
async function observeOpeningOrder(page) {
  await page.evaluate(() => {
    const root = document.querySelector('#wardrobe-root');
    window.__skinPresentationEvidence = [];
    let previous = '';
    const observer = new MutationObserver(() => {
      const stage = root.querySelector('.hero-preview');
      const state = root.classList.contains('skin-opening') ? stage?.classList.contains('sealed') ? 'sealed' : 'revealed' : 'closed';
      if (state === previous) return;
      previous = state;
      if (state === 'closed') return;
      const saves = performance.getEntriesByType('resource').filter(entry => new URL(entry.name).pathname === '/api/progress/skins');
      window.__skinPresentationEvidence.push({ state, at: performance.now(), completedResponses: saves.length, committedResponseEnd: saves.at(-1)?.responseEnd || 0 });
    });
    observer.observe(root, { childList: true, subtree: true, attributes: true });
  });
}

test('three visible study questions earn daily gifts and one official skin survives registration', async ({ actors }, testInfo) => {
  test.setTimeout(120_000);
  testInfo.annotations.push({ type: 'coverage', description: 'Three real distinct study questions with foreground reading/feedback earn warmup, same-unit and newcomer rewards. Official one-pull commits before sealed/revealed presentation, spends once, equips and survives guest registration and reload. No clock changes or reward grants.' });
  const actor = await actors('earned-skin');
  const page = actor.page;
  await calmAnimations(actor);
  await prepareMatch(actor);
  await action(page, 'close-panel').click();
  expect(journey(actor).skinTickets).toBe(0);
  const questions = [];
  for (let i = 0; i < 3; i += 1) questions.push(await studyOne(actor));
  expect(new Set(questions).size).toBe(3);
  await expect.poll(() => journey(actor).newcomerGranted).toBe(true);
  await expect.poll(() => journey(actor).skinTickets).toBe(2);
  expect(currentProgress(actor).collection.earned.dust).toBe(5);
  const activeDay = Object.values(journey(actor).days).find(day => questions.every(id => day.qids.includes(id)));
  expect(activeDay?.claimed).toEqual(expect.arrayContaining(['daily_warmup', 'daily_apply']));
  expect(activeDay?.claimed).not.toContain('daily_practice');
  await action(page, 'daily').click();
  await expect(page.locator('.daily-task.complete')).toHaveCount(2);
  await expect(page.locator('.daily-wallet')).toContainText('造型券 2');
  await safeScreenshot(page, testInfo, 'desktop-earned-daily-gifts');
  await action(page, 'wardrobe').last().click();
  await observeOpeningOrder(page);
  const tickets = journey(actor).skinTickets;
  await skin(page, 'open', 1).click();
  await expect(page.locator('.skin-source')).toContainText('已揭开 0/1');
  await expect.poll(() => journey(actor).openings.official?.count).toBe(1);
  const batch = structuredClone(journey(actor).openings.official);
  expect(journey(actor).skinTickets).toBe(tickets - 1);
  expect(batch.revealed).toBe(0);
  await expect(page.locator('.hero-preview')).toHaveClass(/sealed/);
  await skin(page, 'reveal').click();
  await expect(page.locator('.skin-source')).toContainText('已揭开 1/1');
  await expect.poll(() => journey(actor).openings.official?.revealed).toBe(1);
  const order = await page.evaluate(() => window.__skinPresentationEvidence);
  expect(order.map(item => item.state)).toEqual(['sealed', 'revealed']);
  expect(order.map(item => item.completedResponses)).toEqual([1, 2]);
  for (const item of order) {
    expect(item.committedResponseEnd, 'an actual saved HTTP response preceded presentation').toBeGreaterThan(0);
    expect(item.at).toBeGreaterThanOrEqual(item.committedResponseEnd);
  }
  await safeScreenshot(page, testInfo, 'official-skin-revealed-after-save');
  await skin(page, 'finish').click();
  await expect.poll(() => journey(actor).openings.official).toBe(null);
  const won = batch.results[0].skinId;
  await skin(page, 'select', won).click();
  await skin(page, 'equip').click();
  await expect.poll(() => journey(actor).equipped).toEqual({ mode: 'official', skinId: won });
  await skin(page, 'close').click();
  const preserved = structuredClone(journey(actor));
  await register(actor, fictionalUsername('Reward'));
  await reloadSaved(actor);
  expect(journey(actor)).toEqual(preserved);
  expect(actor.observed.skinWrites.filter(write => write.kind === 'open')).toEqual([{ kind: 'open', mode: 'official', count: 1 }]);
  await action(page, 'wardrobe').click();
  await expect(skin(page, 'select', won)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.skin-detail')).toContainText('正式收藏 · 正在使用');
  await safeScreenshot(page, testInfo, 'registered-official-skin-retained');
});

test('twenty sequential wardrobe previews and a resumable test ten-pull fit compact viewports', async ({ actors }, testInfo) => {
  test.setTimeout(150_000);
  testInfo.annotations.push({ type: 'coverage', description: 'Twenty distinct reward catalogue previews are selected sequentially with one preview canvas. Test ten-pull partially reveals, exits, reloads the exact saved batch, reveals all and archives without changing the official wallet. Daily, wardrobe and reveal controls are hit-tested at 320/390 portrait and 844x390 landscape; screenshots require independent visual review.' });
  const actor = await actors('test-wardrobe', { hasTouch: true });
  const page = actor.page;
  await calmAnimations(actor);
  const official = officialWallet(actor);
  await action(page, 'wardrobe').click();
  const catalogue = await skin(page, 'select').evaluateAll(elements => elements.map(element => ({
    id: element.dataset.value, name: element.querySelector('strong').textContent,
    thumbnail: element.querySelector('img').getAttribute('src'),
  })));
  expect(catalogue).toHaveLength(21);
  expect(new Set(catalogue.map(item => item.id)).size).toBe(21);
  expect(new Set(catalogue.map(item => item.thumbnail)).size).toBe(21);
  for (const [index, item] of catalogue.filter(item => item.id !== 'forest_apprentice').entries()) {
    await skin(page, 'select', item.id).click();
    await expect(page.locator('.hero-caption')).toHaveText(item.name);
    await expect(page.locator('.hero-preview canvas')).toHaveCount(1);
    const canvas = page.locator('.hero-preview canvas');
    await expect(canvas).toHaveAttribute('data-skin-id', item.id);
    await expect(canvas).toHaveAttribute('data-model-count', '1');
    await expect(canvas).not.toHaveAttribute('data-renderer', 'unavailable');
    const renderer=await canvas.getAttribute('data-renderer');
    const quality=await canvas.getAttribute('data-model-quality');
    const triangles=Number(await canvas.getAttribute('data-triangles'));
    expect(quality).toBe(renderer.startsWith('CPU') ? 'low' : 'medium');
    expect(triangles).toBeGreaterThan(0);
    expect(triangles).toBeLessThanOrEqual(quality === 'low' ? 2100 : 5200);
    (actor.metrics.heroPreviewModels ||= []).push({id:item.id,renderer,quality,triangles,modelCount:Number(await canvas.getAttribute('data-model-count'))});
    expect(await page.locator('.hero-preview').evaluate(element=>Number(getComputedStyle(element,'::after').opacity))).toBe(0);
    await expect(page.locator('.hero-preview-fallback')).toHaveAttribute('src', `/assets/heroes/${item.id}/portrait.webp${item.id === 'leaf_ranger' ? '?v=ranger-seams-2026-10-09' : ''}`);
    await page.locator('.hero-preview').scrollIntoViewIfNeeded();
    await safeScreenshot(page, testInfo, `catalogue-${String(index + 1).padStart(2, '0')}-${item.id}`);
  }
  await skin(page, 'close').click();
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    const size = `${viewport.width}x${viewport.height}`;
    await action(page, 'daily').click();
    await touchTargets(page, page.locator('.daily-panel button'));
    await page.locator('.daily-panel h2').scrollIntoViewIfNeeded();
    await safeScreenshot(page, testInfo, `${size}-daily`);
    await page.locator('.daily-panel [data-action="close-panel"]').click();
    await action(page, 'wardrobe').click();
    await touchTargets(page, page.locator('.wardrobe-heading button, .wardrobe-modes button, .skin-wallet button, .skin-pack-actions button, .skin-detail button'));
    await page.locator('.wardrobe-heading').scrollIntoViewIfNeeded();
    await safeScreenshot(page, testInfo, `${size}-wardrobe`);
    await skin(page, 'close').click();
  }
  await page.setViewportSize(viewports[0]);
  await action(page, 'wardrobe').click();
  await skin(page, 'mode', 'test').click();
  await skin(page, 'open', 10).click();
  await expect(page.locator('.skin-source')).toContainText('已揭开 0/10');
  // The local opening renders before its asynchronous persisted-progress
  // response reaches the independent observer. Require that real save first.
  await expect.poll(() => journey(actor).openings.test?.count, { timeout: 12_000 }).toBe(10);
  const batch = structuredClone(journey(actor).openings.test);
  expect(batch.count).toBe(10);
  await skin(page, 'reveal').click();
  await expect(page.locator('.skin-source')).toContainText('已揭开 1/10');
  await expect.poll(() => journey(actor).openings.test?.revealed).toBe(1);
  await skin(page, 'later').click();
  await expect(skin(page, 'resume')).toBeVisible();
  await expect(skin(page, 'open')).toHaveCount(0);
  await skin(page, 'close').click();
  await reloadSaved(actor);
  await action(page, 'wardrobe').click();
  await skin(page, 'mode', 'test').click();
  expect(journey(actor).openings.test).toEqual({ ...batch, revealed: 1 });
  await skin(page, 'resume').click();
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await touchTargets(page, page.locator('.skin-index button, .skin-reveal-actions button, .wardrobe-heading button'));
    await safeScreenshot(page, testInfo, `${viewport.width}x${viewport.height}-same-partial-batch`);
  }
  await skin(page, 'all').click();
  await expect(page.locator('.skin-source')).toContainText('已揭开 10/10');
  expect(journey(actor).openings.test).toEqual({ ...batch, revealed: 1023 });
  await safeScreenshot(page, testInfo, 'test-ten-revealed');
  await skin(page, 'finish').click();
  await expect.poll(() => journey(actor).openings.test).toBe(null);
  expect(journey(actor).recent.find(item => item.id === batch.id)).toEqual({ ...batch, revealed: 1023 });
  expect(officialWallet(actor)).toEqual(official);
  expect(actor.observed.skinWrites.filter(write => write.kind === 'open')).toEqual([{ kind: 'open', mode: 'test', count: 10 }]);
  // Use the existing free test redemption UI, never inject ownership or room state.
  await skin(page, 'select', 'leaf_ranger').click();
  if (!journey(actor).test.owned.includes('leaf_ranger')) await skin(page, 'redeem').click();
  await expect.poll(() => journey(actor).test.owned.includes('leaf_ranger')).toBe(true);
  await skin(page, 'equip').click();
  await expect.poll(() => journey(actor).equipped).toEqual({mode:'test',skinId:'leaf_ranger'});
  await skin(page, 'close').click();
  const peer=await actors('ranger-wardrobe-peer');await calmAnimations(peer);
  await matchPair(actor,peer);await confirmOpening(actor,peer);await sync(actor,peer);
  expect(actor.observed.room.selfSkinId).toBe('leaf_ranger');
  expect(peer.observed.room.opponentSkinId).toBe('leaf_ranger');
  actor.metrics.equippedRanger = {selfSkinId:actor.observed.room.selfSkinId,peerOpponentSkinId:peer.observed.room.opponentSkinId,revision:actor.observed.room.revision};
  for(const viewport of [{width:1280,height:800},{width:844,height:390},{width:320,height:568}]){
    await page.setViewportSize(viewport);await page.bringToFront();await waitForBoard(actor);
    await safeScreenshot(page,testInfo,`${viewport.width}x${viewport.height}-redeemed-ranger-real-match`);
  }
  expect(officialWallet(actor)).toEqual(official);
});

test('three one-click presets and a two-click custom swap retain all thirty-six free card details', async ({ actors }, testInfo) => {
  test.setTimeout(90_000);
  const actor = await actors('card-library');
  const page = actor.page;
  await calmAnimations(actor);
  await action(page, 'library').click();
  await safeScreenshot(page, testInfo, 'desktop-presets-and-deck-slots');
  const presets = await action(page, 'library-equip-preset').evaluateAll(elements => elements.map(element => element.dataset.value));
  expect(presets).toEqual(['grove', 'ember', 'moon']);
  const savedPresets = [];
  for (const id of presets) {
    const visibleSlots = await action(page, 'library-slot').allTextContents();
    expect(visibleSlots).toHaveLength(20);
    const savedRevision = actor.observed.progress.get(actor.observed.player.playerId).revision;
    await page.locator(`[data-action="library-equip-preset"][data-value="${id}"]`).click();
    await expect(page.locator('.card-library')).toBeHidden();
    await expect.poll(() => actor.observed.progress.get(actor.observed.player.playerId).revision).toBeGreaterThan(savedRevision);
    await expect.poll(() => currentProgress(actor).chosenDeckId).toBe('custom');
    savedPresets.push([...currentProgress(actor).customDeck]);
    await action(page, 'library').click();
  }
  expect(new Set(savedPresets.map(deck => JSON.stringify(deck))).size).toBe(3);
  const before = [...currentProgress(actor).customDeck];
  await page.locator('[data-action="library-slot"][data-value="0"]').click();
  await page.locator('[data-action="library-card"][data-value="glass_snail"]').click();
  await expect(page.locator('.deck-swap-hint')).toContainText('先点下方一张旧卡');
  await expect(action(page, 'library-slot')).toHaveCount(20);
  await expect(page.locator('[data-action="library-slot"][data-value="0"]')).toContainText('琉璃蜗牛');
  await action(page, 'library-save').click();
  await expect(page.locator('.card-library')).toBeHidden();
  await expect.poll(() => currentProgress(actor).customDeck).toEqual(['glass_snail', ...before.slice(1)]);
  await reloadSaved(actor);
  expect(currentProgress(actor).chosenDeckId).toBe('custom');
  expect(currentProgress(actor).customDeck).toEqual(['glass_snail', ...before.slice(1)]);
  await action(page, 'library').click();
  await page.locator('[data-action="library-tab"][data-value="cards"]').click();
  const cards = await action(page, 'library-card').evaluateAll(elements => elements.map(element => ({
    id: element.dataset.value, name: element.querySelector('strong').textContent,
  })));
  expect(cards).toHaveLength(36);
  expect(new Set(cards.map(card => card.id)).size).toBe(36);
  for (const card of cards) {
    await page.locator(`[data-action="library-card"][data-value="${card.id}"]`).click();
    await expect(page.locator('.library-detail h3')).toHaveText(card.name);
    await expect(page.locator('.library-detail .card-effect')).not.toBeEmpty();
    await expect(page.locator('.library-detail')).toContainText('试试看');
  }
  actor.metrics.cardDetailsReviewed = cards.length;
  await page.locator('[data-action="library-card"][data-value="glass_snail"]').click();
  await page.locator('.library-detail').scrollIntoViewIfNeeded();
  await safeScreenshot(page, testInfo, 'new-card-complete-rule-detail');
});

// Independently authored language expectations, matched only against the English
// sentence and options actually shown in the quiz. No question bank, question ID,
// answer key, correctOptionId, or unshown network text is read by this test.
const grammarExercises = [
  [/Not until the team reran/, 'did it recognize'],
  [/Had the archive not preserved/, 'The archive preserved the drafts, making it possible to trace the argument’s development.'],
  [/committee recommends/, 'be excluded'],
  [/usefulness of the comparison depends/, 'whether'],
  [/discussion section explains/, 'why the estimates diverged'],
  [/By the time the final report/, 'had already withdrawn'],
  [/Having checked each entry/, 'the researchers excluded six incomplete records from the comparison'],
  [/group of studies has already been identified/, 'The studies, which used the same sampling frame, reached different conclusions.'],
  [/cannot compensate for systematic omissions/, 'Sophisticated though the model may be'],
  [/Scarcely had the discussion begun/, 'when'],
  [/statement with the required scope of negation/, 'Not all reviewers endorsed the proposal.'],
  [/assistant need not have anonymized/, 'The assistant anonymized the records, but doing so was unnecessary.'],
];

async function selectGrammar(actor) {
  await action(actor.page, 'match-setup').click();
  await actor.page.locator('[data-action="question-bank"][data-value="teacher-academic"]').click();
  await actor.page.locator('#teacher-course').selectOption('grammar');
}

async function answerDraw(actor, other, outcome, testInfo, { reconnect = false } = {}) {
  const page = actor.page;
  await page.bringToFront();
  await waitForBoard(actor);
  const before = structuredClone(actor.observed.room);
  const eligible = before.selfDrawEnglish.eligibleHandId;
  const index = before.selfHandIds.indexOf(eligible);
  expect(index).toBeGreaterThanOrEqual(0);
  expect(before.selfDrawEnglish.canBegin).toBe(true);
  await uiCommand(actor, () => action(page, 'draw-begin').click());
  await expect(action(page, 'draw-cancel')).toBeVisible();
  await expect.poll(() => actor.observed.room.selfDrawEnglish.chargesLeft).toBe(before.selfDrawEnglish.chargesLeft - 1);
  const pending = structuredClone(actor.observed.privateChallenge);
  expect(pending.purpose).toBe('draw');
  expect(pending.handId === eligible, 'challenge belongs to the eligible own hand instance').toBe(true);
  if (reconnect) {
    const count = actor.observed.commands.filter(command => command.type === 'draw.begin').length;
    await reloadSaved(actor);
    await expect(action(page, 'draw-cancel')).toBeVisible();
    expect(JSON.stringify(actor.observed.privateChallenge) === JSON.stringify(pending), 'same private challenge, instance and deadline after reload').toBe(true);
    expect(actor.observed.room.selfDrawEnglish.chargesLeft).toBe(before.selfDrawEnglish.chargesLeft - 1);
    expect(actor.observed.commands.filter(command => command.type === 'draw.begin')).toHaveLength(count);
    await sync(actor, other);
  }
  if (outcome === 'cancelled') {
    await uiCommand(actor, () => action(page, 'draw-cancel').click());
    await expect(page.locator('.quiz')).toBeHidden();
  } else {
    const sentence = await page.locator('.quiz .english').innerText();
    const expected = grammarExercises.find(([pattern]) => pattern.test(sentence))?.[1];
    expect(Boolean(expected), 'visible grammar exercise is covered by the independently authored language fixture').toBe(true);
    const options = action(page, 'answer');
    const optionTexts = await options.evaluateAll(elements => elements.map(element => element.childNodes.length > 1
      ? [...element.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent).join('').trim()
      : element.textContent.trim()));
    const correct = optionTexts.indexOf(expected);
    expect(correct, 'expected English option is visibly present').toBeGreaterThanOrEqual(0);
    const choice = outcome === 'correct' ? correct : optionTexts.findIndex((_, i) => i !== correct);
    await sleep(2100);
    await uiCommand(actor, () => options.nth(choice).click());
    await expect(page.locator('.battle-recap')).toContainText(outcome === 'correct' ? '本回合费用减1' : '原牌保留，费用不变');
    await sleep(1300);
    await safeScreenshot(page, testInfo, `draw-${outcome}-feedback`);
    await action(page, 'quiz-close').click();
  }
  await sync(actor, other);
  expect(actor.observed.privateFeedback?.purpose).toBe('draw');
  await expect.poll(() => actor.observed.privateFeedback?.outcome).toBe(outcome);
  expect(actor.observed.privateFeedback?.handId === eligible, 'feedback belongs to this own hand instance').toBe(true);
  const after = actor.observed.room;
  expect(JSON.stringify(after.selfHandIds) === JSON.stringify(before.selfHandIds), 'same held instances after answer/cancel').toBe(true);
  expect(JSON.stringify(after.selfHandCards) === JSON.stringify(before.selfHandCards), 'same held cards after answer/cancel').toBe(true);
  const costs = [...before.selfHandCosts];
  if (outcome === 'correct') costs[index] = Math.max(0, costs[index] - 1);
  expect(after.selfHandCosts).toEqual(costs);
  expect(after.players).toEqual(before.players);
  expect(after.selfRitualsLeft).toBe(before.selfRitualsLeft);
  expect(after.selfDrawEnglish.chargesLeft).toBe(before.selfDrawEnglish.chargesLeft - 1);
  await expect(action(page, 'draw-begin')).toHaveCount(0);
  for (const ritual of ['insight', 'spark', 'bloom']) await expect(page.locator(`[data-action="ritual"][data-value="${ritual}"]`)).toBeDisabled();
  const hand = page.locator(`#hand-semantics [data-hand-index="${index}"]`);
  await expect(hand).toHaveAttribute('aria-label', new RegExp(`，${costs[index]}能量`));
  await hand.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.card-resources')).toContainText(`费用 ${costs[index]}`);
  await action(page, 'clear').click();
  return { handId: eligible, originalCost: before.selfHandCosts[index] };
}

test('two real players charge only their own natural draw twice with correct wrong cancel and reconnect', async ({ actors }, testInfo) => {
  test.setTimeout(150_000);
  testInfo.annotations.push({ type: 'coverage', description: 'Two isolated players reach their actual second/third own turns. Visible grammar answers cover correct and wrong, plus a UI cancel; pending reload preserves question/deadline/reservation. Only the eligible held instance changes cost and it expires next turn. Both two-use caps and original ritual charges are checked. Compact hand/action screenshots and 44px control hit tests use the same live match.' });
  const a = await actors('draw-A');
  const b = await actors('draw-B');
  for (const actor of [a, b]) {
    await calmAnimations(actor);
    await selectGrammar(actor);
  }
  await Promise.all([a, b].map(actor => action(actor.page, 'match').click()));
  await Promise.all([a, b].map(actor => expect(action(actor.page, 'opening-confirm')).toBeVisible()));
  await confirmOpening(a, b);
  const order = [a, b].sort((left, right) => (left.observed.room.youSeat === left.observed.room.activeSeat ? -1 : 1));
  const boosted = new Map();
  const ownTurns = new Map([[a, 0], [b, 0]]);
  for (let turn = 0; turn < 6; turn += 1) {
    const actor = [a, b].find(item => item.observed.room.youSeat === a.observed.room.activeSeat);
    const other = actor === a ? b : a;
    const nth = ownTurns.get(actor) + 1;
    ownTurns.set(actor, nth);
    await actor.page.bringToFront();
    await waitForBoard(actor);
    if (nth === 1) await expect(action(actor.page, 'draw-begin')).toHaveCount(0);
    if (nth === 2) {
      if (actor === order[0]) {
        for (const viewport of [...viewports, { width: 320, height: 568 }]) {
          await actor.page.setViewportSize(viewport);
          await expect(action(actor.page, 'draw-begin')).toBeVisible();
          await touchTargets(actor.page, actor.page.locator('.rituals button'));
          await safeScreenshot(actor.page, testInfo, `${viewport.width}x${viewport.height}-optional-draw-action`);
        }
        await actor.page.setViewportSize({ width: 1280, height: 800 });
      }
      const outcome = actor === order[0] ? 'correct' : 'cancelled';
      boosted.set(actor, await answerDraw(actor, other, outcome, testInfo, { reconnect: actor === order[0] }));
    }
    if (nth === 3) {
      const earlier = boosted.get(actor), index = actor.observed.room.selfHandIds.indexOf(earlier.handId);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(actor.observed.room.selfHandCosts[index]).toBe(earlier.originalCost);
      await answerDraw(actor, other, actor === order[0] ? 'wrong' : 'correct', testInfo);
      expect(actor.observed.room.selfDrawEnglish.chargesLeft).toBe(0);
      expect(actor.observed.room.selfRitualsLeft).toBe(4);
    }
    if (turn === 2) {
      for (const viewport of [...viewports, { width: 320, height: 568 }]) {
        await actor.page.setViewportSize(viewport);
        await touchTargets(actor.page, actor.page.locator('.rituals button'));
        const first = actor.page.locator('#hand-semantics [data-hand-index]').first();
        await first.focus();
        await actor.page.keyboard.press('Enter');
        await expect(actor.page.locator('.card-command')).toBeVisible();
        await touchTargets(actor.page, actor.page.locator('.card-command button'));
        await safeScreenshot(actor.page, testInfo, `${viewport.width}x${viewport.height}-hand-and-card-actions`);
        await action(actor.page, 'clear').click();
      }
      await actor.page.setViewportSize({ width: 1280, height: 800 });
    }
    await uiCommand(actor, () => action(actor.page, 'end').click());
    await sync(a, b);
  }
  for (const actor of [a, b]) {
    expect(actor.observed.commands.filter(command => command.type === 'draw.begin')).toHaveLength(2);
    expect(actor.observed.errors).toEqual([]);
    expect(actor.observed.room.assisted).toBe(false);
  }
});

function boardReadOnlySnapshot(actor) {
  const room = actor.observed.room;
  return structuredClone({
    revision: room.revision, players: room.players,
    handIds: room.selfHandIds, handCards: room.selfHandCards,
    handCosts: room.selfHandCosts, draw: room.selfDrawEnglish,
    rituals: room.selfRitualsLeft,
  });
}

async function verifyBoardUnchanged(actor, before, commandsBefore) {
  // Wait for two presentation frames after the real input/close, so a queued
  // compatibility click is not mistaken for an already-settled interaction.
  await actor.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(JSON.stringify(boardReadOnlySnapshot(actor)) === JSON.stringify(before),
    'inspection preserves revision, both public boards, own mana/hand/costs, ready state and English charges').toBe(true);
  expect(actor.observed.commands.slice(commandsBefore).map(command => command.type),
    'viewing or dismissing details must not send a game command').toEqual([]);
}

test('@interaction armed unit inspection by right click native touch and keyboard never spends an action', async ({ actors }, testInfo) => {
  test.setTimeout(150_000);
  testInfo.annotations.push({ type: 'coverage', description: 'Two real isolated players summon through visible UI and wait for a ready own unit. While attack is armed, own/enemy projected DOM labels open exact-instance details by right click and 520ms Chromium CDP touch hold; I/ContextMenu also inspect. Closing preserves selection, both boards, own mana/hand/ready and command count. One Escape from hand focus then clicking an enemy does not attack. This covers DOM labels and Chromium touch-event emulation, not physical touch hardware or direct 3D model picking.' });
  const a = await actors('inspection-A', { hasTouch: true });
  const b = await actors('inspection-B', { hasTouch: true });
  await calmAnimations(a); await calmAnimations(b);
  await matchPair(a, b); await confirmOpening(a, b);
  let inspector;
  for (let turn = 0; turn < 14; turn += 1) {
    const actor = [a, b].find(item => item.observed.room.youSeat === a.observed.room.activeSeat);
    const other = actor === a ? b : a;
    await actor.page.bringToFront();
    await waitForBoard(actor);
    const room = actor.observed.room;
    if (room.players[room.youSeat].board.some(unit => unit.ready) && room.players[1 - room.youSeat].board.length) {
      inspector = actor; break;
    }
    for (let move = 0; move < 8 && actor.observed.room.players[room.youSeat].board.length === 0; move += 1) {
      if (!await playOneVisibleCard(actor)) break;
      await sync(a, b); await waitForBoard(actor);
    }
    await uiCommand(actor, () => action(actor.page, 'end').click());
    await sync(a, b);
  }
  expect(Boolean(inspector), 'natural play produced a ready own unit and visible opponent unit within fourteen turns').toBe(true);
  const actor = inspector, page = actor.page, room = actor.observed.room;
  const own = room.players[room.youSeat].board.find(unit => unit.ready);
  const enemy = room.players[1 - room.youSeat].board[0];
  const label = unit => page.locator(`.unit-label[data-uid="${unit.uid}"]`);
  const client = await actor.context.newCDPSession(page);
  await page.evaluate(() => {
    const events = [], types = ['pointerdown', 'pointerup', 'contextmenu'];
    const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
    const record = event => {
      const control = event.target?.closest?.('[data-action="unit"]');
      events.push({
        type: event.type,
        eventClass: event instanceof PointerEvent ? 'PointerEvent' : event instanceof MouseEvent ? 'MouseEvent' : 'Event',
        button: number(event.button), buttons: number(event.buttons),
        pointerId: number(event.pointerId),
        pointerType: ['mouse', 'touch', 'pen', ''].includes(event.pointerType) ? event.pointerType : null,
        isPrimary: typeof event.isPrimary === 'boolean' ? event.isPrimary : null,
        targetUnitUid: control?.dataset.uid?.slice(0, 80) || null,
      });
      if (events.length > 96) events.shift();
    };
    for (const type of types) document.addEventListener(type, record, { capture: true, passive: true });
    // Plain, allowlisted public input metadata only. No Event objects, game
    // state, question content, session IDs, hand instances or DOM text survive.
    window.__finishInspectionInputEvidence = () => {
      for (const type of types) document.removeEventListener(type, record, true);
      delete window.__finishInspectionInputEvidence;
      return events;
    };
  });
  actor.metrics.inspectionGesture = { input: 'arm', side: 'own', targetUnitUid: own.uid };
  try {
    await label(own).click();
    await expect(page.locator('.target-command')).toBeVisible();
    await expect(label(enemy)).toHaveClass(/targetable/);
    const cases = [
      { input: 'right', unit: enemy, mine: false },
      { input: 'right', unit: own, mine: true },
      { input: 'touch', unit: enemy, mine: false },
      { input: 'touch', unit: own, mine: true },
      { input: 'i', unit: own, mine: true },
      { input: 'ContextMenu', unit: enemy, mine: false },
    ];
    for (const item of cases) {
      actor.metrics.inspectionGesture = { input: item.input, side: item.mine ? 'own' : 'enemy', targetUnitUid: item.unit.uid, phase: 'open' };
      if (item.input === 'touch') await page.setViewportSize({ width: 390, height: 844 });
      const control = label(item.unit);
      await expect(control).toBeInViewport();
      const publicName = (await control.getAttribute('aria-label')).split('，')[0];
      const before = boardReadOnlySnapshot(actor), commandsBefore = actor.observed.commands.length;
      if (item.input === 'right') await control.click({ button: 'right' });
      else if (item.input === 'touch') {
        const box = await control.boundingBox();
        await client.send('Input.dispatchTouchEvent', {
          type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1, radiusX: 2, radiusY: 2, force: 1 }],
        });
        try { await sleep(520); }
        finally { await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
      } else {
        await control.focus();
        await page.keyboard.press(item.input);
      }
      const dialog = page.locator('.card-info-dialog.board-card-info');
      await expect(dialog).toBeVisible();
      actor.metrics.inspectionGesture.phase = 'verify';
      await expect(dialog.locator('#card-info-title')).toHaveText(publicName);
      await expect(dialog.locator('.card-facts')).toContainText(`当前攻击 ${item.unit.atk}`);
      await expect(dialog.locator('.card-facts')).toContainText(`生命 ${item.unit.hp}/${item.unit.maxHp}`);
      await expect(dialog.locator('.unit-inspection-state')).toContainText(item.mine ? '我方伙伴' : '对方伙伴');
      await expect(dialog.locator('.unit-inspection-state')).toContainText(item.unit.shield ? '护盾：抵挡下一次伤害' : '当前没有护盾');
      await expect(dialog.locator('.unit-inspection-state')).toContainText('基础卡牌：');
      await expect(dialog.locator('.card-info-english')).not.toBeEmpty();
      await safeScreenshot(page, testInfo, `${item.input}-${item.mine ? 'own' : 'enemy'}-unit-details`);
      await action(page, 'card-info-close').click();
      await expect(dialog).toBeHidden();
      await expect(page.locator('.target-command')).toBeVisible();
      await expect(label(enemy)).toHaveClass(/targetable/);
      await verifyBoardUnchanged(actor, before, commandsBefore);
      actor.metrics.inspectionGesture.phase = 'closed-and-unchanged';
    }
    actor.metrics.inspectionGesture = { input: 'escape-from-hand-focus', side: 'enemy', targetUnitUid: enemy.uid, phase: 'cancel' };
    const before = boardReadOnlySnapshot(actor), commandsBefore = actor.observed.commands.length;
    await page.locator('#hand-semantics [data-hand-index]').first().focus();
    await page.keyboard.press('Escape');
    await expect(page.locator('.target-command')).toBeHidden();
    await expect(label(enemy)).not.toHaveClass(/targetable/);
    await label(enemy).click();
    await verifyBoardUnchanged(actor, before, commandsBefore);
    await safeScreenshot(page, testInfo, 'escape-cancelled-attack-from-hand-focus');
    actor.metrics.inspectionGesture.phase = 'completed-and-unchanged';
    actor.metrics.unitInspection = { rightClickOwn: true, rightClickEnemy: true, nativeTouchOwn: true, nativeTouchEnemy: true, holdMs: 520, keyboardI: true, keyboardContextMenu: true, escapeFromHandFocus: true };
    for (const participant of [a, b]) {
      expect(participant.observed.errors).toEqual([]);
      expect(participant.observed.room.assisted).toBe(false);
    }
  } finally {
    const events = await page.evaluate(() => window.__finishInspectionInputEvidence?.()).catch(() => null);
    actor.metrics.inspectionInputEvents = events || [];
    actor.metrics.inspectionEventsCaptured = Array.isArray(events);
    await client.detach();
  }
});
