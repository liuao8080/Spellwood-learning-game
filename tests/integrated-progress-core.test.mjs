import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMatch, act, effectiveCardCost } from '../src/engine.mjs';
import { freshSave, validateMatch, validateSave } from '../src/learning.mjs';
import { CARD, RULES } from '../src/cards.mjs';
import { ProgressStore, PROGRESS_KEY, createProgressModel } from '../src/network/progress.mjs';
import { createQuestionService } from '../server/questions.mjs';
import { createIdentityStore } from '../server/identity-store.mjs';
import { createPlayerProgress } from '../server/player-progress.mjs';
import { createProgressBridge } from '../server/progress-bridge.mjs';
import { SCHOOL_BANK, TEACHER_BANK } from '../src/question-banks.mjs';

const questions = createQuestionService().metadata().questions;
const model = createProgressModel({ questions });
const initial = Date.UTC(2026, 9, 8, 4);
const clone = value => structuredClone(value);
function storage(entries = []) {
  const values = new Map(entries), writes = [];
  return { values, writes, getItem: key => values.get(key) ?? null,
    setItem(key, value) { values.set(key, value); writes.push(key); } };
}
function runtime(t, at = initial) {
  const identity = createIdentityStore(); t.after(() => identity.close());
  let now = at;
  const playerId = identity.createGuest().player.playerId;
  const progress = createPlayerProgress({ identityStore: identity, questions, now: () => now });
  const bridge = createProgressBridge({ identityStore: identity, progress, now: () => now });
  t.after(() => bridge.close());
  return { identity, playerId, progress, bridge, setTime(value) { now = value; } };
}
function result(id, bank = SCHOOL_BANK, participation) {
  return { roomId: id, phase: 'finished', youSeat: 0, bank,
    grade: bank === TEACHER_BANK ? null : 1, course: bank === TEACHER_BANK ? 'reading' : 's1',
    ruleset: 'net-1.1', combatRules: RULES, contentVersion: 'pep1-2026.1', mode: 'pve', assisted: false,
    self: { deckId: 'grove' }, computer: { level: 'easy' }, serverTime: initial + 60000,
    result: { winnerSeat: 0, reason: 'health', ownScore: 500, ownLearning: { attempts: 1, correct: 1 }, rounds: 4, finishedAt: initial + 60000 },
    ...(participation ? { participation } : {}) };
}
function savedMatch() {
  const match = createMatch({ seed: 'HAND-INSTANCE-SAVE' });
  match.turn = 3; match.seq = 1; match.handSeq = 9;
  match.players[0].hand = ['sprout', 'sprout'];
  match.players[0].handIds = ['h1', 'h2'];
  match.players[0].handBoosts = { h2: { turn: 3, amount: 1 } };
  match.players[1].hand = ['spark']; match.players[1].handIds = ['h9'];
  const card = CARD.storm_kingfisher;
  match.players[0].board = [{ uid: 'u1', cardId: card.id, atk: card.atk, hp: card.hp,
    maxHp: card.hp, ready: true, kingfisherDrawTurn: 3 }];
  return match;
}

test('real teacher v3 fixture migrates once as a whole account through local and SQLite stores', async t => {
  // Generated with teacher 33fa224 runtime, never by the schema-4 model.
  const original = JSON.parse(readFileSync(new URL('./fixtures/teacher-v3-progress.json', import.meta.url)));
  assert.equal(original.schema, 3);
  assert.equal(questions.filter(q => q.bank === SCHOOL_BANK).length, 432);
  assert.equal(questions.filter(q => q.bank === TEACHER_BANK).length, 48);
  const raw = JSON.stringify(original), db = storage([['spellwood.save.v3', raw], ['spellwood.save.v2', 'older'], ['spellwood.save.v1', 'oldest']]);
  const store = new ProgressStore({ questions, storage: db, locks: null });
  assert.equal((await store.load()).ok, true);
  const migrated = store.data;
  for (const key of Object.keys(original).filter(k => !['schema', 'revision'].includes(k))) assert.deepEqual(migrated[key], original[key], key);
  assert.equal(migrated.schema, 4); assert.equal(migrated.journey.ownerId, original.profileId);
  assert.equal(migrated.revision, original.revision + 1);
  assert.equal((await store.retry()).ok, true); assert.equal(store.data.revision, migrated.revision);
  assert.equal(db.values.get('spellwood.save.v3'), raw); assert.equal(db.values.get('spellwood.save.v2'), 'older'); assert.equal(db.values.get('spellwood.save.v1'), 'oldest');
  assert.equal((await store.updatePreferences({ bank: SCHOOL_BANK })).ok, true);
  assert.equal(store.data.legacy.grade, 6); assert.equal(store.data.legacy.course, 's2-u5'); assert.equal(store.data.legacy.teacherCourse, 'reading');
  const { identity, playerId, progress } = runtime(t), player = identity.getPublicPlayer(playerId);
  const old = clone(original); old.profileId = playerId; old.revision = player.revision + 1;
  identity.updatePlayerData(playerId, { expectedRevision: player.revision, progress: old });
  const server = progress.ensure(playerId);
  for (const key of Object.keys(old).filter(k => !['schema', 'revision'].includes(k))) assert.deepEqual(server.progress[key], old[key], key);
  assert.equal(server.progress.schema, 4); assert.deepEqual(progress.ensure(playerId), server);
});

