import {
  test, expect, action, currentProgress, safeScreenshot, prepareMatch, calmAnimations,
  confirmOpening, sync, waitForBoard, uiCommand,
} from './helpers.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { extractCombatFrames } from '../../scripts/extract-combat-frames.mjs';
import { startPassiveFrameDiagnostics } from '../../scripts/passive-frame-diagnostics.mjs';

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

async function reachReadyMelee(a, b, allowedCards = Object.keys(meleeDeck), maximumTurns = 10) {
  // Only A's own legal choices guide A's selection. B's hand is never inspected.
  // A summons once, then both simply pass until that actual unit is ready.
  for (let turn = 0; turn < maximumTurns; turn += 1) {
    const active = a.observed.room.activeSeat === a.observed.room.youSeat ? a : b;
    await active.page.bringToFront();
    await waitForBoard(active);
    if (active === a) {
      let room = a.observed.room;
      if (!room.players[room.youSeat].board.length) {
        const choice = room.selfLegalCardTargets.filter(option => option.untargeted && allowedCards.includes(room.selfHandCards[option.index]))
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
    if (turn < maximumTurns - 1) {
      await uiCommand(active, () => action(active.page, 'end').click());
      await sync(a, b);
    }
  }
  throw new Error(`Coverage gap: the UI did not reach a ready melee unit within ${maximumTurns} ordinary turns`);
}

function publicState(actor) {
  const room = actor.observed.room;
  return structuredClone({
    revision: room.revision, phase: room.phase, turn: room.turn,
    activeSeat: room.activeSeat, assisted: room.assisted, players: room.players,
  });
}

async function startDomObservation(page, uid, evidence, checkpoint, bindingName = '__combatMotionBatch') {
  // Passive CPU timeline diagnostics only; strict normal-motion gates remain.
  await page.evaluate(startPassiveFrameDiagnostics);
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
    effectWarmup: ['pending','ready','failed'].includes(value?.effectWarmup)?value.effectWarmup:'unavailable',
    effectWarmupDraw: ['pending','performed','skipped','failed'].includes(value?.effectWarmupDraw)?value.effectWarmupDraw:'unavailable',
    effectWarmupDrawMs: finite(value?.effectWarmupDrawMs),
    effectWarmupCompileMs: finite(value?.effectWarmupCompileMs),
  });
  // Send small, allowlisted batches out before any later screenshot can hang.
  // This binding accepts observations only; it never sends a game command.
  await page.exposeBinding(bindingName, (_source, packet) => {
    if (!Number.isInteger(packet?.offset) || packet.offset < 0 || packet.offset >= 360) return;
    for (const [index, value] of (Array.isArray(packet.samples) ? packet.samples.slice(0, 4) : []).entries())
      if (packet.offset + index < 360) evidence.dom.samples[packet.offset + index] = safeSample(value);
    evidence.dom.clicks = (Array.isArray(packet.clicks) ? packet.clicks.slice(0, 4) : []).map(value => ({
      elapsedMs: finite(value?.elapsedMs), trusted: value?.trusted === true,
    }));
    if (packet.final) evidence.dom.final = safeSample(packet.final);
    void checkpoint();
  });
  await page.evaluate(({ sourceUid, bindingName }) => {
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
        effectWarmup: arena.dataset.effectWarmup||'unavailable',
        effectWarmupDraw: arena.dataset.effectWarmupDraw||'unavailable',
        effectWarmupDrawMs: number(arena.dataset.effectWarmupDrawMs),
        effectWarmupCompileMs: number(arena.dataset.effectWarmupMs),
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
      void window[bindingName]({ offset, samples: batch, clicks, final }).catch(() => {});
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
        const result = { samples, clicks, final, sampleLimit: 360, observationLimitMs: 6000, delivery: 'complete',
          diagnostics: globalThis.__passiveFrameDiagnostics?.finish() ?? null };
        delete globalThis.__passiveFrameDiagnostics;
        delete window.__combatMotionObservation;
        return result;
      },
    };
  }, { sourceUid: uid, bindingName });
}

async function startArenaRecording(page, evidence, videoPath, checkpoint, bindingName = '__combatRecordingComplete') {
  let complete;
  const done = new Promise(resolve => { complete = resolve; });
  await page.exposeBinding(bindingName, async (_source, packet) => {
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
  const support = await page.evaluate(bindingName => new Promise(resolve => {
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
      void window[bindingName]({ code, base64, startElapsedMs, stopElapsedMs, trustedClickElapsedMs,
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
  }), bindingName);
  evidence.captureSupport = support;
  await checkpoint();
  expect(support.supported, 'capability gap: the real browser must support origin-clean arena VP8 capture').toBe(true);
  return { done };
}


export { normalMotion, buildMeleeDeck, reachReadyMelee, publicState, startDomObservation, startArenaRecording };
