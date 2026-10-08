import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { domHarness } from "./dom-harness.mjs";
import { freshSave, validateSave, validateMatch } from "../src/learning.mjs";
import { createMatch, act } from "../src/engine.mjs";
import { validCourse } from "../src/cards.mjs";
const dir = fileURLToPath(new URL("../src", import.meta.url));
const Q = JSON.parse(
  fs.readFileSync(new URL("../src/questions.json", import.meta.url)),
);
const key = "spellwood.save.v2";
function opponent(h) {
  h.run(
    "startReady('CONTINUITY');save.match=act(save.match,{type:'end'});persist();scheduleAI()",
  );
}
test("external sync reschedules the computer turn on the latest saved position", () => {
  const h = domHarness(dir);
  opponent(h);
  const s = JSON.parse(h.run("JSON.stringify(save)"));
  s.nickname = "Newest";
  const raw = JSON.stringify(s);
  h.storage.set(key, raw);
  h.windowEvents.storage({ key, newValue: raw });
  const before = h.run("save.match.seq"),
    callback = h.timerCallback(h.run("aiTimer"));
  assert.equal(typeof callback, "function");
  callback();
  assert.ok(h.run("save.match.seq") > before);
});
for (const interrupt of ["settings", "hidden"])
  test(`already queued AI callback cannot act after ${interrupt}`, () => {
    const h = domHarness(dir);
    opponent(h);
    const before = h.run("save.match.seq"),
      callback = h.timerCallback(h.run("aiTimer"));
    if (interrupt === "settings") h.click("settings");
    else {
      h.run("document.hidden=true");
      h.documentEvents.visibilitychange();
    }
    callback();
    assert.equal(h.run("save.match.seq"), before);
    if (interrupt === "settings") h.click("close");
    else {
      h.run("document.hidden=false");
      h.documentEvents.visibilitychange();
    }
    h.timerCallback(h.run("aiTimer"))();
    assert.ok(h.run("save.match.seq") > before);
  });