test('every existing rule version remains unchanged through save migration and continuation', () => {
  const base = JSON.parse(readFileSync(new URL('./fixtures/teacher-v3-progress.json', import.meta.url)));
  for (const rules of ['1.0', '2.0', '2.1', '2.2']) {
    const source = clone(base); source.legacy.match.rules = rules;
    if (['1.0', '2.0'].includes(rules)) delete source.legacy.match.opening;
    if (rules === '1.0') for (const player of source.legacy.match.players) delete player.ritualsLeft;
    const migrated = model.validate(source).legacy.match;
    assert.deepEqual(migrated, source.legacy.match);
    const continued = act(migrated, { type: 'end' });
    assert.equal(continued.rules, rules); assert.equal(validateMatch(continued), true);
    assert.equal('handSeq' in continued, false);
    assert(continued.players.every(p => !('handIds' in p) && !('handBoosts' in p)));
    for (const location of ['hand', 'deck', 'board']) {
      const forged = clone(source.legacy.match);
      if (location === 'board') { forged.seq = 1; forged.players[0].board = [{ uid: 'u1', cardId: 'storm_kingfisher', atk: 2, hp: 2, maxHp: 2, ready: false }]; }
      else forged.players[0][location][0] = 'acorn_squirrel';
      assert.equal(validateMatch(forged), false, `${rules} ${location}`);
    }
  }
});

test('2.3 duplicates, a single grant and kingfisher marker survive export/import/reload without retriggering', async () => {
  const source = model.fresh('instance-save-owner'); source.legacy.match = savedMatch();
  assert.equal(validateMatch(source.legacy.match), true);
  const db = storage([[PROGRESS_KEY, JSON.stringify(source)]]), store = new ProgressStore({ questions, storage: db, locks: null });
  assert.equal((await store.load()).ok, true);
  const exported = await store.exportLatest(); assert.equal(exported.ok, true);
  const imported = model.importLegacy(exported.json); assert.deepEqual(imported.legacy.match, source.legacy.match);
  const target = new ProgressStore({ questions, storage: storage(), locks: null }); await target.load();
  const plan = target.prepareImport(exported.json); assert.equal((await target.restore(plan, plan.revision)).ok, true);
  assert.deepEqual(target.data.legacy.match, source.legacy.match);
  const match = target.data.legacy.match;
  assert.equal(effectiveCardCost(match, 0, 0), 1); assert.equal(effectiveCardCost(match, 0, 1), 0);
  const attacked = act(match, { type: 'attack', uid: 'u1', target: 'hero' });
  assert.equal(attacked.players[0].hand.length, match.players[0].hand.length);
  assert.equal(attacked.players[0].board[0].kingfisherDrawTurn, 3);
  assert(attacked.players[1].hp < match.players[1].hp);
});

test('malformed 2.3 state fails before import or storage and never receives factory repair', async () => {
  const cases = [
    s => { delete s.handSeq; }, s => { s.handSeq = -1; }, s => { s.handSeq = 1.5; }, s => { s.handSeq = Number.MAX_SAFE_INTEGER + 1; },
    s => { delete s.players[0].handIds; }, s => { s.players[0].handIds.pop(); }, s => { s.players[0].handIds[0] = 'h0'; },
    s => { s.players[0].handIds[0] = 'h01'; }, s => { s.players[0].handIds[0] = 'h10'; }, s => { s.players[0].handIds[0] = 'h9007199254740993'; },
    s => { s.players[0].handIds[0] = 'h2'; }, s => { s.players[1].handIds[0] = 'h1'; }, s => { s.players[0].handBoosts = []; },
    s => { s.players[0].handBoosts.h9 = { turn: 3, amount: 1 }; }, s => { s.players[0].handBoosts.h2.amount = 2; },
    s => { s.players[0].handBoosts.h2.turn = 2; }, s => { s.players[0].handBoosts.h2.turn = 4; },
    s => { s.players[1].handBoosts = { h9: { turn: 3, amount: 1 } }; },
    s => { s.players[0].board[0].kingfisherDrawTurn = 4; }, s => { s.players[0].board[0].kingfisherDrawTurn = 0; },
    s => { s.players[0].board[0].kingfisherDrawTurn = 1.2; }, s => { s.players[0].board[0].cardId = 'sprout'; },
  ];
  for (const mutate of cases) {
    const source = model.fresh('invalid-state-owner'); source.legacy.match = savedMatch(); mutate(source.legacy.match);
    assert.equal(validateMatch(source.legacy.match), false, mutate.toString());
    assert.throws(() => validateSave(source.legacy, questions)); assert.throws(() => model.importLegacy(source));
    const raw = JSON.stringify(source), db = storage([[PROGRESS_KEY, raw]]), store = new ProgressStore({ questions, storage: db, locks: null });
    assert.equal((await store.load()).code, 'CORRUPT_SAVE'); assert.equal(db.values.get(PROGRESS_KEY), raw); assert.equal(db.writes.length, 0);
  }
});

