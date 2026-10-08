import test from "node:test";
import assert from "node:assert/strict";
import {
  freshCombatRating,
  normalizeCombatRating,
  normalizeDifficulty,
  selectDifficulty,
  recordCombatResult,
} from "../src/combat-rating.mjs";
const result = (id, outcome = "win", computer = selectDifficulty()) => ({
  id,
  result: outcome,
  reason: outcome === "draw" ? "draw" : "health",
  mode: "pve",
  assisted: false,
  computer,
});
test("first three adaptive games are easy, placement is provisional for five, and manual choices are explicit", () => {
  let p = freshCombatRating();
  assert.equal(selectDifficulty(p).tutorial, true);
  for (let n = 0; n < 5; n++) {
    const plan = selectDifficulty(p);
    if (n < 3) assert.equal(plan.level, "easy");
    assert.equal(plan.provisional, true);
    p = recordCombatResult(p, result("win-" + n));
  }
  assert.equal(selectDifficulty(p).provisional, false);
  assert.equal(selectDifficulty(p, "easy").level, "easy");
  assert.equal(selectDifficulty(p, "standard").level, "standard");
  assert.equal(normalizeDifficulty().mode, "fixed");
  assert.equal(normalizeDifficulty("__proto__").level, "tactical");
});
test("consecutive completed losses lower the next tier; no mid-game or learning input changes it", () => {
  const p = {
    ...freshCombatRating(),
    rating: 1200,
    games: 10,
    wins: 10,
    lastResultId: "old",
  };
  const plan = selectDifficulty(p);
  const after1 = recordCombatResult(p, result("loss-1", "loss", plan));
  const after2 = recordCombatResult(after1, result("loss-2", "loss", plan));
  assert.equal(plan.level, "tactical");
  assert.equal(selectDifficulty(after2).level, "standard");
  assert.equal(
    selectDifficulty({
      ...after2,
      losses: 4,
      wins: 8,
      games: 12,
      lossStreak: 4,
    }).level,
    "easy",
  );
  assert.deepEqual(
    selectDifficulty({ ...p, correct: 0, mastery: {} }),
    selectDifficulty({ ...p, correct: 900, mastery: { a: true } }),
  );
});
test("only natural unassisted computer finishes update; exits, human matches and duplicate receipts never farm rating", () => {
  const p = freshCombatRating();
  for (const reason of ["resigned", "abandoned", "expired", "server_error"])
    assert.deepEqual(recordCombatResult(p, { ...result("skip"), reason }), p);
  assert.deepEqual(
    recordCombatResult(p, { ...result("skip"), assisted: true }),
    p,
  );
  assert.deepEqual(
    recordCombatResult(p, { ...result("skip"), mode: "pvp" }),
    p,
  );
  assert.deepEqual(
    recordCombatResult(p, { ...result("skip"), computer: undefined }),
    p,
  );
  const next = recordCombatResult(p, result("done"));
  assert.equal(next.games, 1);
  assert.equal(next.rating, 724);
  assert.deepEqual(recordCombatResult(next, result("done")), next);
  assert.deepEqual(
    recordCombatResult(p, { ...result("done"), correct: 0 }),
    recordCombatResult(p, { ...result("done"), correct: 1000 }),
  );
});
test("rating data normalizes safely, K shrinks after placement and result metadata cannot invent a stronger opponent", () => {
  assert.deepEqual(
    normalizeCombatRating({ ...freshCombatRating(), rating: Infinity }),
    freshCombatRating(),
  );
  assert.deepEqual(
    normalizeCombatRating({ ...freshCombatRating(), games: 1 }),
    freshCombatRating(),
  );
  const established = { ...freshCombatRating(), games: 5, wins: 5 };
  assert.equal(recordCombatResult(established, result("win")).rating, 712);
  assert.equal(
    recordCombatResult(
      freshCombatRating(),
      result("win", "win", { level: "easy", opponentRating: 99999 }),
    ).rating,
    724,
  );
  assert.equal(
    normalizeDifficulty({ level: "easy", ritualLimit: 100 }).ritualLimit,
    2,
  );
});
