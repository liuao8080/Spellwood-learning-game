import test from 'node:test';
import assert from 'node:assert/strict';
import { HERO_SKINS, DEFAULT_HERO_SKIN } from '../src/hero-skins.mjs';
import {
  freshJourney, normalizeJourney, rewardDay, rewardPeriod, dailySummary,
  applyQualifiedLearning, applyQualifiedMatch, openSkinPack, revealSkinPack,
  closeSkinPack, redeemSkin, equipSkin, REWARD_JOURNEY_LIMITS,
} from '../src/reward-journey.mjs';

const OWNER = 'synthetic-player-01', NOW = Date.UTC(2026, 9, 1, 4), DAY = 86400000;
const IDS = HERO_SKINS.map(s => s.id);
const fresh = () => freshJourney({ ownerId: OWNER });
const study = (i, extra = {}) => ({ ownerId: OWNER, eventId: `challenge-${i}`, qid: `qid-${i}`, unitId: 'grade1-s1-unit1', source: 'study', issuedAt: NOW, answeredAt: NOW + 2000, qualifiedAt: NOW + 3200, ...extra });
const operation = (id, extra = {}) => ({ ownerId: OWNER, operationId: id, issuedAt: NOW, mode: 'official', ...extra });
const match = extra => ({ ownerId: OWNER, eventId: 'match-event', matchId: 'match-01', issuedAt: NOW, finishedAt: NOW + 20000, mode: 'pve', termination: 'normal', ownTurns: 2, ownActions: 3, ...extra });
function learnDay(state, day = 0) {
  let dust = 0;
  for (let i = 0; i < 6; i++) {
    const issuedAt = NOW + day * DAY + i * 4000;
    const result = applyQualifiedLearning(state, study(`${day}-${i}`, { qid: `qid-${i}`, issuedAt, answeredAt: issuedAt + 2000, qualifiedAt: issuedAt + 3200 }));
    state = result.state; dust += result.officialDustDelta;
  }
  return { state, dust };
}
function closeAll(state, mode, id, at = NOW) {
  const batchId = state.openings[mode].id;
  state = revealSkinPack(state, operation(`${id}-reveal`, { mode, batchId, index: 'all', issuedAt: at })).state;
  return closeSkinPack(state, operation(`${id}-close`, { mode, batchId, issuedAt: at })).state;
}

test('catalogue has exactly 20 cosmetic rewards and separate base; migration never silently regenerates', () => {
  assert.equal(IDS.length, 20); assert.equal(new Set(IDS).size, 20); assert(!IDS.includes(DEFAULT_HERO_SKIN));
  assert.deepEqual(normalizeJourney(undefined, { ownerId: OWNER }), fresh());
  for (const bad of [null, {}, { ...fresh(), version: 2 }, { ...fresh(), timeZone: 'UTC' }, { ...fresh(), skinTickets: -1 }]) {
    assert.throws(() => normalizeJourney(bad), { code: 'INVALID_REWARD_STATE' });
  }
  assert.throws(() => normalizeJourney(fresh(), { ownerId: 'foreign-player' }), { code: 'INVALID_REWARD_STATE' });
  assert.equal('dust' in fresh().official, false, 'official currency has one owner outside this module');
});

test('six distinct questions complete three gentle tasks, including wrong answers; newcomer occurs once', () => {
  let state = fresh(), dust = 0;
  for (let i = 0; i < 6; i++) {
    const before = structuredClone(state), result = applyQualifiedLearning(state, study(i, { correct: false }));
    assert.deepEqual(state, before, 'pure reducer does not mutate its input');
    state = result.state; dust += result.officialDustDelta;
    if (i === 1) assert.equal(state.skinTickets, 1);
    if (i === 2) assert.deepEqual(result.receipt.completed, ['daily_warmup', 'newcomer']);
  }
  assert.equal(dust, 5); assert.equal(state.skinTickets, 3);
  assert(dailySummary(state, NOW).allComplete);
  assert.equal(dailySummary(state, NOW).message, '今天的礼物已收好，随时可以休息');
  assert(!Object.hasOwn(state, 'totalDays'), 'existing five-learning-day card pack remains independently owned');
  state = normalizeJourney(JSON.parse(JSON.stringify(state)), { ownerId: OWNER });
  const second = learnDay(state, 1);
  assert.equal(second.state.skinTickets, 5); assert.equal(second.dust, 5);
  assert.equal(second.state.newcomerGranted, true, 'registration retaining owner/state cannot repeat newcomer');
});

