import test from "node:test";
import assert from "node:assert/strict";
import { StudyDesk } from "../src/network/study-desk.mjs";
import { ProgressStore, createProgressModel } from "../src/network/progress.mjs";
import { RemoteProgressStore } from "../src/network/remote-progress.mjs";

// Mocked transport exercises the real account store and its restored metadata.
// Network regression tests separately retain the original local HTTP flow.
const questions = Array.from({ length: 432 }, (_, i) => ({ id: `question-${String(i).padStart(4, "0")}`, grade: 1, semester: 1, unitId: "g1-s1-u1" }));
const metadata = { questions };
const copy = value => structuredClone(value);
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => copy(data) });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const memory = () => { const values = new Map(); return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)) }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) { for (let i = 0; i < 100; i++) { if (predicate()) return; await tick(); } throw Error("Operation did not start"); }
const feedback = (id = "challenge-before-import") => ({ challengeId: id, learning: { qid: questions[0].id, correct: true, answeredAt: Date.now() } });

async function remoteFixture(t, callbacks = {}) {
  const model = createProgressModel({ questions });
  const env = { model, progress: model.fresh("player-account-0001", "UTC"), calls: [], changes: [], preferences: [], notices: [], restores: [], handler: null };
  env.success = extra => response({ data: env.progress, playerId: env.progress.profileId, revision: env.progress.revision, ...extra });
  env.fetcher = async (path, init = {}) => {
    env.calls.push({ path, init, body: init.body ? JSON.parse(init.body) : undefined });
    if (path === "/api/curriculum") return response(metadata);
    if (env.handler) { const result = await env.handler(path, init); if (result) return result; }
    if (path.endsWith("/answer")) return response(feedback());
    if (path.startsWith("/api/study/")) return response({ challengeId: "challenge-before-import", question: { options: [{ id: "opaque-option" }] } });
    return env.success(path.includes("?receipt=") ? { receipt: { recorded: true } } : {});
  };
  env.desk = new StudyDesk({
    fetcher: env.fetcher, getPreferences: () => ({ grade: 1, course: "s1-u1" }),
    storeFactory: options => { env.options = options; env.store = new RemoteProgressStore({ ...options, playerId: env.progress.profileId, fetcher: env.fetcher }); return env.store; },
    onChange: () => env.changes.push(true), onPreferences: value => env.preferences.push(value),
    onNotice: value => env.notices.push(value), onRestore: context => env.restores.push(context), ...callbacks,
  });
  t.after(() => env.desk.dispose());
  await env.desk.initialize(); assert.equal(env.desk.canStart, true);
  return env;
}

async function prepare(env) {
  env.desk.view = "data";
  const raw = env.store.exportLegacy();
  await env.desk.importFile({ name: "old-progress.json", size: raw.length, text: async () => raw });
  assert(env.desk.prepared);
  return env.desk.prepared;
}

test("default store and local copy continue to use the original v3 key and wording", async t => {
  const storage = memory();
  const desk = new StudyDesk({ storage, locks: null, fetcher: async () => response(metadata) });
  t.after(() => desk.dispose()); await desk.initialize();
  assert(desk.store instanceof ProgressStore); assert.equal(desk.remote, false);
  assert(storage.values.has("spellwood.save.v3"));
  assert.match(desk.dataHtml(), /不会上传到服务器/);
  desk.view = "records"; assert.match(desk.html(), /本机排行榜/);
});

test("factory receives full metadata and callbacks while account store never accesses the global local archive", async t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage"); let reads = 0;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { reads++; throw Error("local access forbidden"); } });
  try {
    const env = await remoteFixture(t);
    assert.equal(env.options.questions.length, 432);
    assert.equal(typeof env.options.onChange, "function"); assert.equal(typeof env.options.onIssue, "function");
    assert.equal(env.desk.remote, true); assert.equal(reads, 0);
    assert.equal(env.desk.data.profileId, "player-account-0001");
    assert.equal(env.preferences.length, 1, "load callback must not duplicate initial preferences");
    assert.match(env.desk.warning(), /服务器的当前账号/);
  } finally { if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor); else delete globalThis.localStorage; }
});

