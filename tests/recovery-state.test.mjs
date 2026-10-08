import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { domHarness } from "./dom-harness.mjs";
import { freshSave } from "../src/learning.mjs";
import { RULES } from "../src/cards.mjs";
const dir = fileURLToPath(new URL("../src", import.meta.url));
const key = "spellwood.save.v2",
  old = "spellwood.save.v1";
for (const source of ["legacy", "current"])
  test(`${source} corrupt save shows a persistent recovery gate instead of a fake playable battle`, () => {
    const raw = "{BROKEN-" + source;
    const h = domHarness(
      dir,
      source === "legacy" ? { legacyRaw: raw } : { raw },
    );
    assert.equal(h.run("storageBlocked"), true);
    assert.match(h.app.innerHTML, /这份进度需要恢复/);
    const before = h.run("JSON.stringify(save)");
    h.click("start");
    h.click("opening-confirm");
    h.click("end");
    h.click("review-start");
    assert.equal(h.run("JSON.stringify(save)"), before);
    assert.equal(h.run("canRunAI()"), false);
    assert.match(h.app.innerHTML, /storage-shield/);
    assert.equal(h.storage.get(source === "legacy" ? old : key), raw);
    h.click("storage-retry");
    assert.equal(h.run("storageBlocked"), true);
    assert.equal(h.storage.get(source === "legacy" ? old : key), raw);
  });
test("a corrupt external update freezes the last intact position until a verified retry", () => {
  const h = domHarness(dir);
  h.run(
    "startReady('RECOVER');save.match=act(save.match,{type:'end'});persist()",
  );
  const raw = h.storage.get(key),
    before = h.run("JSON.stringify(save)");
  h.storage.set(key, "{BROKEN");
  h.windowEvents.storage({ key, newValue: "{BROKEN" });
  h.click("end");
  h.click("start");
  assert.equal(h.run("JSON.stringify(save)"), before);
  assert.equal(h.run("canRunAI()"), false);
  assert.equal(h.run("locked"), false);
  h.storage.set(key, raw);
  h.click("storage-retry");
  assert.equal(h.run("storageBlocked"), false);
  assert.equal(h.run("storageError"), false);
  assert.equal(h.run("canRunAI()"), true);
  assert.equal(typeof h.timerCallback(h.run("aiTimer")), "function");
  assert.equal(h.storage.get(key + ".recovery"), "{BROKEN");
});
test("quota pauses the current in-memory turn and retry saves it before AI resumes", () => {
  const h = domHarness(dir);
  h.run("startReady('QUOTA-RECOVER')");
  const oldRaw = h.storage.get(key);
  h.ctx.localStorage.setItem = () => {
    throw Error("quota");
  };
  h.click("end");
  assert.equal(h.run("save.match.active"), 1);
  assert.equal(h.run("storageError"), true);
  assert.equal(h.run("canRunAI()"), false);
  assert.match(h.app.innerHTML, /进度还没有存好/);
  const inMemory = h.run("JSON.stringify(save)");
  h.click("start");
  h.click("end");
  assert.equal(h.run("JSON.stringify(save)"), inMemory);
  assert.equal(h.storage.get(key), oldRaw);
  h.ctx.localStorage.setItem = (k, v) => h.storage.set(k, v);
  h.click("storage-retry");
  assert.equal(h.storage.get(key), inMemory);
  assert.equal(h.run("storageError"), false);
  assert.equal(h.run("canRunAI()"), true);
});
test("fresh recovery needs explicit confirmation and keeps the unreadable original in both slots", () => {
  const h = domHarness(dir, { legacyRaw: "{OLD-ORIGINAL" });
  h.click("storage-new");
  assert.match(h.app.innerHTML, /确认建立新进度/);
  assert.equal(h.storage.get(key), undefined);
  h.click("close");
  assert.equal(h.storage.get(key), undefined);
  h.click("storage-new");
  h.click("confirm-new-progress");
  assert.deepEqual(JSON.parse(h.storage.get(key)), freshSave());
  assert.equal(h.storage.get(old), "{OLD-ORIGINAL");
  assert.equal(h.storage.get(key + ".recovery"), "{OLD-ORIGINAL");
  assert.equal(h.run("hasSaveProblem()"), false);
});
test("a failed original-backup write cannot replace progress during recovery", () => {
  const h = domHarness(dir, { legacyRaw: "{PROTECT" });
  h.ctx.localStorage.setItem = (k, v) => {
    if (k.endsWith(".recovery")) throw Error("quota");
    h.storage.set(k, v);
  };
  const before = h.run("JSON.stringify(save)");
  h.click("storage-new");
  h.click("confirm-new-progress");
  assert.equal(h.run("JSON.stringify(save)"), before);
  assert.equal(h.storage.get(key), undefined);
  assert.equal(h.storage.get(old), "{PROTECT");
  assert.equal(h.run("storageBlocked"), true);
});
test("recovery gate allows a valid explicitly confirmed imported backup", () => {
  const h = domHarness(dir, { legacyRaw: "{OLD" });
  h.run(
    "importCandidate=freshSave();importCandidate.nickname='Restored';modal='replace-import';render()",
  );
  h.click("confirm-import");
  assert.equal(h.run("hasSaveProblem()"), false);
  assert.equal(JSON.parse(h.storage.get(key)).nickname, "Restored");
  assert.equal(h.storage.get(key + ".recovery"), "{OLD");
});
test("opening rerenders preserve the scrolled lower row in the same match", () => {
  const h = domHarness(dir);
  h.run("start('SCROLL-OPENING')");
  h.run(
    `var originalQuery=document.querySelector;var openingNode={scrollTop:210};document.querySelector=s=>s==='.opening-sheet'?openingNode:originalQuery(s);`,
  );
  h.click("opening-card", { index: "3" });
  assert.equal(h.run("openingNode.scrollTop"), 210);
  assert.equal(h.run("openingSelection[0]"), 3);
});
test("recovery confirmation stays above an unfinished opening overlay", () => {
  const h = domHarness(dir);
  h.run("start('PENDING-RECOVERY')");
  h.storage.set(key, "{BAD");
  h.windowEvents.storage({ key, newValue: "{BAD" });
  h.click("storage-new");
  assert.equal(h.run("modal"), "new-progress");
  assert.match(h.app.innerHTML, /modal-backdrop recovery-confirm/);
  assert.match(h.app.innerHTML, /确认建立新进度/);
  assert.doesNotMatch(h.app.innerHTML, /modal-backdrop storage-shield/);
  h.click("close");
  assert.match(h.app.innerHTML, /modal-backdrop storage-shield/);
});
for (const source of ["legacy", "current"])
  test(`initial read failure cannot turn the ${source} family progress into an empty new save`, () => {
    const saved = freshSave();
    saved.nickname = "ExistingFamily";
    saved.mastery["pep1-g1-s1-u1-q1"] = {
      seen: 4,
      correct: 3,
      streak: 1,
      last: 10,
      due: 86400010,
    };
    const raw = JSON.stringify(saved);
    const h = domHarness(dir, {
      ...(source === "legacy" ? { legacyRaw: raw } : { raw }),
      failReads: true,
    });
    assert.equal(h.run("storageReadPending"), true);
    assert.equal(h.run("storageBlocked"), true);
    assert.doesNotMatch(h.app.innerHTML, /data-action="storage-new"/);
    h.click("start");
    h.click("storage-new");
    assert.equal(h.run("modal"), null);
    h.run('importCandidate=freshSave();modal="replace-import"');
    h.click("confirm-import");
    assert.equal(h.storage.get(source === "legacy" ? old : key), raw);
    if (source === "legacy") assert.equal(h.storage.get(key), undefined);
    h.run("modal=null");
    h.ctx.localStorage.getItem = (k) => h.storage.get(k);
    h.click("storage-retry");
    assert.deepEqual(JSON.parse(h.storage.get(key)), saved);
    assert.equal(h.run("save.nickname"), "ExistingFamily");
    assert.equal(h.run("storageReadPending"), false);
    assert.equal(h.run("hasSaveProblem()"), false);
  });
