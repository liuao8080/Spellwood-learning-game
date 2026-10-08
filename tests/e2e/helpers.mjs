import { test as base, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createAcceptanceServer } from '../../scripts/e2e-server.mjs';

export { expect };
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export const action = (page, name) => page.locator(`[data-action="${name}"]`);
const evidenceDirectory = path.resolve('test-results/browser-evidence');
const slug = text => text.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 100);

function reducedPlayer(player) {
  return player ? { playerId: player.playerId, kind: player.kind, name: player.name } : null;
}
function boardPlayer(player) {
  return {
    seat: player.seat, hp: player.hp, armor: player.armor,
    mana: player.mana, maxMana: player.maxMana,
    handCount: player.handCount, deckCount: player.deckCount,
    controller: player.controller,
    board: player.board.map(unit => ({
      uid: unit.uid, cardId: unit.cardId, atk: unit.atk, hp: unit.hp,
      ready: unit.ready, shield: Boolean(unit.shield),
    })),
  };
}

/** Passive observation of only this browser's real responses. Never intercepts,
 * mocks, replays or sends a game command. Authentication tokens, recovery codes,
 * questions and answers are not retained. Progress is held in memory for asserts.
 */
function observe(page) {
  const state = {
    player: null, progress: new Map(), room: null, roomMessages: 0,
    session: null, sessions: 0, commands: [], acknowledgements: new Map(),
    events: new Map(), eventRevisions: new Map(), duplicateEventRevisions: 0,
    feedbackCount: 0, queueStartedAt: null, queueDeadline: null, firstRoomAt: null,
    errors: [], pageErrorCount: 0,
  };
  page.on('pageerror', () => { state.pageErrorCount += 1; });
  page.on('response', async response => {
    try {
      if (!response.ok()) return;
      const pathname = new URL(response.url()).pathname;
      if (pathname.startsWith('/api/identity/')) {
        const { player } = await response.json();
        state.player = reducedPlayer(player);
      } else if (pathname === '/api/progress' || pathname.startsWith('/api/progress/')) {
        const { playerId, revision, data } = await response.json();
        if (data && revision >= (state.progress.get(playerId)?.revision ?? -1))
          state.progress.set(playerId, { revision, data });
      }
    } catch { /* Navigation can cancel a response; UI assertions remain authoritative. */ }
  });
  page.on('websocket', socket => {
    socket.on('framesent', ({ payload }) => {
      try {
        const message = JSON.parse(String(payload));
        if (!message.commandId) return; // In particular, never retain resume tokens.
        state.commands.push({
          id: message.commandId, type: message.type,
          action: message.payload?.action?.type || null,
        });
        if (message.type === 'queue.join') state.queueStartedAt = Date.now();
      } catch { /* Only JSON game messages are relevant. */ }
    });
    socket.on('framereceived', ({ payload }) => {
      try {
        const message = JSON.parse(String(payload));
        if (message.type === 'session.ready') {
          state.session = { playerId: message.playerId, sessionId: message.sessionId, roomId: message.roomId };
          state.sessions += 1;
        } else if (message.type === 'command.ack') {
          state.acknowledgements.set(message.commandId, { ok: message.ok, code: message.code });
          if (!message.ok) state.errors.push(message.code);
        } else if (message.type === 'queue.status' && message.status === 'waiting') {
          state.queueDeadline = message.matchBy;
        } else if (message.type === 'private.feedback') {
          state.feedbackCount += 1;
        } else if (message.type === 'room.snapshot') {
          state.firstRoomAt ??= Date.now();
          state.roomMessages += 1;
          state.room = {
            roomId: message.roomId, revision: message.revision, phase: message.phase,
            youSeat: message.youSeat, activeSeat: message.activeSeat,
            grade: message.grade, course: message.course, turn: message.turn,
            mode: message.mode, assisted: message.assisted,
            selfController: message.self.controller, opponentController: message.opponent.controller,
            opponentConnected: message.opponent.connected,
            players: message.state.players.map(boardPlayer),
            result: message.result ? {
              reason: message.result.reason, winnerSeat: message.result.winnerSeat,
              ownLearning: message.result.ownLearning,
            } : null,
          };
          if (message.event?.eventId) {
            const event = message.event;
            const earlier = state.eventRevisions.get(event.eventId);
            if (earlier !== undefined && earlier !== message.revision) state.duplicateEventRevisions += 1;
            state.eventRevisions.set(event.eventId, message.revision);
            state.events.set(event.eventId, { kind: event.kind, seat: event.actorSeat });
          }
        }
      } catch { /* A malformed frame will fail subsequent UI/protocol assertions. */ }
    });
  });
  return state;
}