test("same-player restore metadata resets the old session and reloads preferences exactly once", async t => {
  const env = await remoteFixture(t); await prepare(env);
  const previousProfile = env.desk.data.profileId, previousEpoch = env.desk.profileEpoch, preferencesBefore = env.preferences.length;
  env.desk.pending.set("old-learning", feedback()); env.desk.results.set("old-room:0", { phase: "finished" });
  env.desk.question = { challengeId: "old-question" }; env.desk.answer = {}; env.desk.round = { ids: [] }; env.desk.beginAttention("old-question");
  env.handler = path => { if (path.endsWith("legacy-import")) { env.progress = env.model.preferences(env.progress, { grade: 2 }).data; return env.success(); } };
  await env.desk.click("desk-restore");
  assert.equal(env.desk.data.profileId, previousProfile); assert.equal(env.desk.profileEpoch, previousEpoch + 1);
  assert.deepEqual(env.restores, [{ remote: true }]); assert.equal(env.preferences.length, preferencesBefore + 1);
  assert.equal(env.preferences.at(-1).grade, 2); assert.equal(env.desk.pendingCount, 0);
  assert.equal(env.desk.question, null); assert.equal(env.desk.answer, null); assert.equal(env.desk.round, null); assert.equal(env.desk.attention.entries.size, 0);
  assert.equal(env.desk.prepared, null); assert.notEqual(env.desk.networkEpoch, env.desk.profileEpoch);
  env.desk.receiveFeedback(feedback("obsolete-network-receipt")); assert.equal(env.desk.pendingCount, 0);
  assert.match(env.desk.message, /只留在本次页面内存/);
});

test("uncertain import only resets when retry confirms its original server operation", async t => {
  const env = await remoteFixture(t); await prepare(env); const requests = [];
  env.handler = (path, init) => {
    if (!path.endsWith("legacy-import")) return;
    requests.push(JSON.parse(init.body).requestId);
    if (requests.length === 1) { env.progress = env.model.preferences(env.progress, { grade: 3 }).data; throw Error("reply lost after server commit"); }
    return env.success();
  };
  await env.desk.click("desk-restore");
  assert.equal(env.restores.length, 0); assert(env.desk.prepared); assert.match(env.desk.message, /尚未同步/);
  const preferencesBefore = env.preferences.length;
  env.desk.pending.set("stale-local-receipt", feedback()); env.desk.results.set("old-room:0", { phase: "finished" });
  await env.desk.refresh();
  assert.equal(requests.length, 2); assert.equal(requests[0], requests[1]);
  assert.deepEqual(env.restores, [{ remote: true }]); assert.equal(env.preferences.length, preferencesBefore + 1);
  assert.equal(env.preferences.at(-1).grade, 3); assert.equal(env.desk.pendingCount, 0); assert.equal(env.desk.prepared, null);
  await env.desk.refresh(); assert.equal(env.restores.length, 1, "later ordinary reads are not another restore");
});

test("late study answer from before a same-player import is aborted and never submits its receipt", async t => {
  const env = await remoteFixture(t), answer = deferred(); let answerSignal;
  env.desk.view = "study"; await env.desk.study(questions[0].id);
  env.handler = (path, init) => {
    if (path.endsWith("/answer")) { answerSignal = init.signal; return answer.promise; }
    if (path.endsWith("legacy-import")) { env.progress = env.model.preferences(env.progress, { grade: 4 }).data; return env.success(); }
  };
  const answering = env.desk.answerStudy("opaque-option"); await until(() => !!answerSignal);
  env.desk.close(); await prepare(env); await env.desk.click("desk-restore");
  assert.equal(answerSignal.aborted, true); answer.resolve(response(feedback())); await answering;
  assert.equal(env.desk.answer, null); assert.equal(env.desk.pendingCount, 0);
  assert.equal(env.calls.filter(call => call.path.includes("receipt=learn")).length, 0);
});

test("dispose aborts an unfinished curriculum read and suppresses old initialization callbacks", async t => {
  const held = deferred(); let signal, factories = 0, changes = 0, preferences = 0;
  const old = new StudyDesk({ fetcher: async (_path, options) => { signal = options.signal; return held.promise; }, storeFactory: () => { factories++; throw Error("must not run"); }, onChange: () => changes++, onPreferences: () => preferences++ });
  const loading = old.initialize(); old.dispose(); const changesAfterDispose = changes;
  const current = await remoteFixture(t); current.desk.pending.set("new-account-receipt", feedback());
  held.resolve(response(metadata)); await loading;
  assert.equal(signal.aborted, true); assert.equal(factories, 0); assert.equal(preferences, 0); assert.equal(changes, changesAfterDispose);
  assert.equal(current.desk.pending.size, 1); assert.equal(old.canStart, false);
});

