import test from "node:test";
import assert from "node:assert/strict";
import {
  ProgressStore,
  PROGRESS_KEY,
  PROGRESS_LOCK,
  PROGRESS_LIMITS,
} from "../src/network/progress.mjs";
import { freshSave, validateSave, recordLearning } from "../src/learning.mjs";
import { createMatch } from "../src/engine.mjs";

const questions = [
  { id: "pep1-g1-s1-u1-q1", grade: 1, semester: 1, unitId: "g1-s1-u1" },
  { id: "pep1-g6-s1-u4-q6", grade: 6, semester: 1, unitId: "g6-s1-u4" },
];
const qid = questions[0].id;
const when = Date.UTC(2026, 9, 1, 12);
function storage(initial = {}) {
  const values = new Map(Object.entries(initial)),
    reads = [],
    writes = [];
  return {
    values,
    reads,
    writes,
    readFailure: null,
    writeFailure: null,
    getItem(k) {
      reads.push(k);
      if (this.readFailure?.(k)) throw Error("read denied");
      return values.get(k) ?? null;
    },
    setItem(k, v) {
      if (this.writeFailure?.(k, v)) throw Error("quota");
      values.set(k, String(v));
      writes.push([k, String(v)]);
    },
    removeItem(k) {
      values.delete(k);
    },
  };
}
function locks() {
  let tail = Promise.resolve();
  const requests = [];
  return {
    requests,
    request(name, options, callback) {
      requests.push({ name, options });
      const next = tail.then(() => callback({ name, mode: "exclusive" }));
      tail = next.catch(() => {});
      return next;
    },
  };
}
function store(db, mutex = locks(), extra = {}) {
  return new ProgressStore({ storage: db, locks: mutex, questions, ...extra });
}
function feedback(id, correct = true, answeredAt = when) {
  return {
    type: "private.feedback",
    challengeId: "challenge-" + id,
    roomId: "private-room-123",
    explanation: "do not persist",
    correctOptionId: "secret-choice",
    resumeToken: "secret-session",
    learning: { qid, correct, answeredAt },
  };
}
function result(index, date = when + index) {
  return {
    type: "room.snapshot",
    roomId: "room-" + String(index).padStart(8, "0"),
    phase: "finished",
    youSeat: 0,
    grade: 1,
    course: "s1-u1",
    ruleset: "net-1.0",
    combatRules: "2.1",
    contentVersion: "pep1-2026.1",
    mode: "pvp",
    assisted: false,
    serverTime: date,
    self: { hand: ["hidden-card"], name: "Private", deckId: "grove" },
    opponent: { hand: ["private-other"] },
    result: {
      winnerSeat: 0,
      reason: "health",
      rounds: 4,
      ownScore: 740,
      ownLearning: { attempts: 1, correct: 1 },
    },
  };
}
function oldSave() {
  const s = freshSave();
  s.nickname = "Synthetic";
  s.grade = 6;
  s.course = "s1-u4";
  s.mastery[questions[1].id] = {
    seen: 4,
    correct: 4,
    streak: 1,
    due: when + 86400000,
    last: when,
  };
  s.archivedMastery["g1-v01"] = {
    seen: 2,
    correct: 1,
    streak: 0,
    due: when,
    last: when,
  };
  s.match = createMatch({
    grade: 4,
    course: "s1",
    seed: "SYNTHETIC",
    opponentId: "moss",
  });
  s.records = ["1.0", "2.0", "2.1"].map((rules, i) => ({
    id: "synthetic-record-" + i,
    nickname: "Synthetic",
    grade: 4,
    course: "s1",
    seed: "SYNTHETIC",
    deckId: "grove",
    opponentId: "moss",
    rules,
    contentVersion: "pep1-2026.1",
    score: 500,
    correct: 2,
    attempts: 3,
    turns: 8,
    result: "loss",
    date: when + i,
  }));
  return s;
}