test('school and teacher quick returns succeed, then cumulative feedback qualifies once across one Shanghai day', t => {
  const at = Date.UTC(2026, 9, 8, 15, 59, 59), { identity, playerId, progress, bridge, setTime } = runtime(t, at);
  const selected = [...questions.filter(q => q.bank === SCHOOL_BANK).slice(0, 3), ...questions.filter(q => q.bank === TEACHER_BANK).slice(0, 3)];
  for (const [i, q] of selected.entries()) {
    const id = `mixed-fast-learning-${i}`; setTime(at); bridge.noteChallenge(playerId, id, at, { source: 'study' });
    setTime(at + 100); assert.equal(bridge.learning(playerId, { challengeId: id, learning: { qid: q.id, correct: false, answeredAt: at + 100 } }), true);
    const revision = progress.ensure(playerId).revision;
    for (const elapsed of [100, 1299, 3199]) {
      setTime(at + elapsed); const early = bridge.participation(playerId, id);
      assert.deepEqual(early.receipt, { changed: false, qualified: false }); assert.equal(early.player.revision, revision);
      assert.equal(identity.hasPlayerEvent(playerId, `participation:${id}`), false);
    }
    setTime(at + 3200); assert.equal(bridge.participation(playerId, id).duplicate, false);
    assert.equal(bridge.participation(playerId, id).duplicate, true);
  }
  const saved = progress.ensure(playerId).progress;
  assert.equal(saved.collection.totalDays, 1); assert.equal(saved.collection.days['2026-10-08'].qids.length, 6);
  assert.equal(saved.journey.days['2026-10-08'].qids.length, 6); assert.equal(saved.journey.days['2026-10-09'], undefined);
  assert.equal(saved.collection.earned.dust, 5); assert.equal(saved.journey.skinTickets, 3);
  assert(Object.values(saved.legacy.mastery).every(m => m.correct === 0));
});

test('teacher categories use their own trusted reward units, and match learning cannot complete study units', t => {
  const { playerId, progress, bridge, setTime } = runtime(t);
  const teacher = questions.filter(q => q.bank === TEACHER_BANK && q.category === 'reading').slice(0, 2);
  for (const [i, question] of teacher.entries()) {
    const id = `teacher-match-source-${i}`; bridge.noteChallenge(playerId, id, initial, { source: 'match' });
    bridge.learning(playerId, { challengeId: id, learning: { qid: question.id, correct: false, answeredAt: initial + 100 } });
    setTime(initial + 3200); bridge.participation(playerId, id);
  }
  let day = progress.ensure(playerId).progress.journey.days['2026-10-08'];
  assert.deepEqual(day.units, {}); assert.equal(day.claimed.includes('daily_apply'), false);
  for (const [i, question] of teacher.entries()) {
    const id = `teacher-study-source-${i}`; bridge.noteChallenge(playerId, id, initial, { source: 'study' });
    bridge.learning(playerId, { challengeId: id, learning: { qid: question.id, correct: false, answeredAt: initial + 100 } });
    bridge.participation(playerId, id);
  }
  day = progress.ensure(playerId).progress.journey.days['2026-10-08'];
  assert.deepEqual(Object.keys(day.units), [`teacher-academic:reading:${teacher[0].unitId}`]);
  assert.equal(day.claimed.includes('daily_apply'), true); assert.equal(day.qids.length, 2);
});