export const currentProgress = actor => actor.observed.progress.get(actor.observed.player?.playerId)?.data;
export const learned = actor => Object.keys(currentProgress(actor)?.legacy.mastery || {});
export const copies = actor => Object.values(currentProgress(actor)?.collection.test.cards || {}).reduce((sum, n) => sum + n, 0);

export async function safeScreenshot(page, testInfo, name) {
  if (page.isClosed()) return null;
  // Do not photograph the one-time recovery-code screen at all.
  if (await page.locator('.identity-recovery').isVisible().catch(() => false)) return null;
  await mkdir(evidenceDirectory, { recursive: true });
  const file = `${slug(testInfo.title)}-${slug(name)}.png`;
  await page.screenshot({
    path: path.join(evidenceDirectory, file), fullPage: false,
    mask: [page.locator('input[type="password"], [name="recoveryCode"], .identity-recovery')],
  });
  return file;
}

export async function diagnostics(actor) {
  const { page, observed, label } = actor;
  const renderers = await page.locator('canvas').evaluateAll(canvases => canvases.map(canvas => ({
    id: canvas.id, renderer: canvas.dataset.renderer || null,
    recentFrameRate: Number(canvas.dataset.frameRate) || null,
    hidden: canvas.hidden,
  }))).catch(() => []);
  return {
    label, playerKind: observed.player?.kind,
    learnedQuestions: learned(actor).length, collectionCopies: copies(actor),
    roomMessages: observed.roomMessages, sessionReadyMessages: observed.sessions,
    successfulActions: observed.commands.filter(command => observed.acknowledgements.get(command.id)?.ok)
      .reduce((counts, command) => {
        const key = command.action || command.type;
        counts[key] = (counts[key] || 0) + 1; return counts;
      }, {}),
    rejectedCommandCodes: observed.errors,
    duplicateEventRevisions: observed.duplicateEventRevisions,
    feedbackCount: observed.feedbackCount, pageErrorCount: observed.pageErrorCount,
    uiInteractions: actor.metrics,
    queueWaitMs: observed.firstRoomAt && observed.queueStartedAt ? observed.firstRoomAt - observed.queueStartedAt : null,
    result: observed.room?.result || null,
    viewport: page.viewportSize(),
    visibilityAtSample: await page.evaluate(() => document.visibilityState).catch(() => 'unavailable'),
    renderers,
    renderingCaveat: 'One sampled renderer/frame-rate diagnostic, not a whole-session performance measurement or physical-device test',
  };
}

export const test = base.extend({
  server: async ({}, use) => {
    const server = await createAcceptanceServer();
    try { await server.start(); await use(server); }
    finally { await server.close(); }
  },
  actors: async ({ browser, server }, use, testInfo) => {
    const actors = [];
    async function make(label, options = {}) {
      // Each actor has a wholly separate cookie jar and web storage. No storage
      // state file, shared profile, or identity seeding is used.
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 }, locale: 'zh-CN', ...options,
      });
      const page = await context.newPage();
      const actor = { label, context, page, observed: observe(page), metrics: { summons: 0, attacks: 0, answers: 0 } };
      actors.push(actor);
      await page.goto(server.origin);
      await expect(action(page, 'identity')).toContainText('游客');
      await expect.poll(() => actor.observed.player?.kind).toBe('guest');
      await expect.poll(() => Boolean(currentProgress(actor))).toBe(true);
      await expect(page.locator('.connection')).toHaveClass(/online/);
      return actor;
    }
    try { await use(make); }
    finally {
      await mkdir(evidenceDirectory, { recursive: true });
      const records = [];
      for (const actor of actors) {
        if (testInfo.status !== testInfo.expectedStatus)
          await safeScreenshot(actor.page, testInfo, `failure-${actor.label}`).catch(() => {});
        records.push(await diagnostics(actor));
        await actor.context.close();
      }
      await writeFile(path.join(evidenceDirectory, `${slug(testInfo.title)}-observations.json`), JSON.stringify({
        schema: 1, actors: records,
      }, null, 2));
    }
  },
});

export async function calmAnimations(actor) {
  const page = actor.page;
  await action(page, 'settings').click();
  await page.locator('#setting-reduced').check();
  await page.locator('#setting-music').uncheck();
  await page.locator('#setting-sound').uncheck();
  await page.locator('#setting-speech').uncheck();
  await action(page, 'save-settings').click();
  await expect(page.locator('.settings')).toBeHidden();
  await expect.poll(() => currentProgress(actor)?.legacy?.reduced).toBe(true);
}

