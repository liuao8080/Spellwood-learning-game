import {
  test, expect, action, sleep, currentProgress, safeScreenshot,
  calmAnimations, prepareMatch, confirmOpening, sync, uiCommand, waitForBoard,
} from './helpers.mjs';

// Public catalogue choices only. The UI saves an ordinary legal deck; opening
// hands and subsequent draws remain random, with no engine or answer imports.
const deck = { mushroom_medic: 3, glass_snail: 3, sprout: 3, turtle: 3, lantern: 3, moon: 3, fox: 2 };
const cases = {
  mushroom_medic: { reason: '点受伤友方伙伴治疗', eligible: unit => unit.hp < unit.maxHp },
  glass_snail: { reason: '点无盾友方伙伴加盾', eligible: unit => !unit.shield },
};
const viewports = [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }];
const targetKey = target => `${target.seat}:${target.target}`;
const unitLabel = (page, seat, uid) => page.locator(`.unit-label[data-seat="${seat}"][data-uid="${uid}"]`);
const overlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.x, b.x) > 1 &&
  Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 1;
const contains = (outer, inner) => inner.x >= outer.x - 1 && inner.y >= outer.y - 1 &&
  inner.right <= outer.right + 1 && inner.bottom <= outer.bottom + 1;

async function buildDeck(actor) {
  const page = actor.page;
  await action(page, 'library').click();
  const names = await action(page, 'library-card').evaluateAll(elements => Object.fromEntries(elements.map(element =>
    [element.querySelector('strong').textContent, element.dataset.value])));
  const draft = (await action(page, 'library-slot').evaluateAll(elements => elements.map(element =>
    element.querySelector('span:not(.library-art)').textContent))).map(name => names[name]);
  const counts = () => draft.reduce((result, id) => ({ ...result, [id]: (result[id] || 0) + 1 }), {});
  expect(draft).toHaveLength(20);
  for (let step = 0; step < 20; step += 1) {
    const held = counts(), replacement = Object.keys(deck).find(id => (held[id] || 0) < deck[id]);
    if (!replacement) break;
    const index = draft.findIndex(id => held[id] > (deck[id] || 0));
    expect(index).toBeGreaterThanOrEqual(0);
    await page.locator(`[data-action="library-slot"][data-value="${index}"]`).click();
    await page.locator(`[data-action="library-card"][data-value="${replacement}"]`).click();
    draft[index] = replacement;
    expect(Object.values(counts()).every(count => count <= 3), 'each two-click replacement keeps the deck legal').toBe(true);
  }
  expect(counts()).toEqual(deck);
  const revision = actor.observed.progress.get(actor.observed.player.playerId).revision;
  await action(page, 'library-save').click();
  await expect(page.locator('.card-library')).toBeHidden();
  await expect.poll(() => actor.observed.progress.get(actor.observed.player.playerId).revision).toBeGreaterThan(revision);
  await expect.poll(() => currentProgress(actor).customDeck).toEqual(draft);
  await expect.poll(() => currentProgress(actor).chosenDeckId).toBe('custom');
}

function readOnlyState(actor) {
  const room = actor.observed.room;
  // Owner-only hand values are compared in memory and never emitted to artifacts.
  return JSON.stringify({ revision: room.revision, phase: room.phase, activeSeat: room.activeSeat,
    players: room.players, handIds: room.selfHandIds, handCards: room.selfHandCards,
    handCosts: room.selfHandCosts, draw: room.selfDrawEnglish, rituals: room.selfRitualsLeft });
}

async function selectCard(actor, index) {
  await actor.page.locator(`#hand-semantics [data-hand-index="${index}"]`).focus();
  await actor.page.keyboard.press('Enter');
  await expect(actor.page.locator('.card-command')).toBeVisible();
}

async function verifyTargets(actor, choice, card) {
  const room = actor.observed.room, advertised = choice.targets.map(targetKey).sort();
  const eligible = room.players[room.youSeat].board.filter(cases[card].eligible)
    .map(unit => `${room.youSeat}:${unit.uid}`).sort();
  expect(advertised.length, `${card} has a genuine conditioned target`).toBeGreaterThan(0);
  expect(choice.untargeted, 'a targeted arrival is not also offered as an untargeted play').toBe(false);
  expect(advertised, 'the authoritative list contains exactly the public friendly units meeting the condition').toEqual(eligible);
  await expect.poll(() => actor.page.locator('.unit-label.targetable').evaluateAll(elements =>
    elements.map(element => `${element.dataset.seat}:${element.dataset.uid}`).sort())).toEqual(advertised);
  await expect(actor.page.locator('.card-reason[role="status"]')).toHaveText(cases[card].reason);
  await expect(action(actor.page, 'play'), 'the highlighted target commits this card, without a separate Play button').toHaveCount(0);
}

