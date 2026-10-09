/** Compare the same trusted-click window while retaining boundary-spanning stalls. */
export function summarizeFrameWindow(samples, clickMs, durationMs = 3000) {
  const end = clickMs + durationMs;
  const valid = samples.filter(s => Number.isFinite(s.elapsedMs));
  const inside = valid.filter(s => s.elapsedMs >= clickMs && s.elapsedMs <= end);
  const gaps = valid.slice(1).map((s,i) => ({from:valid[i].elapsedMs,to:s.elapsedMs,ms:s.elapsedMs-valid[i].elapsedMs}));
  const overlaps = gaps.filter(g => g.to > clickMs && g.from < end);
  const lastBeforeEnd = valid.filter(s=>s.elapsedMs<=end).at(-1);
  const firstAfterEnd = valid.find(s=>s.elapsedMs>=end);
  const max = values => values.length ? Math.max(...values) : null;
  return {
    clickMs, endMs:end, durationMs, sampleCount:inside.length,
    maximumOverlappingRafGapMs:max(overlaps.map(g=>g.ms)),
    over250ms:overlaps.filter(g=>g.ms>250).length,
    boundarySpanningGaps:overlaps.filter(g=>g.from<clickMs||g.to>end),
    lastSampleBeforeEndMs:lastBeforeEnd?.elapsedMs??null,
    firstSampleAtOrAfterEndMs:firstAfterEnd?.elapsedMs??null,
    uncoveredTailMs:lastBeforeEnd?Math.max(0,end-lastBeforeEnd.elapsedMs):durationMs,
    tailBracketed:!!firstAfterEnd,
    maximumUpdateMs:max(inside.map(s=>s.timing?.updateMs).filter(Number.isFinite)),
    maximumSubmitMs:max(inside.map(s=>s.timing?.submitMs).filter(Number.isFinite)),
    beforeClickSampleCount:valid.filter(s=>s.elapsedMs<clickMs).length,
    afterWindowSampleCount:valid.filter(s=>s.elapsedMs>end).length,
    caveat:'RAF gaps touching the fixed window retain their full duration; boundary gaps can include time outside it. Unbracketed tail is an unknown stall, never zero. Trace totals cover setup and cleanup and are not comparable wall time.',
  };
}