function mockDesk(t) {
  const data = createProgressModel({ questions }).fresh("player-mock-0001", "UTC");
  const events = [], env = { data, events, disposed: 0 };
  const result = extra => ({ ok: true, data: copy(data), ...extra });
  const store = env.store = { remote: true, dirty: false, issue: null, recoveryRaw: "", load: async () => result(), retry: async () => result(), applyLearning: async () => result(), addResult: async () => result(), updatePreferences: async () => result(), qualifyLearning: async () => result(), exportLatest: async () => ({ ...result(), json: JSON.stringify(data) }), dispose: () => env.disposed++ };
  env.desk = new StudyDesk({ fetcher: async () => response(metadata), storeFactory: options => { env.options = options; return store; }, onChange: () => events.push("change"), onNotice: () => events.push("notice"), onPreferences: () => events.push("preferences"), onRestore: () => events.push("restore") });
  t.after(() => env.desk.dispose()); return env;
}

test("disposed flush, preference, refresh, export, attention and store callbacks cannot affect a new desk", async t => {
  const env = mockDesk(t); await env.desk.initialize();
  const receipt = deferred(), preferences = deferred(), refresh = deferred(), exported = deferred(), attention = deferred();
  env.store.applyLearning = () => receipt.promise; env.store.updatePreferences = () => preferences.promise;
  env.store.retry = () => refresh.promise; env.store.exportLatest = () => exported.promise; env.store.qualifyLearning = () => attention.promise;
  let downloads = 0; env.desk.download = () => downloads++;
  const downloading = env.desk.click("desk-export"); await tick();
  env.desk.beginAttention("attention-old"); env.desk.attention.feedback("attention-old");
  const qualifying = env.desk.finishAttention("attention-old"); await tick();
  env.desk.pending.set("old-receipt", feedback()); const flushing = env.desk.flush();
  const saving = env.desk.preferences({ grade: 2 }), reading = env.desk.refresh();
  env.desk.dispose(); const count = env.events.length;
  const next = await remoteFixture(t); next.desk.pending.set("new-receipt", feedback("new-receipt"));
  env.options.onChange({ ...env.data, profileId: "player-late-0001" }, { restored: true, requiresSessionReset: true });
  env.options.onIssue({ code: "READ_FAILED", message: "late issue" });
  receipt.resolve({ ok: true, ignored: true, data: env.data }); preferences.resolve({ ok: false, issue: { message: "late failure" } });
  refresh.resolve({ ok: true, data: env.data, restored: true, requiresSessionReset: true });
  exported.resolve({ ok: true, json: "{}" }); attention.resolve({ ok: true, data: { ...env.data, collection: { totalDays: 5 } } });
  await Promise.all([downloading, qualifying, flushing, saving, reading]);
  assert.equal(env.disposed, 1); assert.equal(env.events.length, count); assert.equal(downloads, 0);
  assert.equal(next.desk.pending.size, 1); assert.equal(next.restores.length, 0);
  env.desk.receiveFeedback(feedback()); env.desk.receiveResult({ phase: "finished", roomId: "old-room", youSeat: 0 });
  assert.equal(env.desk.pendingCount, 0);
});

test("an old flush finishing after a restore cannot clear the new session queue or its busy state", async t => {
  const env = mockDesk(t); await env.desk.initialize(); const old = deferred(), fresh = deferred();
  env.store.applyLearning = event => event.challengeId === "old-id" ? old.promise : fresh.promise;
  env.desk.pending.set("old-id", feedback("old-id")); const oldFlush = env.desk.flush();
  env.options.onChange(env.data, { restored: true, requiresSessionReset: true }); env.desk.sessionReady({});
  env.desk.pending.set("new-id", feedback("new-id")); const newFlush = env.desk.flush();
  const changes = env.events.length; old.resolve({ ok: true, ignored: true }); await oldFlush;
  assert.equal(env.desk.pending.size, 1); assert.equal(env.desk.flushing, true); assert.equal(env.events.length, changes);
  fresh.resolve({ ok: true }); await newFlush; assert.equal(env.desk.pendingCount, 0); assert.equal(env.desk.flushing, false);
});

test("remote import preview distinguishes source history, official initial values and protected active progress", async t => {
  const env = await remoteFixture(t); await prepare(env);
  env.desk.prepared = { ...env.desk.prepared, sourceSummary: { onlineRecords: 12, learningDays: 24, combatRating: 1060 } };
  const html = env.desk.dataHtml();
  assert.match(html, /12局对局成绩.*24个历史学习日.*1060/);
  assert.match(html, /0局正式新成绩.*0个正式学习日.*700/);
  assert.match(html, /学习记录、设置和旧卡外观发送到服务器的当前账号/);
  assert.match(html, /旧钱包仅作未认证展示/); assert.match(html, /正式奖励和PVP成绩不从文件恢复/);
  assert.match(html, /服务器会拒绝导入，不会覆盖/); assert.match(html, /原本机存档和原备份文件不变/);
  assert.match(html, /只保留在本次页面内存.*刷新或离开后不会保留/);
  assert.doesNotMatch(html, /不会上传到服务器|仅保存在这台浏览器|会保留当前档案的恢复副本/);
  env.desk.view = "records"; assert.match(env.desk.html(), /我的账号成绩/); assert.match(env.desk.html(), /不是全服排行榜/);
  assert.doesNotMatch(env.desk.html(), /只显示这个浏览器|本机排行榜/);
});