export async function studyOne(actor, { except } = {}) {
  const page = actor.page;
  const learnedBefore = learned(actor).length;
  await page.bringToFront();
  await action(page, 'study').click();
  await page.locator('[data-action="desk-filter"][data-value="all"]').click();
  const choices = action(page, 'desk-study');
  await expect(choices.first()).toBeVisible();
  const identifiers = await choices.evaluateAll(elements => elements.map(element => element.dataset.value));
  const qid = identifiers.find(value => value !== except && !learned(actor).includes(value));
  expect(Boolean(qid), 'a visible study item is available').toBe(true);
  await page.locator(`[data-action="desk-study"][data-value="${qid}"]`).click();
  await expect(action(page, 'desk-answer').first()).toBeVisible();
  await sleep(2100); // Real visible reading time; no clock or answer manipulation.
  await action(page, 'desk-answer').first().click();
  await expect(page.locator('.study-desk .feedback')).toBeVisible();
  await expect.poll(() => learned(actor).includes(qid)).toBe(true);
  await sleep(1300);
  const participation = page.waitForResponse(response => new URL(response.url()).pathname === '/api/progress/participation' && response.request().method() === 'POST');
  await action(page, 'desk-back').click();
  expect((await participation).ok(), 'visible reading and feedback participation saved').toBe(true);
  await expect(page.locator('.study-desk')).toContainText(`已练 ${learnedBefore + 1}项`);
  await action(page, 'close-panel').click();
  return qid;
}

export async function openTestGift(actor, testInfo) {
  const page = actor.page;
  await action(page, 'collection').click();
  await page.locator('[data-action="collection-open"][data-value="test"]').click();
  await expect(page.locator('#pack-canvas')).toBeVisible();
  await action(page, 'collection-reveal-all').click();
  await expect(page.locator('#pack-count')).toHaveText('已揭开 10/10');
  await expect.poll(() => copies(actor)).toBe(10);
  await safeScreenshot(page, testInfo, 'test-gift-ten-revealed');
  await action(page, 'collection-finish').click();
  await action(page, 'collection-close').click();
  await expect(page.locator('#collection-root')).toBeHidden();
}

export function fictionalUsername(prefix = 'Forest') {
  return prefix + [...crypto.getRandomValues(new Uint8Array(12))].map(value => String.fromCharCode(97 + value % 26)).join('');
}
export async function register(actor, username, password = 'forest') {
  const page = actor.page;
  const before = actor.observed.player.playerId;
  await action(page, 'identity').click();
  const dialog = page.locator('.identity-panel');
  await dialog.getByRole('button', { name: '创建账号，保留此游客', exact: true }).click();
  await dialog.getByLabel('用户名', { exact: true }).fill(username);
  await dialog.getByLabel('密码', { exact: true }).fill(password);
  await expect(dialog.getByLabel('密码', { exact: true })).toHaveAttribute('type', 'password');
  await dialog.getByRole('button', { name: '创建账号', exact: true }).click();
  await expect(dialog.locator('.identity-success')).toContainText('账号已创建');
  await expect.poll(() => actor.observed.player?.kind).toBe('account');
  expect(actor.observed.player.playerId).toBe(before);
  await dialog.getByRole('button', { name: '继续返回营地', exact: true }).click();
  await expect(action(page, 'identity')).toContainText(username);
  await expect(page.locator('.connection')).toHaveClass(/online/);
  return before;
}

export async function logout(actor) {
  await action(actor.page, 'identity').click();
  const dialog = actor.page.locator('.identity-panel');
  await dialog.getByRole('button', { name: '退出账号', exact: true }).click();
  await dialog.getByRole('button', { name: '确认退出账号', exact: true }).click();
  await expect(dialog.locator('.identity-success')).toContainText('已退出账号');
  await dialog.getByRole('button', { name: '继续返回营地', exact: true }).click();
  await expect(action(actor.page, 'identity')).toContainText('游客');
  await expect.poll(() => actor.observed.player?.kind).toBe('guest');
  await expect.poll(() => Boolean(currentProgress(actor))).toBe(true);
  await expect(actor.page.locator('.connection')).toHaveClass(/online/);
}