test("review answer merges once into the newer learning aggregate without a null reference", () => {
  const h = domHarness(dir);
  h.run("openModal('book');nextReview()");
  const qid = h.run("reviewQ.id"),
    answer = h.run("reviewQ.answer");
  const newer = JSON.parse(h.run("JSON.stringify(save)"));
  newer.nickname = "Other";
  newer.mastery[qid] = {
    seen: 1,
    correct: 1,
    streak: 1,
    last: Date.now(),
    due: Date.now() + 86400000,
  };
  h.storage.set(key, JSON.stringify(newer));
  h.click("review-answer", { index: String(answer) });
  const saved = JSON.parse(h.storage.get(key));
  assert.equal(saved.nickname, "Other");
  assert.equal(saved.mastery[qid].seen, 2);
  assert.equal(saved.mastery[qid].correct, 2);
  h.click("review-answer", { index: String(answer) });
  assert.equal(JSON.parse(h.storage.get(key)).mastery[qid].seen, 2);
});
test("a newer empty battle save cancels a stale action without crashing", async () => {
  const h = domHarness(dir);
  h.run("startReady('STALE');save.match.players[0].hand=['rabbit'];persist()");
  const newer = JSON.parse(h.run("JSON.stringify(save)"));
  newer.match = null;
  const raw = JSON.stringify(newer);
  h.storage.set(key, raw);
  await h.run("step({type:'play',index:0})");
  assert.equal(h.run("save.match"), null);
  assert.equal(h.run("view"), "lobby");
  assert.equal(h.storage.get(key), raw);
});
test("confirmed valid backup replaces blocked corrupt external data and survives restart", () => {
  const h = domHarness(dir);
  h.run("startReady('OLD')");
  h.storage.set(key, "{BROKEN");
  h.windowEvents.storage({ key, newValue: "{BROKEN" });
  assert.equal(h.run("storageBlocked"), true);
  h.run(
    "importCandidate=freshSave();importCandidate.nickname='Restored';modal='replace-import'",
  );
  h.click("confirm-import");
  assert.equal(h.run("storageBlocked"), false);
  assert.equal(JSON.parse(h.storage.get(key)).nickname, "Restored");
  assert.equal(h.storage.get(key + ".recovery"), "{BROKEN");
  const restarted = domHarness(dir, { raw: h.storage.get(key) });
  assert.equal(restarted.run("save.nickname"), "Restored");
  assert.equal(restarted.run("storageError"), false);
});
test("failed restore write retains current progress and never claims success", () => {
  const h = domHarness(dir, { failWrites: true });
  h.run(
    "save.nickname='Current';importCandidate=freshSave();importCandidate.nickname='Imported';modal='replace-import'",
  );
  h.click("confirm-import");
  assert.equal(h.run("save.nickname"), "Current");
  assert.equal(h.run("importCandidate.nickname"), "Imported");
  assert.match(
    h.run("document.querySelector('#toast').textContent"),
    /尚未恢复/,
  );
});
function pendingImport(h, name) {
  let resolve;
  const s = freshSave();
  s.nickname = name;
  const p = new Promise((r) => (resolve = r));
  const done = h.fileEvents.change({
    target: { files: [{ size: 100, text: () => p }], value: "x" },
  });
  return { done, finish: () => resolve(JSON.stringify(s)) };
}
test("the last chosen backup wins even when the first file finishes reading later", async () => {
  const h = domHarness(dir);
  h.click("settings");
  const first = pendingImport(h, "First"),
    second = pendingImport(h, "Second");
  second.finish();
  await second.done;
  first.finish();
  await first.done;
  assert.equal(h.run("importCandidate.nickname"), "Second");
});
test("leaving an import dialog cancels a still-reading file", async () => {
  const h = domHarness(dir);
  h.click("settings");
  const pending = pendingImport(h, "Late");
  h.click("close");
  pending.finish();
  await pending.done;
  assert.equal(h.run("modal"), null);
  assert.equal(h.run("importCandidate"), null);
});
test("course validation rejects coercible arrays and imported battle ranges", () => {
  assert.equal(validCourse(["s1"]), false);
  const s = freshSave();
  s.course = ["s1"];
  assert.equal(validateSave(s, Q).course, "all");
  s.match = createMatch();
  s.match.course = ["s1"];
  assert.throws(() => validateSave(s, Q), /已损坏/);
});
test("imported unit sequence cannot generate duplicate IDs after a summon", () => {
  const s = freshSave();
  s.match = act(createMatch(), { type: "end" });
  s.match.players[0].board = [
    { uid: "u5", cardId: "sprout", atk: 1, hp: 3, maxHp: 3, ready: true },
  ];
  s.match.seq = 0;
  assert.equal(validateMatch(s.match), false);
  s.match.seq = 5;
  assert.equal(validateMatch(s.match), true);
});
test("imported health and winner must describe the same actual outcome", () => {
  const s = createMatch();
  s.players[0].hp = 0;
  assert.equal(validateMatch(s), false);
  s.phase = "finished";
  s.winner = 1;
  assert.equal(validateMatch(s), true);
  s.winner = "draw";
  assert.equal(validateMatch(s), false);
});
test("leaving while a ritual projectile travels does not play a late impact or count the answer twice", async () => {
  const h = domHarness(dir);
  h.run(`startReady('INTERRUPT-RITUAL');
    var sounds=[]; SOUND.play=k=>sounds.push(k);
    var oldQuery=document.querySelector;
    document.querySelector=s=>s.includes('hero-frame')?{getBoundingClientRect:()=>({x:0,y:0,width:30,height:30})}:oldQuery(s);
    var releaseShot; FX.projectile=()=>new Promise(resolve=>releaseShot=resolve);
    openQuestion('spark','hero');
  `);
  const pending = h.run(
    "handleAnswer(QUESTIONS.find(q=>q.id===prompt.qid).answer)",
  );
  assert.equal(h.run("save.match.attempts"), 1);
  assert.ok(h.run('sounds.includes("spark")'));
  h.click("home");
  h.run("sounds.length=0;releaseShot()");
  await h.settle(pending);
  assert.equal(h.run("view"), "lobby");
  assert.equal(h.run('sounds.includes("hit")'), false);
  assert.equal(h.run("save.match.attempts"), 1);
  const restored = domHarness(dir, { raw: h.storage.get(key) });
  assert.equal(restored.run("save.match.attempts"), 1);
});
