import test from "node:test";
import assert from "node:assert/strict";
import { RemoteProgressStore } from "../src/network/remote-progress.mjs";
import { createProgressModel, PROGRESS_LIMITS } from "../src/network/progress.mjs";
import { freshSave } from "../src/learning.mjs";
import { CARDS } from "../src/cards.mjs";

// Transport-level unit tests with mocked HTTP responses, not browser or live
// backend coverage. Actual authoritative model validation remains in the path.
const questions = [{ id: "pep1-g1-s1-u1-q1", grade: 1, semester: 1, unitId: "g1-s1-u1" }];
const playerId = "player-account-0001";
const otherPlayer = "player-account-0002";
const when = Date.UTC(2026, 9, 8, 12);
const copy = (value) => structuredClone(value);
const response = (payload, status = 200) => ({ ok: status >= 200 && status < 300, status,
  async json() { return copy(payload); } });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function setup(options = {}) {
  const model = createProgressModel({ questions });
  const env = { model, progress: model.fresh(playerId, "UTC"), calls: [], changes: [], issues: [], handler: null };
  env.success = (extra = {}) => response({ data: env.progress, playerId: env.progress.profileId,
    revision: env.progress.revision, serverNow: when, ...extra });
  env.fetcher = async (path, init) => {
    env.calls.push({ path, init, body: init.body ? JSON.parse(init.body) : undefined });
    return env.handler ? env.handler(path, init) : env.success();
  };
  env.store = new RemoteProgressStore({ questions, playerId, fetcher: env.fetcher,
    onChange: (data, meta) => env.changes.push({ data, meta }), onIssue: (issue) => env.issues.push(issue), ...options });
  return env;
}
const feedback = (id = "challenge-0001", correct = true) => ({ challengeId: id,
  learning: { qid: questions[0].id, correct, answeredAt: when } });
const snapshot = () => ({ roomId: "room-result-0001", phase: "finished", youSeat: 0,
  grade: 1, course: "s1-u1", ruleset: "net-1.1", combatRules: "2.1", contentVersion: "pep1-2026.1",
  mode: "pvp", assisted: false, serverTime: when, result: { winnerSeat: 0, reason: "health",
    ownScore: 740, ownLearning: { attempts: 1, correct: 1 }, rounds: 4, finishedAt: when } });
function openOnServer(env, id = "opening-server-0001", mode = "test") {
  env.progress = env.model.collection(env.progress, { kind: "open-pack", id, mode, createdAt: when,
    cards: Array.from({ length: 10 }, () => ({ cardId: CARDS[0].id, finish: "leaf" })) }).data;
}

test("loads only a canonical cookie-authenticated account snapshot and never touches localStorage", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  let storageReads = 0;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { storageReads++; throw Error("no storage"); } });
  try {
    const env = setup();
    assert.equal(env.store.data, null);
    assert.equal(env.store.loaded, false);
    assert.equal(env.store.readPending, true);
    const result = await env.store.load();
    assert.equal(result.ok, true);
    assert.deepEqual(result.data, env.progress);
    assert.equal(env.store.loaded, true);
    assert.equal(env.store.readPending, false);
    assert.equal(env.store.singlePage, false);
    assert.equal(env.store.dirty, false);
    assert.equal(storageReads, 0);
    assert.equal(env.calls[0].path, "/api/progress");
    assert.equal(env.calls[0].init.method, "GET");
    assert.equal(env.calls[0].init.credentials, "same-origin");
    assert.equal(env.calls[0].init.redirect, "error");
    assert.equal(env.calls[0].init.cache, "no-store");
    assert.equal(env.calls[0].init.headers["X-Spellwood-Player"], playerId);
    assert.equal(Object.hasOwn(env.calls[0].init, "body"), false);
    result.data.legacy.nickname = "tampered";
    assert.notEqual(env.store.data.legacy.nickname, "tampered");
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else delete globalThis.localStorage;
  }
});

