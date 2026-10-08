import {
  test, expect, action, sleep, currentProgress, learned, copies,
  safeScreenshot, fictionalUsername, calmAnimations, studyOne, openTestGift,
  register, login, logout, prepareMatch, matchPair, confirmOpening, sync,
  canvasAndKeyboard, playTurn,
} from './helpers.mjs';

test('@smoke guest learning and visible registration preserve identity; account and guest match', async ({ actors }, testInfo) => {
  testInfo.annotations.push({ type: 'coverage', description: 'Smoke only: two real isolated contexts, guest learning, registration preservation, matched opening. Does not claim a completed battle.' });
  const a = await actors('account-A');
  const b = await actors('guest-B');
  expect(learned(a)).toEqual([]);
  expect(learned(b)).toEqual([]);
  const guestId = a.observed.player.playerId;
  const qid = await studyOne(a);
  const masteryBefore = structuredClone(currentProgress(a).legacy.mastery);
  await register(a, fictionalUsername());
  expect(a.observed.player.playerId).toBe(guestId);
  await expect.poll(() => currentProgress(a)?.legacy.mastery).toEqual(masteryBefore);
  expect(learned(a)).toContain(qid);
  expect(b.observed.player.kind).toBe('guest');
  expect(learned(b)).toEqual([]);
  await safeScreenshot(a.page, testInfo, 'registered-camp');
  await matchPair(a, b);
  await safeScreenshot(a.page, testInfo, 'account-matched-opening');
  await safeScreenshot(b.page, testInfo, 'guest-matched-opening');
  expect(a.observed.pageErrorCount + b.observed.pageErrorCount).toBe(0);
});

test('two isolated browsers finish a human UI match with summons attacks English and reconnect', async ({ actors }, testInfo) => {
  test.setTimeout(7 * 60_000);
  testInfo.annotations.push({ type: 'coverage', description: 'Automated browser UI driven PvP: genuine pointer card selection, keyboard I/Enter, summons, attacks, first visible English choices, short offline/reload recovery, health/draw terminal state with no proxy assistance.' });
  const a = await actors('account-A');
  const b = await actors('guest-B');
  await register(a, fictionalUsername('Duel'));
  await calmAnimations(a);
  await calmAnimations(b);
  await matchPair(a, b);
  await confirmOpening(a, b);
  const first = [a, b].find(actor => actor.observed.room.youSeat === actor.observed.room.activeSeat);
  const other = first === a ? b : a;
  await canvasAndKeyboard(first, testInfo);
  await playTurn(first, other, testInfo);
  // Opening draws are random: do not assume a one-energy partner is available.
  for (let turns = 0; a.metrics.summons + b.metrics.summons === 0 && turns < 8; turns += 1) {
    const actor = [a, b].find(candidate => candidate.observed.room.youSeat === a.observed.room.activeSeat);
    await playTurn(actor, actor === a ? b : a, testInfo);
  }
  expect(a.metrics.summons + b.metrics.summons, 'real UI play occurred before the interruption').toBeGreaterThan(0);

  const roomId = a.observed.room.roomId;
  const seat = a.observed.room.youSeat;
  const beforeBoard = structuredClone(a.observed.room.players);
  const beforeCommands = a.observed.commands.length;
  const beforeSessions = a.observed.sessions;
  const beforeRoomMessages = a.observed.roomMessages;
  // A real browser network interruption; reloading while offline also ensures
  // the old WebSocket is gone. Only this test's context is affected.
  await a.context.setOffline(true);
  try {
    await a.page.reload({ timeout: 3500, waitUntil: 'domcontentloaded' }).catch(() => {});
    await expect.poll(() => b.observed.room.opponentConnected).toBe(false);
  } finally { await a.context.setOffline(false); }
  await a.page.goto('http://127.0.0.1:4173');
  await expect.poll(() => a.observed.sessions).toBeGreaterThan(beforeSessions);
  await expect.poll(() => a.observed.roomMessages).toBeGreaterThan(beforeRoomMessages);
  await sync(a, b);
  expect(a.observed.room.roomId).toBe(roomId);
  expect(a.observed.room.youSeat).toBe(seat);
  expect(a.observed.room.players).toEqual(beforeBoard);
  expect(a.observed.room.assisted).toBe(false);
  expect(a.observed.commands.slice(beforeCommands).filter(command => command.type === 'battle.action' || command.type === 'ritual.answer')).toHaveLength(0);
  await safeScreenshot(a.page, testInfo, 'same-seat-after-offline-reload');

  let turns = 0;
  while (a.observed.room.phase !== 'finished' && turns < 70) {
    const actor = [a, b].find(candidate => candidate.observed.room.youSeat === a.observed.room.activeSeat);
    await playTurn(actor, actor === a ? b : a, testInfo);
    turns += 1;
  }
  await sync(a, b);
  expect(a.observed.room.phase, 'real UI actions reached a terminal state').toBe('finished');
  expect(['health', 'draw']).toContain(a.observed.room.result.reason);
  expect(a.observed.room.result.winnerSeat).toBe(b.observed.room.result.winnerSeat);
  for (const actor of [a, b]) {
    expect(actor.metrics.summons, `${actor.label} summoned real partners`).toBeGreaterThan(0);
    expect(actor.metrics.attacks, `${actor.label} made real attacks`).toBeGreaterThan(0);
    expect(actor.metrics.answers, `${actor.label} answered visible English`).toBeGreaterThan(0);
    expect(actor.observed.room.assisted).toBe(false);
    expect(actor.observed.room.selfController).toBe('human');
    expect(actor.observed.errors).toEqual([]);
    expect(actor.observed.duplicateEventRevisions).toBe(0);
    expect(actor.observed.pageErrorCount).toBe(0);
    await expect(actor.page.locator('.result')).toBeVisible();
    await expect(actor.page.locator('.result')).not.toContainText('本局有伙伴托管');
    await expect.poll(() => currentProgress(actor)?.onlineRecords.length).toBe(1);
    await safeScreenshot(actor.page, testInfo, `${actor.label}-normal-result`);
  }
});

