import {
  test, expect, action, currentProgress, safeScreenshot, prepareMatch, calmAnimations,
  confirmOpening, sync, waitForBoard, uiCommand,
} from './helpers.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { extractCombatFrames } from '../../scripts/extract-combat-frames.mjs';

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

async function startDomObservation(page, uid, evidence, checkpoint) {
  // This observer reads only public DOM geometry, rendered hero HP and browser
  // visibility. Native RAF timestamps are observed, never replaced or advanced.
  // No renderer, client, engine, storage, canvas pixels or network API is touched.
  evidence.dom = { samples: [], clicks: [], final: null, sampleLimit: 360, observationLimitMs: 6000, delivery: 'incremental' };
  const finite = value => Number.isFinite(value) ? value : null;
  const safeSample = value => ({
    elapsedMs: finite(value?.elapsedMs),
    source: value?.source ? { x: finite(value.source.x), y: finite(value.source.y), hp: finite(value.source.hp) } : null,
    enemyHp: finite(value?.enemyHp),
    arena: Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, finite(value?.arena?.[key])])),
    renderer: ['WebGL2', 'CPU · 兼容三维'].includes(value?.renderer) ? value.renderer : 'other',
    reducedMotion: typeof value?.reducedMotion === 'boolean' ? value.reducedMotion : null,
    arenaHidden: value?.arenaHidden === true,
    visibility: ['visible', 'hidden'].includes(value?.visibility) ? value.visibility : 'other',
    inputReady: value?.inputReady === true,
    timing: Object.fromEntries(['updateMs','submitMs','anchorMs','frameGapMs','qualityLevel','pixelScale','shadowMapSize']
      .map(key=>[key,finite(value?.timing?.[key])])),
  });
  // Send small, allowlisted batches out before any later screenshot can hang.
  // This binding accepts observations only; it never sends a game command.
  await page.exposeBinding('__combatMotionBatch', (_source, packet) => {
    if (!Number.isInteger(packet?.offset) || packet.offset < 0 || packet.offset >= 360) return;
    for (const [index, value] of (Array.isArray(packet.samples) ? packet.samples.slice(0, 4) : []).entries())
      if (packet.offset + index < 360) evidence.dom.samples[packet.offset + index] = safeSample(value);
    evidence.dom.clicks = (Array.isArray(packet.clicks) ? packet.clicks.slice(0, 4) : []).map(value => ({
      elapsedMs: finite(value?.elapsedMs), trusted: value?.trusted === true,
    }));
    if (packet.final) evidence.dom.final = safeSample(packet.final);
    void checkpoint();
  });
  await page.evaluate(sourceUid => {
    const started = performance.now(), samples = [], clicks = [];
    let frame = null, stopped = false, sent = 0;
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
        timing: {
          updateMs:number(arena.dataset.renderUpdateMs),submitMs:number(arena.dataset.renderSubmitMs),
          anchorMs:number(arena.dataset.renderAnchorMs),frameGapMs:number(arena.dataset.frameGapMs),
          qualityLevel:number(arena.dataset.qualityLevel),pixelScale:number(arena.dataset.pixelScale),
          shadowMapSize:number(arena.dataset.shadowMapSize),
        },
      };
    };
    const onClick = event => {
      if (clicks.length >= 4 || event.target.closest('[data-action]')?.dataset.action !== 'enemy-hero') return;
      clicks.push({ elapsedMs: Math.round((performance.now() - started) * 100) / 100, trusted: event.isTrusted });
    };
    const publish = final => {
      const offset = sent, batch = samples.slice(sent, sent + 4);
      sent += batch.length;
      void window.__combatMotionBatch({ offset, samples: batch, clicks, final }).catch(() => {});
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
      const complete = samples.length >= 360 || performance.now() - started >= 6000;
      if (samples.length - sent >= 4 || complete) publish(complete ? samples.at(-1) : null);
      if (complete) stop(); else frame = requestAnimationFrame(record);
    };
    document.addEventListener('click', onClick, { capture: true, passive: true });
    samples.push(sample());
    frame = requestAnimationFrame(record);
    window.__combatMotionObservation = {
      mark: () => ({ elapsedMs: Math.round((performance.now() - started) * 100) / 100, latestSample: samples.length - 1 }),
      finish: () => {
        stop();
        const final = sample();
        publish(final);
        const result = { samples, clicks, final, sampleLimit: 360, observationLimitMs: 6000, delivery: 'complete' };
        delete window.__combatMotionObservation;
        return result;
      },
    };
  }, uid);
}