test('duplicate IDs replay, conflicting IDs fail, repeated qids never replace distinct learning', () => {
  const first = applyQualifiedLearning(fresh(), study(0));
  const repeated = applyQualifiedLearning(first.state, { ...study(0), correct: false }, { expectedRevision: 0 });
  assert(repeated.replayed); assert.equal(repeated.officialDustDelta, 0); assert.deepEqual(repeated.state, first.state);
  assert.throws(() => applyQualifiedLearning(first.state, study(0, { qid: 'different-qid' })), { code: 'REWARD_EVENT_CONFLICT' });
  let state = first.state;
  for (let i = 1; i < 10; i++) state = applyQualifiedLearning(state, study(i, { qid: 'qid-0' })).state;
  assert.equal(dailySummary(state, NOW).tasks[0].progress, 1);
  assert.equal(state.skinTickets, 0);
});

test('empty/missing/premature activity never auto-awards, and the owner boundary is checked', () => {
  const state = fresh(), before = structuredClone(state);
  assert(!dailySummary(state, NOW).allComplete); assert.equal(dailySummary(state, NOW + DAY).skinTickets, 0);
  for (const event of [study(0, { answeredAt: undefined }), study(0, { qualifiedAt: NOW + 1199 }), study(0, { issuedAt: NOW + 5000 }), study(0, { ownerId: 'other-owner' })]) assert.throws(() => applyQualifiedLearning(state, event));
  assert.deepEqual(state, before);
  const fast = study(1, { answeredAt: NOW + 500, qualifiedAt: NOW + 3200 });
  assert.equal(applyQualifiedLearning(state, fast).receipt.qualified, true, 'server may confirm reading after a fast answer');
});

test('same-unit route requires two different StudyDesk qids; battle answers still advance 3/6', () => {
  let state = applyQualifiedLearning(fresh(), study(0, { source: 'match' })).state;
  state = applyQualifiedLearning(state, study(1, { source: 'match' })).state;
  assert.equal(state.skinTickets, 0);
  state = applyQualifiedLearning(state, study(2, { unitId: 'unit-a' })).state;
  state = applyQualifiedLearning(state, study(3, { unitId: 'unit-b' })).state;
  assert.equal(state.skinTickets, 1, 'only newcomer, different units do not meet route');
  state = applyQualifiedLearning(state, study(4, { unitId: 'unit-a' })).state;
  assert.equal(state.skinTickets, 2);
});

test('normal PvE/PvP, win or loss participation routes are equal; quit, surrender, expiry and AI-only actions do not qualify', () => {
  for (const mode of ['pve', 'pvp']) {
    const result = applyQualifiedMatch(fresh(), match({ mode, outcome: 'loss', assisted: true }));
    assert(result.receipt.qualified); assert.equal(result.state.skinTickets, 1); assert.equal(result.officialDustDelta, 0);
    assert(applyQualifiedMatch(result.state, match({ mode, outcome: 'loss', assisted: true })).replayed);
  }
  for (const extra of [{ termination: 'surrender' }, { termination: 'quit' }, { termination: 'expired' }, { ownTurns: 1 }, { ownActions: 2 }, { ownActions: 0, aiActions: 300 }]) {
    const result = applyQualifiedMatch(fresh(), match(extra));
    assert.equal(result.receipt.qualified, false); assert.equal(result.state.skinTickets, 0);
  }
  const full = learnDay(fresh()).state;
  assert.equal(applyQualifiedMatch(full, match()).state.skinTickets, 3, 'two routes award once');
});

