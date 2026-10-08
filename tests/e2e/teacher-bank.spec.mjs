import { readFileSync } from 'node:fs';
import {
  test, expect, action, sleep, currentProgress, learned, safeScreenshot,
  fictionalUsername, calmAnimations, studyOne, register, login, logout,
  prepareMatch, confirmOpening, sync, playTurn,
} from './helpers.mjs';

const teacherBank = 'teacher-academic';
const bankButton = (page, bank) => page.locator(`[data-action="question-bank"][data-value="${bank}"]`);
// This single, known study scenario supplies the test's expected wrong-answer
// outcome while allowing editorial improvements to the authored English. The
// fixture stays in the Node test process; the browser receives only real UI input.
const readingScenario = JSON.parse(readFileSync(new URL('../../src/teacher-questions.json', import.meta.url), 'utf8'))
  .find(question => question.id === 'ta-reading-01');
const readingDistractor = readingScenario.options.find((_, index) => index !== readingScenario.answer);

async function selectTeacher(actor, course = 'all') {
  await action(actor.page, 'match-setup').click();
  await bankButton(actor.page, teacherBank).click();
  await expect(bankButton(actor.page, teacherBank)).toHaveAttribute('aria-pressed', 'true');
  await actor.page.locator('#teacher-course').selectOption(course);
  await expect.poll(() => ({
    bank: currentProgress(actor)?.legacy.bank,
    teacherCourse: currentProgress(actor)?.legacy.teacherCourse,
  })).toEqual({ bank: teacherBank, teacherCourse: course });
  await expect(action(actor.page, 'match')).toBeEnabled();
}

async function studyCurrentScope(actor) {
  const page = actor.page;
  await page.bringToFront();
  await action(page, 'study').click();
  await page.locator('[data-action="desk-filter"][data-value="all"]').click();
  const item = action(page, 'desk-study').first();
  await expect(item).toContainText('教师内测');
  const qid = await item.getAttribute('data-value');
  await item.click();
  await expect(action(page, 'desk-answer').first()).toBeVisible();
  await sleep(2100);
  await action(page, 'desk-answer').first().click();
  await expect(page.locator('.study-desk .feedback')).toBeVisible();
  await expect.poll(() => learned(actor).includes(qid)).toBe(true);
  await sleep(1300);
  const participation = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/progress/participation' && response.request().method() === 'POST');
  await action(page, 'desk-back').click();
  expect((await participation).ok()).toBe(true);
  await expect(page.locator('.study-desk')).toContainText('已练 1项');
  await action(page, 'close-panel').click();
  return qid;
}

async function noHorizontalOverflow(page) {
  const layout = await page.evaluate(() => ({
    viewport: innerWidth,
    document: document.documentElement.scrollWidth,
    dialogs: [...document.querySelectorAll('.dialog, .academic-passage, .answers')]
      .map(element => ({ visible: element.clientWidth, contents: element.scrollWidth })),
  }));
  expect(layout.document).toBeLessThanOrEqual(layout.viewport + 2);
  for (const box of layout.dialogs) expect(box.contents).toBeLessThanOrEqual(box.visible + 2);
}