test("malformed, unknown and identity-mismatched success envelopes preserve the verified memory copy", async () => {
  const env = setup(); await env.store.load();
  const before = env.store.export();
  const envelope = () => ({ data: copy(env.progress), playerId, revision: env.progress.revision, serverNow: when });
  const cases = [
    () => ({}),
    () => ({ ...envelope(), sessionToken: "do-not-accept" }),
    () => ({ ...envelope(), revision: 300 }),
    () => { const value = envelope(); delete value.data.collection; return value; },
    () => { const value = envelope(); value.data.unknownWallet = { coins: 99999 }; return value; },
    () => { const value = envelope(); value.data.legacy.mastery[questions[0].id] = { seen: -1 }; return value; },
    () => { const value = envelope(); value.data.collection.test.dust = -1; return value; },
    () => ({ ...envelope(), changed: "yes" }),
    () => ({ ...envelope(), receipt: [] }),
  ];
  for (const make of cases) {
    env.handler = () => response(make());
    assert.equal((await env.store.refresh()).code, "INVALID_RESPONSE");
    assert.equal(env.store.export(), before);
    assert.equal(env.store.loaded, true);
  }
  env.handler = () => response({ data: env.model.fresh(otherPlayer, "UTC"), playerId: otherPlayer, revision: 0, serverNow: when });
  assert.equal((await env.store.refresh()).code, "PROFILE_CHANGED");
  assert.equal(env.store.playerId, playerId);
  assert.equal(env.store.export(), before);
});

test("canonical comparison ignores property order but rejects a different snapshot at the same revision", async () => {
  const env = setup(); await env.store.load();
  env.progress = Object.fromEntries(Object.entries(env.progress).reverse());
  assert.equal((await env.store.refresh()).ok, true);
  env.progress.legacy.nickname = "different-at-same-revision";
  assert.equal((await env.store.refresh()).code, "INVALID_RESPONSE");
  assert.notEqual(env.store.data.legacy.nickname, "different-at-same-revision");
});

test("learning and result receipts use GET only; caller correctness, score, hands and tokens never leave memory", async () => {
  const env = setup(); await env.store.load();
  env.progress = env.model.applyLearning(env.progress, feedback()).data;
  env.handler = () => env.success({ receipt: { recorded: true } });
  const learned = await env.store.applyLearning({ ...feedback(undefined, false), sessionToken: "private",
    correctOptionId: "secret", balance: 900000 });
  assert.equal(learned.ok, true);
  assert.equal(learned.data.legacy.mastery[questions[0].id].correct, 1);
  const official = snapshot(); env.progress = env.model.addResult(env.progress, official).data;
  const result = await env.store.addResult({ ...official, result: { ownScore: 9999999 }, self: { hand: ["secret"] } });
  assert.equal(result.ok, true);
  assert.equal(result.data.onlineRecords[0].score, 740);
  assert.equal(env.calls.length, 3);
  assert.equal(new URL(env.calls[1].path, "https://example.test").searchParams.get("receipt"), "learn:challenge-0001");
  assert.equal(new URL(env.calls[2].path, "https://example.test").searchParams.get("receipt"), "result:room-result-0001:0");
  assert.ok(env.calls.every(({ init }) => init.method === "GET" && !Object.hasOwn(init, "body")));
});

test("an unrecorded or malformed receipt stays pending until a later GET confirms it", async () => {
  const env = setup(); await env.store.load();
  env.handler = () => env.success({ receipt: { recorded: false } });
  assert.equal((await env.store.applyLearning(feedback())).code, "RECEIPT_PENDING");
  assert.equal(env.store.dirty, true);
  assert.equal(env.store.data.legacy.mastery[questions[0].id], undefined);
  env.handler = () => env.success({ receipt: { recorded: "true" } });
  assert.equal((await env.store.retry()).code, "INVALID_RESPONSE");
  assert.equal(env.store.dirty, true);
  env.progress = env.model.applyLearning(env.progress, feedback()).data;
  env.handler = (path) => env.success(path.includes("receipt=") ? { receipt: { recorded: true } } : {});
  assert.equal((await env.store.retry()).ok, true);
  assert.equal(env.store.dirty, false);
  assert.equal(env.store.issue, null);
  assert.equal(env.store.data.legacy.mastery[questions[0].id].seen, 1);
});

