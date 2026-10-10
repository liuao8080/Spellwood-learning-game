import { test, expect, action, currentProgress, matchPair, confirmOpening, safeScreenshot } from './helpers.mjs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

test('@local-renderer settled normal-motion viewports retain attributable public buffer and quality observations', async ({ actors }, testInfo) => {
  test.setTimeout(120_000);
  testInfo.annotations.push({ type: 'coverage', description: 'An ordinary two-guest opening with default normal motion. Four viewports each sit without game commands until 2, 5 and 10 seconds. Read-only CSS/drawing-buffer/DPR/adaptive-quality diagnostics establish settled configuration, not whole-session FPS or physical-phone performance.' });
  const a = await actors('settled-renderer-A');
  const b = await actors('settled-renderer-B');
  await matchPair(a, b); await confirmOpening(a, b);
  expect(currentProgress(a).legacy.reduced).toBe(false);
  expect(currentProgress(b).legacy.reduced).toBe(false);
  const commandCounts = [a.observed.commands.length, b.observed.commands.length];
  const revision = a.observed.room.revision;
  const observations = [];
  const checkpoint = async status => writeFile(path.join(process.env.SPELLWOOD_LOCAL_EVIDENCE, 'local-settled-renderer.json'), JSON.stringify({
    schema: 1, status, observations, commandsDuringViewportSamples: a.observed.commands.length - commandCounts[0] + b.observed.commands.length - commandCounts[1],
    scope: 'Browser-context DPR and viewport are emulated values; no quality override, restoration, game-command injection or physical-device acceptance',
    caveat: 'Public frame-rate/timing fields are application samples. Static settling is not a smoothness pass; the original native-recording 250ms gate remains independent.',
  }, null, 2));
  for (const viewport of [{ width: 1280, height: 800 }, { width: 844, height: 390 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
    await a.page.setViewportSize(viewport); await a.page.bringToFront();
    const started = Date.now();
    const samples = [];
    observations.push({ viewport, samples });
    for (const scheduledMs of [2000, 5000, 10_000]) {
      await a.page.waitForTimeout(Math.max(0, scheduledMs - (Date.now() - started)));
      const sample = await a.page.evaluate(() => {
        const numeric = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
        return {
          visibility: document.visibilityState, dpr: window.devicePixelRatio,
          canvases: ['arena', 'hand-canvas'].map(id => {
            const canvas = document.getElementById(id); const box = canvas.getBoundingClientRect();
            const style = getComputedStyle(canvas);
            return {
              id, renderer: canvas.dataset.renderer || null, hidden: canvas.hidden,
              cssBox: { x: box.x, y: box.y, width: box.width, height: box.height },
              drawingBuffer: { width: canvas.width, height: canvas.height },
              bufferToCss: { x: box.width ? canvas.width / box.width : null, y: box.height ? canvas.height / box.height : null },
              display: style.display, visibility: style.visibility,
              diagnostics: Object.fromEntries(['qualityLevel', 'pixelScale', 'shadowMapSize', 'renderUpdateMs', 'renderSubmitMs', 'renderAnchorMs', 'frameGapMs', 'frameRate', 'paintedFrames', 'rafCallbacks', 'maxRafGapMs', 'sampleWindowMs'].map(name => [name, numeric(canvas.dataset[name])])),
            };
          }),
        };
      });
      samples.push({ scheduledMs, elapsedMs: Date.now() - started, ...sample });
      await checkpoint('sampling');
      expect(sample.visibility).toBe('visible');
      for (const canvas of sample.canvases) {
        expect(canvas.renderer).toBe('WebGL2'); expect(canvas.hidden).toBe(false);
        expect(canvas.cssBox.width).toBeGreaterThan(0); expect(canvas.cssBox.height).toBeGreaterThan(0);
        expect(canvas.drawingBuffer.width).toBeGreaterThan(0); expect(canvas.drawingBuffer.height).toBeGreaterThan(0);
        expect(canvas.display).not.toBe('none'); expect(canvas.visibility).toBe('visible');
      }
      expect(a.observed.commands.length).toBe(commandCounts[0]);
      expect(b.observed.commands.length).toBe(commandCounts[1]);
      expect(a.observed.room.revision).toBe(revision); expect(b.observed.room.revision).toBe(revision);
    }
    await safeScreenshot(a.page, testInfo, `${viewport.width}x${viewport.height}-settled-10s`);
  }
  await checkpoint('complete');
  expect(a.observed.errors).toEqual([]); expect(b.observed.errors).toEqual([]);
});
