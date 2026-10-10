// The explicit local configuration copies this beside the original E2E
// modules. Its helpers import resolves only in that generated suite.
import {
  test, expect, action, currentProgress, register,
  calmAnimations, matchPair, confirmOpening, safeScreenshot, diagnostics,
} from './helpers.mjs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

test('@local-polish wide real battle HUD contains long account names and preserves complete accessible identity', async ({ actors }, testInfo) => {
  testInfo.annotations.push({ type: 'coverage', description: 'Two actual registered fictional long-name accounts and an ordinary match at 1280x800 and 1600x900. Public layout, complete title/accessible identity and visible HP/mana only; no physical-device or full-match claim.' });
  const a = await actors('long-name-A');
  const b = await actors('long-name-B');
  // These 42/38-letter fictional usernames stay within the existing public
  // display-name cap; this fixture tests clipping, not account-name policy.
  const aName = 'WillowForestCompanion'.repeat(2);
  const bName = 'CedarForestCompanion'.repeat(2).slice(0, 38);
  await register(a, aName); await register(b, bName);
  await calmAnimations(a); await calmAnimations(b);
  await matchPair(a, b); await confirmOpening(a, b);
  const layouts = [];
  for (const viewport of [{ width: 1280, height: 800 }, { width: 1600, height: 900 }]) {
    await a.page.setViewportSize(viewport); await b.page.setViewportSize(viewport);
    await a.page.bringToFront(); await settle(a.page);
    const panels = await a.page.locator('.hero-panel').evaluateAll(elements => elements.map(element => {
      const box = element.getBoundingClientRect();
      const name = element.querySelector('strong'); const nameBox = name.getBoundingClientRect();
      const style = getComputedStyle(name);
      return {
        side: element.classList.contains('mine') ? 'self' : 'opponent',
        box: box.toJSON(), name: nameBox.toJSON(), title: name.title,
        accessible: element.getAttribute('aria-label'), text: name.textContent,
        textOverflow: style.textOverflow, overflowX: style.overflowX, whiteSpace: style.whiteSpace,
        nameFontSize: Number.parseFloat(style.fontSize),
        hp: element.querySelector('.hero-gem')?.textContent,
        mana: element.querySelector('.mana b')?.textContent,
      };
    }));
    layouts.push({ viewport, panels });
    await writeFile(path.join(process.env.SPELLWOOD_LOCAL_EVIDENCE, 'local-wide-name-layout.json'), JSON.stringify({ schema: 1, layouts }, null, 2));
    await safeScreenshot(a.page, testInfo, `${viewport.width}x${viewport.height}-long-real-account-names`);
    expect(panels).toHaveLength(2);
    for (const panel of panels) {
      const name = panel.side === 'self' ? aName : bName;
      expect(panel.text).toBe(name); expect(panel.title).toBe(name); expect(panel.accessible).toContain(name);
      expect(panel.box.x).toBeGreaterThanOrEqual(0); expect(panel.box.right).toBeLessThanOrEqual(viewport.width);
      expect(panel.box.width, 'a long identity cannot widen the HUD into the board').toBeLessThanOrEqual(220);
      expect(panel.name.left).toBeGreaterThanOrEqual(panel.box.left);
      expect(panel.name.right).toBeLessThanOrEqual(panel.box.right);
      expect(panel.name.top).toBeGreaterThanOrEqual(panel.box.top);
      expect(panel.name.bottom).toBeLessThanOrEqual(panel.box.bottom);
      expect(panel.textOverflow).toBe('ellipsis'); expect(panel.overflowX).not.toBe('visible');
      expect(panel.whiteSpace).toBe('nowrap'); expect(panel.nameFontSize).toBeGreaterThanOrEqual(13);
      expect(panel.hp).toMatch(/^\d+$/); expect(panel.mana).toMatch(/^\d+\/\d+$/);
    }
  }
  await writeFile(path.join(process.env.SPELLWOOD_LOCAL_EVIDENCE, 'local-wide-name-layout.json'), JSON.stringify({ schema: 1, layouts }, null, 2));
  expect(a.observed.errors).toEqual([]); expect(b.observed.errors).toEqual([]);
});