test("preferences, participation and collections send only whitelisted intents", async () => {
  const env = setup(); await env.store.load();
  env.handler = () => env.success({ changed: false });
  assert.equal((await env.store.updatePreferences({ sound: false, grade: 2 })).ok, true);
  assert.equal((await env.store.qualifyLearning("challenge-0001", { questionMs: Infinity, feedbackMs: 999999, now: 99 })).ok, true);
  assert.equal((await env.store.openPack("test")).ok, true);
  assert.deepEqual(env.calls[1].body.patch, { sound: false, grade: 2 });
  assert.deepEqual(Object.keys(env.calls[2].body).sort(), ["challengeId", "requestId"]);
  assert.deepEqual(env.calls[3].body.action, { kind: "open-pack", mode: "test" });
  for (const call of env.calls.slice(1)) {
    assert.match(call.body.requestId, /^[A-Za-z0-9_-]{8,128}$/);
    assert.equal(call.init.method, "POST");
    assert.equal(call.init.credentials, "same-origin");
    assert.equal(call.init.headers["Content-Type"], "application/json");
    assert.equal(call.init.headers["X-Spellwood-Player"], playerId);
  }
  const count = env.calls.length;
  assert.equal((await env.store.updatePreferences({ coins: 999 })).code, "INVALID_PREFERENCES");
  for (const action of [
    { kind: "open-pack", mode: "test", cards: [] },
    { kind: "open-pack", mode: "test", id: "chosen-opening" },
    { kind: "set-wallet", dust: 500 },
    { kind: "reveal-pack", id: "opening-0001", index: 10 },
    { kind: "close-pack", id: "opening-0001", earnedPacksSpent: 0 },
    { kind: "redeem-finish", mode: "test", cardId: CARDS[0].id, finish: "not-a-finish" },
  ]) assert.equal((await env.store.collectionAction(action)).code, "INVALID_COLLECTION_ACTION");
  assert.equal(env.calls.length, count);
});

test("overlapping identical opening clicks share one promise and one server-generated pack", async () => {
  const env = setup(); await env.store.load();
  const waiting = deferred(), started = deferred();
  env.handler = async () => { openOnServer(env); started.resolve(); await waiting.promise; return env.success({ changed: true }); };
  const first = env.store.openPack("test"), second = env.store.openPack("test");
  assert.equal(first, second);
  await started.promise;
  assert.equal(env.calls.filter((call) => call.init.method === "POST").length, 1);
  assert.equal(env.store.dirty, true);
  waiting.resolve();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.ok, true); assert.equal(b.ok, true);
  assert.equal(a.data.collection.opening.id, "opening-server-0001");
  assert.equal(a.data.collection.openingIds.length, 1);
  assert.equal(env.store.dirty, false);
});

