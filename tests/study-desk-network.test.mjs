import test from "node:test";
import assert from "node:assert/strict";
import { StudyDesk } from "../src/network/study-desk.mjs";
import { createGameServer } from "../server/index.mjs";

const pause = (ms = 5) => new Promise((r) => setTimeout(r, ms));
async function until(fn) { for (let i = 0; i < 200; i++) { if (fn()) return; await pause(); } throw Error("Condition did not settle"); }
const memory = () => { const values = new Map(); return { values, getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, String(v)), removeItem: (k) => values.delete(k) }; };
async function fixture(t, override) {
  const server = createGameServer({ port: 0 }); await server.listen(); t.after(() => server.close());
  const storage = memory(), preferences = { grade: 1, course: "s1-u1" };
  const jar = new Map();
  const request = async (path, init = {}) => {
    const response = await fetch(server.origin + path, { ...init, headers: { ...init.headers, Origin: server.origin, Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; ") } });
    for (const item of response.headers.getSetCookie()) {
      const pair = item.split(";")[0], at = pair.indexOf("="), key = pair.slice(0, at), value = pair.slice(at + 1);
      if (/Max-Age=0(?:;|$)/i.test(item)) jar.delete(key); else jar.set(key, value);
    }
    return response;
  };
  const guest = await request("/api/identity/guest", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(guest.ok, true);
  const desk = new StudyDesk({ storage, locks: null, fetcher: override ? override(request) : request, getPreferences: () => preferences });
  t.after(() => desk.dispose());
  await desk.initialize(); assert.equal(desk.canStart, true);
  return { desk, storage, preferences, server };
}

test("study desk loads all curriculum metadata while selecting only one six-item unit", async (t) => {
  const { desk } = await fixture(t);
  assert.equal(desk.catalogue.questions.length, 480);
  assert.equal(desk.catalogue.questions.filter(q => (q.bank || "school") === "school").length, 432);
  assert.equal(desk.store.questions.length, 480, "migration must know every current question ID");
  assert.equal(desk.scope().length, 6);
  assert.equal(desk.data.legacy.records.length, 0);
  assert.equal(desk.store.singlePage, true);
  assert.match(desk.warning(), /只用一个页面/);
});

test("study desk sends an opaque answer once and persists its receipt across reload", async (t) => {
  const { desk, storage } = await fixture(t); desk.open("study");
  const qid = desk.scope()[0].id; await desk.study(qid);
  const challengeId = desk.question.challengeId, option = desk.question.question.options[0].id;
  await Promise.all([desk.answerStudy(option), desk.answerStudy(option)]);
  await until(() => !desk.flushing);
  assert(desk.answer); assert.equal(desk.data.legacy.mastery[qid].seen, 1);
  assert(desk.data.learningReceipts[challengeId]);
  desk.receiveFeedback(desk.answer); await until(() => !desk.flushing);
  assert.equal(desk.data.legacy.mastery[qid].seen, 1);
  const raw = storage.getItem("spellwood.save.v4");
  assert.doesNotMatch(raw, /correctOptionId|listenAudio|resumeToken/);
  const answer = desk.answer; await desk.store.load(); desk.receiveFeedback(answer); await until(() => !desk.flushing);
  assert.equal(desk.data.legacy.mastery[qid].seen, 1);
});

test("closed study catalogue cannot be replaced by a late question response", async (t) => {
  let release, fetched;
  const { desk } = await fixture(t, (request) => async (path, init) => {
    const result = await request(path, init);
    if (path.startsWith("/api/study/")) { fetched = true; await new Promise((r) => { release = r; }); }
    return result;
  });
  desk.open("study"); const pending = desk.study(desk.scope()[0].id);
  await until(() => fetched); desk.close(); release(); await pending;
  assert.equal(desk.view, null); assert.equal(desk.question, null); assert.equal(desk.busy, false);
});

test("closing an answered study panel preserves the received learning event without reopening it", async (t) => {
  let release, sent;
  const { desk } = await fixture(t, (request) => async (path, init) => {
    const result = await request(path, init);
    if (path.endsWith("/answer")) { sent = true; await new Promise((r) => { release = r; }); }
    return result;
  });
  desk.open("study"); const qid = desk.scope()[0].id; await desk.study(qid);
  const pending = desk.answerStudy(desk.question.question.options[0].id);
  await until(() => sent); desk.close(); release(); await pending; await until(() => !desk.flushing);
  assert.equal(desk.view, null); assert.equal(desk.question, null); assert.equal(desk.answer, null);
  assert.equal(desk.data.legacy.mastery[qid].seen, 1);
});

test("an expired study challenge does not become a wrong answer or a mastery event", async (t) => {
  const { desk } = await fixture(t, (request) => (path, init) => path.endsWith("/answer") ? Promise.resolve({ ok: false, status: 410 }) : request(path, init));
  desk.open("study"); const qid = desk.scope()[0].id; await desk.study(qid);
  await desk.answerStudy(desk.question.question.options[0].id);
  assert.equal(desk.answer, null); assert.equal(desk.data.legacy.mastery[qid], undefined);
  assert.match(desk.message, /没有记为答错/);
});

test("study scope changes preserve completed learning from the previous grade", async (t) => {
  const { desk, preferences } = await fixture(t); desk.open("study");
  const qid = desk.scope()[0].id; await desk.study(qid); await desk.answerStudy(desk.question.question.options[0].id); await until(() => !desk.flushing);
  desk.close(); preferences.grade = 6; await desk.preferences({ grade: 6 });
  assert.equal(desk.scope().length, 6); assert(desk.scope().every((q) => q.grade === 6));
  assert.equal(desk.data.legacy.mastery[qid].seen, 1);
  desk.open("study"); await desk.study(qid); assert.equal(desk.question, null, "cannot request an out-of-scope ID through this UI");
});

test("restoring a legacy backup discards a late answer from the previous temporary session", async (t) => {
  let release, sent, resets = 0;
  const { desk } = await fixture(t, (request) => async (path, init) => {
    const result = await request(path, init);
    if (path.endsWith("/answer")) { sent = true; await new Promise((r) => { release = r; }); }
    return result;
  });
  desk.onRestore = () => { resets++; };
  const legacy = desk.store.exportLegacy();
  desk.open("study"); const qid = desk.scope()[0].id; await desk.study(qid);
  const pending = desk.answerStudy(desk.question.question.options[0].id);
  await until(() => sent);
  desk.open("data"); await desk.store.retry();
  desk.prepared = desk.store.prepareImport(legacy);
  await desk.click("desk-restore");
  assert.equal(resets, 1); assert.equal(desk.pending.size, 0);
  release(); await pending; await until(() => !desk.flushing);
  assert.equal(desk.data.legacy.mastery[qid], undefined);
  assert.equal(Object.keys(desk.data.learningReceipts).length, 0);
  assert.equal(desk.view, "data");
});

test("full export uses the latest durable API and does not label a memory rescue complete", async (t) => {
  const { desk } = await fixture(t); desk.open("data");
  const downloads = []; desk.download = (text, name) => downloads.push({ text, name });
  await desk.click("desk-export"); assert.equal(downloads.length, 1);
  assert.equal(JSON.parse(downloads[0].text).schema, 4);
  assert.match(desk.message, /已生成备份下载/);
  await desk.click("desk-rescue"); assert.equal(downloads.length, 2);
  assert.match(desk.message, /可能不含另一页/);
});

test("a study round visits six distinct questions and then offers an explicit finish", async (t) => {
  const { desk } = await fixture(t); desk.open("study"); desk.filter = "all";
  await desk.study(desk.scope()[2].id);
  const seen = [];
  while (desk.question) {
    seen.push(desk.studyId); assert(seen.length <= 6, "a round must not continue forever");
    await desk.answerStudy(desk.question.question.options[0].id); await desk.flush();
    await desk.click("desk-next");
  }
  assert.equal(seen.length, 6); assert.equal(new Set(seen).size, 6);
  assert.equal(desk.round.finished, true); assert.match(desk.studyHtml(), /这轮练习完成了/);
  assert.doesNotMatch(desk.studyHtml(), /data-action="desk-next"/);
  assert.equal(Object.values(desk.data.legacy.mastery).reduce((n, x) => n + x.seen, 0), 6);
});

test("a short new-material round stops when its original two-item selection is exhausted", async (t) => {
  const { desk } = await fixture(t); const scope = desk.scope();
  for (let i = 0; i < 4; i++) await desk.store.applyLearning({ challengeId: `prelearned-item-${i}`, learning: { qid: scope[i].id, correct: true, answeredAt: Date.now() } });
  desk.open("study"); desk.filter = "new"; await desk.store.retry();
  await desk.study(scope[4].id); assert.equal(desk.round.ids.length, 2);
  for (let i = 0; i < 2; i++) { await desk.answerStudy(desk.question.question.options[0].id); await desk.flush(); await desk.click("desk-next"); }
  assert.equal(desk.round.finished, true); assert.equal(desk.question, null);
  assert(scope.slice(0, 4).every((q) => desk.data.legacy.mastery[q.id].seen === 1), "already known items were not silently appended");
});

test("leaving an unanswered round records no attempt and a later round starts fresh", async (t) => {
  const { desk } = await fixture(t); desk.open("study"); desk.filter = "all";
  await desk.study(desk.scope()[0].id); await desk.click("desk-back");
  assert.equal(desk.round, null); assert.equal(Object.keys(desk.data.legacy.mastery).length, 0);
  await desk.study(desk.scope()[3].id);
  assert.equal(desk.round.index, 0); assert.equal(desk.round.ids[0], desk.scope()[3].id);
});

test("a cancelled file read cannot clear the busy state of a later study request", async (t) => {
  let releaseFile, releaseStudy, fetched;
  const { desk } = await fixture(t, (request) => async (path, init) => {
    const response = await request(path, init);
    if (path.startsWith("/api/study/")) { fetched = true; await new Promise((r) => { releaseStudy = r; }); }
    return response;
  });
  desk.open("data"); const backup = desk.store.exportLegacy();
  const read = desk.importFile({ name: "backup.json", size: backup.length, text: () => new Promise((r) => { releaseFile = () => r(backup); }) });
  desk.close(); desk.open("study"); const study = desk.study(desk.scope()[0].id);
  await until(() => fetched); assert.equal(desk.busy, true);
  releaseFile(); await read; assert.equal(desk.busy, true); assert.equal(desk.prepared, null);
  releaseStudy(); await study; assert(desk.question); assert.equal(desk.busy, false);
});
