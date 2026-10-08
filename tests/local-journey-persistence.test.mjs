import test from 'node:test';
import assert from 'node:assert/strict';
import { ProgressStore, createProgressModel, PROGRESS_KEY } from '../src/network/progress.mjs';
import { createQuestionService } from '../server/questions.mjs';
import { HERO_SKINS } from '../src/hero-skins.mjs';

const questions = createQuestionService().metadata().questions;
const initial = Date.UTC(2026, 9, 8, 15, 59, 59);
const clone = value => structuredClone(value);
function environment(seed) {
  const values = new Map(seed ? [[PROGRESS_KEY, JSON.stringify(seed)]] : []);
  let tail = Promise.resolve(), failures = 0;
  return { values, failWrites(count = 1) { failures = count; },
    storage: { getItem: key => values.get(key) ?? null, setItem(key, value) { if (failures-- > 0) throw Error('synthetic quota'); values.set(key, String(value)); } },
    locks: { request(_name, _options, run) { const task = tail.then(run); tail = task.catch(() => {}); return task; } } };
}
function seed() { const data = createProgressModel({ questions }).fresh('local-journey-owner', 'UTC'); data.journey.skinTickets = 10; data.collection.earned.dust = 120; return data; }
async function stores(env = environment(), count = 1, options = {}) {
  const all = Array.from({ length: count }, () => new ProgressStore({ questions, storage: env.storage, locks: env.locks, ...options }));
  for (const store of all) assert.equal((await store.load()).ok, true);
  return all;
}
function snapshot(id, participation, reason = 'health') {
  return { roomId: id, phase: 'finished', youSeat: 0, bank: 'teacher-academic', grade: null, course: 'reading',
    ruleset: 'net-1.1', combatRules: '2.3', contentVersion: 'pep1-2026.1', mode: 'pve', assisted: false,
    self: { deckId: 'grove' }, computer: { level: 'easy' }, serverTime: initial + 60000,
    result: { winnerSeat: reason === 'draw' ? null : 0, reason, ownScore: 500, ownLearning: { attempts: 0, correct: 0 }, rounds: 4, finishedAt: initial + 60000 },
    ...(participation ? { participation } : {}) };
}

test('local wrong-answer participation joins both banks into one issue-day, study route and old card day without duplicate rewards', async () => {
  let now = initial;
  const env = environment(), [store] = await stores(env, 1, { now: () => now });
  const selected = [...questions.filter(q => q.bank === 'school').slice(0, 3), ...questions.filter(q => q.bank === 'teacher-academic').slice(0, 3)];
  for (const [i, question] of selected.entries()) {
    const id = `local-qualified-question-${i}`; now = initial;
    store.noteChallenge(id, { issuedAt: initial, source: i < 3 ? 'match' : 'study' });
    now = initial + 1100; await store.applyLearning({ challengeId: id, learning: { qid: question.id, correct: false, answeredAt: now } });
    now = initial + 3200;
    // A reconnect repeats presentation without moving the original issue-day.
    store.noteChallenge(id, { issuedAt: now, source: 'study' });
    const result = await store.qualifyLearning(id, { questionMs: 1100, feedbackMs: 2100 }); assert.equal(result.ok, true);
    assert.equal((await store.qualifyLearning(id, { questionMs: 1100, feedbackMs: 9999 })).changed, false);
    if (i === 2) assert.deepEqual(store.data.journey.days['2026-10-08'].units, {});
  }
  const data = store.data;
  assert.equal(data.journey.skinTickets, 3); assert.equal(data.collection.earned.dust, 5);
  assert.equal(data.collection.totalDays, 1); assert.equal(data.collection.days['2026-10-08'].qids.length, 6);
  assert.equal(data.journey.days['2026-10-08'].qids.length, 6); assert.equal(data.journey.days['2026-10-09'], undefined);
  assert(Object.keys(data.journey.days['2026-10-08'].units).every(key => key.startsWith('teacher-academic:')));
  assert(Object.values(data.legacy.mastery).every(item => item.correct === 0));
  const [reloaded] = await stores(env, 1, { now: () => now });
  assert.deepEqual(reloaded.data, data);
  assert.equal((await reloaded.qualifyLearning('local-qualified-question-0', { questionMs: 1100, feedbackMs: 2100 })).changed, false);
  assert.deepEqual(reloaded.data, data);
  assert.throws(() => reloaded.noteChallenge('source-required-local'), { code: 'INVALID_PARTICIPATION' });
});