test("v3 migrates a valid v2 exactly once and preserves all sanitized legacy state", async () => {
  const original = JSON.stringify(oldSave()),
    db = storage({
      "spellwood.save.v2": original,
      "spellwood.save.v1": "broken older",
    }),
    mutex = locks();
  const a = store(db, mutex);
  assert((await a.load()).ok);
  assert.deepEqual(
    a.data.legacy,
    validateSave(JSON.parse(original), questions),
  );
  assert.equal(db.getItem("spellwood.save.v2"), original);
  const writes = db.writes.length;
  const b = store(db, mutex);
  assert((await b.load()).ok);
  assert.equal(db.writes.length, writes);
  assert.deepEqual(JSON.parse(b.exportLegacy()), a.data.legacy);
  assert.equal(b.data.onlineRecords.length, 0);
  assert(
    mutex.requests.every(
      (r) => r.name === PROGRESS_LOCK && r.options.mode === "exclusive",
    ),
  );
});

test("v3 presence wins over corrupt old keys; only absence permits v1 fallback", async () => {
  const original = JSON.stringify(oldSave()),
    db = storage({ "spellwood.save.v1": original }),
    a = store(db);
  assert((await a.load()).ok);
  db.values.set("spellwood.save.v2", "{");
  const b = store(db);
  assert((await b.load()).ok);
  assert.equal(b.data.legacy.nickname, "Synthetic");
  assert.equal(db.getItem("spellwood.save.v1"), original);
});

test("read failures and damaged saves never create empty v3 or permit unknown-state restore", async () => {
  for (const key of [PROGRESS_KEY, "spellwood.save.v2", "spellwood.save.v1"]) {
    const raw = JSON.stringify(oldSave()),
      db = storage({ "spellwood.save.v1": raw });
    db.readFailure = (k) => k === key;
    const s = store(db);
    assert.equal((await s.load()).code, "READ_FAILED");
    assert.equal(db.values.has(PROGRESS_KEY), false);
    assert.throws(() => s.prepareImport(oldSave()), /READ_FAILED/);
    assert.equal((await s.applyLearning(feedback("unknown"))).ok, false);
    db.readFailure = null;
    assert((await s.retry()).ok);
    assert.equal(s.data.legacy.nickname, "Synthetic");
  }
  for (const key of [PROGRESS_KEY, "spellwood.save.v2", "spellwood.save.v1"]) {
    const db = storage({ [key]: "{broken" }),
      s = store(db);
    assert.equal((await s.load()).code, "CORRUPT_SAVE");
    assert.equal(s.recoveryRaw, "{broken");
    assert.equal(db.writes.length, 0);
    assert.throws(() => s.export(), /NO_PROGRESS_TO_EXPORT/);
  }
});

test("two independent pages serialize short transactions and merge attempts instead of overwriting", async () => {
  const db = storage(),
    mutex = locks(),
    a = store(db, mutex),
    b = store(db, mutex);
  await Promise.all([a.load(), b.load()]);
  await Promise.all([
    a.applyLearning(feedback("first")),
    b.applyLearning(feedback("second")),
  ]);
  const c = store(db, mutex);
  assert((await c.load()).ok);
  assert.equal(c.data.legacy.mastery[qid].seen, 2);
  assert.equal(Object.keys(c.data.learningReceipts).length, 2);
  await Promise.all([
    a.updatePreferences({ grade: 6 }),
    b.applyLearning(feedback("third")),
  ]);
  await c.load();
  assert.equal(c.data.legacy.grade, 6);
  assert.equal(c.data.legacy.mastery[qid].seen, 3);
});

test("feedback IDs survive reload and raw feedback, tokens and online hands are excluded", async () => {
  const db = storage(),
    a = store(db);
  await a.load();
  const f = feedback("repeat");
  await a.applyLearning(f);
  await a.addResult(result(1));
  const raw = a.export();
  assert(!raw.includes("secret-session"));
  assert(!raw.includes("secret-choice"));
  assert(!raw.includes("do not persist"));
  assert(!raw.includes("private-room-123"));
  assert(!raw.includes("hidden-card"));
  const b = store(db);
  await b.load();
  const revision = b.revision;
  assert((await b.applyLearning(f)).ok);
  assert.equal(b.revision, revision);
  assert.equal(b.data.legacy.mastery[qid].seen, 1);
  const conflict = feedback("repeat", false);
  assert.equal((await b.applyLearning(conflict)).code, "LEARNING_ID_CONFLICT");
  assert.equal(b.data.legacy.mastery[qid].correct, 1);
});