test("a timed-out opening stays unknown; GET can discover it and retry reuses its requestId without rerolling", async () => {
  const env = setup({ timeoutMs: 20 }); await env.store.load();
  const receipts = new Map(); let created = 0;
  env.handler = (path, init) => {
    if (init.method === "GET") return env.success();
    const body = JSON.parse(init.body);
    if (receipts.has(body.requestId)) return response(receipts.get(body.requestId));
    openOnServer(env); created++;
    receipts.set(body.requestId, { data: copy(env.progress), playerId, revision: env.progress.revision, changed: true, serverNow: when });
    return new Promise(() => {});
  };
  const unknown = await env.store.openPack("test");
  assert.equal(unknown.code, "TIMEOUT"); assert.equal(unknown.uncertain, true);
  assert.equal(env.store.dirty, true);
  assert.equal(env.store.data.collection.opening, null);
  const blocked = await env.store.updatePreferences({ sound: false });
  assert.equal(blocked.code, "PROGRESS_UNSYNCED");
  const read = await env.store.refresh();
  assert.equal(read.ok, true);
  assert.equal(env.store.data.collection.opening.id, "opening-server-0001");
  assert.equal(env.store.dirty, true);
  assert.equal(env.store.issue.code, "TIMEOUT");
  assert.equal((await env.store.exportLatest()).code, "PROGRESS_UNSYNCED");
  const retried = await env.store.retry();
  assert.equal(retried.ok, true);
  assert.equal(env.store.dirty, false);
  assert.equal(env.store.issue, null);
  const posts = env.calls.filter((call) => call.init.method === "POST");
  assert.equal(posts.length, 2);
  assert.deepEqual(posts[0].body, posts[1].body);
  assert.equal(created, 1);
  assert.equal(env.store.data.collection.test.cards[`${CARDS[0].id}:leaf`], 10);
});

test("distinct collection mutations are serialized and exact repeated actions are single-flight", async () => {
  const env = setup(); openOnServer(env); await env.store.load();
  const waiting = deferred(), started = deferred(); let active = 0, maxActive = 0;
  env.handler = async (_path, init) => {
    active++; maxActive = Math.max(maxActive, active);
    const action = JSON.parse(init.body).action;
    if (action.kind === "reveal-pack") { started.resolve(); await waiting.promise; }
    env.progress = env.model.collection(env.progress, action).data;
    active--; return env.success({ changed: true });
  };
  const reveal = { kind: "reveal-pack", id: "opening-server-0001", index: "all" };
  const a = env.store.collectionAction(reveal), b = env.store.collectionAction(reveal);
  const close = env.store.collectionAction({ kind: "close-pack", id: "opening-server-0001" });
  assert.equal(a, b); await started.promise;
  assert.equal(env.calls.filter((call) => call.init.method === "POST").length, 1);
  waiting.resolve(); await Promise.all([a, b, close]);
  assert.equal(maxActive, 1);
  assert.equal(env.calls.filter((call) => call.init.method === "POST").length, 2);
  assert.equal(env.store.data.collection.opening, null);
  assert.equal(env.store.data.collection.recent.length, 1);
});

test("retry and an overlapping original-action click confirm one unknown operation without creating a fresh id", async () => {
  const env = setup(); await env.store.load(); let first = true;
  env.handler = (_path, init) => {
    if (init.method === "GET") return env.success();
    if (first) { first = false; openOnServer(env); throw Error("response connection lost"); }
    return env.success({ changed: true });
  };
  assert.equal((await env.store.openPack()).uncertain, true);
  const retried = env.store.retry(), repeated = env.store.openPack();
  assert.equal((await retried).ok, true);
  assert.equal((await repeated).ok, true);
  const posts = env.calls.filter((call) => call.init.method === "POST");
  assert.equal(posts.length, 2);
  assert.equal(posts[0].body.requestId, posts[1].body.requestId);
});

test("service failures and unknown error shapes never clear progress or declare an uncertain mutation cancelled", async () => {
  const env = setup(); await env.store.load(); const before = env.store.export();
  env.handler = () => response({ code: "SERVER_ERROR", data: {} }, 503);
  assert.equal((await env.store.refresh()).code, "SERVER_ERROR");
  assert.equal(env.store.export(), before);
  assert.equal(env.store.loaded, true);
  env.handler = () => env.success(); await env.store.retry();
  env.handler = () => response({ code: "UNRECOGNIZED_SUCCESS", message: "throw away your archive" }, 400);
  const unknown = await env.store.openPack();
  assert.equal(unknown.code, "INVALID_RESPONSE");
  assert.equal(unknown.uncertain, true);
  assert.equal(env.store.dirty, true);
  assert.equal(env.store.export(), before);
  assert.ok(!env.store.issue.message.includes("throw away"));
  const id = env.calls.at(-1).body.requestId;
  env.handler = () => response({ code: "TEST_PACKS_DISABLED" }, 403);
  const rejected = await env.store.retry();
  assert.equal(rejected.code, "TEST_PACKS_DISABLED");
  assert.equal(rejected.uncertain, false);
  assert.equal(env.calls.at(-1).body.requestId, id);
  assert.equal(env.store.dirty, false);
  assert.equal(env.store.export(), before);
});