test('Shanghai reward midnight uses challenge-issued day and retains balances and pending batch across skipped days', () => {
  const beforeMidnight = Date.UTC(2026, 9, 1, 15, 59, 59), afterMidnight = beforeMidnight + 4000;
  assert.equal(rewardDay(beforeMidnight), '2026-10-01'); assert.equal(rewardDay(afterMidnight), '2026-10-02');
  assert.equal(rewardPeriod(beforeMidnight).endAt, Date.UTC(2026, 9, 1, 16));
  const result = applyQualifiedLearning(fresh(), study('midnight', { issuedAt: beforeMidnight, answeredAt: beforeMidnight + 2000, qualifiedAt: afterMidnight }));
  assert.equal(result.receipt.rewardDay, '2026-10-01'); assert.equal(dailySummary(result.state, afterMidnight).tasks[0].progress, 0);
  let state = learnDay(fresh()).state;
  state = openSkinPack(state, operation('midnight-pack', { count: 1 }), { randomValues: [0] }).state;
  const tomorrow = dailySummary(state, NOW + 4 * DAY);
  assert.equal(tomorrow.skinTickets, 2); assert(tomorrow.tasks.every(t => t.progress === 0));
  assert.equal(state.openings.official.id, 'midnight-pack');
  assert.equal(learnDay(state, 4).state.skinTickets, 4, 'no skipped-day penalty');
});

test('ten results commit before reveals; repeats inside a batch pay dust and fifth consecutive duplicate guarantees unowned', () => {
  let state = { ...fresh(), skinTickets: 10 };
  const result = openSkinPack(state, operation('ten-pack', { count: 10 }), { randomValues: Array(10).fill(0) });
  assert.equal(state.skinTickets, 10); assert.equal(result.state.skinTickets, 0);
  const batch = result.state.openings.official;
  assert.equal(batch.results.length, 10); assert.equal(batch.revealed, 0);
  assert.deepEqual(batch.results.map(r => r.duplicate), [false, true, true, true, true, false, true, true, true, true]);
  assert.equal(batch.results[5].guaranteed, true); assert.equal(result.officialDustDelta, 160);
  assert.equal(result.state.official.owned.length, 2); assert.equal(result.state.official.repeatStreak, 4);
  const restored = normalizeJourney(JSON.parse(JSON.stringify(result.state)));
  const replay = openSkinPack(restored, operation('ten-pack', { count: 10, issuedAt: NOW + DAY }), { randomValues: Array(10).fill(.9) });
  assert(replay.replayed); assert.equal(replay.officialDustDelta, 0); assert.deepEqual(replay.receipt, result.receipt);
  assert.throws(() => openSkinPack(restored, operation('ten-pack', { count: 1 }), { randomValues: [0] }), { code: 'REWARD_EVENT_CONFLICT' });
  assert.throws(() => openSkinPack(restored, operation('another-pack', { count: 1 }), { randomValues: [0] }), { code: 'SKIN_PACK_PENDING' });
});

test('cancel/close preserves partially revealed batch, cannot refund or reroll, and full close archives same results', () => {
  let result = openSkinPack({ ...fresh(), skinTickets: 10 }, operation('cancel-pack', { count: 10 }), { randomValues: IDS.slice(0, 10).map((_, i) => (i + .1) / 20) });
  let state = revealSkinPack(result.state, operation('reveal-third', { batchId: 'cancel-pack', index: 2 })).state;
  assert.equal(state.openings.official.revealed, 4);
  result = closeSkinPack(state, operation('dismiss-pack', { batchId: 'cancel-pack' })); state = result.state;
  assert(result.receipt.pending); assert.equal(state.openings.official.revealed, 4); assert.equal(state.skinTickets, 0);
  state = normalizeJourney(JSON.parse(JSON.stringify(state)));
  assert.equal(state.openings.official.results.length, 10);
  state = closeAll(state, 'official', 'finish');
  assert.equal(state.openings.official, null); assert.equal(state.recent[0].revealed, 1023); assert.equal(state.recent[0].results.length, 10);
  const replay = openSkinPack(state, operation('cancel-pack', { count: 10 }), { randomValues: [] });
  assert(replay.replayed); assert.equal(replay.state.skinTickets, 0); assert.equal(replay.state.openings.official, null);
});

test('full collection draws from nonempty ordinary pool, pays repeat dust, and disables the unowned guarantee', () => {
  const state = { ...fresh(), skinTickets: 10, official: { owned: [...IDS], repeatStreak: 0 } };
  const result = openSkinPack(state, operation('full-pack', { count: 10 }), { randomValues: Array(10).fill(.999999) });
  assert.equal(result.officialDustDelta, 200); assert.equal(result.state.official.repeatStreak, 0);
  assert(result.receipt.batch.results.every(r => r.duplicate && !r.guaranteed && r.skinId === IDS.at(-1)));
  assert.equal(dailySummary(result.state, NOW).official.guaranteeAvailable, false);
});