test("same-day correction and out-of-order feedback keep original answer dates and mastery rules", async () => {
  const db = storage(),
    a = store(db);
  await a.load();
  const events = [
    feedback("a", true, when),
    feedback("b", false, when + 1000),
    feedback("c", true, when + 2000),
    feedback("d", true, when + 86400000),
    feedback("e", true, when + 2 * 86400000),
  ];
  for (const i of [4, 2, 0, 3, 1])
    assert((await a.applyLearning(events[i])).ok);
  const expected = freshSave();
  for (const event of events)
    recordLearning(
      expected,
      { id: qid },
      event.learning.correct,
      event.learning.answeredAt,
    );
  assert.deepEqual(a.data.legacy.mastery[qid], expected.mastery[qid]);
  assert.equal(a.data.legacy.mastery[qid].streak, 2);
  const b = store(db);
  assert((await b.load()).ok);
  assert.deepEqual(b.data.legacy.mastery[qid], expected.mastery[qid]);
});

test("quota failure retains exportable unsaved memory and retries against newer durable progress", async () => {
  const db = storage(),
    mutex = locks(),
    a = store(db, mutex),
    b = store(db, mutex);
  await a.load();
  await b.load();
  db.writeFailure = (k) => k === PROGRESS_KEY;
  const failed = await a.applyLearning(feedback("unsaved"));
  assert.equal(failed.code, "WRITE_FAILED");
  assert.equal(a.dirty, true);
  assert.equal(JSON.parse(a.export()).legacy.mastery[qid].seen, 1);
  assert.equal(
    JSON.parse(db.values.get(PROGRESS_KEY)).legacy.mastery[qid],
    undefined,
  );
  db.writeFailure = null;
  await b.applyLearning(feedback("other"));
  assert((await a.retry()).ok);
  assert.equal(a.data.legacy.mastery[qid].seen, 2);
  assert.equal(a.dirty, false);
});

test("a failed initial migration can rebase its pending attempt onto another page migration", async () => {
  const db = storage({ "spellwood.save.v2": JSON.stringify(oldSave()) }),
    mutex = locks(),
    a = store(db, mutex);
  db.writeFailure = (k) => k === PROGRESS_KEY;
  assert.equal((await a.load()).code, "WRITE_FAILED");
  await a.applyLearning(feedback("waiting"));
  db.writeFailure = null;
  const b = store(db, mutex);
  await b.load();
  await b.applyLearning(feedback("second-page"));
  assert((await a.retry()).ok);
  assert.equal(a.data.legacy.mastery[qid].seen, 2);
  assert(a.data.legacy.match);
});

test("online results are separate, latest 200, and old pruned room IDs remain idempotent", async () => {
  const db = storage(),
    a = store(db);
  await a.load();
  for (let i = 0; i < 202; i++) assert((await a.addResult(result(i))).ok);
  assert.equal(a.data.onlineRecords.length, 200);
  assert.equal(a.data.legacy.records.length, 0);
  assert.equal(a.data.onlineRecords[0].id, result(2).roomId);
  const revision = a.revision;
  assert((await a.addResult(result(0, when + 9999))).ok);
  assert.equal(a.revision, revision);
  assert.equal(a.data.onlineRecords[0].id, result(2).roomId);
});

test("restore uses reviewed revision, backups the original, and leaves v2 unchanged", async () => {
  const legacyRaw = JSON.stringify(oldSave()),
    db = storage({ "spellwood.save.v2": legacyRaw }),
    s = store(db);
  await s.load();
  await s.applyLearning(feedback("before-restore"));
  const before = db.values.get(PROGRESS_KEY),
    imported = oldSave(),
    prepared = s.prepareImport(imported);
  assert((await s.restore(prepared, s.revision)).ok);
  assert.equal(db.values.get(s.recoveryKey), before);
  assert.equal(db.values.get("spellwood.save.v2"), legacyRaw);
  assert.deepEqual(
    JSON.parse(s.exportLegacy()),
    validateSave(imported, questions),
  );
  assert.equal(s.data.onlineRecords.length, 0);
});

