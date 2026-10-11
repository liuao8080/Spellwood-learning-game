import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { extractCombatFrames } from './extract-combat-frames.mjs';
import { summarizeFrameWindow } from './frame-window-summary.mjs';

// Re-run the original decoder and unchanged native-PTS limit against retained
// anonymous evidence. This checks evidence; it does not replay the game or
// replace actual browser acceptance. Re-decoded PNGs are separate from originals.
const input = path.resolve(process.argv[2] || '');
const output = path.resolve(process.argv[3] || 'test-results/motion-recheck');
if (process.argv.length < 3) throw new Error('Usage: node scripts/recheck-normal-motion.mjs <evidence-directory> [output-directory]');
const checkpoint = JSON.parse(await readFile(path.join(input, 'combat-motion-checkpoints.json'), 'utf8')).combatMotion;
const filename = checkpoint?.recording?.file;
if (!filename || filename !== path.basename(filename)) throw new Error('Expected a bounded recording filename.');
await mkdir(output, { recursive: true });
const decoded = await extractCombatFrames({ videoPath: path.join(input, filename), outputDirectory: path.join(output, 'redecoded'), prefix: 'rechecked-arena' });
if (decoded.video.sha256 !== checkpoint.decoded.video.sha256) throw new Error('Original video SHA-256 mismatch.');
const click = checkpoint.dom.clicks.find(value => value.trusted);
if (!Number.isFinite(click?.elapsedMs)) throw new Error('Missing trusted-click timestamp.');
const window = summarizeFrameWindow(checkpoint.dom.samples, click.elapsedMs, 3000);
const nativePass = decoded.video.maximumFrameGapSeconds <= .250;
const report = {
  schema: 1, scope: 'Original native-video/DOM evidence recheck, not a game replay',
  originalVideoSha256: decoded.video.sha256,
  unchangedNativeGapLimitMs: 250,
  nativeGate: nativePass ? 'passed' : 'failed',
  nativeVideo: decoded.video, trustedClickWindow: window,
  observedRenderer: checkpoint.renderEnvironment?.unmaskedRenderer || null,
  qualitySamples: [...new Set(checkpoint.dom.samples.map(value => JSON.stringify(value.timing ? {
    level: value.timing.qualityLevel, pixelScale: value.timing.pixelScale, shadowMapSize: value.timing.shadowMapSize,
  } : null)))].map(value => JSON.parse(value)),
  authority: checkpoint.summary,
  limits: ['Passive diagnostics, DOM observations and media PTS have separate origins; no cross-clock phase alignment inferred',
    'Native adjacent-frame gaps do not measure unknown time before the first or after the last encoded frame',
    'Application update/submission numbers are CPU samples, not GPU completion times'],
};
await writeFile(path.join(output, 'recheck.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ nativeGate: report.nativeGate, originalGapMs: decoded.video.maximumFrameGapSeconds * 1000,
  unchangedLimitMs: 250, frames: decoded.video.recordedFrames, trustedWindowRafMaxMs: window.maximumOverlappingRafGapMs,
  trustedWindowGapsOver250: window.over250ms, tailBracketed: window.tailBracketed, videoSha256: decoded.video.sha256 }));
if (!nativePass) process.exitCode = 1;