async function reasonGeometry(actor, testInfo, card, viewport) {
  const page = actor.page;
  await page.setViewportSize(viewport);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.locator('.card-reason')).toHaveText(cases[card].reason);
  const geometry = await page.evaluate(() => {
    const rect = element => {
      const b = element.getBoundingClientRect();
      return { x: b.x, y: b.y, width: b.width, height: b.height, right: b.right, bottom: b.bottom };
    };
    const visible = element => {
      const style = getComputedStyle(element), box = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
    };
    const reason = document.querySelector('.card-reason'), body = reason.parentElement;
    const range = document.createRange(); range.selectNodeContents(reason);
    const textLines = [...range.getClientRects()].map(b => ({ x: b.x, y: b.y, right: b.right, bottom: b.bottom }));
    const bodyBox = rect(body);
    return {
      viewport: { width: innerWidth, height: innerHeight }, contentWidth: document.documentElement.scrollWidth,
      reason: rect(reason), command: rect(document.querySelector('.card-command')),
      // The body can scroll independently: command-bar containment alone would
      // miss a reason clipped behind that body's visible reading window.
      visibleBody: { x: bodyBox.x + body.clientLeft, y: bodyBox.y + body.clientTop,
        right: bodyBox.x + body.clientLeft + body.clientWidth, bottom: bodyBox.y + body.clientTop + body.clientHeight },
      textLines,
      neighbours: [...document.querySelectorAll('.card-command > div > b, .card-resources, .card-command > button, #hand-canvas, .unit-label, .hero-panel')]
        .filter(visible).map(element => ({ name: element.dataset.action || element.id || element.className, ...rect(element) })),
    };
  });
  actor.metrics.conditionedTargets.layouts.push({ card, ...geometry });
  const label = `${card}-${viewport.width}x${viewport.height}-conditioned-reason`;
  await safeScreenshot(page, testInfo, label);
  expect(geometry.contentWidth).toBeLessThanOrEqual(viewport.width + 1);
  const screen = { x: 0, y: 0, right: viewport.width, bottom: viewport.height };
  expect(contains(screen, geometry.reason), `${label}: reason is inside the viewport`).toBe(true);
  expect(contains(geometry.command, geometry.reason), `${label}: reason is inside its command bar`).toBe(true);
  expect(contains(geometry.visibleBody, geometry.reason), `${label}: the full reason is not clipped by its scrollable body`).toBe(true);
  expect(geometry.textLines.length).toBeGreaterThan(0);
  for (const line of geometry.textLines)
    expect(contains(geometry.visibleBody, line), `${label}: every text line fits the visible reading window`).toBe(true);
  for (const neighbour of geometry.neighbours)
    expect(overlap(geometry.reason, neighbour), `${label}: reason does not overlap ${neighbour.name}`).toBe(false);
}

