import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { questionVisual, PICTURE_SHEETS } from "../src/learning-visuals.mjs";
const Q = JSON.parse(
  fs.readFileSync(new URL("../src/questions.json", import.meta.url)),
);
test("all48 grade1 word meanings have a visual; sentence and older grade tasks stay unchanged", () => {
  const words = Q.filter((q) => q.grade === 1 && q.type === "word");
  assert.equal(words.length, 48);
  assert.ok(words.every((q) => questionVisual(q).length > 0));
  assert.ok(
    Q.filter((q) => q.grade !== 1 || q.type !== "word").every(
      (q) => questionVisual(q) === "",
    ),
  );
});
test("dictionary crop regions cover40 distinct objects with valid original bounds", () => {
  const words = PICTURE_SHEETS.flatMap((s) => s.words);
  assert.equal(words.length, 40);
  assert.equal(new Set(words).size, 40);
  for (const s of PICTURE_SHEETS) {
    assert.equal(s.rows[0], 0);
    assert.equal(s.rows.at(-1), s.height);
    assert.equal(s.words.length, s.columns * (s.rows.length - 1));
    assert.ok(s.rows.every((x, i) => i === 0 || x > s.rows[i - 1]));
    assert.ok(
      fs.statSync(new URL("../dist/assets/learning/" + s.file, import.meta.url))
        .size > 0,
    );
  }
  const under = Q.find((q) => q.grade === 1 && q.target === "under");
  assert.ok(questionVisual(under).includes("看看红球的位置"));
});
