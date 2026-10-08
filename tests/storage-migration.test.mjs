import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { domHarness } from "./dom-harness.mjs";
import { freshSave } from "../src/learning.mjs";
import * as old from "./fixtures/rules2/engine.mjs";
const dir = fileURLToPath(new URL("../src", import.meta.url));
const oldKey = "spellwood.save.v1",
  key = "spellwood.save.v2";
function legacy() {
  const s = freshSave();
  s.nickname = "Earlier";
  s.grade = 6;
  s.match = old.createMatch({ grade: 6, seed: "KEEP-OLD-RULES" });
  return s;
}
test("first current page copies a valid older save exactly and retains the original bytes", () => {
  const s = legacy(),
    raw = JSON.stringify(s);
  const h = domHarness(dir, { legacyRaw: raw });
  assert.deepEqual(JSON.parse(h.storage.get(key)), s);
  assert.equal(h.storage.get(oldKey), raw);
  assert.equal(h.run("save.match.rules"), "2.0");
  assert.equal(h.run("openingPending(save.match)"), false);
  assert.match(
    h.run("document.querySelector('#toast').textContent"),
    /旧进度已复制/,
  );
});
test("new progress takes precedence and later legacy writes cannot overwrite or remigrate it", () => {
  const s = legacy(),
    current = freshSave();
  current.nickname = "Current";
  const raw = JSON.stringify(current);
  const h = domHarness(dir, { raw, legacyRaw: JSON.stringify(s) });
  assert.equal(h.run("save.nickname"), "Current");
  s.nickname = "LaterOldWrite";
  h.storage.set(oldKey, JSON.stringify(s));
  h.windowEvents.storage({ key: oldKey, newValue: JSON.stringify(s) });
  h.run("SESSION.change('active')");
  assert.equal(h.run("save.nickname"), "Current");
  assert.equal(h.storage.get(key), raw);
});
test("if another new page already migrated, acquiring ownership never copies over its changes", () => {
  const h = domHarness(dir);
  h.run('legacyMigrationNeeded=true;lastStoredRaw=""');
  const newer = freshSave();
  newer.nickname = "FirstNewWriter";
  h.storage.set(key, JSON.stringify(newer));
  h.storage.set(oldKey, JSON.stringify(legacy()));
  h.run("SESSION.change('active')");
  assert.equal(h.run("save.nickname"), "FirstNewWriter");
  assert.equal(h.run("legacyMigrationNeeded"), false);
});
test("a corrupt old save is retained and cannot be silently replaced by a new empty save", () => {
  const h = domHarness(dir, { legacyRaw: "{BROKEN-OLD" });
  assert.equal(h.storage.get(oldKey), "{BROKEN-OLD");
  assert.equal(h.storage.get(key), undefined);
  assert.equal(h.run("storageBlocked"), true);
  assert.equal(h.run("recoveryRaw"), "{BROKEN-OLD");
  h.run("persist()");
  assert.equal(h.storage.get(key), undefined);
  h.run(
    "importCandidate=freshSave();importCandidate.nickname='Restored';modal='replace-import'",
  );
  h.click("confirm-import");
  assert.equal(JSON.parse(h.storage.get(key)).nickname, "Restored");
  assert.equal(h.storage.get(oldKey), "{BROKEN-OLD");
});
test("failed migration write preserves the old file and retains its progress for export", () => {
  const raw = JSON.stringify(legacy());
  const h = domHarness(dir, { legacyRaw: raw, failWrites: true });
  assert.equal(h.storage.get(oldKey), raw);
  assert.equal(h.storage.get(key), undefined);
  assert.equal(h.run("save.nickname"), "Earlier");
  assert.equal(h.run("storageError"), true);
});