export async function login(actor, username, password = 'forest') {
  await action(actor.page, 'identity').click();
  const dialog = actor.page.locator('.identity-panel');
  await dialog.getByRole('button', { name: '登录已有账号', exact: true }).click();
  await dialog.getByLabel('用户名', { exact: true }).fill(username);
  await dialog.getByLabel('密码', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: '登录', exact: true }).click();
  await expect(dialog.locator('.identity-success')).toContainText('已登录账号');
  await dialog.getByRole('button', { name: '继续返回营地', exact: true }).click();
  await expect(action(actor.page, 'identity')).toContainText(username);
  await expect.poll(() => actor.observed.player?.kind).toBe('account');
  await expect.poll(() => Boolean(currentProgress(actor))).toBe(true);
  await expect(actor.page.locator('.connection')).toHaveClass(/online/);
}

export async function prepareMatch(actor, grade = 1, course = 's1-u1') {
  const page = actor.page;
  await action(page, 'match-setup').click();
  await page.locator(`[data-action="grade"][data-value="${grade}"]`).click();
  await page.locator('#course').selectOption(course);
  await page.locator('#deck').selectOption('ember');
  await expect(action(page, 'match')).toBeEnabled();
}

export async function matchPair(a, b) {
  expect(a.context).not.toBe(b.context);
  expect(a.observed.player.playerId).not.toBe(b.observed.player.playerId);
  await prepareMatch(a);
  await prepareMatch(b);
  await Promise.all([action(a.page, 'match').click(), action(b.page, 'match').click()]);
  await Promise.all([a, b].map(actor => expect(action(actor.page, 'opening-confirm')).toBeVisible()));
  await expect.poll(() => Boolean(a.observed.room?.roomId && a.observed.room.roomId === b.observed.room?.roomId)).toBe(true);
  expect(a.observed.room.youSeat).not.toBe(b.observed.room.youSeat);
  expect(a.observed.room.grade).toBe(1);
  expect(a.observed.room.course).toBe('s1-u1');
  expect(a.observed.room.opponentController).toBe('human');
  expect(b.observed.room.opponentController).toBe('human');
}

export async function confirmOpening(a, b) {
  await Promise.all([a, b].map(actor => action(actor.page, 'opening-confirm').click()));
  await expect.poll(() => a.observed.room?.phase).toBe('playing');
  await expect.poll(() => b.observed.room?.phase).toBe('playing');
  await sync(a, b);
}

export async function sync(a, b) {
  await expect.poll(() => {
    const left = a.observed.room, right = b.observed.room;
    return Boolean(left && right && left.roomId === right.roomId && left.revision === right.revision &&
      left.phase === right.phase && left.activeSeat === right.activeSeat &&
      JSON.stringify(left.players) === JSON.stringify(right.players));
  }, { message: 'both independent browsers received the same authoritative public board' }).toBe(true);
}

export async function waitForBoard(actor) {
  await expect.poll(async () => actor.observed.room?.phase === 'finished' ||
    await actor.page.locator('[data-action="end"]:enabled').count() > 0,
  { message: 'the visible active board finished settling' }).toBe(true);
}

export async function uiCommand(actor, click) {
  const before = actor.observed.commands.length;
  await click();
  await expect.poll(() => actor.observed.commands.slice(before).some(command =>
    actor.observed.acknowledgements.has(command.id)), { message: 'the clicked UI action received its real server acknowledgement' }).toBe(true);
  const command = actor.observed.commands.slice(before).find(item => actor.observed.acknowledgements.has(item.id));
  expect(actor.observed.acknowledgements.get(command.id).ok, `UI command accepted: ${command.type}`).toBe(true);
  return command;
}

export async function canvasAndKeyboard(actor, testInfo) {
  const page = actor.page;
  await page.bringToFront();
  await waitForBoard(actor);
  const canvas = page.locator('#hand-canvas');
  await expect(canvas).toBeVisible();
  await expect(canvas).not.toHaveAttribute('data-renderer', 'unavailable');
  const bounds = await canvas.boundingBox();
  expect(Boolean(bounds && bounds.width > 100 && bounds.height > 80)).toBe(true);
  // Public canvas bounds and genuine pointer events only. No renderer picking
  // functions, layout internals, engine state or synthesized DOM clicks.
  for (const fraction of [0.5, 0.35, 0.65, 0.2, 0.8]) {
    await canvas.click({ position: { x: bounds.width * fraction, y: bounds.height * 0.55 } });
    if (await page.locator('.card-command').isVisible()) break;
  }
  await expect(page.locator('.card-command')).toBeVisible();
  actor.metrics.canvasPointerSelection = true;
  await safeScreenshot(page, testInfo, 'canvas-card-selected');
  await action(page, 'clear').click();
  const first = page.locator('#hand-semantics [data-hand-index]').first();
  await first.focus();
  await page.keyboard.press('i');
  await expect(page.locator('.card-info-dialog')).toBeVisible();
  await safeScreenshot(page, testInfo, 'keyboard-card-description');
  await action(page, 'card-info-close').click();
  await first.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.card-command')).toBeVisible();
  actor.metrics.keyboardDescriptionAndSelection = true;
  await action(page, 'clear').click();
}