test('local qualified learning commits journey, old collection and dust together; failed storage retries the original event once', async () => {
  let now = initial;
  const env = environment(), [store] = await stores(env, 1, { now: () => now });
  for (let i = 0; i < 3; i++) {
    const id = `local-atomic-question-${i}`; store.noteChallenge(id, { issuedAt: initial, source: 'study' });
    await store.applyLearning({ challengeId: id, learning: { qid: questions[i].id, correct: false, answeredAt: initial + 100 } });
    now = initial + 3200;
    if (i === 2) {
      const before = env.values.get(PROGRESS_KEY); env.failWrites();
      const failed = await store.qualifyLearning(id, { questionMs: 100, feedbackMs: 3100 });
      assert.equal(failed.ok, false); assert.equal(store.dirty, true); assert.equal(env.values.get(PROGRESS_KEY), before);
      now += 86400000; assert.equal((await store.retry()).ok, true);
    } else assert.equal((await store.qualifyLearning(id, { questionMs: 100, feedbackMs: 3100 })).ok, true);
  }
  assert.equal(store.data.journey.skinTickets, 2); assert.equal(store.data.collection.earned.dust, 5);
  assert.equal(store.data.journey.events.length, 3); assert.equal(store.data.journey.days['2026-10-09'], undefined);
});

test('local ten-pull locks randomness once and reveals only after durable success; repeat, reload, reveal and equip retain exact results', async () => {
  let draws = 0;
  const env = environment(seed()), [store] = await stores(env, 1, { now: () => initial, random: () => { draws++; return 0; } });
  const before = env.values.get(PROGRESS_KEY); env.failWrites();
  const first = store.openSkinPack('official', 10), duplicate = store.openSkinPack('official', 10); assert.equal(first, duplicate);
  assert.equal((await first).ok, false); assert.equal(store.dirty, true); assert.equal(env.values.get(PROGRESS_KEY), before);
  const locked = clone(store.data.journey.openings.official); assert.equal(draws, 10);
  assert.equal((await store.revealSkinPack('official', locked.id)).code, 'PROGRESS_UNSYNCED');
  const retried = await store.openSkinPack('official', 10); assert.equal(retried.ok, true); assert.equal(draws, 10);
  assert.deepEqual(store.data.journey.openings.official, locked); assert.equal(store.data.journey.skinTickets, 0);
  const [reloaded] = await stores(env, 1, { now: () => initial + 100 });
  assert.deepEqual(reloaded.data.journey.openings.official, locked);
  assert.equal((await reloaded.openSkinPack('official', 10)).ok, true); assert.deepEqual(reloaded.data.journey.openings.official, locked);
  await reloaded.closeSkinPack('official', locked.id); assert.deepEqual(reloaded.data.journey.openings.official, locked);
  await reloaded.revealSkinPack('official', locked.id, 3); assert.equal(reloaded.data.journey.openings.official.revealed, 8);
  await reloaded.equipSkin('official', locked.results[0].skinId); assert.deepEqual(reloaded.data.journey.equipped, { mode: 'official', skinId: locked.results[0].skinId });
  await reloaded.revealSkinPack('official', locked.id); await reloaded.closeSkinPack('official', locked.id);
  assert.equal(reloaded.data.journey.openings.official, null); assert.equal(reloaded.data.journey.recent.at(-1).id, locked.id);
  assert.equal(reloaded.data.journey.skinTickets, 0);
  assert.equal(reloaded.data.collection.earned.dust, 120 + locked.results.reduce((sum, item) => sum + item.dust, 0));
});