test('teacher preference reload preserves school scope mastery and account isolation', async ({ actors }, testInfo) => {
  test.setTimeout(150_000);
  testInfo.annotations.push({ type: 'coverage', description: 'Visible bank/course switching and server-backed reload; the existing school mastery entry remains byte-for-byte unchanged; an independent guest can log into and out of the fictional account without mixing either profile.' });
  const a = await actors('teacher-account');
  await calmAnimations(a);
  await expect.poll(() => a.observed.catalogueCounts).toEqual({ school: 432, teacher: 48 });
  await prepareMatch(a, 6, 's2-u6');
  await action(a.page, 'close-panel').click();
  const schoolQuestion = await studyOne(a);
  const schoolMastery = structuredClone(currentProgress(a).legacy.mastery[schoolQuestion]);
  const username = fictionalUsername('Teacher');
  const accountId = await register(a, username);

  await selectTeacher(a);
  expect(await a.page.locator('#teacher-course option').evaluateAll(options => options.map(option => option.value)))
    .toEqual(['all', 'vocabulary', 'grammar', 'syntax', 'reading']);
  await expect(action(a.page, 'grade')).toHaveCount(0);
  await action(a.page, 'close-panel').click();
  await action(a.page, 'study').click();
  await expect(a.page.locator('.study-desk')).toContainText('当前范围 48项');
  await action(a.page, 'close-panel').click();
  await selectTeacher(a, 'vocabulary');
  await action(a.page, 'close-panel').click();
  const teacherQuestion = await studyCurrentScope(a);
  expect(teacherQuestion).not.toBe(schoolQuestion);
  expect(currentProgress(a).legacy.mastery[schoolQuestion]).toEqual(schoolMastery);
  const accountMastery = structuredClone(currentProgress(a).legacy.mastery);
  const sessionsBefore = a.observed.sessions;
  await a.page.reload();
  await expect.poll(() => a.observed.sessions).toBeGreaterThan(sessionsBefore);
  await expect(action(a.page, 'identity')).toContainText(username);
  await action(a.page, 'match-setup').click();
  await expect(bankButton(a.page, teacherBank)).toHaveAttribute('aria-pressed', 'true');
  await expect(a.page.locator('#teacher-course')).toHaveValue('vocabulary');
  await bankButton(a.page, 'school').click();
  await expect(a.page.locator('[data-action="grade"][data-value="6"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(a.page.locator('#course')).toHaveValue('s2-u6');
  await expect(action(a.page, 'match')).toBeEnabled();
  await action(a.page, 'close-panel').click();
  await action(a.page, 'study').click();
  await expect(a.page.locator('.study-desk')).toContainText('6年级 · 当前范围 6项，已练 1项');
  await safeScreenshot(a.page, testInfo, 'retained-sixth-grade-learning');
  await action(a.page, 'close-panel').click();
  await selectTeacher(a, 'vocabulary');
  await safeScreenshot(a.page, testInfo, 'teacher-scope-after-reload');
  await action(a.page, 'close-panel').click();
  expect(currentProgress(a).legacy.mastery).toEqual(accountMastery);

  const b = await actors('independent-school-guest');
  const guestId = b.observed.player.playerId;
  const guestQuestion = await studyOne(b);
  const guestMastery = structuredClone(currentProgress(b).legacy.mastery);
  expect(guestQuestion).not.toBe(schoolQuestion);
  await login(b, username);
  expect(b.observed.player.playerId).toBe(accountId);
  await expect.poll(() => currentProgress(b).legacy.mastery).toEqual(accountMastery);
  expect(learned(b)).not.toContain(guestQuestion);
  await b.page.reload();
  await expect(action(b.page, 'identity')).toContainText(username);
  await action(b.page, 'match-setup').click();
  await expect(bankButton(b.page, teacherBank)).toHaveAttribute('aria-pressed', 'true');
  await expect(b.page.locator('#teacher-course')).toHaveValue('vocabulary');
  await action(b.page, 'close-panel').click();
  await logout(b);
  expect(b.observed.player.playerId).toBe(guestId);
  await expect.poll(() => currentProgress(b).legacy.mastery).toEqual(guestMastery);
  await action(b.page, 'match-setup').click();
  await expect(bankButton(b.page, 'school')).toHaveAttribute('aria-pressed', 'true');
  expect(learned(b)).not.toContain(teacherQuestion);
  await safeScreenshot(b.page, testInfo, 'separate-guest-restored');
});

test('teacher reading passage choices and wrong-answer explanation fit narrow portrait and landscape', async ({ actors }, testInfo) => {
  test.setTimeout(150_000);
  testInfo.annotations.push({ type: 'coverage', description: 'Real UI at 320x740 and 844x390. Scrolls through a long academic reading passage, checks all four answer targets and feedback controls, deliberately selects a visible distractor, and saves viewport screenshots. This is Chromium emulation, not a physical-device claim.' });
  for (const viewport of [{ width: 320, height: 740 }, { width: 844, height: 390 }]) {
    const size = `${viewport.width}x${viewport.height}`;
    const actor = await actors(`teacher-reading-${size}`, { viewport, isMobile: true, hasTouch: true });
    const page = actor.page;
    await calmAnimations(actor);
    await selectTeacher(actor, 'reading');
    await action(page, 'match').scrollIntoViewIfNeeded();
    await expect(action(page, 'match')).toBeInViewport();
    await noHorizontalOverflow(page);
    await safeScreenshot(page, testInfo, `${size}-teacher-match-options`);
    await action(page, 'close-panel').click();
    await action(page, 'study').click();
    await page.locator('[data-action="desk-filter"][data-value="all"]').click();
    await expect(page.locator('.study-desk')).toContainText('当前范围 12项');
    await page.locator('[data-action="desk-study"][data-value="ta-reading-01"]').click();
    const passage = page.locator('.academic-passage');
    await expect(passage).toBeVisible();
    expect((await passage.innerText()).trim().split(/\s+/).length, 'an actual long reading passage is shown').toBeGreaterThanOrEqual(100);
    const prompt = page.locator('.study-desk .quiz header h3');
    await prompt.scrollIntoViewIfNeeded();
    await expect(prompt).toBeInViewport();
    await safeScreenshot(page, testInfo, `${size}-academic-prompt`);
    await passage.scrollIntoViewIfNeeded();
    await safeScreenshot(page, testInfo, `${size}-academic-passage`);
    await noHorizontalOverflow(page);
    const answers = action(page, 'desk-answer');
    await expect(answers).toHaveCount(4);
    for (let index = 0; index < 4; index += 1) {
      const answer = answers.nth(index);
      await answer.scrollIntoViewIfNeeded();
      await expect(answer).toBeInViewport();
      const box = await answer.boundingBox();
      expect(box.width).toBeGreaterThan(150);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
    }
    await safeScreenshot(page, testInfo, `${size}-academic-answer-choices`);
    // Click the authored distractor by its displayed English. No answer key,
    // opaque option ID or test command is injected into the running game.
    const distractor = answers.filter({ hasText: readingDistractor });
    await expect(distractor).toHaveCount(1);
    await sleep(2100);
    await distractor.click();
    const feedback = page.locator('.study-desk .feedback');
    await expect(feedback).toContainText('一起再看一遍');
    await expect(feedback).toContainText(readingScenario.explanation);
    await feedback.scrollIntoViewIfNeeded();
    await safeScreenshot(page, testInfo, `${size}-academic-wrong-answer-explanation`);
    await noHorizontalOverflow(page);
    for (const name of ['desk-back', 'desk-next']) {
      await action(page, name).scrollIntoViewIfNeeded();
      await expect(action(page, name)).toBeInViewport();
      await expect(action(page, name)).toBeEnabled();
      expect((await action(page, name).boundingBox()).height).toBeGreaterThanOrEqual(44);
    }
    await safeScreenshot(page, testInfo, `${size}-academic-feedback-controls`);
    await action(page, 'desk-back').click();
    await expect(action(page, 'desk-study').first()).toBeVisible();
    await noHorizontalOverflow(page);
  }
});

test('two teacher browsers pair by academic scope and use real cards and teacher rituals', async ({ actors }, testInfo) => {
  test.setTimeout(150_000);
  testInfo.annotations.push({ type: 'coverage', description: 'Two isolated cookie jars pair in teacher reading scope; both answer a genuine server-issued teacher ritual through the UI and at least one real summon is acknowledged. This focused case does not claim to complete a whole match.' });
  const a = await actors('teacher-A');
  const b = await actors('teacher-B');
  expect(a.context).not.toBe(b.context);
  expect(a.observed.player.playerId).not.toBe(b.observed.player.playerId);
  for (const actor of [a, b]) {
    await calmAnimations(actor);
    await selectTeacher(actor, 'reading');
  }
  await Promise.all([a, b].map(actor => action(actor.page, 'match').click()));
  await Promise.all([a, b].map(actor => expect(action(actor.page, 'opening-confirm')).toBeVisible()));
  await expect.poll(() => Boolean(a.observed.room?.roomId && a.observed.room.roomId === b.observed.room?.roomId)).toBe(true);
  for (const actor of [a, b]) {
    expect(actor.observed.queueScope).toEqual({ bank: teacherBank, grade: null, course: 'reading' });
    expect(actor.observed.room).toMatchObject({ bank: teacherBank, grade: null, course: 'reading', mode: 'pvp', opponentController: 'human' });
    await safeScreenshot(actor.page, testInfo, `${actor.label}-teacher-matched-opening`);
  }
  expect(a.observed.room.youSeat).not.toBe(b.observed.room.youSeat);
  await confirmOpening(a, b);
  for (let turns = 0; turns < 8 && (a.metrics.answers === 0 || b.metrics.answers === 0 || a.metrics.summons + b.metrics.summons === 0); turns += 1) {
    const actor = [a, b].find(candidate => candidate.observed.room.youSeat === a.observed.room.activeSeat);
    await playTurn(actor, actor === a ? b : a, testInfo);
  }
  await sync(a, b);
  expect(a.metrics.summons + b.metrics.summons).toBeGreaterThan(0);
  for (const actor of [a, b]) {
    expect(actor.metrics.answers).toBeGreaterThan(0);
    expect(actor.observed.challengeScopes).toHaveLength(1);
    expect(actor.observed.challengeScopes[0]).toEqual({ bank: teacherBank, grade: null, category: 'reading', hasPassage: true });
    expect(actor.observed.errors).toEqual([]);
    expect(actor.observed.room.assisted).toBe(false);
    await expect(actor.page.locator('.battle-context')).toContainText('教师内测');
    await safeScreenshot(actor.page, testInfo, `${actor.label}-teacher-board-after-actions`);
  }
});

test('teacher and school queues stay separate before their real default AI fallbacks', async ({ actors }, testInfo) => {
  testInfo.annotations.push({ type: 'coverage', description: 'Simultaneous teacher and school queue requests from independent real browsers never pair; each waits the default approximately ten seconds and receives a separate, visibly identified computer opponent.' });
  const teacher = await actors('unmatched-teacher');
  const school = await actors('unmatched-school');
  await selectTeacher(teacher, 'grammar');
  await prepareMatch(school, 6, 's2-u6');
  await Promise.all([teacher, school].map(actor => action(actor.page, 'match').click()));
  await expect(teacher.page.locator('.match-setup')).toContainText('正在寻找相同教师题库与范围的对手');
  await expect(school.page.locator('.match-setup')).toContainText('正在寻找相同年级与范围的对手');
  for (const actor of [teacher, school]) {
    await expect.poll(() => actor.observed.queueDeadline !== null).toBe(true);
    expect(actor.observed.queueDeadline - actor.observed.queueStartedAt).toBeGreaterThanOrEqual(9500);
    expect(actor.observed.queueDeadline - actor.observed.queueStartedAt).toBeLessThanOrEqual(11_000);
    await safeScreenshot(actor.page, testInfo, `${actor.label}-separate-waiting-pool`);
  }
  await Promise.all([teacher, school].map(actor => expect(action(actor.page, 'opening-confirm')).toBeVisible({ timeout: 15_000 })));
  expect(teacher.observed.room.roomId).not.toBe(school.observed.room.roomId);
  expect(teacher.observed.room).toMatchObject({ bank: teacherBank, grade: null, course: 'grammar' });
  expect(school.observed.room).toMatchObject({ bank: 'school', grade: 6, course: 's2-u6' });
  for (const actor of [teacher, school]) {
    const elapsed = actor.observed.firstRoomAt - actor.observed.queueStartedAt;
    expect(elapsed).toBeGreaterThanOrEqual(9500);
    expect(elapsed).toBeLessThan(20_000);
    expect(actor.observed.room).toMatchObject({ mode: 'pve', opponentController: 'bot' });
    await action(actor.page, 'opening-confirm').click();
    await expect(actor.page.locator('.opening')).toBeHidden();
    await action(actor.page, 'enemy-hero').click();
    await expect(actor.page.locator('#modal-root')).toContainText('森林电脑角色');
    await safeScreenshot(actor.page, testInfo, `${actor.label}-declared-computer-opponent`);
    expect(actor.observed.errors).toEqual([]);
  }
});