test('an unmatched guest waits the real default ten seconds before the declared AI fallback', async ({ actors }, testInfo) => {
  testInfo.annotations.push({ type: 'coverage', description: 'Real default 10-second matchmaking wait and explicitly identified AI fallback; this is not a completed browser game or a timeout-proxy test.' });
  const guest = await actors('unmatched-guest');
  await calmAnimations(guest);
  await prepareMatch(guest, 6, 's2-u6');
  await action(guest.page, 'match').click();
  await expect(guest.page.locator('.match-setup')).toContainText('正在寻找相同年级与范围的对手');
  await expect.poll(() => guest.observed.queueDeadline !== null).toBe(true);
  expect(guest.observed.queueDeadline - guest.observed.queueStartedAt).toBeGreaterThanOrEqual(9500);
  expect(guest.observed.queueDeadline - guest.observed.queueStartedAt).toBeLessThanOrEqual(11_000);
  await safeScreenshot(guest.page, testInfo, 'waiting-for-a-real-opponent');
  await expect(action(guest.page, 'opening-confirm')).toBeVisible({ timeout: 15_000 });
  const elapsed = guest.observed.firstRoomAt - guest.observed.queueStartedAt;
  expect(elapsed).toBeGreaterThanOrEqual(9500);
  expect(elapsed).toBeLessThan(20_000);
  expect(guest.observed.room.mode).toBe('pve');
  expect(guest.observed.room.opponentController).toBe('bot');
  await action(guest.page, 'opening-confirm').click();
  await expect(guest.page.locator('.opening')).toBeHidden();
  await action(guest.page, 'enemy-hero').click();
  await expect(guest.page.locator('#modal-root')).toContainText('森林电脑角色');
  await safeScreenshot(guest.page, testInfo, 'honestly-labeled-ai-opponent');
  expect(guest.observed.pageErrorCount).toBe(0);
});