test("account switch discards queued old work and late replies even when mocked fetch ignores AbortSignal", async () => {
  const env = setup(); await env.store.load();
  const delayed = deferred(), started = deferred();
  env.handler = () => { started.resolve(); return delayed.promise; };
  const oldRead = env.store.refresh(); await started.promise;
  const queuedOld = env.store.updatePreferences({ sound: false });
  env.store.setPlayerId(otherPlayer);
  assert.equal(env.store.data, null);
  env.progress = env.model.fresh(otherPlayer, "UTC");
  env.handler = () => env.success();
  assert.equal((await env.store.load()).ok, true);
  const changes = env.changes.length;
  delayed.resolve(response({ data: env.model.fresh(playerId, "UTC"), playerId, revision: 0, serverNow: when }));
  assert.equal((await oldRead).stale, true);
  assert.equal((await queuedOld).stale, true);
  assert.equal(env.store.data.profileId, otherPlayer);
  assert.equal(env.changes.length, changes);
  assert.equal(env.calls.filter((call) => call.init.method === "POST").length, 0);
});

test("dispose suppresses late callbacks, resolves pending callers as stale and preserves rescue export", async () => {
  const env = setup(); await env.store.load(); const before = env.store.export();
  const delayed = deferred(), started = deferred();
  env.handler = () => { started.resolve(); return delayed.promise; };
  const pending = env.store.openPack(); await started.promise;
  const changes = env.changes.length;
  env.store.dispose();
  assert.equal((await pending).stale, true);
  delayed.resolve(env.success());
  await Promise.resolve();
  assert.equal(env.changes.length, changes);
  assert.equal(env.store.export(), before);
  assert.equal((await env.store.retry()).stale, true);
  assert.equal(env.store.dirty, true);
});

test("latest exports read and validate server data while rescue exports retain the last verified copy offline", async () => {
  const env = setup(); await env.store.load();
  env.progress = env.model.preferences(env.progress, { grade: 2 }).data;
  const exported = await env.store.exportLatest();
  assert.equal(exported.ok, true);
  assert.equal(exported.scope, "latest-durable");
  assert.equal(JSON.parse(exported.json).legacy.grade, 2);
  const legacy = await env.store.exportLegacyLatest();
  assert.equal(JSON.parse(legacy.json).schema, 1);
  assert.equal(JSON.parse(legacy.json).grade, 2);
  const rescue = env.store.export();
  env.handler = () => { throw Error("offline"); };
  const unavailable = await env.store.exportLatest();
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.json, undefined);
  assert.equal(env.store.export(), rescue);
  assert.equal(JSON.parse(env.store.exportLegacy()).grade, 2);
  assert.ok(env.calls.every((call) => call.init.method === "GET"));
});

