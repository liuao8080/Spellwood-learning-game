import {
  test, expect, action, currentProgress, safeScreenshot, prepareMatch, calmAnimations,
  confirmOpening, sync, waitForBoard, uiCommand,
} from './helpers.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { extractCombatFrames } from '../../scripts/extract-combat-frames.mjs';
import { startPassiveFrameDiagnostics } from '../../scripts/passive-frame-diagnostics.mjs';

import { normalMotion, buildMeleeDeck, reachReadyMelee, publicState, startDomObservation, startArenaRecording } from './combat-motion-tools.mjs';

test('@combat-motion normal melee leaves its slot, changes hero HP once and returns', async ({ actors }, testInfo) => {
  test.setTimeout(120_000);
  testInfo.annotations.push({ type: 'coverage', description: 'One real melee attack. A uses normal motion at 844x390; B uses reduced motion via Settings. Only the anonymous arena canvas is natively recorded for about three seconds, with no audio, display capture, whole-session video, HAR, clock change or scene injection. Original lossy-video decoded frames and actual PTS require pixel review; DOM RAF observations and own received authoritative state are separate evidence. No audio/healing/shield/armor/death/pack-opening or physical-GPU claim.' });
  const began = Date.now(), directory = path.resolve('test-results/browser-evidence');
  await mkdir(directory, { recursive: true });
  const evidence = { status: 'preparing', stages: [], screenshots: [],
    coverage: { normalMotionViewer: 'A', viewport: { width: 844, height: 390 }, otherParticipantReducedMotion: true,
      attackCount: 1, audio: false, maximumRecordedFrameGapSeconds: 0.25 },
    visualReview: { status: 'required', checks: ['target line or arrow', 'departure', 'contact flash', 'floating damage', 'return'] },
    caveat: 'WebM uses lossy VP8. PNGs are unchanged decoded video frames, not lossless canvas captures. Native frame PTS describe this recording, not exact animation duration. WebGL2 does not prove physical GPU acceleration.' };
  let a, b, writes = Promise.resolve();
  const checkpoint = () => {
    if (a?.observed.room) evidence.latestAuthority = publicState(a);
    const data = JSON.stringify({ schema: 2, combatMotion: evidence }, null, 2);
    writes = writes.then(() => writeFile(path.join(directory, 'combat-motion-checkpoints.json'), data))
      .catch(() => { evidence.checkpointWriteFailed = true; });
    return writes;
  };
  const stage = async (name, limitMs, work) => {
    const available = 110_000 - (Date.now() - began);
    const record = { name, limitMs: Math.max(0, Math.min(limitMs, available)), status: 'running' };
    evidence.stages.push(record);
    await checkpoint();
    let timer;
    const started = Date.now();
    try {
      if (record.limitMs <= 0) throw new Error('Combat evidence stage budget exhausted');
      const value = await Promise.race([work(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Combat evidence stage deadline: ${name}`)), record.limitMs);
      })]);
      record.status = 'passed';
      return value;
    } catch (error) {
      record.status = 'failed'; evidence.status = 'failed'; evidence.failedStage = name;
      throw error;
    } finally {
      clearTimeout(timer); record.elapsedMs = Date.now() - started; await checkpoint();
    }
  };
  const screenshot = async name => {
    const started = Date.now();
    const file = await safeScreenshot(a.page, testInfo, name);
    evidence.screenshots.push({ file, elapsedMs: Date.now() - started });
    expect(file).not.toBeNull();
    await checkpoint();
  };
  let observationStarted = false, commandStart, otherCommandStart, eventIds;
  try {
    await stage('isolated-guests', 25_000, async () => {
      a = await actors('motion-guest-A', { viewport: { width: 844, height: 390 }, reducedMotion: 'no-preference' });
      // Setup uses the same bounded action budget as the rest of browser CI.
      // The stricter capture-stage deadlines below still guard recording.
      a.metrics.combatMotion = evidence;
      b = await actors('motion-guest-B', { reducedMotion: 'reduce' });
    });
    await stage('settings-and-legal-deck', 30_000, async () => {
      await b.page.bringToFront();
      await calmAnimations(b);
      await a.page.bringToFront();
      await normalMotion(a);
      await buildMeleeDeck(a);
      await prepareMatch(a); await a.page.locator('#deck').selectOption('custom');
      await prepareMatch(b);
    });
    await stage('real-match-and-opening', 15_000, async () => {
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
    });
    const uid = await stage('ordinary-turns-to-melee', 18_000, () => reachReadyMelee(a, b));
    const page = a.page, seat = a.observed.room.youSeat, enemySeat = 1 - seat;
    const before = evidence.before = publicState(a), source = before.players[seat].board.find(unit => unit.uid === uid);
    evidence.sourceUid = uid; evidence.sourceCard = source.cardId;
    expect(before.players[seat].board).toHaveLength(1);
    expect(before.players[enemySeat].board).toHaveLength(0);
    expect(before.players[enemySeat].armor).toBe(0);
    expect(source.atk).toBeGreaterThan(0);
    expect(before.players[enemySeat].hp).toBeGreaterThan(source.atk);
    await stage('selected-target-and-before-image', 7000, async () => {
      await expect(page.locator('#arena')).toHaveAttribute('data-reduced-motion', 'false');
      await expect(page.locator('#arena')).toHaveAttribute('data-renderer', /^(WebGL2|CPU · 兼容三维)$/);
      await expect(b.page.locator('#arena')).toHaveAttribute('data-reduced-motion', 'true');
      evidence.renderEnvironment = await page.evaluate(() => {
        const arena = document.querySelector('#arena');
        if (arena.dataset.renderer !== 'WebGL2') return { path: 'CPU compatibility' };
        // The canvas already owns this context. No creation attributes, render
        // parameters, security options or application state are changed.
        const gl = arena.getContext('webgl2');
        if (!gl) return { path: 'WebGL2', contextReadable: false };
        const text = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, '').slice(0, 160) : null;
        const extension = gl.getExtension('WEBGL_debug_renderer_info');
        return { path: 'WebGL2', contextReadable: true,
          vendor: text(gl.getParameter(gl.VENDOR)), renderer: text(gl.getParameter(gl.RENDERER)),
          unmaskedRenderer: extension ? text(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)) : null,
          caveat: 'Read-only facts from the isolated CI browser; not a frame-rate measurement or a cause of earlier slowness' };
      });
      await page.locator(`.unit-label[data-uid="${uid}"]`).click();
      await expect(page.locator('.target-command')).toBeVisible();
      await action(page, 'enemy-hero').hover();
      await screenshot('00-selected-before-single-attack');
    });
    let recordingDone;
    const videoPath = path.join(directory, 'combat-motion-anonymous-arena-only.webm');
    await stage('passive-observer-and-arena-recorder', 5000, async () => {
      await startDomObservation(page, uid, evidence, checkpoint);
      observationStarted = true;
      // Do not await the recording's completion here; one real click follows.
      recordingDone = (await startArenaRecording(page, evidence, videoPath, checkpoint)).done;
    });
    commandStart = a.observed.commands.length; otherCommandStart = b.observed.commands.length;
    eventIds = new Set(a.observed.events.keys());
    await stage('single-trusted-attack', 3500, () => action(page, 'enemy-hero').click());
    await stage('native-recording-completion', 8000, async () => {
      expect(await recordingDone, 'arena recording must actually complete within its byte and time bounds').toBe('CAPTURE_COMPLETE');
      await sync(a, b); await waitForBoard(a);
      evidence.after = publicState(a);
      evidence.dom = await page.evaluate(() => window.__combatMotionObservation.finish());
      observationStarted = false;
    });
    await stage('settled-after-image', 4000, async () => {
      await expect(page.locator('.hero-panel.theirs .hero-gem')).toHaveText(String(before.players[enemySeat].hp - source.atk));
      await screenshot('01-settled-after-single-attack');
    });
    // Offline decoding happens only after the same one-time capture is stopped.
    await stage('decode-original-video-frames', 22_000, async () => {
      evidence.decoded = await extractCombatFrames({ videoPath, outputDirectory: directory, prefix: 'combat-motion-arena', maximumFrames: 12 });
    });
    await stage('motion-and-authority-evidence', 4000, async () => {
      evidence.commands = a.observed.commands.slice(commandStart).map(command => ({
        type: command.type, action: command.action, accepted: a.observed.acknowledgements.get(command.id)?.ok === true,
      }));
      evidence.newEvents = [...a.observed.events.entries()].filter(([id]) => !eventIds.has(id)).map(([id, event]) => ({
        kind: event.kind, seat: event.seat, revision: a.observed.eventRevisions.get(id),
      }));
      expect(evidence.commands).toEqual([{ type: 'battle.action', action: 'attack', accepted: true }]);
      expect(b.observed.commands.slice(otherCommandStart)).toEqual([]);
      expect(evidence.newEvents).toEqual([{ kind: 'attack', seat, revision: before.revision + 1 }]);
      const expected = structuredClone(before);
      expected.revision += 1; expected.players[enemySeat].hp -= source.atk;
      expected.players[seat].board.find(unit => unit.uid === uid).ready = false;
      expect(evidence.after, 'only enemy HP and attacker ready may change; no draw, buff, armor, mana or new turn').toEqual(expected);
      expect(publicState(b)).toEqual(evidence.after);
      expect(evidence.dom.clicks).toHaveLength(1);
      expect(evidence.dom.clicks[0].trusted).toBe(true);
      const samples = evidence.dom.samples, baseline = samples[0];
      const distance = sample => sample.source && baseline.source
        ? Math.hypot(sample.source.x - baseline.source.x, sample.source.y - baseline.source.y) : null;
      const hpTransitions = samples.filter((sample, index) => !index || sample.enemyHp !== samples[index - 1].enemyHp);
      evidence.summary = {
        renderer: baseline.renderer, normalMotionSamples: samples.length,
        maximumSourceDisplacementPx: Math.max(...samples.map(distance).filter(value => value !== null)),
        sourceDisplacementAtFirstHpChangePx: hpTransitions[1] ? distance(hpTransitions[1]) : null,
        finalSourceDisplacementPx: distance(evidence.dom.final),
        visualHpStates: hpTransitions.map(sample => ({ elapsedMs: sample.elapsedMs, hp: sample.enemyHp })),
        authoritativeHealthDelta: evidence.after.players[enemySeat].hp - before.players[enemySeat].hp,
      };
      expect(samples.length, 'coverage requires real multi-frame observations').toBeGreaterThanOrEqual(8);
      for (const sample of [...samples, evidence.dom.final]) {
        expect(sample.reducedMotion).toBe(false); expect(sample.arenaHidden).toBe(false);
        expect(sample.visibility).toBe('visible'); expect(sample.renderer).toBe(baseline.renderer);
        expect(sample.arena, 'layout motion cannot impersonate a unit attack').toEqual(baseline.arena);
        expect(sample.source).not.toBeNull();
        expect(Number.isFinite(sample.source.x) && Number.isFinite(sample.source.y)).toBe(true);
      }
      expect(hpTransitions.map(sample => sample.enemyHp)).toEqual([before.players[enemySeat].hp, expected.players[enemySeat].hp]);
      expect(evidence.summary.maximumSourceDisplacementPx).toBeGreaterThan(24);
      expect(evidence.summary.sourceDisplacementAtFirstHpChangePx).toBeGreaterThan(24);
      expect(evidence.summary.finalSourceDisplacementPx).toBeLessThan(4);
      expect(evidence.dom.final.inputReady).toBe(true);
      expect(evidence.recording.audioTracks).toBe(0);
      expect(evidence.recording.startElapsedMs).toBeLessThan(evidence.dom.clicks[0].elapsedMs);
      expect(evidence.recording.stopElapsedMs).toBeGreaterThan(hpTransitions[1].elapsedMs);
      expect(evidence.decoded.video.maximumFrameGapSeconds,
        'coverage gap: a recording with large missing-frame intervals cannot establish a short melee sequence').toBeLessThanOrEqual(0.25);
      expect(evidence.decoded.selectedFrames.length).toBeGreaterThanOrEqual(6);
      for (const actor of [a, b]) {
        expect(actor.observed.room.assisted).toBe(false); expect(actor.observed.errors).toEqual([]);
        expect(actor.observed.duplicateEventRevisions).toBe(0);
      }
      a.metrics.attacks += 1;
      evidence.status = 'dom-authority-and-recording-checks-passed; decoded-pixel-review-required';
    });
  } finally {
    // Browser-independent checkpoints come first, preserving evidence even if
    // the page is already gone. Never replace the first failure during cleanup.
    if (a?.observed.room) evidence.after ??= publicState(a);
    if (a && commandStart !== undefined) {
      evidence.commands = a.observed.commands.slice(commandStart).map(command => ({
        type: command.type, action: command.action, accepted: a.observed.acknowledgements.get(command.id)?.ok === true,
      }));
      evidence.newEvents = [...a.observed.events.entries()].filter(([id]) => !eventIds.has(id)).map(([id, event]) => ({
        kind: event.kind, seat: event.seat, revision: a.observed.eventRevisions.get(id),
      }));
    }
    await checkpoint();
    if (observationStarted && a) {
      let timer;
      try {
        const dom = await Promise.race([
          a.page.evaluate(() => { window.__combatCaptureStop?.(); return window.__combatMotionObservation?.finish(); }),
          new Promise(resolve => { timer = setTimeout(() => resolve(null), 2000); }),
        ]);
        if (dom) evidence.dom = dom;
        else evidence.cleanup = 'bounded-cleanup-unavailable';
      } catch { evidence.cleanup = 'page-unavailable'; }
      finally { clearTimeout(timer); }
    }
    await checkpoint();
  }
});