test('local test skins and official targeted redemption keep their wallets and ownership separate', async () => {
  const env = environment(seed()), [store] = await stores(env, 1, { now: () => initial, random: () => 0 });
  const before = store.data;
  assert.equal((await store.openSkinPack('test', 10)).ok, true);
  const testBatch = store.data.journey.openings.test;
  assert.equal((await store.redeemSkin('test', HERO_SKINS.at(-1).id)).ok, true);
  assert.equal((await store.equipSkin('test', HERO_SKINS.at(-1).id)).ok, true);
  assert.deepEqual(store.data.journey.official, before.journey.official);
  assert.equal(store.data.journey.skinTickets, 10); assert.deepEqual(store.data.collection.earned, before.collection.earned);
  const owned = HERO_SKINS[0].id;
  assert.equal((await store.redeemSkin('official', owned)).ok, true); assert.equal(store.data.collection.earned.dust, 20);
  assert.equal((await store.redeemSkin('official', owned)).ok, true); assert.equal(store.data.collection.earned.dust, 20);
  assert.equal((await store.equipSkin('official', HERO_SKINS.at(-1).id)).code, 'SKIN_NOT_OWNED');
  assert.deepEqual(store.data.journey.openings.test, testBatch);
  assert.equal((await store.skinAction({ kind: 'open', mode: 'official', count: 1, results: [] })).code, 'INVALID_SKIN_ACTION');
});

test('two local tabs coalesce one paid opening and stale skin conflicts do not poison unrelated learning', async () => {
  const data = seed(); data.journey.skinTickets = 1;
  const env = environment(data), [a, b] = await stores(env, 2, { now: () => initial, random: () => 0 });
  const [first, second] = await Promise.all([a.openSkinPack('official', 1), b.openSkinPack('official', 1)]);
  assert.equal(first.ok, true); assert.equal(second.ok, true);
  assert.equal(a.data.journey.skinTickets, 0); assert.equal(b.data.journey.skinTickets, 0);
  assert.deepEqual(a.data.journey.openings.official, b.data.journey.openings.official);
  const [fresh] = await stores(env); assert.equal(fresh.data.journey.operations.filter(event => JSON.parse(event.signature).kind === 'open').length, 1);
  const env2 = environment(seed()), [x, y] = await stores(env2, 2, { now: () => initial, random: () => 0 });
  env2.failWrites(); assert.equal((await x.openSkinPack('official', 10)).ok, false);
  assert.equal((await y.openSkinPack('official', 1)).ok, true);
  const update = await x.applyLearning({ challengeId: 'local-conflict-learning', learning: { qid: questions[0].id, correct: false, answeredAt: initial } });
  assert.equal(update.discarded, true); assert.equal(x.dirty, false);
  assert.equal(x.data.legacy.mastery[questions[0].id].seen, 1);
  assert.deepEqual(x.data.journey.openings.official, y.data.journey.openings.official);
});

test('only real local snapshot counters qualify a fresh normal result, never old results or inferred score', async () => {
  const env = environment(), [store] = await stores(env, 1, { now: () => initial });
  const valid = { startedAt: initial, ownTurns: 2, ownActions: 3 };
  const old = snapshot('local-old-result'); await store.addResult(old);
  await store.addResult({ ...old, participation: valid }); assert.equal(store.data.journey.skinTickets, 0);
  for (const [i, counters, reason] of [[0, { ...valid, ownTurns: 1 }, 'health'], [1, { ...valid, ownActions: 2 }, 'draw'], [2, valid, 'surrender'], [3, valid, 'expired']])
    assert.equal((await store.addResult(snapshot(`local-ineligible-${i}`, counters, reason))).ok, true);
  assert.equal(store.data.journey.skinTickets, 0);
  const before = store.data;
  assert.equal((await store.addResult(snapshot('local-forged-counters', { ...valid, ownActions: -1 }))).code, 'INVALID_QUALIFIED_MATCH');
  assert.deepEqual(store.data, before);
  const complete = snapshot('local-qualified-result', valid, 'draw');
  const raw = env.values.get(PROGRESS_KEY); env.failWrites(); assert.equal((await store.addResult(complete)).ok, false); assert.equal(env.values.get(PROGRESS_KEY), raw);
  assert.equal((await store.retry()).ok, true); assert.equal(store.data.journey.skinTickets, 1);
  assert.equal(store.data.journey.days['2026-10-08'].qualifiedMatch, true);
  const saved = store.data; const [reloaded] = await stores(env); await reloaded.addResult(complete);
  assert.deepEqual(reloaded.data, saved);
});