async function startArenaRecording(page, evidence, videoPath, checkpoint) {
  let complete;
  const done = new Promise(resolve => { complete = resolve; });
  await page.exposeBinding('__combatRecordingComplete', async (_source, packet) => {
    const allowed = new Set(['CAPTURE_COMPLETE', 'CAPTURE_UNAVAILABLE', 'CAPTURE_SECURITY', 'CAPTURE_FAILED',
      'CAPTURE_EMPTY', 'CAPTURE_SIZE_LIMIT', 'CAPTURE_HARD_LIMIT', 'CAPTURE_TRACK_ENDED']);
    const code = allowed.has(packet?.code) ? packet.code : 'CAPTURE_FAILED';
    evidence.recording = {
      code, scope: 'Only the anonymous arena canvas; no DOM, hand canvas, display capture or audio',
      requestedFrameRate: 30, requestedAfterClickMs: 3000, hardLimitMs: 6000, byteLimit: 2 * 1024 * 1024,
      startElapsedMs: Number.isFinite(packet?.startElapsedMs) ? packet.startElapsedMs : null,
      stopElapsedMs: Number.isFinite(packet?.stopElapsedMs) ? packet.stopElapsedMs : null,
      trustedClickElapsedMs: Number.isFinite(packet?.trustedClickElapsedMs) ? packet.trustedClickElapsedMs : null,
      width: Number.isInteger(packet?.width) ? packet.width : null,
      height: Number.isInteger(packet?.height) ? packet.height : null,
      audioTracks: packet?.audioTracks === 0 ? 0 : null,
    };
    if (code === 'CAPTURE_COMPLETE') {
      const encoded = packet?.base64;
      if (typeof encoded !== 'string' || encoded.length > 2_800_000 || !/^[a-zA-Z0-9+/]*={0,2}$/.test(encoded)) {
        evidence.recording.code = 'CAPTURE_SIZE_LIMIT';
      } else {
        const bytes = Buffer.from(encoded, 'base64');
        if (!bytes.length || bytes.length > 2 * 1024 * 1024) evidence.recording.code = 'CAPTURE_SIZE_LIMIT';
        else {
          try {
            await writeFile(videoPath, bytes);
            evidence.recording.file = path.basename(videoPath);
            evidence.recording.bytes = bytes.length;
          } catch { evidence.recording.code = 'CAPTURE_WRITE_FAILED'; }
        }
      }
    }
    await checkpoint();
    complete(evidence.recording.code);
  });
  const support = await page.evaluate(() => new Promise(resolve => {
    const arena = document.querySelector('#arena');
    const mimeType = 'video/webm;codecs=vp8';
    if (!(arena instanceof HTMLCanvasElement) || arena.hidden || !document.body.classList.contains('has-room') ||
      document.querySelector('.identity-panel, .identity-recovery') || typeof arena.captureStream !== 'function' ||
      typeof MediaRecorder !== 'function' || !MediaRecorder.isTypeSupported(mimeType)) {
      resolve({ supported: false, code: 'CAPTURE_UNAVAILABLE' }); return;
    }
    let stream, recorder, stopTimer, hardTimer, totalBytes = 0, stopped = false, delivered = false;
    let code = 'CAPTURE_COMPLETE', trustedClickElapsedMs = null;
    const chunks = [], startReference = performance.now();
    const startElapsedMs = window.__combatMotionObservation.mark().elapsedMs;
    const mark = () => startElapsedMs + performance.now() - startReference;
    const cleanup = () => {
      clearTimeout(stopTimer); clearTimeout(hardTimer);
      document.removeEventListener('click', onClick, true);
      for (const track of stream?.getTracks() || []) track.stop();
      delete window.__combatCaptureStop;
    };
    const send = async () => {
      if (delivered) return;
      delivered = true;
      const stopElapsedMs = mark();
      cleanup();
      const blob = new Blob(chunks, { type: mimeType });
      if (!blob.size && code === 'CAPTURE_COMPLETE') code = 'CAPTURE_EMPTY';
      if (blob.size > 2 * 1024 * 1024) code = 'CAPTURE_SIZE_LIMIT';
      let base64;
      if (code === 'CAPTURE_COMPLETE') {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = '';
        for (let offset = 0; offset < bytes.length; offset += 16384)
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 16384));
        base64 = btoa(binary);
      }
      void window.__combatRecordingComplete({ code, base64, startElapsedMs, stopElapsedMs, trustedClickElapsedMs,
        width: arena.width, height: arena.height, audioTracks: stream?.getAudioTracks().length ?? null }).catch(() => {});
    };
    const stop = reason => {
      if (stopped) return;
      stopped = true;
      if (reason !== 'CAPTURE_COMPLETE') code = reason;
      if (recorder?.state === 'recording') recorder.stop(); else void send();
    };
    const onClick = event => {
      if (trustedClickElapsedMs !== null || !event.isTrusted || event.target.closest('[data-action]')?.dataset.action !== 'enemy-hero') return;
      trustedClickElapsedMs = mark();
      stopTimer = setTimeout(() => stop('CAPTURE_COMPLETE'), 3000);
    };
    try {
      stream = arena.captureStream(30);
      if (stream.getVideoTracks().length !== 1 || stream.getAudioTracks().length || arena.width * arena.height > 1_000_000)
        throw new Error('Unsupported capture scope');
      recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 1_200_000 });
      recorder.ondataavailable = event => {
        if (!event.data.size) return;
        totalBytes += event.data.size;
        if (totalBytes > 2 * 1024 * 1024 || chunks.length >= 32) { stop('CAPTURE_SIZE_LIMIT'); return; }
        chunks.push(event.data);
      };
      recorder.onerror = () => stop('CAPTURE_FAILED');
      recorder.onstop = () => void send();
      recorder.onstart = () => resolve({ supported: true, mimeType, width: arena.width, height: arena.height });
      stream.getVideoTracks()[0].addEventListener('ended', () => { if (!stopped) stop('CAPTURE_TRACK_ENDED'); });
      document.addEventListener('click', onClick, { capture: true, passive: true });
      window.__combatCaptureStop = () => stop('CAPTURE_FAILED');
      hardTimer = setTimeout(() => stop('CAPTURE_HARD_LIMIT'), 6000);
      recorder.start(250);
    } catch (error) {
      code = error?.name === 'SecurityError' ? 'CAPTURE_SECURITY' : 'CAPTURE_UNAVAILABLE';
      cleanup(); resolve({ supported: false, code });
    }
  }));
  evidence.captureSupport = support;
  await checkpoint();
  expect(support.supported, 'capability gap: the real browser must support origin-clean arena VP8 capture').toBe(true);
  return { done };
}

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
