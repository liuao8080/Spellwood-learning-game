/** Serializable, bounded observer for anonymous test pages. No API replacement,
 * game-state access, script URLs, attribution names, pixels or network records.
 * Missing/empty entries do not establish smooth rendering or GPU completion.
 */
export function startPassiveFrameDiagnostics() {
  const started = performance.now(), limit = 96, observers = [], entries = [];
  const types = ['longtask', 'long-animation-frame'];
  const available = globalThis.PerformanceObserver?.supportedEntryTypes || [];
  const support = Object.fromEntries(types.map(type => [type, available.includes(type) ? 'available' : 'unsupported']));
  const finite = value => Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
  const append = (type, values) => {
    for (const entry of values) {
      if (entries.length >= limit || entry.startTime < started) continue;
      const value = { type, elapsedMs: finite(entry.startTime - started), durationMs: finite(entry.duration) };
      if (type === 'long-animation-frame') {
        value.blockingDurationMs = finite(entry.blockingDuration);
        value.renderStartMs = entry.renderStart > 0 ? finite(entry.renderStart - started) : null;
        value.styleAndLayoutStartMs = entry.styleAndLayoutStart > 0 ? finite(entry.styleAndLayoutStart - started) : null;
        const scripts = Array.isArray(entry.scripts) ? entry.scripts : [];
        value.scriptCount = scripts.length;
        value.scriptDurationMs = finite(scripts.reduce((sum, script) => sum + (Number.isFinite(script.duration) ? script.duration : 0), 0));
        value.forcedStyleAndLayoutMs = finite(scripts.reduce((sum, script) => sum + (Number.isFinite(script.forcedStyleAndLayoutDuration) ? script.forcedStyleAndLayoutDuration : 0), 0));
      }
      entries.push(value);
    }
  };
  for (const type of types) {
    if (support[type] === 'unsupported') continue;
    try {
      const observer = new PerformanceObserver(list => append(type, list.getEntries()));
      observer.observe({ type, buffered: false });
      observers.push({ type, observer }); support[type] = 'observing';
    } catch { support[type] = 'failed'; }
  }
  let finished = false;
  globalThis.__passiveFrameDiagnostics = {
    finish() {
      if (!finished) {
        finished = true;
        for (const { type, observer } of observers) {
          append(type, observer.takeRecords()); observer.disconnect();
        }
      }
      return { support, entries: entries.slice(), entryLimit: limit, elapsedMs: finite(performance.now() - started),
        caveat: 'Diagnostic observer overhead is unmeasured. Missing entries do not prove absence of stalls. These are browser CPU timeline entries, not GPU timers.' };
    },
  };
}