test("remote conflict and unavailable export retain the data and show server issues without success wording", async t => {
  const env = await remoteFixture(t); await prepare(env); const before = env.store.export(); let downloads = 0;
  env.desk.download = () => downloads++;
  env.handler = path => path.endsWith("legacy-import") ? response({ code: "LEGACY_IMPORT_CONFLICT" }, 409) : undefined;
  await env.desk.click("desk-restore");
  assert.equal(env.store.export(), before); assert.equal(env.restores.length, 0); assert(env.desk.prepared);
  assert.match(env.desk.message, /账号已有记录，无法导入覆盖/); assert.doesNotMatch(env.desk.message, /备份已/);
  env.handler = () => response({ code: "SESSION_REQUIRED" }, 401);
  await env.desk.click("desk-export"); assert.equal(downloads, 0); assert.match(env.desk.message, /登录身份已过期/);
  assert.doesNotMatch(env.desk.message, /本机|已生成/); assert.equal(env.store.export(), before);
  await env.desk.click("desk-rescue"); assert.equal(downloads, 1); assert.match(env.desk.message, /服务器最新记录或尚未确认的操作/);
});

test("refresh does not report sync success when a queued receipt still failed", async t => {
  const env = mockDesk(t); await env.desk.initialize();
  env.store.applyLearning = async () => ({ ok: false, code: "RECEIPT_PENDING", issue: { code: "RECEIPT_PENDING", message: "服务器还没有确认这条学习记录" } });
  env.desk.pending.set("pending-receipt", feedback()); await env.desk.refresh();
  assert.equal(env.desk.pendingCount, 1); assert.match(env.desk.message, /服务器还没有确认/); assert.doesNotMatch(env.desk.message, /已同步/);
});

test("async import preparation cannot return into a disposed desk", async t => {
  const env = await remoteFixture(t), prepared = deferred(); env.desk.view = "data";
  env.store.prepareImport = () => prepared.promise;
  const importing = env.desk.importFile({ name: "old.json", size: 2, text: async () => "{}" }); await tick();
  env.desk.dispose(); const count = env.changes.length; prepared.resolve({ preview: { grade: 1 } }); await importing;
  assert.equal(env.desk.prepared, null); assert.equal(env.changes.length, count);
});

test("disposed restore cannot fire callbacks or erase the new account's pending work", async t => {
  const env = mockDesk(t); await env.desk.initialize(); const held = deferred(); let started = false;
  env.store.restore = () => { started = true; return held.promise; };
  env.desk.prepared = { revision: 0 }; const restoring = env.desk.click("desk-restore"); await until(() => started);
  env.desk.dispose(); const count = env.events.length;
  const next = await remoteFixture(t); next.desk.pending.set("new-account-work", feedback());
  held.resolve({ ok: true, data: env.data, requiresSessionReset: true, restored: true }); await restoring;
  assert.equal(env.events.length, count); assert.equal(next.desk.pendingCount, 1); assert.equal(next.restores.length, 0);
});

test("account identity errors while loading a question explain the real blocker", async t => {
  const env = await remoteFixture(t); env.desk.view = "study";
  env.handler = () => response({ code: "IDENTITY_REQUIRED" }, 401);
  await env.desk.study(questions[0].id);
  assert.equal(env.desk.question, null); assert.match(env.desk.message, /确认当前身份/);
});

test("a late export after navigation cannot download or clear a later request's busy state", async t => {
  const env = mockDesk(t); await env.desk.initialize(); const held = deferred(); let started = false;
  env.store.exportLatest = () => { started = true; return held.promise; }; let downloads = 0; env.desk.download = () => downloads++;
  env.desk.view = "data"; const exporting = env.desk.click("desk-export"); await until(() => started);
  env.desk.close(); env.desk.view = "study"; env.desk.busy = true;
  held.resolve({ ok: true, json: "{}" }); await exporting;
  assert.equal(downloads, 0); assert.equal(env.desk.busy, true);
});