test('local source-bound participation cannot grant from impossible elapsed time and two tabs cannot spend the same redemption dust', async () => {
  let now = initial;
  const env = environment(), [store] = await stores(env, 1, { now: () => now });
  store.noteChallenge('local-impossible-time', { source: 'study', issuedAt: initial });
  await store.applyLearning({ challengeId: 'local-impossible-time', learning: { qid: questions[0].id, correct: false, answeredAt: initial + 2000 } });
  const before = store.data; now = initial + 2500;
  const early = await store.qualifyLearning('local-impossible-time', { questionMs: 2000, feedbackMs: 1200 });
  assert.equal(early.ok, true); assert.equal(early.changed, false); assert.deepEqual(store.data, before);
  now = initial + 3200; assert.equal((await store.qualifyLearning('local-impossible-time', { questionMs: 2000, feedbackMs: 1200 })).ok, true);
  assert.equal(store.data.journey.events.length, 1);
  const spending = environment(seed()), [a, b] = await stores(spending, 2, { now: () => initial });
  const results = await Promise.all([a.redeemSkin('official', HERO_SKINS[0].id), b.redeemSkin('official', HERO_SKINS[1].id)]);
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.equal(results.find(result => !result.ok).code, 'INSUFFICIENT_OFFICIAL_DUST');
  const [saved] = await stores(spending); assert.equal(saved.data.collection.earned.dust, 20); assert.equal(saved.data.journey.official.owned.length, 1);
  assert.equal(a.dirty, false); assert.equal(b.dirty, false);
});

test('delayed local presentation after Shanghai midnight retains the authority-issued day', async () => {
  let now = initial + 1100;
  const [store] = await stores(environment(), 1, { now: () => now });
  const id = 'local-delayed-midnight';
  store.noteChallenge(id, { source: 'study', issuedAt: initial });
  now = initial + 1200;
  await store.applyLearning({ challengeId: id, learning: { qid: questions[0].id, correct: false, answeredAt: now } });
  store.noteChallenge(id, { source: 'match', issuedAt: now });
  now = initial + 4400;
  assert.equal((await store.qualifyLearning(id, { questionMs: 100, feedbackMs: 3200 })).ok, true);
  assert.equal(store.data.journey.days['2026-10-08'].qids.length, 1);
  assert.equal(store.data.journey.days['2026-10-09'], undefined);
  assert.equal(store.data.collection.days['2026-10-08'].qids.length, 1);
  assert.equal(store.data.collection.days['2026-10-09'], undefined);
});


test('queued local skin and reward intents stay bound to their original profile across an explicit restore', async () => {
  let now = initial;
  const [store] = await stores(environment(seed()), 1, { now: () => now, random: () => 0 });
  const id = 'local-profile-bound-reward'; store.noteChallenge(id, { source: 'study', issuedAt: initial });
  await store.applyLearning({ challengeId: id, learning: { qid: questions[0].id, correct: false, answeredAt: initial + 100 } });
  const originalOwner = store.data.profileId, plan = store.prepareImport(store.export()); now = initial + 3200;
  const restoring = store.restore(plan, plan.revision);
  const opening = store.openSkinPack('test', 10);
  const participating = store.qualifyLearning(id, { questionMs: 100, feedbackMs: 3100 });
  const finishing = store.addResult(snapshot('local-profile-bound-match', { startedAt: initial, ownTurns: 2, ownActions: 3 }));
  assert.equal((await restoring).ok, true); assert.notEqual(store.data.profileId, originalOwner);
  for (const operation of [opening, participating, finishing]) assert.equal((await operation).code, 'PROFILE_CHANGED');
  assert.equal(store.data.journey.events.length, 0); assert.equal(store.data.journey.openings.test, null);
  assert.equal(store.data.onlineRecords.length, 0); assert.equal(store.dirty, false);
});