test("restore refuses stale revision and retains original data when backup or primary writes fail", async () => {
  const db = storage(),
    mutex = locks(),
    a = store(db, mutex),
    b = store(db, mutex);
  await a.load();
  await b.load();
  const prepared = a.prepareImport(oldSave()),
    revision = a.revision;
  await b.applyLearning(feedback("newer"));
  assert.equal((await a.restore(prepared, revision)).code, "STALE_REVISION");
  assert.equal(
    JSON.parse(db.values.get(PROGRESS_KEY)).legacy.mastery[qid].seen,
    1,
  );
  await a.load();
  for (const failKey of ["backup", "main"]) {
    const p = a.prepareImport(oldSave()),
      before = db.values.get(PROGRESS_KEY),
      memory = a.export();
    db.writeFailure = (k) =>
      failKey === "backup"
        ? k.startsWith(PROGRESS_KEY + ".recovery")
        : k === PROGRESS_KEY;
    assert.equal((await a.restore(p, a.revision)).code, "RESTORE_WRITE_FAILED");
    assert.equal(db.values.get(PROGRESS_KEY), before);
    assert.equal(a.export(), memory);
    db.writeFailure = null;
  }
});

test("corrupt legacy restoration preserves raw backup first and never removes old key", async () => {
  const raw = "{damaged old progress",
    db = storage({ "spellwood.save.v2": raw }),
    a = store(db);
  await a.load();
  const p = a.prepareImport(oldSave());
  assert((await a.restore(p, a.revision)).ok);
  assert.equal(db.values.get("spellwood.save.v2"), raw);
  assert.equal(db.values.get(a.recoveryKey), raw);
  assert.equal(a.data.legacy.nickname, "Synthetic");
});

test("cross-page restore stops in-flight attempts being assigned to another profile", async () => {
  const db = storage(),
    mutex = locks(),
    a = store(db, mutex),
    b = store(db, mutex);
  await a.load();
  await b.load();
  const p = b.prepareImport(oldSave());
  assert((await b.restore(p, b.revision)).ok);
  assert.equal(
    (await a.applyLearning(feedback("old-profile"))).code,
    "PROFILE_CHANGED",
  );
  assert.equal(a.dirty, true);
  assert.equal(JSON.parse(a.export()).legacy.mastery[qid].seen, 1);
  assert.equal(
    JSON.parse(db.values.get(PROGRESS_KEY)).legacy.mastery[qid],
    undefined,
  );
});

test("unsupported locks are explicit single-page mode; broken lock API never falls back to writes", async () => {
  const db = storage(),
    a = store(db, null);
  assert((await a.load()).ok);
  assert.equal(a.singlePage, true);
  const brokenDb = storage(),
    b = store(brokenDb, {
      request() {
        throw Error("broken lock");
      },
    });
  assert.equal((await b.load()).code, "LOCK_FAILED");
  assert.equal(brokenDb.writes.length, 0);
});

test("event-window compaction folds old events into the baseline without losing counters or stage", async () => {
  const db = storage(),
    a = store(db);
  await a.load();
  const data = a.data;
  const start = Date.now() - 3 * 86400000;
  data.learningBase[qid] = null;
  for (let i = 0; i < PROGRESS_LIMITS.learningEvents; i++) {
    const event = {
      id: "fold-" + String(i).padStart(8, "0"),
      qid,
      correct: i % 9 !== 0,
      answeredAt: start + i * 1000,
    };
    data.learningReceipts[event.id] = event;
    recordLearning(data.legacy, { id: qid }, event.correct, event.answeredAt);
  }
  db.values.set(PROGRESS_KEY, JSON.stringify(data));
  const b = store(db);
  assert((await b.load()).ok);
  const expected = structuredClone(data.legacy);
  recordLearning(expected, { id: qid }, true, Date.now());
  const latest = feedback("after-window", true, expected.mastery[qid].last);
  assert((await b.applyLearning(latest)).ok);
  assert.equal(
    Object.keys(b.data.learningReceipts).length,
    PROGRESS_LIMITS.learningEvents,
  );
  assert.deepEqual(b.data.legacy.mastery[qid], expected.mastery[qid]);
  const before = b.export();
  assert(
    (
      await b.applyLearning({
        challengeId: "fold-00000000",
        learning: { qid, correct: false, answeredAt: start },
      })
    ).ok,
  );
  assert.equal(b.export(), before);
  const c = store(db);
  assert((await c.load()).ok);
  assert.deepEqual(c.data.legacy.mastery[qid], expected.mastery[qid]);
});