async function exerciseConditionedCard(actor, other, choice, card, testInfo) {
  const page = actor.page, originalViewport = page.viewportSize();
  const beforeSelection = readOnlyState(actor), beforeCommands = actor.observed.commands.length;
  const otherCommands = other.observed.commands.length;
  await selectCard(actor, choice.index);
  const name = await page.locator('.card-command > div > b').innerText();
  await verifyTargets(actor, choice, card);
  for (const viewport of viewports) {
    await reasonGeometry(actor, testInfo, card, viewport);
    await verifyTargets(actor, choice, card);
    // Keyboard inspection is a real supported entry even in compact layouts
    // where the card-info button may be hidden. Escape preserves selection.
    await page.locator(`#hand-semantics [data-hand-index="${choice.index}"]`).focus();
    await page.keyboard.press('i');
    await expect(page.locator('.card-info-dialog')).toBeVisible();
    await expect(page.locator('#card-info-title')).toHaveText(name);
    await page.keyboard.press('Escape');
    await expect(page.locator('.card-info-dialog')).toBeHidden();
    await verifyTargets(actor, choice, card);
  }
  await action(page, 'clear').click();
  await expect(page.locator('.card-command')).toBeHidden();
  await expect(page.locator('.unit-label.targetable')).toHaveCount(0);
  await sleep(250); // Allow an accidental trailing command to become observable.
  expect(readOnlyState(actor) === beforeSelection, 'selection, orientation, information and cancellation preserve all owner/public game state').toBe(true);
  expect(actor.observed.commands.slice(beforeCommands), 'selection, information and cancellation submit no command').toEqual([]);
  expect(other.observed.commands.length).toBe(otherCommands);
  actor.metrics.conditionedTargets.readOnlyChecks.push({ card, viewportCount: viewports.length, commandDelta: 0, preserved: true });

  await page.setViewportSize(originalViewport);
  await selectCard(actor, choice.index);
  await verifyTargets(actor, choice, card);
  const room = actor.observed.room, seat = room.youSeat, own = structuredClone(room.players[seat]);
  const enemy = structuredClone(room.players[1 - seat]), handIds = [...room.selfHandIds];
  const target = choice.targets[0], before = structuredClone(own.board.find(unit => unit.uid === target.target));
  expect(target.seat).toBe(seat);
  expect(cases[card].eligible(before)).toBe(true);
  const excludedFriendly = own.board.find(unit => !cases[card].eligible(unit));
  const invalid = excludedFriendly ? { seat, unit: excludedFriendly } : { seat: 1 - seat, unit: enemy.board[0] };
  expect(Boolean(invalid.unit), 'a genuine ineligible public unit is available for the guarded click').toBe(true);
  await expect(unitLabel(page, invalid.seat, invalid.unit.uid)).not.toHaveClass(/targetable/);
  await unitLabel(page, invalid.seat, invalid.unit.uid).click();
  await expect(page.locator('#notice')).toHaveText('请选择亮起的合法目标');
  await expect(page.locator('#notice')).toHaveAttribute('data-kind','target');
  await safeScreenshot(page,testInfo,`${card}-invalid-target-warning`);
  await expect(page.locator('#notice')).toHaveText('请选择亮起的合法目标');
  const cancelAt=await page.evaluate(()=>performance.now());
  await action(page,'clear').click();
  await expect(page.locator('#notice')).toHaveText('');
  const cancelledAt=await page.evaluate(()=>performance.now());
  expect(actor.observed.commands.length).toBe(beforeCommands);
  await selectCard(actor,choice.index);await verifyTargets(actor,choice,card);
  await unitLabel(page,invalid.seat,invalid.unit.uid).click();
  await expect(page.locator('#notice')).toHaveText('请选择亮起的合法目标');
  await sleep(250);
  await verifyTargets(actor, choice, card);
  expect(actor.observed.commands.length, 'clicking an ineligible unit sends no command and keeps the current card selected').toBe(beforeCommands);
  expect(readOnlyState(actor) === beforeSelection).toBe(true);
  const commands = actor.observed.commands.length, events = new Set(actor.observed.events.keys());
  const revision = room.revision, cost = room.selfHandCosts[choice.index];
  await expect(page.locator('#notice')).toHaveText('请选择亮起的合法目标');
  const submitAt=await page.evaluate(()=>performance.now());
  const command = await uiCommand(actor, () => unitLabel(page, target.seat, target.target).click());
  expect(command.type).toBe('battle.action'); expect(command.action).toBe('play');
  await sync(actor, other); await waitForBoard(actor); await sleep(250);
  await expect(page.locator('#notice')).toHaveText('');
  const acceptedAt=await page.evaluate(()=>performance.now());
  expect(actor.observed.commands.slice(commands).map(item => ({ type: item.type, action: item.action })))
    .toEqual([{ type: 'battle.action', action: 'play' }]);
  expect(other.observed.commands.length).toBe(otherCommands);
  expect([...actor.observed.events].filter(([id]) => !events.has(id)).map(([, event]) => event))
    .toEqual([{ kind: 'play', seat }]);
  const afterRoom = actor.observed.room, afterOwn = afterRoom.players[seat];
  expect(afterRoom.revision).toBe(revision + 1);
  expect(JSON.stringify(afterRoom.selfHandIds) === JSON.stringify(handIds.filter(id => id !== choice.handId)),
    'exactly the selected own hand instance is consumed').toBe(true);
  expect(afterOwn.mana).toBe(own.mana - cost);
  expect(afterOwn.handCount).toBe(own.handCount - 1);
  expect(afterOwn.board).toHaveLength(own.board.length + 1);
  const summoned = afterOwn.board.filter(unit => !own.board.some(old => old.uid === unit.uid));
  expect(summoned).toHaveLength(1); expect(summoned[0].cardId).toBe(card);
  const after = afterOwn.board.find(unit => unit.uid === target.target);
  expect(after).toEqual(card === 'mushroom_medic'
    ? { ...before, hp: Math.min(before.maxHp, before.hp + 3) }
    : { ...before, shield: true });
  expect(afterOwn.board.filter(unit => unit.uid !== target.target && unit.uid !== summoned[0].uid))
    .toEqual(own.board.filter(unit => unit.uid !== target.target));
  expect(afterRoom.players[1 - seat]).toEqual(enemy);
  actor.metrics.summons += 1;
  actor.metrics.conditionedTargets.effects.push({ card, seat, targetUid: target.target,
    before, after, excludedSeat: invalid.seat, excludedUid: invalid.unit.uid,
    invalidClickCommandCount: 0, commandCount: 1, publicPlayEventCount: 1,
    warningLifecycle:{cancelAt,cancelledAt,submitAt,acceptedAt,emptyAfterCancel:true,emptyAfterAccepted:true} });
  await safeScreenshot(page, testInfo, `${card}-accepted-condition-effect`);
}