test('account and guest progress stay separate across login logout and a real SQLite server restart', async ({ actors, server }, testInfo) => {
  test.setTimeout(150_000);
  testInfo.annotations.push({ type: 'coverage', description: 'Visible learning and test collection persist for a registered account across fresh-context login and a real server process restart; original guest progress stays isolated; unfinished room is interrupted rather than fabricated.' });
  const a = await actors('registered-account');
  const b = await actors('independent-guest');
  await calmAnimations(a);
  const qa = await studyOne(a);
  await openTestGift(a, testInfo);
  const username = fictionalUsername('Saved');
  const accountId = await register(a, username);
  const originalGuestB = b.observed.player.playerId;
  const qb = await studyOne(b, { except: qa });
  const guestMastery = structuredClone(currentProgress(b).legacy.mastery);
  expect(copies(b)).toBe(0);
  await login(b, username);
  expect(b.observed.player.playerId).toBe(accountId);
  expect(learned(b)).toEqual([qa]);
  expect(learned(b)).not.toContain(qb);
  expect(copies(b)).toBe(10);
  await logout(b);
  expect(b.observed.player.playerId).toBe(originalGuestB);
  expect(currentProgress(b).legacy.mastery).toEqual(guestMastery);
  expect(copies(b)).toBe(0);

  // Registering consumes A's original guest. A later logout creates a fresh one.
  await a.page.reload();
  await expect(action(a.page, 'identity')).toContainText(username);
  await logout(a);
  expect(a.observed.player.playerId).not.toBe(accountId);
  expect(learned(a)).toEqual([]);
  expect(copies(a)).toBe(0);
  await login(a, username);
  expect(a.observed.player.playerId).toBe(accountId);
  expect(learned(a)).toEqual([qa]);
  expect(copies(a)).toBe(10);
  const savedMastery = structuredClone(currentProgress(a).legacy.mastery);
  const savedCollection = structuredClone(currentProgress(a).collection);
  await matchPair(a, b);
  await confirmOpening(a, b);
  const interruptedRoom = a.observed.room.roomId;
  const sessionsBefore = a.observed.sessions;
  await server.restart();
  expect(server.starts).toBe(2);
  await a.page.reload();
  await b.page.reload();
  await expect.poll(() => a.observed.sessions).toBeGreaterThan(sessionsBefore);
  await expect(action(a.page, 'identity')).toContainText(username);
  await expect(action(a.page, 'match-setup')).toBeVisible();
  await expect(a.page.locator('.battle-ui')).toHaveCount(0);
  expect(a.observed.session.roomId).toBeNull();
  expect(a.observed.session.roomId).not.toBe(interruptedRoom);
  expect(a.observed.player.playerId).toBe(accountId);
  await expect.poll(() => currentProgress(a)?.legacy.mastery).toEqual(savedMastery);
  expect(currentProgress(a).collection).toEqual(savedCollection);
  expect(currentProgress(a).onlineRecords).toHaveLength(0);
  expect(b.observed.player.playerId).toBe(originalGuestB);
  await expect.poll(() => currentProgress(b)?.legacy.mastery).toEqual(guestMastery);
  expect(copies(b)).toBe(0);
  await safeScreenshot(a.page, testInfo, 'account-after-process-restart');
  // A fresh third cookie jar proves persistence is not supplied by A's memory.
  const fresh = await actors('fresh-context-after-restart');
  await login(fresh, username);
  expect(fresh.observed.player.playerId).toBe(accountId);
  expect(currentProgress(fresh).legacy.mastery).toEqual(savedMastery);
  expect(currentProgress(fresh).collection).toEqual(savedCollection);
  await action(fresh.page, 'data').click();
  await expect(fresh.page.locator('.study-desk')).toContainText('1项学习');
  await safeScreenshot(fresh.page, testInfo, 'durable-learning-in-fresh-context');
});

test('320 and 390 portrait plus 844 by 390 landscape expose readable real UI screenshots', async ({ actors }, testInfo) => {
  test.setTimeout(120_000);
  testInfo.annotations.push({ type: 'coverage', description: 'Chromium viewport emulation: 320x740 and 390x844 portrait; 844x390 landscape. Real UI clicks and bounded layout checks; no claim of physical touch-device, whole-session FPS or pixel-perfect visual approval.' });
  for (const viewport of [{ width: 320, height: 740 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    const size = `${viewport.width}x${viewport.height}`;
    const actor = await actors(size, { viewport, isMobile: true, hasTouch: true });
    const page = actor.page;
    await safeScreenshot(page, testInfo, `${size}-camp`);
    await action(page, 'identity').click();
    const dialog = page.locator('.identity-panel');
    await dialog.getByRole('button', { name: '创建账号，保留此游客', exact: true }).click();
    await dialog.getByLabel('用户名', { exact: true }).fill('Example');
    await dialog.getByLabel('密码', { exact: true }).fill('forest');
    await expect(dialog.getByLabel('密码', { exact: true })).toHaveAttribute('type', 'password');
    await safeScreenshot(page, testInfo, `${size}-registration-form`);
    const dialogBox = await dialog.boundingBox();
    expect(dialogBox.x).toBeGreaterThanOrEqual(-1);
    expect(dialogBox.width).toBeLessThanOrEqual(viewport.width + 2);
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await action(page, 'match-setup').click();
    await expect(page.locator('#course')).toBeVisible();
    await expect(action(page, 'match')).toBeEnabled();
    await action(page, 'match').scrollIntoViewIfNeeded();
    await safeScreenshot(page, testInfo, `${size}-match-options`);
    await action(page, 'close-panel').click();
    await action(page, 'study').click();
    await page.locator('[data-action="desk-filter"][data-value="all"]').click();
    await action(page, 'desk-study').first().click();
    const answer = action(page, 'desk-answer').first();
    await expect(answer).toBeVisible();
    await answer.scrollIntoViewIfNeeded();
    const answerBox = await answer.boundingBox();
    expect(answerBox.width).toBeGreaterThan(150);
    expect(answerBox.height).toBeGreaterThanOrEqual(32);
    await safeScreenshot(page, testInfo, `${size}-english-choices`);
    const layout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width + 2);
    expect(actor.observed.pageErrorCount).toBe(0);
  }
});