test("import strips unknown network secrets even inside an offline match", async () => {
  const db = storage(),
    a = store(db);
  await a.load();
  const old = oldSave();
  old.resumeToken = "outer-secret";
  old.match.resumeToken = "inner-secret";
  old.match.players[0].resumeToken = "player-secret";
  const p = a.prepareImport(old);
  assert((await a.restore(p, a.revision)).ok);
  assert(!a.export().includes("secret"));
  assert(a.data.legacy.match.players[0].hand.length > 0);
});

test("restoring from a pretty-printed durable v3 compares original bytes, not reserialized bytes", async () => {
  const db = storage(),
    a = store(db);
  await a.load();
  await a.applyLearning(feedback("pretty"));
  db.values.set(
    PROGRESS_KEY,
    JSON.stringify(JSON.parse(db.values.get(PROGRESS_KEY)), null, 2),
  );
  const b = store(db);
  await b.load();
  const p = b.prepareImport(oldSave());
  assert((await b.restore(p, b.revision)).ok);
});

test("full recent replay window pauses safely, keeps exportable memory, then folds after two hours", async () => {
  const db = storage(),
    a = store(db);
  await a.load();
  const data = a.data,
    now = Date.now();
  data.learningBase[qid] = null;
  for (let i = 0; i < PROGRESS_LIMITS.learningEvents; i++) {
    const event = {
      id: "recent-" + String(i).padStart(8, "0"),
      qid,
      correct: true,
      answeredAt: now - 1000,
    };
    data.learningReceipts[event.id] = event;
    recordLearning(data.legacy, { id: qid }, true, event.answeredAt);
  }
  db.values.set(PROGRESS_KEY, JSON.stringify(data));
  const b = store(db);
  await b.load();
  assert.equal(
    (await b.applyLearning(feedback("recent-overflow", true, now))).code,
    "PROGRESS_FULL",
  );
  assert.equal(b.dirty, true);
  assert.equal(
    JSON.parse(b.export()).legacy.mastery[qid].seen,
    PROGRESS_LIMITS.learningEvents + 1,
  );
  assert.equal(
    JSON.parse(db.values.get(PROGRESS_KEY)).legacy.mastery[qid].seen,
    PROGRESS_LIMITS.learningEvents,
  );
  assert.equal(
    (await b.applyLearning(feedback("further", true, now))).code,
    "PROGRESS_UNAVAILABLE",
  );
  const realNow = Date.now;
  try {
    Date.now = () => now + PROGRESS_LIMITS.replayMs + 1000;
    assert((await b.retry()).ok);
  } finally {
    Date.now = realNow;
  }
  assert.equal(b.dirty, false);
  assert.equal(
    b.data.legacy.mastery[qid].seen,
    PROGRESS_LIMITS.learningEvents + 1,
  );
});

test("external removal after load pauses rather than recreating a fresh archive over the remaining memory", async () => {
  const db = storage(),
    a = store(db);
  await a.load();
  await a.applyLearning(feedback("durable-before-removal"));
  db.removeItem(PROGRESS_KEY);
  assert.equal(
    (await a.applyLearning(feedback("pending-after-removal"))).code,
    "SAVE_REMOVED",
  );
  assert.equal(db.values.has(PROGRESS_KEY), false);
  assert.equal(JSON.parse(a.export()).legacy.mastery[qid].seen, 2);
  const prepared = a.prepareImport(a.export());
  assert((await a.restore(prepared, a.revision)).ok);
  assert.equal(a.data.legacy.mastery[qid].seen, 2);
});

