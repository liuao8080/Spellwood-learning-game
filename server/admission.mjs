/** Small in-process limiters. Only server-derived keys belong here. */
const CLEANUP_MS = 60000;
const allowed = Object.freeze({ok: true, retryAfter: 0});
const denied = milliseconds => ({ok: false, retryAfter: Math.max(1, Math.ceil(milliseconds / 1000))});

function clock(now) {
  let latest = -Infinity;
  return () => {
    const value = now();
    if (!Number.isFinite(value)) throw new TypeError('Invalid admission clock');
    latest = Math.max(latest, value);
    return latest;
  };
}
function maximum(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 65536) throw new TypeError('Invalid admission key limit');
  return value;
}
function validKey(key) {
  if (typeof key !== 'string' || key.length > 160) throw new TypeError('Invalid admission key');
}

/** Atomically charge all buckets, so a blocked peer cannot drain shared tokens.
 * Cold buckets start full. Never evict a depleted bucket to make room for a new
 * key: doing so would let rotating peers reset limits. Cleanup is amortized.
 */
export function createTokenBuckets({now = () => Date.now(), maxKeys = 4096} = {}) {
  const states = new Map(), time = clock(now), limit = maximum(maxKeys);
  let nextCleanup = -Infinity;
  const available = (state, at) => Math.min(state.capacity,
    state.tokens + (at - state.updatedAt) * state.refillPerSecond / 1000);
  function prune(at = time()) {
    if (at < nextCleanup) return;
    nextCleanup = at + CLEANUP_MS;
    for (const [key, state] of states) {
      if (at - state.lastUsedAt >= CLEANUP_MS && available(state, at) >= state.capacity) states.delete(key);
    }
  }
  return {
    get size() { return states.size; },
    prune() { prune(); },
    clear() { states.clear(); nextCleanup = -Infinity; },
    consume(buckets) {
      if (!Array.isArray(buckets) || !buckets.length || buckets.length > 32) throw new TypeError('Invalid admission buckets');
      const at = time();
      prune(at);
      const seen = new Set(), pending = [];
      let missing = 0, wait = 0;
      for (const {key, capacity, refillPerSecond} of buckets) {
        validKey(key);
        if (seen.has(key) || !Number.isSafeInteger(capacity) || capacity < 1 ||
            !Number.isFinite(refillPerSecond) || refillPerSecond <= 0) throw new TypeError('Invalid admission bucket');
        seen.add(key);
        const state = states.get(key);
        if (state && (state.capacity !== capacity || state.refillPerSecond !== refillPerSecond)) throw new TypeError('Admission bucket policy changed');
        const tokens = state ? available(state, at) : capacity;
        if (!state) missing++;
        if (tokens < 1) wait = Math.max(wait, (1 - tokens) * 1000 / refillPerSecond);
        pending.push({key, capacity, refillPerSecond, tokens: tokens - 1, updatedAt: at, lastUsedAt: at});
      }
      if (wait > 0) return denied(wait);
      if (states.size + missing > limit) return denied(Math.max(1000, nextCleanup - at));
      for (const {key, ...state} of pending) states.set(key, state);
      return allowed;
    }
  };
}

/** Exact rolling window for password attempts; no new burst at a minute edge. */
export function createAttemptWindow({now = () => Date.now(), maxKeys = 4096, attempts = 8, periodMs = 60000} = {}) {
  const states = new Map(), time = clock(now), limit = maximum(maxKeys);
  if (!Number.isSafeInteger(attempts) || attempts < 1 || !Number.isSafeInteger(periodMs) || periodMs < 1) throw new TypeError('Invalid attempt window');
  let nextCleanup = -Infinity;
  function inspect(key) {
    validKey(key);
    const at = time();
    if (at >= nextCleanup) {
      nextCleanup = at + CLEANUP_MS;
      for (const [name, values] of states) if (values.at(-1) <= at - periodMs) states.delete(name);
    }
    const values = (states.get(key) || []).filter(value => value > at - periodMs);
    const result = values.length >= attempts ? denied(values[0] + periodMs - at) :
      !states.has(key) && states.size >= limit ? denied(Math.max(1000, nextCleanup - at)) : allowed;
    return {at, values, result};
  }
  return {
    get size() { return states.size; },
    clear() { states.clear(); nextCleanup = -Infinity; },
    check(key) { return inspect(key).result; },
    consume(key) {
      const {at, values, result} = inspect(key);
      if (result.ok) { values.push(at); states.set(key, values); }
      return result;
    }
  };
}
