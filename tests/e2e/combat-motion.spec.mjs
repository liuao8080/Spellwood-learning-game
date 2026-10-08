import {
  test, expect, action, currentProgress, safeScreenshot, prepareMatch,
  confirmOpening, sync, waitForBoard, uiCommand,
} from './helpers.mjs';

// These are public catalogue choices, not engine imports or a seeded hand.
// One ordinary UI-built deck makes a melee source reachable in bounded turns.
// The other participant only passes; no guard, shield, retaliation or death
// effect can obscure the single hero-health change under review.
const meleeDeck = { rabbit: 3, hedgehog: 3, acorn_squirrel: 3, fox: 3, wolf: 3, turtle: 3, boar: 2 };

async function normalMotion(actor) {
  await action(actor.page, 'settings').click();
  await actor.page.locator('#setting-reduced').uncheck();
  for (const name of ['music', 'sound', 'speech']) await actor.page.locator(`#setting-${name}`).uncheck();
  await action(actor.page, 'save-settings').click();
  await expect(actor.page.locator('.settings')).toBeHidden();
  await expect.poll(() => currentProgress(actor)?.legacy?.reduced).toBe(false);
}

async function buildMeleeDeck(actor) {
  const page = actor.page;
  await action(page, 'library').click();
  const names = await action(page, 'library-card').evaluateAll(elements => Object.fromEntries(elements.map(element =>
    [element.querySelector('strong').textContent, element.dataset.value])));
  const draft = (await action(page, 'library-slot').evaluateAll(elements => elements.map(element =>
    element.querySelector('span:not(.library-art)').textContent))).map(name => names[name]);
  const counts = () => draft.reduce((result, id) => ({ ...result, [id]: (result[id] || 0) + 1 }), {});
  for (let step = 0; step < 20; step += 1) {
    const held = counts(), replacement = Object.keys(meleeDeck).find(id => (held[id] || 0) < meleeDeck[id]);
    if (!replacement) break;
    const index = draft.findIndex(id => held[id] > (meleeDeck[id] || 0));
    expect(index).toBeGreaterThanOrEqual(0);
    await page.locator(`[data-action="library-slot"][data-value="${index}"]`).click();
    await page.locator(`[data-action="library-card"][data-value="${replacement}"]`).click();
    draft[index] = replacement;
  }
  expect(counts()).toEqual(meleeDeck);
  await action(page, 'library-save').click();
  await expect(page.locator('.card-library')).toBeHidden();
  await expect.poll(() => currentProgress(actor)?.customDeck).toEqual(draft);
}

async function reachReadyMelee(a, b) {
  // Only A's own legal choices guide A's selection. B's hand is never inspected.
  // A summons once, then both simply pass until that actual unit is ready.
  for (let turn = 0; turn < 10; turn += 1) {
    const active = a.observed.room.activeSeat === a.observed.room.youSeat ? a : b;
    await active.page.bringToFront();
    await waitForBoard(active);
    if (active === a) {
      let room = a.observed.room;
      if (!room.players[room.youSeat].board.length) {
        const choice = room.selfLegalCardTargets.filter(option => option.untargeted && meleeDeck[room.selfHandCards[option.index]])
          .sort((left, right) => room.selfHandCosts[left.index] - room.selfHandCosts[right.index])[0];
        if (choice) {
          await a.page.locator(`#hand-semantics [data-hand-index="${choice.index}"]`).focus();
          await a.page.keyboard.press('Enter');
          await expect(action(a.page, 'play')).toContainText('召唤');
          await uiCommand(a, () => action(a.page, 'play').click());
          a.metrics.summons += 1;
          await sync(a, b);
          await waitForBoard(a);
          room = a.observed.room;
        }
      }
      const source = room.players[room.youSeat].board.find(unit => unit.ready);
      if (source) {
        expect(meleeDeck[source.cardId]).toBeGreaterThan(0);
        await expect(a.page.locator(`.unit-label[data-uid="${source.uid}"]`)).toHaveAttribute('aria-label', /可攻击/);
        a.metrics.turnsToReadyMelee = turn + 1;
        return source.uid;
      }
    }
    if (turn < 9) {
      await uiCommand(active, () => action(active.page, 'end').click());
      await sync(a, b);
    }
  }
  throw new Error('Coverage gap: the UI did not reach a ready melee unit within ten ordinary turns');
}