export async function answerRitual(actor, testInfo) {
  const page = actor.page;
  await waitForBoard(actor);
  const insight = page.locator('[data-action="ritual"][data-value="insight"]');
  if (!await insight.isEnabled()) return false;
  await uiCommand(actor, () => insight.click());
  await expect(action(page, 'answer').first()).toBeVisible();
  await safeScreenshot(page, testInfo, `${actor.label}-english-question`);
  await sleep(2100);
  await uiCommand(actor, () => action(page, 'answer').first().click());
  await expect(page.locator('[data-action="recap-expand"], [data-action="quiz-close"]').first()).toBeVisible();
  if (await action(page, 'recap-expand').isVisible()) await action(page, 'recap-expand').click();
  await expect(action(page, 'quiz-close')).toBeVisible();
  await sleep(1300);
  await action(page, 'quiz-close').click();
  await expect(page.locator('.quiz, .battle-recap')).toBeHidden();
  actor.metrics.answers += 1;
  return true;
}

async function playOneVisibleCard(actor) {
  const page = actor.page;
  const labels = await page.locator('#hand-semantics [data-hand-index]').evaluateAll(elements =>
    elements.map(element => ({ index: Number(element.dataset.handIndex), label: element.getAttribute('aria-label') })));
  const manaText = await page.locator('.hero-panel.mine .mana b').innerText();
  const mana = Number(manaText.split('/')[0]);
  const candidates = labels.map(card => ({ ...card, cost: Number(card.label.match(/，(\d+)能量/)?.[1]) }))
    .filter(card => Number.isFinite(card.cost) && card.cost <= mana).sort((left, right) => left.cost - right.cost);
  for (const card of candidates) {
    await page.locator(`#hand-semantics [data-hand-index="${card.index}"]`).focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.card-command')).toBeVisible();
    const play = action(page, 'play');
    if (await play.count() && await play.isEnabled()) {
      const summon = (await play.innerText()).includes('召唤');
      await uiCommand(actor, () => play.click());
      if (summon) actor.metrics.summons += 1;
      return true;
    }
    if (await page.locator('.card-reason').filter({ hasText: '点击亮起的敌人来施放' }).count()) {
      await uiCommand(actor, () => action(page, 'enemy-hero').click());
      return true;
    }
    await action(page, 'clear').click();
  }
  return false;
}

async function attackOneVisibleTarget(actor) {
  const page = actor.page;
  const ready = page.locator('.unit-label.ready[aria-label*="可攻击"]').first();
  if (!await ready.count()) return false;
  await ready.click();
  await expect(page.locator('.target-command')).toBeVisible();
  const highlighted = page.locator('.unit-label.targetable').first();
  await uiCommand(actor, () => highlighted.count().then(count => count ? highlighted.click() : action(page, 'enemy-hero').click()));
  actor.metrics.attacks += 1;
  return true;
}

/** Deliberately simple UI policy: visible affordable cards, visible highlighted
 * targets, and the first displayed English option. It does not import game rules
 * or the AI, and never examines undisclosed cards or answers.
 */
export async function playTurn(actor, other, testInfo) {
  await actor.page.bringToFront();
  await waitForBoard(actor);
  if (actor.observed.room.phase === 'finished') return;
  if (!actor.metrics.answers) { await answerRitual(actor, testInfo); await sync(actor, other); }
  for (let moves = 0; moves < 24; moves += 1) {
    await waitForBoard(actor);
    if (actor.observed.room.phase === 'finished') return;
    if (await attackOneVisibleTarget(actor)) { await sync(actor, other); continue; }
    if (await playOneVisibleCard(actor)) { await sync(actor, other); continue; }
    await uiCommand(actor, () => action(actor.page, 'end').click());
    await sync(actor, other);
    return;
  }
  throw new Error('Visible UI actions did not finish this turn within the bounded move budget');
}