async function playPreparation(actor, other, seen) {
  const room = actor.observed.room, own = room.players[room.youSeat];
  const options = room.selfLegalCardTargets.map(choice => ({ ...choice, card: room.selfHandCards[choice.index] }));
  // Hold conditioned cards for actual target coverage. A duplicate can become
  // an initial ordinary summon only when no friendly target exists yet.
  const choice = options.find(item => item.untargeted && ['sprout', 'turtle', 'fox'].includes(item.card) && own.board.length < 2)
    || options.find(item => item.untargeted && item.card === 'lantern' && own.deckCount > 0)
    || options.find(item => item.untargeted && item.card === 'moon' && own.deckCount > 0 && own.handCount <= 5)
    || options.find(item => item.untargeted && cases[item.card] && own.board.length === 0 &&
      (seen.has(item.card) || room.selfHandCards.filter(id => id === item.card).length > 1))
    || options.find(item => item.untargeted && ['sprout', 'turtle', 'fox'].includes(item.card) && own.board.length < 3 && own.handCount >= 6);
  if (!choice) return false;
  await selectCard(actor, choice.index);
  await expect(action(actor.page, 'play')).toBeEnabled();
  const command = await uiCommand(actor, () => action(actor.page, 'play').click());
  expect(command.action).toBe('play');
  if (!['lantern', 'moon'].includes(choice.card)) actor.metrics.summons += 1;
  await sync(actor, other);
  return true;
}

async function prepareWound(actor, other, seen) {
  const page = actor.page, room = actor.observed.room, seat = room.youSeat, own = room.players[seat];
  const wounded = own.board.filter(unit => unit.hp < unit.maxHp);
  const clearSpace = own.board.length >= 3 && own.handCount >= 6;
  if ((seen.has('mushroom_medic') || wounded.length) && !clearSpace) return false;
  for (const source of own.board.filter(unit => unit.ready)) {
    // Keep one established wound available while looking for a medic naturally.
    if (!seen.has('mushroom_medic') && wounded.length === 1 && source.uid === wounded[0].uid) continue;
    await unitLabel(page, seat, source.uid).click();
    await expect(page.locator('.target-command')).toBeVisible();
    const highlighted = await page.locator('.unit-label.targetable').evaluateAll(elements =>
      elements.map(element => ({ target: element.dataset.uid, seat: Number(element.dataset.seat) })));
    const candidates = highlighted.map(target => ({ ...target,
      unit: room.players[target.seat].board.find(unit => unit.uid === target.target) }));
    const target = candidates.find(item => item.seat !== seat && item.unit.atk > 0 && !source.shield && source.hp > item.unit.atk)
      || (clearSpace ? candidates.find(item => item.seat !== seat) : null);
    if (!target) { await action(page, 'clear').click(); continue; }
    const command = await uiCommand(actor, () => unitLabel(page, target.seat, target.target).click());
    expect(command.action).toBe('attack');
    await sync(actor, other); await waitForBoard(actor);
    actor.metrics.attacks += 1;
    const after = actor.observed.room.players[seat].board.find(unit => unit.uid === source.uid);
    if (!source.shield && source.hp > target.unit.atk) {
      expect(after.hp).toBe(source.hp - target.unit.atk);
      expect(after.hp).toBeLessThan(after.maxHp);
      actor.metrics.conditionedTargets.wounds.push({ seat, sourceUid: source.uid, targetUid: target.target,
        beforeHp: source.hp, afterHp: after.hp, maximumHp: after.maxHp });
    }
    return true;
  }
  return false;
}