test("the original recovery copy remains accessible after a settings write and a fresh load", async () => {
  const db = storage(),
    a = store(db);
  await a.load();
  await a.applyLearning(feedback("original-backup"));
  const original = db.values.get(PROGRESS_KEY),
    p = a.prepareImport(oldSave());
  assert((await a.restore(p, a.revision)).ok);
  assert((await a.updatePreferences({ grade: 3 })).ok);
  const b = store(db);
  assert((await b.load()).ok);
  assert.equal(b.recoveryRaw, original);
  assert.equal(db.values.get(b.recoveryKey), original);
});

test("exported v3 preserves its learning calendar when restored on a device in another time zone", async () => {
  const oldZone = process.env.TZ;
  try {
    process.env.TZ = "UTC";
    const db = storage(),
      a = store(db);
    await a.load();
    await a.applyLearning(
      feedback("calendar-early", true, Date.UTC(2026, 9, 1, 1)),
    );
    await a.applyLearning(
      feedback("calendar-late", true, Date.UTC(2026, 9, 1, 23)),
    );
    assert.equal(a.data.legacy.mastery[qid].streak, 1);
    const oldMastery = a.data.legacy.mastery[qid];
    process.env.TZ = "America/New_York";
    const b = store(db);
    assert((await b.load()).ok);
    assert.deepEqual(b.data.legacy.mastery[qid], oldMastery);
    assert(
      (
        await b.applyLearning(
          feedback("calendar-next", true, Date.UTC(2026, 9, 2, 1)),
        )
      ).ok,
    );
    assert.equal(b.data.legacy.mastery[qid].streak, 2);
    assert.equal(b.data.legacy.mastery[qid].last, Date.UTC(2026, 9, 2, 1));
  } finally {
    if (oldZone === undefined) delete process.env.TZ;
    else process.env.TZ = oldZone;
  }
});

test("latest export reads other-page learning, results and preferences inside a short transaction", async () => {
  const db = storage(),
    mutex = locks(),
    a = store(db, mutex),
    b = store(db, mutex);
  await a.load();
  await b.load();
  await b.applyLearning(feedback("other-page-export"));
  await b.addResult(result(11));
  await b.updatePreferences({ grade: 6 });
  assert.equal(
    JSON.parse(a.export()).legacy.mastery[qid],
    undefined,
    "sync export is an emergency memory snapshot",
  );
  const count = mutex.requests.length,
    complete = await a.exportLatest();
  assert.equal(complete.ok, true);
  assert.equal(complete.scope, "latest-durable");
  assert.equal(mutex.requests.length, count + 1);
  const data = JSON.parse(complete.json);
  assert.equal(data.legacy.mastery[qid].seen, 1);
  assert.equal(data.onlineRecords.length, 1);
  assert.equal(data.legacy.grade, 6);
  assert.equal(data.revision, JSON.parse(db.values.get(PROGRESS_KEY)).revision);
  await b.updatePreferences({ grade: 3 });
  const legacy = await a.exportLegacyLatest();
  assert.equal(legacy.ok, true);
  assert.equal(JSON.parse(legacy.json).schema, 1);
  assert.equal(JSON.parse(legacy.json).grade, 3);
});

test("latest export never labels a failed read or unsaved write as a complete durable backup", async () => {
  const db = storage(),
    a = store(db);
  await a.load();
  db.writeFailure = (k) => k === PROGRESS_KEY;
  await a.applyLearning(feedback("export-write-failed"));
  const write = await a.exportLatest();
  assert.equal(write.ok, false);
  assert.equal(write.code, "WRITE_FAILED");
  assert.equal(write.json, undefined);
  assert.equal(JSON.parse(a.export()).legacy.mastery[qid].seen, 1);
  db.writeFailure = null;
  db.readFailure = (k) => k === PROGRESS_KEY;
  const read = await a.exportLatest();
  assert.equal(read.ok, false);
  assert.equal(read.code, "READ_FAILED");
  assert.equal(read.json, undefined);
  db.readFailure = null;
  const recovered = await a.exportLatest();
  assert.equal(recovered.ok, true);
  assert.equal(JSON.parse(recovered.json).legacy.mastery[qid].seen, 1);
});