function publicState(actor) {
  const room = actor.observed.room;
  return structuredClone({
    revision: room.revision, phase: room.phase, turn: room.turn,
    activeSeat: room.activeSeat, assisted: room.assisted, players: room.players,
  });
}

async function startDomObservation(page, uid) {
  // This observer reads only public DOM geometry, rendered hero HP and browser
  // visibility. Native RAF timestamps are observed, never replaced or advanced.
  // No renderer, client, engine, storage, canvas pixels or network API is touched.
  await page.evaluate(sourceUid => {
    const started = performance.now(), samples = [], clicks = [];
    let frame = null, stopped = false;
    const number = value => {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
    };
    const sample = () => {
      const source = [...document.querySelectorAll('.unit-label')].find(element => element.dataset.uid === sourceUid);
      const arena = document.querySelector('#arena'), bounds = arena.getBoundingClientRect();
      return {
        elapsedMs: Math.round((performance.now() - started) * 100) / 100,
        source: source ? {
          x: number(source.style.getPropertyValue('--anchor-x')),
          y: number(source.style.getPropertyValue('--anchor-y')),
          hp: number(source.querySelector('b:last-of-type')?.textContent),
        } : null,
        enemyHp: number(document.querySelector('.hero-panel.theirs .hero-gem')?.textContent),
        arena: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
        renderer: ['WebGL2', 'CPU · 兼容三维'].includes(arena.dataset.renderer) ? arena.dataset.renderer : 'other',
        reducedMotion: arena.dataset.reducedMotion === 'false' ? false : arena.dataset.reducedMotion === 'true' ? true : null,
        arenaHidden: arena.hidden, visibility: document.visibilityState,
        inputReady: Boolean(document.querySelector('[data-action="end"]:enabled')),
      };
    };
    const onClick = event => {
      if (clicks.length >= 4 || event.target.closest('[data-action]')?.dataset.action !== 'enemy-hero') return;
      clicks.push({ elapsedMs: Math.round((performance.now() - started) * 100) / 100, trusted: event.isTrusted });
    };
    const stop = () => {
      if (stopped) return;
      stopped = true;
      cancelAnimationFrame(frame);
      document.removeEventListener('click', onClick, true);
    };
    const record = () => {
      if (stopped) return;
      samples.push(sample());
      if (samples.length >= 360 || performance.now() - started >= 6000) stop();
      else frame = requestAnimationFrame(record);
    };
    document.addEventListener('click', onClick, { capture: true, passive: true });
    samples.push(sample());
    frame = requestAnimationFrame(record);
    window.__combatMotionObservation = {
      mark: () => ({ elapsedMs: Math.round((performance.now() - started) * 100) / 100, latestSample: samples.length - 1 }),
      finish: () => {
        stop();
        const result = { samples, clicks, final: sample(), sampleLimit: 360, observationLimitMs: 6000 };
        delete window.__combatMotionObservation;
        return result;
      },
    };
  }, uid);
}