test('@local-polish first hand selection clears the introductory hint and detail close restores keyboard focus', async ({ actors }, testInfo) => {
  testInfo.annotations.push({ type: 'coverage', description: 'Fresh ordinary match, actually displayed introductory hint, real keyboard card selection, I inspection and close. Hint clears within 200ms instead of waiting for its 4.2-second expiry; selection and exact hand focus survive without any battle command.' });
  const a = await actors('hand-hint-A', { viewport: { width: 844, height: 390 } });
  const b = await actors('hand-hint-B');
  await calmAnimations(a); await calmAnimations(b);
  await matchPair(a, b); await confirmOpening(a, b);
  const actor = a.observed.room.activeSeat === a.observed.room.youSeat ? a : b;
  await actor.page.setViewportSize({ width: 844, height: 390 }); await actor.page.bringToFront();
  const hint = actor.page.locator('#notice');
  await expect(hint).toHaveAttribute('data-kind', 'hand-tip');
  await expect(hint).toContainText('手牌');
  const beforeCommands = actor.observed.commands.length;
  const beforeRevision = actor.observed.room.revision;
  const heldCard = actor.page.locator('#hand-semantics [data-hand-index="0"]');
  await heldCard.focus(); await actor.page.keyboard.press('Enter');
  await expect(actor.page.locator('.card-command')).toBeVisible();
  await expect(hint).toHaveText('', { timeout: 200 });
  await safeScreenshot(actor.page, testInfo, 'selected-hand-hint-cleared');
  await actor.page.keyboard.press('i');
  await expect(actor.page.locator('.card-info-dialog')).toBeVisible();
  await actor.page.locator('.card-info-dialog').getByRole('button', { name: '返回棋盘', exact: true }).click();
  await expect(actor.page.locator('.card-info-dialog')).toBeHidden();
  await expect(heldCard).toBeFocused();
  await expect(actor.page.locator('.card-command')).toBeVisible();
  await expect(hint).toHaveText('');
  expect(actor.observed.commands.length).toBe(beforeCommands);
  expect(actor.observed.room.revision).toBe(beforeRevision);
  await safeScreenshot(actor.page, testInfo, 'detail-closed-exact-hand-focus');
});

test('@local-polish a saved real pack ignores right click and multiple touch but still opens from primary input', async ({ actors }, testInfo) => {
  test.setTimeout(90_000);
  testInfo.annotations.push({ type: 'coverage', description: 'Ordinary test gift saved through real UI before presentation. Native right mouse and CDP-dispatched two-contact touch do not launch/reveal; normal primary mouse still opens the same saved batch. Chrome touch emulation is not a physical touchscreen or animation performance acceptance.' });
  const actor = await actors('pack-gesture', { hasTouch: true, viewport: { width: 1280, height: 800 } });
  const page = actor.page;
  await page.bringToFront();
  await action(page, 'camp-more').click(); await action(page, 'collection').click();
  await page.locator('[data-action="collection-open"][data-value="test"]').click();
  const canvas = page.locator('#pack-canvas');
  await expect(canvas).toBeVisible(); await expect(action(page, 'collection-launch')).toBeVisible();
  await expect.poll(() => currentProgress(actor)?.collection.opening?.revealed).toBe(0);
  const saved = structuredClone(currentProgress(actor).collection.opening);
  const expectSealed = async () => {
    await expect(action(page, 'collection-launch')).toBeVisible();
    await expect(page.locator('#pack-instruction')).toContainText('点击礼盒');
    expect(currentProgress(actor).collection.opening).toEqual(saved);
    await expect(page.locator('#pack-count')).toHaveText('已揭开 0/10');
  };
  await canvas.click({ button: 'right' }); await expectSealed();
  // Headed Mac Chrome may retain its native menu after a renderer-only corner
  // click. Escape dismisses it; if the app also receives Escape, use its real
  // resume control to restore the same already-saved batch before continuing.
  await page.keyboard.press('Escape');
  const resume = action(page, 'collection-cancel-close');
  if (await resume.isVisible()) await resume.click();
  await expectSealed();
  const box = await canvas.boundingBox(); expect(box).not.toBeNull();
  const point = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2), id: 1 };
  const second = { x: point.x + 25, y: point.y, id: 2 };
  const cdp = await actor.context.newCDPSession(page);
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point, second] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally { await cdp.detach(); }
  await expectSealed(); await safeScreenshot(page, testInfo, 'secondary-and-multiple-touch-kept-sealed');
  await canvas.click();
  await expect(action(page, 'collection-launch')).toBeHidden();
  await expect(action(page, 'collection-reveal').first()).toBeEnabled({ timeout: 7000 });
  expect(currentProgress(actor).collection.opening).toEqual(saved);
  await expect(page.locator('#pack-count')).toHaveText('已揭开 0/10');
  await safeScreenshot(page, testInfo, 'normal-primary-opened-same-saved-batch');
  expect(actor.observed.pageErrorCount).toBe(0);
  // Preserve the final real gift diagnostics before releasing its WebContents.
  // This navigation is cleanup only: every gesture assertion, saved-batch check
  // and original screenshot above must succeed first. Close remains limited to
  // five seconds and any navigation/close failure is still a failed test.
  await writeFile(path.join(process.env.SPELLWOOD_LOCAL_EVIDENCE, 'local-pack-gesture-body.json'), JSON.stringify({
    schema: 1, status: 'body-checks-passed', diagnostics: await diagnostics(actor),
    cleanupNavigation: 'about:blank after completed evidence; not a product/performance change',
  }, null, 2));
  await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 3000 });
});