test("the two local seats in one room each keep their own result and remain individually idempotent", async () => {
  const db = storage(),
    mutex = locks(),
    a = store(db, mutex),
    b = store(db, mutex);
  await a.load();
  await b.load();
  const win = result(33),
    loss = { ...structuredClone(win), youSeat: 1 };
  loss.result.ownScore = 100;
  loss.result.ownLearning.correct = 0;
  await Promise.all([a.addResult(win), b.addResult(loss)]);
  const latest = JSON.parse((await a.exportLatest()).json);
  assert.equal(latest.onlineRecords.length, 2);
  assert.deepEqual(
    latest.onlineRecords.map((r) => [r.youSeat, r.result, r.score]).sort(),
    [
      [0, "win", 740],
      [1, "loss", 100],
    ],
  );
  assert(latest.resultIds.includes(win.roomId + ":0"));
  assert(latest.resultIds.includes(win.roomId + ":1"));
  const revision = a.revision;
  assert((await a.addResult(win)).ok);
  assert((await b.addResult(loss)).ok);
  assert.equal(JSON.parse(db.values.get(PROGRESS_KEY)).revision, revision);
});

test("old v3 results without seat remain readable and matching receipts enrich them without losing the other seat", async () => {
  const db = storage(),
    a = store(db);
  await a.load();
  const win = result(44);
  await a.addResult(win);
  const old = a.data;
  delete old.onlineRecords[0].youSeat;
  old.resultIds = [win.roomId];
  db.values.set(PROGRESS_KEY, JSON.stringify(old));
  const b = store(db);
  assert((await b.load()).ok);
  assert.equal(b.data.onlineRecords[0].youSeat, undefined);
  const loss = { ...structuredClone(win), youSeat: 1 };
  loss.result.ownScore = 100;
  loss.result.ownLearning.correct = 0;
  assert((await b.addResult(loss)).ok);
  assert.equal(b.data.onlineRecords.length, 2);
  assert((await b.addResult(win)).ok);
  assert.equal(b.data.onlineRecords.length, 2);
  assert.deepEqual(b.data.onlineRecords.map((r) => r.youSeat).sort(), [0, 1]);
  const c = store(db);
  assert((await c.load()).ok);
  assert.equal(c.data.onlineRecords.length, 2);
});

test("a cutoff legitimately committed before device-clock rollback is not treated as a corrupt archive", async () => {
  const db = storage(),
    a = store(db);
  await a.load();
  const data = a.data,
    now = Date.now();
  data.learningCutoff = now - PROGRESS_LIMITS.replayMs - 1;
  db.values.set(PROGRESS_KEY, JSON.stringify(data));
  const realNow = Date.now;
  try {
    Date.now = () => now - 60_000;
    const b = store(db);
    const loaded = await b.load();
    assert.equal(loaded.ok, true);
    assert.equal(b.data.learningCutoff, data.learningCutoff);
    assert.equal(JSON.parse(b.export()).learningCutoff, data.learningCutoff);
  } finally {
    Date.now = realNow;
  }
});

test("legacy restore explicitly signals that online receipts are absent and the active session must end", async () => {
  const db = storage(),
    a = store(db);
  await a.load();
  await a.applyLearning(feedback("before-legacy-restore"));
  const p = a.prepareImport(a.exportLegacy());
  assert.equal(p.requiresSessionReset, true);
  assert.equal(p.dropsOnlineReceipts, true);
  const restored = await a.restore(p, p.revision);
  assert.equal(restored.ok, true);
  assert.equal(restored.requiresSessionReset, true);
  assert.equal(restored.dropsOnlineReceipts, true);
  assert.equal(Object.keys(a.data.learningReceipts).length, 0);
  const full = a.prepareImport(a.export());
  assert.equal(full.requiresSessionReset, true);
  assert.equal(full.dropsOnlineReceipts, false);
});