test('@combat-motion normal melee leaves its slot, changes hero HP once and returns', async ({ actors }, testInfo) => {
  test.setTimeout(120_000);
  testInfo.annotations.push({ type: 'coverage', description: 'Normal-speed melee only: two isolated guest contexts, UI-built legal deck and unseeded match, one genuine attack click. Eleven safe PNGs plus bounded read-only DOM RAF samples and existing reduced own-WebSocket observations. No animation pause, frame-time injection, synthetic game state, hidden opponent hand, video or HAR. PNGs require visual review for aiming line/contact flash/floating damage; this test does not certify audio, ranged combat, healing, armor, shields, death, pack opening, physical GPU use or exact animation duration.' });
  const a = await actors('motion-guest-A', { reducedMotion: 'no-preference' });
  const b = await actors('motion-guest-B', { reducedMotion: 'no-preference' });
  await normalMotion(a);
  await normalMotion(b);
  await buildMeleeDeck(a);
  await prepareMatch(a);
  await a.page.locator('#deck').selectOption('custom');
  await prepareMatch(b);
  expect(a.context).not.toBe(b.context);
  expect(a.observed.player.playerId).not.toBe(b.observed.player.playerId);
  await Promise.all([a, b].map(actor => action(actor.page, 'match').click()));
  await Promise.all([a, b].map(actor => expect(action(actor.page, 'opening-confirm')).toBeVisible()));
  await expect.poll(() => Boolean(a.observed.room?.roomId && a.observed.room.roomId === b.observed.room?.roomId)).toBe(true);
  for (const actor of [a, b]) {
    expect(actor.observed.player.kind).toBe('guest');
    expect(actor.observed.room.opponentController).toBe('human');
  }
  await confirmOpening(a, b);
  const uid = await reachReadyMelee(a, b), page = a.page;
  const seat = a.observed.room.youSeat, enemySeat = 1 - seat;
  const before = publicState(a), source = before.players[seat].board.find(unit => unit.uid === uid);
  expect(before.players[seat].board).toHaveLength(1);
  expect(before.players[enemySeat].board).toHaveLength(0);
  expect(before.players[enemySeat].armor).toBe(0);
  expect(source.atk).toBeGreaterThan(0);
  expect(before.players[enemySeat].hp).toBeGreaterThan(source.atk);
  await expect(page.locator('#arena')).toHaveAttribute('data-reduced-motion', 'false');
  await expect(page.locator('#arena')).toHaveAttribute('data-renderer', /^(WebGL2|CPU · 兼容三维)$/);

  const evidence = a.metrics.combatMotion = {
    status: 'collecting', sourceUid: uid, sourceCard: source.cardId,
    before, screenshots: [],
    observationMethod: 'Existing helpers.observe passively reduces each participant\'s own WebSocket traffic; DOM observer reads native RAF samples only',
    captureCaveat: 'Screenshot requests and serialization can affect cadence. Request windows are not exact pixel exposure times or animation duration. Frames are sequential unedited safeScreenshot PNGs, not interpolated video.',
    renderingCaveat: 'Record the actual arena data-renderer. WebGL2 is an API path, not proof of physical GPU acceleration; CPU compatibility is a different measured path. No capability override is used.',
    visualReview: { status: 'required', checks: ['selected target line or arrow', 'unit departure', 'contact flash', 'floating damage', 'unit return'], excluded: ['audio', 'ranged attacks', 'healing', 'armor', 'shields', 'death', 'pack opening'] },
  };
  const screenshot = async (name, observed = false) => {
    const requested = observed ? await page.evaluate(() => window.__combatMotionObservation.mark()) : null;
    const file = await safeScreenshot(page, testInfo, name);
    const returned = observed ? await page.evaluate(() => window.__combatMotionObservation.mark()) : null;
    evidence.screenshots.push({ file, requested, returned });
    expect(file, 'the safe capture must produce an image in this guest-only flow').not.toBeNull();
  };
  await screenshot('00-ready-before-selection');
  await page.locator(`.unit-label[data-uid="${uid}"]`).click();
  await expect(page.locator('.target-command')).toBeVisible();
  const target = action(page, 'enemy-hero');
  await target.hover();
  await screenshot('01-selected-target');
  const bounds = await target.boundingBox();
  expect(Boolean(bounds && bounds.width > 0 && bounds.height > 0)).toBe(true);
  const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
  expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-action]')?.dataset.action === 'enemy-hero', { x, y })).toBe(true);
  const commandStart = a.observed.commands.length, eventIds = new Set(a.observed.events.keys());
  const otherCommandStart = b.observed.commands.length;
  await startDomObservation(page, uid);
  try {
    // Native input goes through the exact visible target checked above. Do not
    // wait for the acknowledgement before beginning the short PNG sequence.
    await page.mouse.click(x, y);
    for (let frame = 0; frame < 8; frame += 1)
      await screenshot(`${String(frame + 2).padStart(2, '0')}-sequence-${frame}`, true);
    await sync(a, b);
    await waitForBoard(a);
    await expect(page.locator('.hero-panel.theirs .hero-gem')).toHaveText(String(before.players[enemySeat].hp - source.atk));
    await screenshot('10-settled-after', true);
  } finally {
    evidence.dom = await page.evaluate(() => window.__combatMotionObservation.finish());
    evidence.after = publicState(a);
    // IDs from commands, sessions, identities and events are never persisted.
    evidence.commands = a.observed.commands.slice(commandStart).map(command => ({
      type: command.type, action: command.action, accepted: a.observed.acknowledgements.get(command.id)?.ok === true,
    }));
    evidence.newEvents = [...a.observed.events.entries()].filter(([id]) => !eventIds.has(id)).map(([id, event]) => ({
      kind: event.kind, seat: event.seat, revision: a.observed.eventRevisions.get(id),
    }));
  }

  expect(evidence.commands).toEqual([{ type: 'battle.action', action: 'attack', accepted: true }]);
  expect(b.observed.commands.slice(otherCommandStart)).toEqual([]);
  expect(evidence.newEvents).toEqual([{ kind: 'attack', seat, revision: before.revision + 1 }]);
  const expected = structuredClone(before);
  expected.revision += 1;
  expected.players[enemySeat].hp -= source.atk;
  expected.players[seat].board.find(unit => unit.uid === uid).ready = false;
  expect(evidence.after, 'exactly one attack: no draw, buff, mana, armor, turn or extra board change').toEqual(expected);
  expect(publicState(b)).toEqual(evidence.after);
  expect(evidence.dom.clicks).toHaveLength(1);
  expect(evidence.dom.clicks[0].trusted).toBe(true);

  const samples = evidence.dom.samples, baseline = samples[0];
  const distance = sample => sample.source && baseline.source
    ? Math.hypot(sample.source.x - baseline.source.x, sample.source.y - baseline.source.y) : null;
  const hpTransitions = samples.filter((sample, index) => !index || sample.enemyHp !== samples[index - 1].enemyHp);
  // These windows identify candidate images for review; an asynchronous PNG
  // capture is not assigned an invented instantaneous exposure timestamp.
  const displacedCaptureWindows = evidence.screenshots.filter(shot => shot.requested && samples.some(sample =>
    sample.elapsedMs >= shot.requested.elapsedMs && sample.elapsedMs <= shot.returned.elapsedMs && distance(sample) > 24));
  evidence.summary = {
    renderer: baseline.renderer, normalMotionSamples: samples.length,
    maximumSourceDisplacementPx: Math.max(...samples.map(distance).filter(value => value !== null)),
    sourceDisplacementAtFirstHpChangePx: hpTransitions[1] ? distance(hpTransitions[1]) : null,
    finalSourceDisplacementPx: distance(evidence.dom.final),
    visualHpStates: hpTransitions.map(sample => ({ elapsedMs: sample.elapsedMs, hp: sample.enemyHp })),
    authoritativeHealthDelta: evidence.after.players[enemySeat].hp - before.players[enemySeat].hp,
    unchangedPublicStateExceptHealthAndReady: true,
    screenshotWindowsOverlappingObservedDeparture: displacedCaptureWindows.map(shot => shot.file),
  };
  expect(samples.length, 'coverage requires a real multi-frame observation').toBeGreaterThanOrEqual(8);
  for (const sample of [...samples, evidence.dom.final]) {
    expect(sample.reducedMotion).toBe(false);
    expect(sample.arenaHidden).toBe(false);
    expect(sample.visibility).toBe('visible');
    expect(sample.renderer).toBe(baseline.renderer);
    expect(sample.arena, 'viewport/layout movement must not impersonate unit motion').toEqual(baseline.arena);
    expect(sample.source, 'this simple hero attack must keep its attacking unit').not.toBeNull();
    expect(Number.isFinite(sample.source.x) && Number.isFinite(sample.source.y)).toBe(true);
  }
  expect(hpTransitions.map(sample => sample.enemyHp)).toEqual([before.players[enemySeat].hp, expected.players[enemySeat].hp]);
  expect(evidence.summary.maximumSourceDisplacementPx, 'a ready-state change alone is not melee animation evidence').toBeGreaterThan(24);
  expect(evidence.summary.sourceDisplacementAtFirstHpChangePx, 'health must visibly change while the source is away from its slot').toBeGreaterThan(24);
  expect(evidence.summary.finalSourceDisplacementPx, 'the source must visibly return to its original slot').toBeLessThan(4);
  expect(displacedCaptureWindows.length, 'coverage gap: no PNG request overlapped the observed unit departure').toBeGreaterThan(0);
  expect(evidence.dom.final.inputReady).toBe(true);
  expect(evidence.screenshots).toHaveLength(11);
  for (const actor of [a, b]) {
    expect(actor.observed.room.assisted).toBe(false);
    expect(actor.observed.errors).toEqual([]);
    expect(actor.observed.duplicateEventRevisions).toBe(0);
  }
  a.metrics.attacks += 1;
  evidence.status = 'dom-and-authority-assertions-passed; pixel-review-still-required';
});
