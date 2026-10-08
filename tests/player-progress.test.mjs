import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  createIdentityStore, IDENTITY_SCHEMA_VERSION,
  PLAYER_PROFILE_MAX_BYTES, PLAYER_PROGRESS_MAX_BYTES,
} from "../server/identity-store.mjs";
import { createPlayerProgress } from "../server/player-progress.mjs";
import { createProgressModel, ProgressStore, PROGRESS_LIMITS } from "../src/network/progress.mjs";
import { createQuestionService } from "../server/questions.mjs";
import { freshSave, recordLearning } from "../src/learning.mjs";
import { CARDS } from "../src/cards.mjs";

// Fixtures are synthetic. Real students' data and credentials are never used.
const questions = createQuestionService().metadata().questions;
const model = createProgressModel({ questions });
const when = Date.UTC(2026, 9, 1, 4);
const qid = questions[0].id;
const feedback = (id = "learning-0001", correct = true, answeredAt = when, questionId = qid) => ({
  challengeId: id, learning: { qid: questionId, correct, answeredAt },
  correctOptionId: "private-answer", explanation: "private-explanation", resumeToken: "private-token",
});
const snapshot = (id = "result-00001", extra = {}) => ({
  roomId: id, phase: "finished", youSeat: 0, grade: 1, course: "s1", ruleset: "net-1.1",
  combatRules: "2.1", contentVersion: "pep1-2026.1", mode: "pvp", assisted: false,
  self: { deckId: "grove", hand: ["private-card"] }, serverTime: when,
  result: { winnerSeat: 0, reason: "health", ownScore: 750, ownLearning: { attempts: 2, correct: 1 }, rounds: 4, finishedAt: when },
  ...extra,
});
function filename(t) {
  const folder = mkdtempSync(path.join(tmpdir(), "spellwood-player-progress-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return path.join(folder, "identity.sqlite");
}
function fixture(t, options = {}) {
  const store = createIdentityStore(options);
  t.after(() => store.close());
  const service = createPlayerProgress({ identityStore: store, questions, now: () => when });
  const guest = store.createGuest();
  const player = service.ensure(guest.player.playerId);
  return { store, service, guest, player, playerId: player.playerId };
}
function sqlFor(t, file) {
  const sql = new DatabaseSync(file);
  t.after(() => sql.close());
  return sql;
}

test("fresh v3 progress keeps the guest's identity and survives registration/restart", async (t) => {
  const file = filename(t);
  const { store, service, guest, playerId, player } = fixture(t, { databasePath: file });
  assert.equal(player.progress.schema, 3);
  assert.equal(player.progress.profileId, playerId);
  assert.equal(player.progress.timeZone, "Asia/Shanghai");
  assert.equal(player.progress.revision, player.revision);
  assert.deepEqual(service.ensure(playerId), player);
  const learned = service.applyLearning(playerId, feedback());
  const registered = await store.registerGuest({
    guestToken: guest.session.token, username: "SyntheticWillow", password: "synthetic-password",
  });
  assert.equal(registered.player.playerId, playerId);
  assert.deepEqual(registered.player.progress, learned.player.progress);
  store.close();
  const reopened = createIdentityStore({ databasePath: file });
  t.after(() => reopened.close());
  const restored = createPlayerProgress({ identityStore: reopened, questions }).ensure(playerId);
  assert.deepEqual(restored.progress, learned.player.progress);
  assert.equal(restored.progress.legacy.mastery[qid].seen, 1);
});

test("learning reproduces v3 chronology and strips private question/session content", async (t) => {
  const { service, playerId } = fixture(t);
  const values = new Map();
  const local = new ProgressStore({ questions, locks: null, storage: {
    getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value),
  } });
  await local.load();
  const events = [feedback("question-first", true), feedback("question-later", true, when + 86400000), feedback("question-middle", false, when + 1000)];
  for (const event of events) await local.applyLearning(event);
  for (const event of [...events].reverse()) service.applyLearning(playerId, event);
  const saved = service.ensure(playerId);
  assert.deepEqual(saved.progress.legacy.mastery, local.data.legacy.mastery);
  assert.equal(saved.profile.progressAuthority.learningEvents, 3);
  const json = JSON.stringify(saved);
  for (const secret of ["private-answer", "private-explanation", "private-token"]) assert(!json.includes(secret));
});

test("identical learning retries have the original receipt, current view, and no extra award", (t) => {
  const { service, playerId } = fixture(t);
  const first = service.applyLearning(playerId, feedback());
  const preferences = service.preferences(playerId, { grade: 3 }, "settings-0001");
  const retry = service.applyLearning(playerId, { ...feedback(), explanation: "different private prose" });
  assert.equal(retry.duplicate, true);
  assert.deepEqual(retry.receipt, first.receipt);
  assert.equal(retry.player.revision, preferences.player.revision);
  assert.equal(retry.player.progress.legacy.mastery[qid].seen, 1);
  assert.throws(() => service.applyLearning(playerId, feedback("learning-0001", false)), { code: "PLAYER_EVENT_CONFLICT" });
  assert.equal(service.ensure(playerId).revision, preferences.player.revision);
});

test("terminal results are seat-specific, stable across resends, and never persist hands", (t) => {
  const { service, playerId } = fixture(t);
  const first = service.addResult(playerId, snapshot());
  const retry = service.addResult(playerId, snapshot("result-00001", { serverTime: when + 50000 }));
  assert.equal(retry.duplicate, true);
  assert.deepEqual(retry.receipt, first.receipt);
  assert.equal(retry.player.progress.onlineRecords.length, 1);
  assert.equal(retry.player.progress.combatRating.games, 0, "PvP does not become the old computer rating");
  assert(!JSON.stringify(retry.player).includes("private-card"));
  service.addResult(playerId, snapshot("result-00001", { youSeat: 1 }));
  assert.equal(service.ensure(playerId).progress.onlineRecords.length, 2);
  const altered = snapshot(); altered.result.ownScore++;
  assert.throws(() => service.addResult(playerId, altered), { code: "PLAYER_EVENT_CONFLICT" });
});

test("invalid learning, results, preferences, and collection intents cannot mutate a player", (t) => {
  const { service, playerId, player } = fixture(t);
  const invalid = [
    () => service.applyLearning(playerId, feedback("invalid-question", true, when, "not-in-bank")),
    () => service.applyLearning(playerId, feedback("invalid-answer", "yes")),
    () => service.addResult(playerId, snapshot("wrong-phase-01", { phase: "playing" })),
    () => service.preferences(playerId, { wallet: 999999 }, "settings-0001"),
    () => service.preferences(playerId, { grade: 7 }, "settings-0001"),
    () => service.collection(playerId, { kind: "mint-money", dust: 10000 }, "collection-001"),
    () => service.preferences(playerId, { grade: 1 }, "short"),
  ];
  for (const action of invalid) assert.throws(action);
  assert.deepEqual(service.ensure(playerId), player);
});

test("existing participation rules count distinct server receipts, not correctness or retries", (t) => {
  const { service, playerId } = fixture(t);
  for (let index = 0; index < 6; index++) {
    const id = `participation-${index}`;
    service.applyLearning(playerId, feedback(id, false, when, questions[index].id));
    const timing = { questionMs: 2000, feedbackMs: 1200, now: when + 1200 };
    const qualified = service.participation(playerId, id, timing);
    assert.equal(service.participation(playerId, id, timing).duplicate, true);
    assert.equal(service.participation(playerId, id, {...timing,feedbackMs:timing.feedbackMs+500,now:timing.now+500}).duplicate,true);
    assert.equal(qualified.receipt.changed, true);
  }
  const player = service.ensure(playerId);
  assert.equal(player.progress.collection.totalDays, 1);
  assert.equal(Object.values(player.progress.collection.days)[0].qids.length, 6);
  assert.deepEqual(player.progress.collection.earned, { cards: {}, dust: 0 });
  assert.throws(() => service.participation(playerId, "missing-receipt", { questionMs: 2000, feedbackMs: 1200, now: when }), { code: "INVALID_PARTICIPATION" });
  assert.throws(() => service.participation(playerId, "participation-0", { questionMs: 0, feedbackMs: 1200, now: when }), { code: "INVALID_PARTICIPATION" });
});

test("an opening retry fingerprints the stable request, preserving the original random pack", (t) => {
  const { store, service, playerId } = fixture(t);
  const action = { kind: "open-pack", mode: "test", id: "original-pack-01", createdAt: when,
    cards: Array.from({ length: 10 }, () => ({ cardId: CARDS[0].id, finish: "leaf" })) };
  const saved = service.collection(playerId, action, "open-request-01");
  const retry = service.collection(playerId, { ...action, id: "retry-pack-0001", createdAt: when + 100,
    cards: Array.from({ length: 10 }, () => ({ cardId: CARDS[1].id, finish: "gold" })) }, "open-request-01");
  assert.equal(retry.duplicate, true);
  assert.deepEqual(retry.player.progress.collection, saved.player.progress.collection);
  assert.equal(retry.player.progress.collection.opening.id, "original-pack-01");
  assert.equal(store.hasPlayerEvent(playerId, "collection:open-request-01"), true);
  assert.equal(store.hasPlayerEvent(playerId, "collection:missing-request-01"), false);
  assert.throws(() => service.collection(playerId, { ...action, mode: "earned" }, "open-request-01"), { code: "PLAYER_EVENT_CONFLICT" });
});

test("atomic event receipts canonicalize payload keys and reject a reused ID/type", (t) => {
  const { store, playerId, player } = fixture(t);
  const event = { eventId: "synthetic-event", type: "synthetic", payload: { a: 1, b: { x: 2, y: 3 } },
    expectedRevision: player.revision, progress: player.progress, receipt: { rewarded: 1 } };
  const first = store.commitPlayerEvent(playerId, event);
  const duplicate = store.commitPlayerEvent(playerId, { ...event,
    payload: { b: { y: 3, x: 2 }, a: 1 }, expectedRevision: -99, progress: "ignored-for-replay" });
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(duplicate.receipt, first.receipt);
  assert.throws(() => store.commitPlayerEvent(playerId, { ...event, type: "another" }), { code: "PLAYER_EVENT_CONFLICT" });
  assert.throws(() => store.commitPlayerEvent(playerId, { ...event, payload: { a: 2 } }), { code: "PLAYER_EVENT_CONFLICT" });
  assert.throws(() => store.commitPlayerEvent(playerId, { ...event, eventId: "different-event" }), { code: "REVISION_CONFLICT" });
  assert.equal(store.getPublicPlayer(playerId).revision, first.player.revision);
});

test("two database connections re-read and recompute a distinct event after CAS conflict", (t) => {
  const file = filename(t);
  const first = fixture(t, { databasePath: file });
  const secondStore = createIdentityStore({ databasePath: file });
  t.after(() => secondStore.close());
  const secondService = createPlayerProgress({ identityStore: secondStore, questions });
  let interleave = true, writes = 0;
  const store = {
    getPublicPlayer: first.store.getPublicPlayer.bind(first.store),
    getPlayerEvent: first.store.getPlayerEvent.bind(first.store),
    updatePlayerData: first.store.updatePlayerData.bind(first.store),
    commitPlayerEvent(...args) {
      writes++;
      if (interleave) { interleave = false; secondService.applyLearning(first.playerId, feedback("concurrent-second", false)); }
      return first.store.commitPlayerEvent(...args);
    },
  };
  const service = createPlayerProgress({ identityStore: store, questions });
  const saved = service.applyLearning(first.playerId, feedback("concurrent-first"));
  assert.equal(writes, 2);
  assert.equal(saved.player.progress.legacy.mastery[qid].seen, 2);
  assert.equal(saved.player.progress.legacy.mastery[qid].correct, 1);
  assert.equal(secondService.applyLearning(first.playerId, feedback("concurrent-first")).duplicate, true);
});

test("event insert failure rolls back both progress and receipt; retry awards exactly once", (t) => {
  const file = filename(t);
  const { store, service, playerId, player } = fixture(t, { databasePath: file });
  const sql = sqlFor(t, file);
  sql.exec("CREATE TRIGGER fail_event BEFORE INSERT ON player_events BEGIN SELECT RAISE(ABORT, 'SYNTHETIC_DISK_FAILURE'); END");
  assert.throws(() => service.applyLearning(playerId, feedback()), /SYNTHETIC_DISK_FAILURE/);
  assert.deepEqual(store.getPublicPlayer(playerId), player);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM player_events").get().n, 0);
  sql.exec("DROP TRIGGER fail_event");
  const saved = service.applyLearning(playerId, feedback());
  assert.equal(saved.player.progress.legacy.mastery[qid].seen, 1);
  assert.equal(service.applyLearning(playerId, feedback()).duplicate, true);
  const row = sql.prepare("SELECT * FROM player_events").get();
  assert.match(row.fingerprint, /^[a-f0-9]{64}$/);
  for (const secret of ["private-answer", "private-explanation", "private-token"]) assert(!JSON.stringify(row).includes(secret));
});

function oldProgress() {
  let data = model.fresh("synthetic-legacy-player", "UTC");
  data = model.applyLearning(data, feedback()).data;
  data = model.addResult(data, snapshot("legacy-result-01", { mode: "pve", computer: { level: "easy" } })).data;
  data.legacy.nickname = "Synthetic";
  data.legacy.grade = 4;
  data.combatMode = "standard";
  const card = CARDS[0].id;
  data.collection.test = { dust: 50, cards: { [`${card}:leaf`]: 2 } };
  data.collection.earned = { dust: 20, cards: { [`${card}:gold`]: 3 } };
  data.collection.equipped[card] = { mode: "earned", finish: "gold" };
  for (let day = 1; day <= 5; day++)
    data.collection.days[`2026-09-0${day}`] = { qids: questions.slice(0, 6).map((q) => q.id), complete: true };
  data.collection.totalDays = 5;
  return model.validate(data);
}

test("legacy import preserves learning/settings/looks and archives old rewards and scores as unverified", (t) => {
  const { service, playerId } = fixture(t);
  const source = oldProgress(), raw = JSON.stringify(source);
  const saved = service.importLegacy(playerId, raw, "legacy-request-001");
  const data = saved.player.progress, archive = saved.player.profile.legacyImport;
  assert.deepEqual(data.legacy.mastery, source.legacy.mastery);
  assert.equal(data.legacy.nickname, source.legacy.nickname);
  assert.equal(data.legacy.grade, source.legacy.grade);
  assert.equal(data.combatMode, source.combatMode);
  assert.equal(data.profileId, playerId);
  assert.equal(archive.provenance, "unverified-local");
  assert.equal(archive.summary.learningAttempts, 1);
  assert.equal(archive.summary.learningDays, 5);
  assert.equal(archive.learningHistory.receiptCount, 1);
  assert.deepEqual(archive.onlineRecords, source.onlineRecords);
  assert.deepEqual(archive.combatRating, source.combatRating);
  assert.equal(data.combatRating.games, 0);
  assert.equal(data.onlineRecords.length, 0);
  assert.equal(data.collection.totalDays, 0);
  assert.deepEqual(data.collection.days, {});
  assert.deepEqual(data.collection.earned, { dust: 0, cards: {} });
  assert.equal(data.collection.test.cards[`${CARDS[0].id}:gold`], 3);
  assert.deepEqual(data.collection.equipped[CARDS[0].id], { mode: "test", finish: "gold" });
  assert.deepEqual(data.learningReceipts, {});
  assert.equal(data.learningCutoff, null);
  assert.equal(JSON.stringify(source), raw, "the caller's old archive remains unchanged");
  const retry = service.importLegacy(playerId, raw, "legacy-request-001");
  assert.equal(retry.duplicate, true);
  assert.deepEqual(retry.receipt, saved.receipt);
  assert.equal(service.applyLearning(playerId, feedback("fresh-server-learning")).player.progress.legacy.mastery[qid].seen, 2);
});

test("active accounts require review; changed import payloads and invalid schemas cannot replace progress", (t) => {
  const { service, playerId } = fixture(t);
  const current = service.applyLearning(playerId, feedback());
  let conflict;
  try { service.importLegacy(playerId, JSON.stringify(oldProgress()), "legacy-request-001"); }
  catch (error) { conflict = error; }
  assert.equal(conflict.code, "LEGACY_IMPORT_CONFLICT");
  assert.equal(conflict.summary.current.learningAttempts, 1);
  assert.equal(conflict.summary.incoming.learningDays, 5);
  assert.equal(conflict.summary.canReplace, false);
  assert.deepEqual(service.ensure(playerId), current.player);
  const next = fixture(t);
  const original = next.service.importLegacy(next.playerId, JSON.stringify(freshSave()), "legacy-request-001");
  const changed = freshSave(); changed.nickname = "Changed";
  assert.throws(() => next.service.importLegacy(next.playerId, changed, "legacy-request-001"), { code: "PLAYER_EVENT_CONFLICT" });
  assert.throws(() => next.service.importLegacy(next.playerId, { ...freshSave(), schema: 2 }, "legacy-request-002"), { code: "INVALID_IMPORT" });
  assert.throws(() => next.service.importLegacy(next.playerId, "{broken", "legacy-request-002"), { code: "INVALID_IMPORT" });
  assert.deepEqual(next.service.ensure(next.playerId), original.player);
});

test("real v1/v2 schema:1 archives retain old mastery aggregates", (t) => {
  const { service, playerId } = fixture(t);
  const source = freshSave();
  recordLearning(source, { id: qid }, true, when);
  source.archivedMastery["g1-v01"] = { seen: 2, correct: 1, streak: 0, due: when, last: when };
  const imported = service.importLegacy(playerId, JSON.stringify(source), "legacy-schema-one");
  assert.deepEqual(imported.player.progress.legacy.mastery, source.mastery);
  assert.deepEqual(imported.player.progress.legacy.archivedMastery, source.archivedMastery);
  assert.equal(imported.receipt.sourceSchema, 1);
  assert.equal(imported.receipt.summary.learningAttempts, 3);
});

test("legacy confirmation checks the current revision but replays an already committed request first", (t) => {
  const { service, playerId, player } = fixture(t);
  const raw = JSON.stringify(freshSave());
  assert.throws(() => service.importLegacy(playerId, raw, "legacy-confirm-01", {
    expectedRevision: player.revision - 1,
  }), { code: "STALE_REVISION" });
  assert.deepEqual(service.ensure(playerId), player);
  const saved = service.importLegacy(playerId, raw, "legacy-confirm-01", { expectedRevision: player.revision });
  const current = service.preferences(playerId, { grade: 2 }, "later-settings-01");
  const replay = service.importLegacy(playerId, raw, "legacy-confirm-01", { expectedRevision: player.revision });
  assert.equal(replay.duplicate, true);
  assert.deepEqual(replay.receipt, saved.receipt);
  assert.equal(replay.player.revision, current.player.revision);
});

test("schema1 databases migrate once, while failed schema2 migration rolls back", (t) => {
  const file = filename(t);
  let store = createIdentityStore({ databasePath: file });
  const guest = store.createGuest(); store.close();
  const sql = sqlFor(t, file);
  sql.exec("DROP TABLE player_events; DELETE FROM schema_migrations WHERE version = 2");
  sql.exec("CREATE TRIGGER fail_migration BEFORE INSERT ON schema_migrations WHEN NEW.version = 2 BEGIN SELECT RAISE(ABORT, 'SYNTHETIC_MIGRATION_FAILURE'); END");
  assert.throws(() => createIdentityStore({ databasePath: file }), /SYNTHETIC_MIGRATION_FAILURE/);
  assert.equal(sql.prepare("SELECT MAX(version) AS v FROM schema_migrations").get().v, 1);
  assert.equal(sql.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'player_events'").get(), undefined);
  sql.exec("DROP TRIGGER fail_migration");
  store = createIdentityStore({ databasePath: file }); t.after(() => store.close());
  assert.equal(sql.prepare("SELECT MAX(version) AS v FROM schema_migrations").get().v, IDENTITY_SCHEMA_VERSION);
  assert.equal(store.resolveSession(guest.session.token, "guest").player.playerId, guest.player.playerId);
  const again = createIdentityStore({ databasePath: file }); t.after(() => again.close());
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get().n, 2);
});

test("brief authentication reads no profile/progress JSON and still enforces session expiry", (t) => {
  let time = when;
  const { store, guest, playerId } = fixture(t, { now: () => time, guestSessionTtlMs: 1000 });
  const expected = { playerId, kind: "guest", name: guest.player.name, username: null };
  const parse = JSON.parse;
  try {
    JSON.parse = () => { throw Error("Progress JSON was parsed during authentication"); };
    assert.deepEqual(store.resolveSessionBrief(guest.session.token, "guest").player, expected);
    assert.deepEqual(store.resolveIdentityBrief({ guestToken: guest.session.token }).player, expected);
    assert.equal(store.hasPlayerEvent(playerId, "learning:missing-receipt"), false);
    assert.equal(store.resolveSessionBrief(guest.session.token, "account"), null);
    time += 1000;
    assert.equal(store.resolveSessionBrief(guest.session.token, "guest"), null);
  } finally { JSON.parse = parse; }
});

test("profile and progress byte limits differ, and over-limit commits leave no event", (t) => {
  const { store, playerId, player } = fixture(t);
  const large = { synthetic: "x".repeat(1024 * 1024 + 1) };
  const updated = store.updatePlayerData(playerId, { progress: large, expectedRevision: player.revision });
  assert(updated.revision > player.revision);
  const event = { eventId: "over-limit-event", type: "synthetic", payload: {}, expectedRevision: updated.revision,
    profile: { synthetic: "x".repeat(PLAYER_PROFILE_MAX_BYTES) }, progress: player.progress };
  assert.throws(() => store.commitPlayerEvent(playerId, event), { code: "PLAYER_DATA_TOO_LARGE" });
  assert.equal(store.getPlayerEvent(playerId, event), null);
  assert.equal(store.getPublicPlayer(playerId).revision, updated.revision);
});

test("432 questions, 8192 learning receipts, and both 65536 UUID ledgers fit the normalized progress limit", (t) => {
  const { store, playerId, player } = fixture(t);
  const data = model.fresh(playerId, "UTC");
  const uuid = (index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  for (let index = 0; index < PROGRESS_LIMITS.learningEvents; index++) {
    const q = questions[index % questions.length], id = uuid(index);
    data.learningBase[q.id] = null;
    data.learningReceipts[id] = { id, qid: q.id, correct: true, answeredAt: when };
    recordLearning(data.legacy, q, true, when);
  }
  data.resultIds = Array.from({ length: PROGRESS_LIMITS.resultIds }, (_, index) => `${uuid(index)}:0`);
  data.collection.openingIds = Array.from({ length: 65536 }, (_, index) => uuid(index));
  const clean = model.validate(data);
  const bytes = Buffer.byteLength(JSON.stringify(clean));
  assert(bytes > 1024 * 1024);
  assert(bytes < PLAYER_PROGRESS_MAX_BYTES);
  t.diagnostic(`Full normal-ID fixture: ${bytes} normalized UTF-8 bytes; limit ${PLAYER_PROGRESS_MAX_BYTES}`);
  const saved = store.updatePlayerData(playerId, { expectedRevision: player.revision, progress: clean });
  assert.equal(saved.progress.resultIds.length, 65536);
  assert.equal(Object.keys(saved.progress.legacy.mastery).length, 432);
});