test('conditioned friendly target copy guides one wounded heal and one unshielded shield in a real match', async ({ actors }, testInfo) => {
  test.setTimeout(180_000);
  testInfo.annotations.push({ type: 'coverage', description: 'One additional formal E2E scenario. Two isolated human browsers build legal 20-card decks through UI and use natural draws, turns and attacks. Within 24 alternating turns, mushroom_medic must heal a real wounded friendly and glass_snail must shield a real unshielded friendly. Exact reason text and authoritative seat/UID highlights, 320x568/390x844/844x390 visible-body bounds and nonoverlap, zero-command inspection/cancel/ineligible click, and exactly one accepted play/event/effect per conditioned card. No seeded state, shuffle control, hidden opponent hand, direct commands or full-match claim. Screenshots require visual review.' });
  const a = await actors('conditioned-A'), b = await actors('conditioned-B');
  expect(a.context).not.toBe(b.context);
  expect(a.observed.player.playerId).not.toBe(b.observed.player.playerId);
  for (const actor of [a, b]) {
    actor.metrics.conditionedTargets = { layouts: [], readOnlyChecks: [], effects: [], wounds: [] };
    await actor.page.bringToFront(); await calmAnimations(actor); await buildDeck(actor);
    await prepareMatch(actor); await actor.page.locator('#deck').selectOption('custom');
  }
  await Promise.all([a, b].map(actor => action(actor.page, 'match').click()));
  await Promise.all([a, b].map(actor => expect(action(actor.page, 'opening-confirm')).toBeVisible()));
  await confirmOpening(a, b);
  expect(a.observed.room.youSeat).not.toBe(b.observed.room.youSeat);
  const seen = new Set();
  for (let turn = 0; turn < 24 && seen.size < 2; turn += 1) {
    const actor = [a, b].find(item => item.observed.room.youSeat === a.observed.room.activeSeat);
    const other = actor === a ? b : a;
    await actor.page.bringToFront();
    for (let move = 0; move < 12 && seen.size < 2; move += 1) {
      await waitForBoard(actor);
      const room = actor.observed.room;
      if (room.phase === 'finished') break;
      expect(room.selfController).toBe('human'); expect(room.opponentController).toBe('human');
      const choice = room.players[1 - room.youSeat].board.length && room.selfLegalCardTargets.find(item =>
        cases[room.selfHandCards[item.index]] && !seen.has(room.selfHandCards[item.index]) && item.targets.length);
      if (choice) {
        const card = room.selfHandCards[choice.index];
        await exerciseConditionedCard(actor, other, choice, card, testInfo); seen.add(card);
      } else if (await prepareWound(actor, other, seen)) continue;
      else if (!await playPreparation(actor, other, seen)) break;
    }
    if (seen.size === 2 || actor.observed.room.phase === 'finished') break;
    await uiCommand(actor, () => action(actor.page, 'end').click()); await sync(a, b);
  }
  expect([...seen].sort(), 'Coverage gap: natural UI play must reach both conditioned effects within 24 turns')
    .toEqual(['glass_snail', 'mushroom_medic']);
  expect([a, b].flatMap(actor => actor.metrics.conditionedTargets.wounds).length,
    'at least one surviving public wound was established by a real UI attack').toBeGreaterThan(0);
  for (const actor of [a, b]) {
    expect(actor.observed.errors, 'no illegal or otherwise rejected command was submitted').toEqual([]);
    expect(actor.observed.duplicateEventRevisions).toBe(0);
    expect(actor.observed.room.mode).toBe('pvp'); expect(actor.observed.room.assisted).toBe(false);
    expect(actor.observed.room.selfController).toBe('human'); expect(actor.observed.room.opponentController).toBe('human');
  }
});