test('invalid or stale timing never freezes qualification, while a failed qualifying write freezes its first valid time', t => {
  const { identity, playerId, progress, bridge, setTime } = runtime(t);
  assert.throws(() => bridge.participation(playerId, 'missing-timing'), { code: 'INVALID_PARTICIPATION' });
  for (const [i, answer, observe] of [[0, initial - 1, initial + 3200], [1, initial + 10, initial + 7200001], [2, initial + 10, initial + 9], [3, initial + .5, initial + 3200]]) {
    const id = `invalid-time-${i}`; bridge.noteChallenge(playerId, id, initial);
    bridge.learning(playerId, { challengeId: id, learning: { qid: questions[0].id, correct: false, answeredAt: answer } });
    setTime(observe); assert.throws(() => bridge.participation(playerId, id), { code: i === 3 ? 'PROGRESS_PENDING' : 'INVALID_PARTICIPATION' });
  }
  // Isolate the deliberately rejected fractional learning write from the valid retry.
  const next = runtime(t); const id = 'frozen-first-valid-time'; next.bridge.noteChallenge(next.playerId, id, initial);
  next.bridge.learning(next.playerId, { challengeId: id, learning: { qid: questions[0].id, correct: false, answeredAt: initial + 100 } });
  const commit = next.identity.commitPlayerEvent.bind(next.identity); let fail = true;
  next.identity.commitPlayerEvent = (...args) => { if (fail) { fail = false; throw Error('synthetic atomic write failure'); } return commit(...args); };
  const before = next.progress.ensure(next.playerId); next.setTime(initial + 3200);
  assert.throws(() => next.bridge.participation(next.playerId, id)); assert.deepEqual(next.progress.ensure(next.playerId), before);
  next.setTime(initial + 86400000);
  next.bridge.noteChallenge(next.playerId, 'later-challenge-prunes-timing', initial + 86400000);
  next.bridge.participation(next.playerId, id);
  const saved = next.progress.ensure(next.playerId).progress;
  assert.equal(JSON.parse(saved.journey.events[0].signature).qualifiedAt, initial + 3200);
  assert.equal(saved.journey.days['2026-10-09'], undefined);
  const restarted = createProgressBridge({ identityStore: next.identity, progress: next.progress });
  assert.equal(restarted.participation(next.playerId, id).duplicate, true);
});

test('historical school and teacher result receipts cannot gain retroactive participation; new deferred results keep stable bank and counters', t => {
  const { identity, playerId, progress, bridge } = runtime(t);
  for (const bank of [SCHOOL_BANK, TEACHER_BANK]) {
    const snapshot = result(`historical-${bank}`, bank); const first = progress.addResult(playerId, snapshot);
    assert.equal(progress.addResult(playerId, snapshot).duplicate, true);
    assert.throws(() => progress.addResult(playerId, { ...snapshot, participation: { startedAt: initial, ownTurns: 2, ownActions: 3 } }), { code: 'PLAYER_EVENT_CONFLICT' });
    assert.deepEqual(progress.ensure(playerId).progress, first.player.progress);
  }
  const snapshot = result('deferred-teacher-reward', TEACHER_BANK, { startedAt: initial, ownTurns: 2, ownActions: 3 });
  const expected = clone(snapshot), commit = identity.commitPlayerEvent.bind(identity); let fail = true;
  identity.commitPlayerEvent = (...args) => { if (fail) { fail = false; throw Error('synthetic result failure'); } return commit(...args); };
  assert.equal(bridge.result(playerId, snapshot), false);
  snapshot.bank = SCHOOL_BANK; snapshot.participation.ownActions = 0;
  bridge.ensureSynced(playerId); assert.equal(bridge.pendingCount, 0);
  const saved = progress.ensure(playerId).progress;
  assert.equal(saved.onlineRecords.at(-1).bank, TEACHER_BANK); assert.equal(saved.journey.skinTickets, 1);
  assert.equal(progress.addResult(playerId, expected).duplicate, true); assert.deepEqual(progress.ensure(playerId).progress, saved);
});


test('local participation accepts only a complete cumulative foreground budget without changing the old card reducer', async t => {
  let now = initial;
  t.mock.method(Date, 'now', () => now);
  const store = new ProgressStore({ questions, storage: storage(), locks: null });
  assert.equal((await store.load()).ok, true);
  const challengeId = 'local-fast-answer-budget';
  await store.applyLearning({ challengeId, learning: { qid: questions[0].id, correct: false, answeredAt: initial } });
  now += 3200;
  const before = store.data;
  for (const timing of [{ questionMs: 0, feedbackMs: 3199 }, { questionMs: 2001, feedbackMs: 1199 },
    { questionMs: -1, feedbackMs: 3201 }, { questionMs: 0.5, feedbackMs: 3200 }]) {
    const result = await store.qualifyLearning(challengeId, timing);
    assert.equal(result.ok, true); assert.equal(result.changed, false); assert.equal(store.dirty, false);
    assert.deepEqual(store.data, before);
  }
  const qualified = await store.qualifyLearning(challengeId, { questionMs: 0, feedbackMs: 3200 });
  assert.equal(qualified.ok, true); assert.equal(qualified.changed, true);
  assert.equal(Object.values(store.data.collection.days)[0].qids.length, 1);
  assert.deepEqual(store.data.legacy.mastery, before.legacy.mastery);
  assert.equal((await store.qualifyLearning(challengeId, { questionMs: 0, feedbackMs: 3200 })).changed, false);
});