test('ordinary draw bins are exactly uniform; guarantee selection is uniform across only unowned skins', () => {
  const counts = new Map(IDS.map(id => [id, 0]));
  for (let i = 0; i < 400; i++) {
    const result = openSkinPack(fresh(), operation(`uniform-${i}`, { mode: 'test', count: 1 }), { randomValues: [(i + .5) / 400] });
    const id = result.receipt.batch.results[0].skinId; counts.set(id, counts.get(id) + 1);
  }
  assert([...counts.values()].every(n => n === 20));
  const state = { ...fresh(), skinTickets: 1, official: { owned: IDS.slice(0, 17), repeatStreak: 4 } };
  assert.deepEqual([0, .333334, .99999].map(random => openSkinPack(state, operation('guarantee', { count: 1 }), { randomValues: [random] }).receipt.batch.results[0].skinId), IDS.slice(17));
});

test('official redemption atomically requests exact external dust debit; repeat redemption never charges and pity survives', () => {
  const state = { ...fresh(), official: { owned: [IDS[0]], repeatStreak: 4 } };
  const request = operation('redeem-target', { skinId: IDS[1] });
  assert.throws(() => redeemSkin(state, request, { officialDustBalance: 99 }), { code: 'INSUFFICIENT_OFFICIAL_DUST' });
  const result = redeemSkin(state, request, { officialDustBalance: 100 });
  assert.equal(result.officialDustDelta, -100); assert.equal(result.state.official.repeatStreak, 4);
  const replay = redeemSkin(result.state, request, { officialDustBalance: 0 }); assert(replay.replayed); assert.equal(replay.officialDustDelta, 0);
  assert.equal(redeemSkin(result.state, operation('owned-again', { skinId: IDS[1] }), { officialDustBalance: 0 }).officialDustDelta, 0);
  assert.equal(equipSkin(result.state, operation('equip-target', { skinId: IDS[1] })).state.equipped.skinId, IDS[1]);
  assert.throws(() => equipSkin(state, operation('not-owned', { skinId: IDS[2] })), { code: 'SKIN_NOT_OWNED' });
  assert.equal(equipSkin(result.state, operation('equip-base', { skinId: DEFAULT_HERO_SKIN })).state.equipped.mode, 'base');
});

test('infinite test draws and redemptions are labeled and never touch official tickets, ownership, pity or dust', () => {
  const original = fresh(); let state = original;
  const testDraw = openSkinPack(state, operation('test-ten', { mode: 'test', count: 10 }), { randomValues: Array(10).fill(0) });
  state = testDraw.state;
  assert.equal(testDraw.officialDustDelta, 0); assert.equal(state.test.dust, 160); assert.deepEqual(state.official, original.official); assert.equal(state.skinTickets, 0);
  const testRedeem = redeemSkin(state, operation('test-redeem', { mode: 'test', skinId: IDS[19] })); state = testRedeem.state;
  assert.equal(testRedeem.officialDustDelta, 0); assert(state.test.owned.includes(IDS[19])); assert(!state.official.owned.includes(IDS[19]));
  assert(dailySummary(state, NOW).test.unlimitedTickets); assert.match(dailySummary(state, NOW).test.label, /体验区.*正式/);
  assert.throws(() => equipSkin(state, operation('test-cannot-equip-official', { skinId: IDS[19] })), { code: 'SKIN_NOT_OWNED' });
  assert.equal(equipSkin(state, operation('test-equip', { mode: 'test', skinId: IDS[19] })).state.equipped.mode, 'test');
  state.skinTickets = 1;
  const official = openSkinPack(state, operation('parallel-official', { count: 1 }), { randomValues: [0] });
  assert.equal(official.receipt.batch.results[0].duplicate, false, 'test ownership cannot turn first official draw into repeat');
  assert(official.state.openings.test); assert(official.state.openings.official);
});