test("backup preparation validates locally, uploads nothing, and only its bound confirmation can import", async () => {
  const env = setup(); await env.store.load(); const before = env.store.export();
  let source = env.model.applyLearning(env.model.fresh("local-backup-0001", "UTC"), feedback()).data;
  source = env.model.addResult(source, snapshot()).data;
  const raw = JSON.stringify(source), count = env.calls.length;
  for (const invalid of ["{bad", JSON.stringify({ schema: 2 }), JSON.stringify({ schema: 3 }),
    JSON.stringify({ ...source, collection: { ...source.collection, earnedPacksSpent: 100 } })])
    assert.throws(() => env.store.prepareImport(invalid));
  assert.throws(() => env.store.prepareImport(" ".repeat(PROGRESS_LIMITS.importCharacters + 1)), { code: "IMPORT_TOO_LARGE" });
  const prepared = env.store.prepareImport(raw);
  assert.equal(Object.isFrozen(prepared), true);
  assert.equal(prepared.preview.onlineRecords, 0);
  assert.equal(prepared.sourceSummary.onlineRecords, 1);
  assert.equal(prepared.preview.learningDays, 0);
  assert.equal(prepared.dropsOnlineReceipts, true);
  assert.equal(prepared.resetsEarnedRewards, true);
  assert.equal(env.calls.length, count);
  assert.equal((await env.store.restore({ ...prepared }, prepared.revision)).code, "INVALID_RESTORE_CONFIRMATION");
  assert.equal((await env.store.restore(prepared, prepared.revision + 1)).code, "INVALID_RESTORE_CONFIRMATION");
  assert.equal(env.calls.length, count);
  env.handler = (_path, init) => {
    const body = JSON.parse(init.body);
    assert.deepEqual(Object.keys(body).sort(), ["expectedRevision", "raw", "requestId"]);
    assert.equal(body.raw, raw);
    assert.equal(body.expectedRevision, prepared.revision);
    env.progress = env.model.fresh(playerId, "UTC");
    env.progress.legacy = copy(source.legacy); env.progress.revision = 1;
    return env.success({ changed: true });
  };
  const restored = await env.store.restore(prepared, prepared.revision);
  assert.equal(restored.ok, true);
  assert.equal(restored.requiresSessionReset, true);
  assert.equal(env.store.recoveryRaw, before);
  assert.equal(env.store.data.onlineRecords.length, 0);
  assert.equal(env.store.data.legacy.mastery[questions[0].id].seen, 1);
  assert.equal(env.changes.at(-1).meta.restored, true);
  assert.equal((await env.store.restore(prepared, prepared.revision)).code, "INVALID_RESTORE_CONFIRMATION");
});

test("legacy schema 1 preview is supported and failed import conflict preserves current data and safe summary", async () => {
  const env = setup(); await env.store.load(); const before = env.store.export();
  const prepared = env.store.prepareImport(JSON.stringify(freshSave()));
  assert.equal(prepared.sourceSchema, 1);
  env.handler = () => response({ code: "LEGACY_IMPORT_CONFLICT", summary: {
    current: { learningAttempts: 2, password: "never-expose" }, incoming: { learningAttempts: 0 },
    currentRevision: 4, canReplace: false, recoveryCode: "never-expose",
  } }, 409);
  const result = await env.store.restore(prepared, prepared.revision);
  assert.equal(result.code, "LEGACY_IMPORT_CONFLICT");
  assert.deepEqual(result.summary, { current: { learningAttempts: 2 }, incoming: { learningAttempts: 0 },
    currentRevision: 4, canReplace: false });
  assert.equal(env.store.export(), before);
  assert.equal(env.store.recoveryRaw, "");
});

test("unknown import retries its original raw request and emits a session reset when confirmed through retry", async () => {
  const env = setup({ timeoutMs: 20 }); await env.store.load();
  const prepared = env.store.prepareImport(JSON.stringify(freshSave())), rawCalls = [];
  let first = true;
  env.handler = (_path, init) => {
    if (init.method === "GET") return env.success();
    rawCalls.push(JSON.parse(init.body));
    if (first) { first = false; env.progress.revision++; return new Promise(() => {}); }
    return env.success({ changed: true });
  };
  assert.equal((await env.store.restore(prepared, prepared.revision)).code, "TIMEOUT");
  await env.store.refresh();
  assert.equal(env.store.revision, 1);
  const retried = await env.store.retry();
  assert.equal(retried.ok, true);
  assert.equal(retried.requiresSessionReset, true);
  assert.deepEqual(rawCalls[0], rawCalls[1]);
  assert.equal(env.changes.filter(({ meta }) => meta.restored).length, 1);
});

