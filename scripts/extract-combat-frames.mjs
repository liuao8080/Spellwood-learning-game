import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const execute = promisify(execFile);
const failure = code => Object.assign(new Error(`Combat recording evidence: ${code}`), { code });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function run(binary, args) {
  try {
    return await execute(binary, args, {
      timeout: 10_000, killSignal: 'SIGKILL', maxBuffer: 768 * 1024,
      encoding: 'utf8', windowsHide: true, shell: false,
    });
  } catch (error) {
    // Never put raw process stderr, command lines or arbitrary errors in JSON.
    throw failure(error.code === 'ENOENT' ? 'MEDIA_TOOL_UNAVAILABLE' : error.killed ? 'MEDIA_TOOL_TIMEOUT' : 'MEDIA_TOOL_FAILED');
  }
}

/** Decode selected existing video frames without a frame-rate conversion,
 * scaling, interpolation or playback-speed change. The source is a bounded,
 * anonymous arena recording; decoded PNGs retain VP8 compression artefacts.
 */
export async function extractCombatFrames({ videoPath, outputDirectory, prefix, maximumFrames = 12 }) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(prefix) || !Number.isInteger(maximumFrames) || maximumFrames < 6 || maximumFrames > 12)
    throw failure('INVALID_EXTRACTION_LIMIT');
  const information = await stat(videoPath);
  if (information.size < 1 || information.size > 2 * 1024 * 1024) throw failure('VIDEO_SIZE_LIMIT');
  const probe = await run('ffprobe', [
    '-v', 'error', '-threads', '1', '-show_streams', '-show_frames',
    '-show_entries', 'stream=index,codec_type,codec_name,width,height:frame=media_type,best_effort_timestamp_time,pkt_duration_time',
    '-of', 'json', videoPath,
  ]);
  let metadata;
  try { metadata = JSON.parse(probe.stdout); } catch { throw failure('INVALID_PROBE_METADATA'); }
  if (!Array.isArray(metadata.streams) || metadata.streams.length !== 1 || metadata.streams[0].codec_type !== 'video')
    throw failure('VIDEO_ONLY_STREAM_REQUIRED');
  const stream = metadata.streams[0];
  if (!['vp8', 'vp9'].includes(stream.codec_name)) throw failure('UNEXPECTED_VIDEO_CODEC');
  const width = Number(stream.width), height = Number(stream.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 100 || height < 80 || width * height > 1_000_000)
    throw failure('VIDEO_DIMENSION_LIMIT');
  const frames = (metadata.frames || []).filter(frame => frame.media_type === 'video');
  if (frames.length < 6 || frames.length > 200) throw failure('RECORDED_FRAME_COUNT_GAP');
  const times = frames.map(frame => Number(frame.best_effort_timestamp_time));
  if (times.some((time, index) => !Number.isFinite(time) || time < 0 || (index > 0 && time <= times[index - 1])))
    throw failure('RECORDED_PTS_NOT_STRICTLY_INCREASING');
  const span = times.at(-1) - times[0];
  if (span < 0.5 || span > 6.5) throw failure('RECORDED_TIME_SPAN_GAP');
  const count = Math.min(maximumFrames, frames.length);
  // Pick actual frame indices nearest evenly spaced source PTS, with first and
  // last always retained. A Set prevents a sparse recording inventing frames.
  const wanted = new Set([0, frames.length - 1]);
  for (let index = 1; index < count - 1; index += 1) {
    const desired = times[0] + span * index / (count - 1);
    let nearest = 0;
    for (let candidate = 1; candidate < times.length; candidate += 1)
      if (Math.abs(times[candidate] - desired) < Math.abs(times[nearest] - desired)) nearest = candidate;
    wanted.add(nearest);
  }
  // Sparse or irregular PTS can produce collisions. Fill only with real frames.
  for (let index = 0; wanted.size < count && index < frames.length; index += 1) wanted.add(index);
  const selected = [...wanted].sort((left, right) => left - right);
  await mkdir(outputDirectory, { recursive: true });
  const expression = selected.map(index => `eq(n\\,${index})`).join('+');
  const decoded = await run('ffmpeg', [
    '-hide_banner', '-loglevel', 'info', '-nostdin', '-y', '-threads', '1', '-i', videoPath,
    '-map', '0:v:0', '-an', '-filter_threads', '1',
    // Limited-range decoded YUV represents black near luma 16, not zero.
    '-vf', `select=${expression},blackframe=amount=0:threshold=32`,
    '-vsync', '0', '-frames:v', String(selected.length), '-threads', '1',
    '-compression_level', '3', '-start_number', '0',
    path.join(outputDirectory, `${prefix}-frame-%02d.png`),
  ]);
  // blackframe runs after select, so every selected image must have its own
  // detector sample. Its fixed numeric report is reduced before persistence.
  const black = [...decoded.stderr.matchAll(/\bframe:\s*(\d+)\s+pblack:\s*(\d+(?:\.\d+)?)/g)]
    .map(match => ({ frame: Number(match[1]), percent: Number(match[2]) }));
  if (black.length !== selected.length) throw failure('BLACK_FRAME_CHECK_UNAVAILABLE');
  if (black.some(frame => frame.percent >= 99)) throw failure('BLACK_OR_EMPTY_RECORDED_FRAME');
  const images = [];
  for (const [index, sourceIndex] of selected.entries()) {
    const file = `${prefix}-frame-${String(index).padStart(2, '0')}.png`;
    const filePath = path.join(outputDirectory, file), size = (await stat(filePath)).size;
    if (size < 100 || size > 5 * 1024 * 1024) throw failure('DECODED_IMAGE_SIZE_LIMIT');
    images.push({ file, sourceIndex, ptsSeconds: times[sourceIndex], blackPercent: black[index].percent,
      bytes: size, sha256: sha256(await readFile(filePath)) });
  }
  if (new Set(images.map(frame => frame.sha256)).size < 3) throw failure('RECORDED_IMAGE_VARIETY_GAP');
  return {
    method: 'ffprobe source-frame PTS; ffmpeg selects existing frame indices with vsync 0; no interpolation, scaling or speed change',
    caveat: 'PNG files are original decoded frames of a lossy WebM recording, not lossless copies of the source canvas',
    video: { file: path.basename(videoPath), bytes: information.size, sha256: sha256(await readFile(videoPath)),
      codec: stream.codec_name, width, height, audioStreams: 0, recordedFrames: frames.length,
      firstPtsSeconds: times[0], lastPtsSeconds: times.at(-1),
      maximumFrameGapSeconds: Math.round(Math.max(...times.slice(1).map((time, index) => time - times[index])) * 1e6) / 1e6 },
    selectedFrames: images,
  };
}