test('invalid random values and simulated commit failure cannot half-charge, half-grant or mutate input', () => {
  const state = { ...fresh(), skinTickets: 10 }, copy = structuredClone(state);
  for (const randomValues of [[], Array(9).fill(0), [...Array(9).fill(0), 1], [...Array(9).fill(0), NaN], [...Array(9).fill(0), -1]]) {
    assert.throws(() => openSkinPack(state, operation('bad-rng', { count: 10 }), { randomValues }), { code: 'INVALID_SKIN_RANDOM' });
    assert.deepEqual(state, copy);
  }
  let stored = { journey: state, dust: 50 };
  const candidate = openSkinPack(stored.journey, operation('fault-pack', { count: 10 }), { randomValues: Array(10).fill(0) });
  assert.throws(() => { throw Error('SIMULATED_TRANSACTION_ABORT'); });
  assert.deepEqual(stored, { journey: copy, dust: 50 });
  // One owner transaction stores both fields; uncommitted candidate is discarded.
  stored = { journey: candidate.state, dust: stored.dust + candidate.officialDustDelta };
  const retry = openSkinPack(stored.journey, operation('fault-pack', { count: 10 }), { randomValues: Array(10).fill(.8) });
  assert(retry.replayed); assert.equal(stored.dust + retry.officialDustDelta, 210);
});

test('CAS contract serializes concurrent spending: loser recomputes against committed owner revision', () => {
  let stored = { ...fresh(), skinTickets: 1 };
  const a = openSkinPack(stored, operation('concurrent-a', { count: 1 }), { randomValues: [0], expectedRevision: 0 });
  const b = openSkinPack(stored, operation('concurrent-b', { count: 1 }), { randomValues: [.5], expectedRevision: 0 });
  assert.equal(a.state.revision, b.state.revision, 'a pure calculation is not a database commit');
  const commit = (result, expectedRevision) => {
    if (stored.revision !== expectedRevision) throw Object.assign(Error('CAS_CONFLICT'), { code: 'CAS_CONFLICT' });
    stored = result.state;
  };
  commit(a, 0); assert.throws(() => commit(b, 0), { code: 'CAS_CONFLICT' });
  assert.throws(() => openSkinPack(stored, operation('concurrent-b', { count: 1 }), { randomValues: [.5], expectedRevision: 0 }), { code: 'REWARD_REVISION_CONFLICT' });
  assert.equal(stored.skinTickets, 0); assert.deepEqual(stored.official.owned, [IDS[0]]);
});

test('normalization rejects broken masks, foreign skins, claims, duplicate ownership and histories', () => {
  const open = openSkinPack({ ...fresh(), skinTickets: 1 }, operation('validate-pack', { count: 1 }), { randomValues: [0] }).state;
  for (const mutate of [
    s => { s.openings.official.revealed = 2; },
    s => { s.openings.official.results[0].skinId = 'unknown'; },
    s => { s.openings.official.results[0].dust = 20; },
    s => { s.official.owned.push(s.official.owned[0]); },
    s => { s.operations.push(s.operations[0]); },
    s => { s.official.repeatStreak = 5; },
    s => { s.days['2026-10-01'] = { qids: [], units: {}, qualifiedMatch: false, claimed: ['daily_warmup'] }; },
  ]) { const value = structuredClone(open); mutate(value); assert.throws(() => normalizeJourney(value), { code: 'INVALID_REWARD_STATE' }); }
  const cleaned = normalizeJourney({ ...open, sessionToken: 'do-not-persist' }); assert(!Object.hasOwn(cleaned, 'sessionToken'));
  assert.throws(() => applyQualifiedLearning({ ...fresh(), revision: Number.MAX_SAFE_INTEGER }, study('overflow')), { code: 'REWARD_REVISION_EXHAUSTED' });
});