test("server display time is mandatory and malformed clocks preserve the previous account and clock anchor", async () => {
  let monotonic = 100;
  const env = setup({ monotonicNow: () => monotonic });
  assert.equal(env.store.serverNow, null); assert.equal(env.store.rewardNow(), null);
  await env.store.load(); const before = env.store.export();
  for (const serverNow of [undefined, null, '1791432000000', -1, 1.5, Infinity, 4102444800001]) {
    env.handler = () => env.success({ serverNow });
    monotonic += 10;
    assert.equal((await env.store.refresh()).code, 'INVALID_RESPONSE');
    assert.equal(env.store.serverNow, when); assert.equal(env.store.rewardNow(), when + monotonic - 100);
    assert.equal(env.store.export(), before);
  }
  env.handler = () => env.success(); monotonic = NaN;
  assert.equal((await env.store.refresh()).code, 'INVALID_RESPONSE');
  assert.equal(env.store.serverNow, when); assert.equal(env.store.export(), before);
});

test("reward display follows server noon and Shanghai midnight using monotonic time even when local wall time changes", async t => {
  let monotonic = 500, serverNow = Date.UTC(2026, 9, 8, 4), localNow = Date.UTC(2036, 0, 1);
  t.mock.method(Date, 'now', () => localNow);
  const env = setup({ monotonicNow: () => monotonic }); env.handler = () => env.success({ serverNow });
  await env.store.load(); assert.equal(env.store.serverNow, serverNow); assert.equal(env.store.rewardNow(), serverNow);
  monotonic += 5000.9; localNow -= 365 * 86400000;
  assert.equal(env.store.rewardNow(), serverNow + 5000);
  serverNow = Date.UTC(2026, 9, 8, 15, 59, 59); await env.store.refresh();
  const { dailySummary } = await import('../src/reward-journey.mjs');
  assert.equal(dailySummary(env.store.data.journey, env.store.rewardNow()).rewardDay, '2026-10-08');
  monotonic += 1000; localNow += 20 * 365 * 86400000;
  assert.equal(dailySummary(env.store.data.journey, env.store.rewardNow()).rewardDay, '2026-10-09');
  const displayed = env.store.rewardNow(); monotonic -= 800;
  assert.equal(env.store.rewardNow(), displayed);
  assert.equal(env.store.serverNow, serverNow);
  assert.equal(Object.hasOwn(env.store.data, 'serverNow'), false);
  assert.equal(env.store.export().includes('serverNow'), false);
  assert.equal(env.calls.some(call => call.body && JSON.stringify(call.body).includes('serverNow')), false);
  env.store.setPlayerId(otherPlayer); assert.equal(env.store.serverNow, null); assert.equal(env.store.rewardNow(), null);
  env.progress = env.model.fresh(otherPlayer, 'UTC'); monotonic += 1000; await env.store.load();
  assert.equal(env.store.rewardNow(), serverNow); env.store.dispose(); assert.equal(env.store.rewardNow(), null);
});

test("display clock values never travel back in participation or preference intents", async () => {
  const env = setup({ monotonicNow: () => 100 }); await env.store.load();
  await env.store.qualifyLearning('clock-client-forgery', { serverNow: when + 86400000, questionMs: 999999, feedbackMs: 999999 });
  const request = env.calls.find(call => call.path === '/api/progress/participation');
  assert.deepEqual(Object.keys(request.body).sort(), ['challengeId', 'requestId']);
  assert.equal((await env.store.updatePreferences({ serverNow: when })).code, 'INVALID_PREFERENCES');
  assert.equal(env.store.data.serverNow, undefined);
});