test("a recovered initial read can establish that both generations are genuinely absent", () => {
  const h = domHarness(dir, { failReads: true });
  h.ctx.localStorage.getItem = (k) => h.storage.get(k);
  h.click("storage-retry");
  assert.equal(h.run("hasSaveProblem()"), false);
  assert.equal(h.run("storageReadPending"), false);
  h.click("start");
  assert.equal(JSON.parse(h.storage.get(key)).match.rules, RULES);
});
test("a failure only while reading the legacy key after ownership is still an unread state", () => {
  const saved = freshSave();
  saved.nickname = "ExistingFamily";
  saved.mastery["pep1-g1-s1-u1-q1"] = {
    seen: 4,
    correct: 3,
    streak: 1,
    last: 10,
    due: 86400010,
  };
  const raw = JSON.stringify(saved),
    h = domHarness(dir, { legacyRaw: raw, failReads: [old] });
  assert.equal(h.run("storageReadPending"), true);
  assert.equal(h.run("storageBlocked"), true);
  h.click("storage-retry");
  assert.equal(h.storage.get(key), undefined);
  assert.equal(h.storage.get(old), raw);
  h.ctx.localStorage.getItem = (k) => h.storage.get(k);
  h.click("storage-retry");
  assert.deepEqual(JSON.parse(h.storage.get(key)), saved);
  assert.equal(h.run("hasSaveProblem()"), false);
  assert.equal(h.storage.get(old), raw);
});