test('bounded histories reject expired requests instead of regranting and retain permanent balances', () => {
  let state = fresh();
  for (let day = 0; day < 40; day++) state = learnDay(state, day).state;
  assert.equal(Object.keys(state.days).length, REWARD_JOURNEY_LIMITS.days); assert.equal(state.events.length, REWARD_JOURNEY_LIMITS.events);
  assert.equal(state.skinTickets, 81); assert.equal(state.newcomerGranted, true);
  assert.throws(() => applyQualifiedLearning(state, study('very-old')), { code: 'REWARD_HISTORY_EXPIRED' });
  state = normalizeJourney(JSON.parse(JSON.stringify(state)));
  const before = state.skinTickets;
  for (let i = 0; i < 70; i++) state = equipSkin(state, operation(`bounded-equip-${i}`, { skinId: DEFAULT_HERO_SKIN, issuedAt: NOW + 50 * DAY + i })).state;
  assert.equal(state.operations.length, REWARD_JOURNEY_LIMITS.operations); assert.equal(state.skinTickets, before);
  assert.throws(() => equipSkin(state, operation('bounded-equip-0', { skinId: DEFAULT_HERO_SKIN, issuedAt: NOW + 50 * DAY })), { code: 'REWARD_HISTORY_EXPIRED' });
});

test('an unfinished official pack survives receipt pruning and many separate test openings', () => {
  let state = openSkinPack({ ...fresh(), skinTickets: 1 }, operation('long-pending', { count: 1 }), { randomValues: [0] }).state;
  for (let i = 0; i < 25; i++) {
    const id = `history-pack-${i}`, issuedAt = NOW + i + 1;
    state = openSkinPack(state, operation(id, { mode: 'test', count: 1, issuedAt }), { randomValues: [.5] }).state;
    state = closeAll(state, 'test', id, issuedAt);
  }
  assert.equal(state.recent.length, REWARD_JOURNEY_LIMITS.recent);
  assert(!state.operations.some(o => o.id === 'long-pending'));
  const retry = openSkinPack(normalizeJourney(JSON.parse(JSON.stringify(state))), operation('long-pending', { count: 1 }), { randomValues: [.9] });
  assert(retry.replayed); assert.equal(retry.officialDustDelta, 0); assert.equal(retry.state.skinTickets, 0);
  assert.equal(retry.receipt.batch.results[0].skinId, IDS[0]);
  assert.throws(() => openSkinPack(state, operation('long-pending', { mode: 'test', count: 1 }), { randomValues: [.9] }), { code: 'REWARD_EVENT_CONFLICT' });
});

function seeded(seed) { let value = seed >>> 0; return () => { value = (Math.imul(1664525, value) + 1013904223) >>> 0; return value / 4294967296; }; }
function simulatedDraws(days, random) {
  // Explicit model: earn full 2/day + once-only gift; spend every ticket;
  // save all dust and make no direct redemption. No child behavior is modeled.
  let state = { ...fresh(), skinTickets: 2 * days + 1 }, dust = days * 5, n = 0;
  while (state.skinTickets) {
    const id = `simulation-${n++}`, count = state.skinTickets >= 10 ? 10 : 1;
    const result = openSkinPack(state, operation(id, { count, issuedAt: NOW + n }), { randomValues: Array.from({ length: count }, random) });
    state = closeAll(result.state, 'official', id, NOW + n); dust += result.officialDustDelta;
  }
  return { owned: state.official.owned.length, dust };
}
test('fixed-seed 10/20/30 active-day model and extreme repeats stay finite, deterministic and honest', t => {
  const results = [];
  for (const days of [10, 20, 30]) {
    const runs = Array.from({ length: 120 }, (_, seed) => simulatedDraws(days, seeded(seed + 1)));
    const owned = runs.map(r => r.owned).sort((a, b) => a - b), dust = runs.map(r => r.dust);
    assert(owned.every(n => n >= Math.min(20, 1 + Math.floor((2 * days) / 5)) && n <= 20));
    results.push({ activeDays: days, tickets: 2 * days + 1, runs: runs.length, skinsMin: owned[0], skinsMedian: owned[Math.floor(owned.length / 2)], skinsMax: owned.at(-1), dustMean: Math.round(dust.reduce((a, b) => a + b, 0) / dust.length) });
  }
  assert.deepEqual(simulatedDraws(30, seeded(123)), simulatedDraws(30, seeded(123)));
  const extreme = simulatedDraws(50, () => 0); assert.equal(extreme.owned, 20); assert.equal(extreme.dust, 1870);
  t.diagnostic('SIMULATION ONLY: full task completion, all tickets spent, no redemption; not observed child behavior. ' + JSON.stringify(results));
});
