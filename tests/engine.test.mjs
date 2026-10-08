import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { CARDS, CARD, DECKS, OPPONENTS, RULES } from "../src/cards.mjs";
import {
  rng,
  shuffle,
  createMatch,
  legalActions,
  act,
  ritual,
  chooseAI,
  findLethal,
  findSafeLine,
  publicLethalThreat,
  scoreMatch,
} from "../src/engine.mjs";
import {
  freshSave,
  validateSave,
  validateMatch,
  recordLearning,
  questionFor,
  addRecord,
} from "../src/learning.mjs";
const Q = JSON.parse(
  fs.readFileSync(new URL("../src/questions.json", import.meta.url)),
);
const unit = (id, uid, ready = true) => ({
  uid,
  cardId: id,
  atk: CARD[id].atk,
  hp: CARD[id].hp,
  maxHp: CARD[id].hp,
  ready,
});
const state = () => {
  const s = createMatch();
  s.players[0].hand = [];
  s.players[1].hand = [];
  s.players[0].mana = s.players[0].maxMana = 6;
  s.players[1].mana = s.players[1].maxMana = 6;
  return s;
};
test("432 questions have complete, unique, well-formed content", () => {
  assert.equal(Q.length, 432);
  assert.equal(new Set(Q.map((q) => q.id)).size, 432);
  for (let g = 1; g <= 6; g++) {
    assert.equal(Q.filter((q) => q.grade === g).length, 72);
    for (const [type, count] of [
      ["word", g === 1 ? 48 : 36],
      ["sentence", g === 1 ? 24 : g === 2 ? 24 : 12],
      ["cloze", g === 1 ? 0 : g === 2 ? 12 : 24],
    ])
      assert.equal(
        Q.filter((q) => q.grade === g && q.type === type).length,
        count,
      );
  }
  for (const q of Q) {
    assert.equal(new Set(q.options.map((o) => o.toLowerCase())).size, 3);
    assert.ok(q.options[q.answer]);
    assert.ok(q.prompt && q.explanation && q.speak && q.target && q.listen);
    assert.match(q.unitId, /^g[1-6]-s[12]-u[1-6]$/);
    assert.ok(q.sourcePages.pdf.length && q.sourcePages.printed.length);
    assert.equal(q.contentVersion, "pep1-2026.1");
    assert.ok(Number.isInteger(q.answer));
  }
});
test("same seed produces same decks and question sequence", () => {
  const a = createMatch({ seed: "SAME" }),
    b = createMatch({ seed: "SAME" });
  assert.deepEqual(a.players, b.players);
  assert.equal(questionFor(a, Q).id, questionFor(b, Q).id);
  b.questionIndex++;
  assert.notEqual(questionFor(a, Q).id, questionFor(b, Q).id);
});
test("all decks contain exactly 20 valid cards", () => {
  assert.equal(CARDS.length, 24);
  for (const d of DECKS) {
    assert.equal(d.ids.length, 20);
    assert.ok(d.ids.every((id) => CARD[id]));
  }
});
test("insufficient mana cannot play; mutation-free rejection", () => {
  const s = state();
  s.players[0].mana = 1;
  s.players[0].hand = ["dragon"];
  assert.equal(act(s, { type: "play", index: 0 }), s);
});
test("summoned unit sleeps, rush unit can act immediately", () => {
  let s = state();
  s.players[0].hand = ["sprout", "rabbit"];
  s = act(s, { type: "play", index: 0 });
  assert.equal(s.players[0].board[0].ready, false);
  s = act(s, { type: "play", index: 0 });
  assert.equal(s.players[0].board[1].ready, true);
  assert.equal(s.players[0].mana, 4);
});
test("full board rejects fifth summon", () => {
  const s = state();
  s.players[0].hand = ["sprout"];
  s.players[0].board = Array.from({ length: 4 }, (_, i) =>
    unit("sprout", "a" + i),
  );
  assert.equal(act(s, { type: "play", index: 0 }), s);
});
test("guard constrains attacks but not damage spells", () => {
  let s = state();
  s.players[0].board = [unit("dragon", "a")];
  s.players[1].board = [unit("turtle", "b"), unit("sprout", "c")];
  s.players[0].hand = ["spark"];
  assert.ok(
    !legalActions(s).some((a) => a.type === "attack" && a.target === "hero"),
  );
  assert.ok(
    legalActions(s).some((a) => a.type === "play" && a.target === "hero"),
  );
  assert.equal(act(s, { type: "attack", uid: "a", target: "c" }), s);
});
test("combat is simultaneous and deceased units disappear", () => {
  let s = state();
  s.players[0].board = [unit("fox", "a")];
  s.players[1].board = [unit("fox", "b")];
  s = act(s, { type: "attack", uid: "a", target: "b" });
  assert.equal(s.players[0].board.length, 0);
  assert.equal(s.players[1].board.length, 0);
});
test("armor absorbs damage before hero health", () => {
  let s = state();
  s.players[0].board = [unit("dragon", "a")];
  s.players[1].armor = 3;
  s = act(s, { type: "attack", uid: "a", target: "hero" });
  assert.equal(s.players[1].armor, 0);
  assert.equal(s.players[1].hp, 16);
});
test("unit cannot attack twice in a turn", () => {
  let s = state();
  s.players[0].board = [unit("fox", "a")];
  s = act(s, { type: "attack", uid: "a", target: "hero" });
  assert.equal(act(s, { type: "attack", uid: "a", target: "hero" }), s);
});
test("end turn increments resources, draws and grows on return", () => {
  let s = state();
  s.players[0].board = [unit("sprite", "a", false)];
  s = act(s, { type: "end" });
  s = act(s, { type: "end" });
  assert.equal(s.players[0].board[0].atk, 2);
  assert.equal(s.players[0].board[0].ready, true);
  assert.equal(s.players[0].mana, 6);
});
test("healing never exceeds 18", () => {
  let s = state();
  s.players[0].hp = 17;
  s.players[0].hand = ["bloom"];
  s = act(s, { type: "play", index: 0 });
  assert.equal(s.players[0].hp, 18);
});
test("fatigue escalates, ends matches and prevents later actions", () => {
  let s = state();
  s.players[1].deck = [];
  s.players[1].hp = 1;
  s = act(s, { type: "end" });
  assert.equal(s.winner, 0);
  assert.equal(s.phase, "finished");
  assert.equal(legalActions(s).length, 0);
});
test("correct ritual heals, wrong ritual shields, repeats ignored", () => {
  let s = state();
  s.players[0].hp = 10;
  s = ritual(s, "bloom", true);
  assert.equal(s.players[0].hp, 13);
  assert.equal(ritual(s, "spark", true), s);
  let w = ritual(state(), "spark", false);
  assert.equal(w.players[0].armor, 1);
  assert.equal(w.players[1].hp, 18);
});
test("invalid ritual targets do not consume a use", () => {
  const s = state();
  assert.equal(ritual(s, "spark", true, "missing"), s);
});
test("AI takes lethal attack and never reads hidden card identity", () => {
  const s = state();
  s.active = 1;
  s.players[1].board = [unit("dragon", "a")];
  s.players[0].hp = 4;
  for (const style of ["aggro", "control", "value"])
    assert.deepEqual(chooseAI(s, style), {
      type: "attack",
      uid: "a",
      target: "hero",
    });
  const b = structuredClone(s);
  s.players[0].hand = ["dragon"];
  b.players[0].hand = ["bloom"];
  assert.deepEqual(chooseAI(s, "control"), chooseAI(b, "control"));
});
test("AI respects mandatory guard targets", () => {
  const s = state();
  s.players[1].ritualsLeft = 0;
  s.active = 1;
  s.players[1].board = [unit("dragon", "a")];
  s.players[0].board = [unit("turtle", "b")];
  s.players[0].hp = 1;
  const action = chooseAI(s, "aggro");
  assert.deepEqual(action, { type: "attack", uid: "a", target: "b" });
});
test("storage roundtrip maintains exact progress, invalid imports rejected", () => {
  const save = freshSave();
  save.match = createMatch();
  recordLearning(save, Q[0], true, 1000);
  const round = validateSave(JSON.parse(JSON.stringify(save)), Q);
  assert.deepEqual(round, save);
  assert.throws(() => validateSave({ schema: 2 }, Q));
  const bad = structuredClone(save);
  bad.match.players[0].mana = 900;
  assert.throws(() => validateSave(bad, Q));
  assert.equal(save.match.players[0].mana, 1);
});
test("learning intervals increase and mistakes reset streak", () => {
  const s = freshSave();
  recordLearning(s, Q[0], true, 0);
  assert.equal(s.mastery[Q[0].id].due, 86400000);
  recordLearning(s, Q[0], true, 86400001);
  assert.equal(s.mastery[Q[0].id].streak, 2);
  recordLearning(s, Q[0], false, 2);
  assert.equal(s.mastery[Q[0].id].streak, 0);
  assert.equal(s.mastery[Q[0].id].due, 2);
});
test("completed records written once, ongoing games never ranked", () => {
  const s = createMatch(),
    save = freshSave();
  assert.equal(addRecord(save, s), false);
  s.phase = "finished";
  s.winner = 0;
  assert.equal(addRecord(save, s), true);
  assert.equal(addRecord(save, s), false);
  assert.equal(save.records.length, 1);
  assert.equal(save.records[0].score, scoreMatch(s));
});
test("120 rule-only simulations terminate legally (player rituals intentionally absent)", () => {
  const results = { win: 0, loss: 0, draw: 0, maxTurns: 0 };
  for (let n = 0; n < 120; n++) {
    let s = createMatch({
      seed: "SIM" + n,
      grade: (n % 6) + 1,
      deckId: DECKS[n % 3].id,
      opponentId: OPPONENTS[n % 3].id,
    });
    let moves = 0;
    while (s.phase === "playing" && moves < 1000) {
      const style = s.active === 0 ? "control" : OPPONENTS[n % 3].style;
      const a = chooseAI(s, style);
      assert.ok(
        legalActions(s).some((x) => JSON.stringify(x) === JSON.stringify(a)),
      );
      const old = s;
      s = act(s, a);
      assert.notEqual(s, old);
      moves++;
    }
    assert.equal(s.phase, "finished", `seed SIM${n} stalled`);
    assert.ok(validateMatch(s));
    results[s.winner === 0 ? "win" : s.winner === 1 ? "loss" : "draw"]++;
    results.maxTurns = Math.max(results.maxTurns, s.turn);
  }
  console.log("SIMULATION", JSON.stringify(results));
});
test("unsafe and duplicate imported unit IDs are rejected", () => {
  const save = freshSave();
  save.match = state();
  save.match.seq = 2;
  save.match.players[0].board = [unit("fox", "u2")];
  assert.ok(validateSave(save, Q));
  save.match.players[0].board[0].uid = 'u2" onpointerenter="alert(1)';
  assert.throws(() => validateSave(save, Q));
  save.match.players[0].board = [unit("fox", "u2"), unit("fox", "u2")];
  assert.throws(() => validateSave(save, Q));
});
test("same-day repeated practice cannot create mastery", () => {
  const s = freshSave();
  recordLearning(s, Q[0], true, 1000);
  recordLearning(s, Q[0], true, 2000);
  recordLearning(s, Q[0], true, 3000);
  assert.equal(s.mastery[Q[0].id].streak, 1);
});
test("AI values lifesaving healing monotonically near critical HP", () => {
  const s = state();
  s.active = 1;
  s.players[1].hp = 6;
  s.players[1].mana = 2;
  s.players[1].hand = ["bloom"];
  s.players[0].board = [unit("dragon", "u1"), unit("rabbit", "u2")];
  for (const style of ["aggro", "control", "value"])
    assert.deepEqual(chooseAI(s, style), { type: "play", index: 0 });
});
test("legacy learning and scores survive audio preference migration", () => {
  const old = freshSave();
  delete old.music;
  delete old.musicVolume;
  delete old.soundVolume;
  old.sound = false;
  old.match = createMatch({ seed: "LEGACY" });
  recordLearning(old, Q[0], true);
  const next = validateSave(old, Q);
  assert.equal(next.match.seed, "LEGACY");
  assert.deepEqual(next.mastery, old.mastery);
  assert.equal(next.music, true);
  assert.equal(next.sound, true);
  assert.equal(next.musicVolume, 35);
});
test("every grade, book and unit gives exactly its declared question range", () => {
  for (let grade = 1; grade <= 6; grade++) {
    for (const course of [
      "all",
      "s1",
      "s2",
      ...Array.from(
        { length: 12 },
        (_, i) => `s${1 + Math.floor(i / 6)}-u${1 + (i % 6)}`,
      ),
    ]) {
      const count = course === "all" ? 72 : course.length === 2 ? 36 : 6;
      const s = createMatch({ grade, course, seed: "SCOPE" });
      const ids = new Set();
      for (let i = 0; i < count; i++) {
        s.questionIndex = i;
        const q = questionFor(s, Q);
        assert.equal(q.grade, grade);
        ids.add(q.id);
        if (course !== "all") assert.equal(q.semester, Number(course[1]));
        if (course.length > 2 && course !== "all")
          assert.equal(q.unitId, `g${grade}-${course}`);
      }
      assert.equal(ids.size, count);
      s.questionIndex = count;
      assert.ok(ids.has(questionFor(s, Q).id));
    }
  }
});
test("curriculum metadata covers each question and six original tasks per unit", () => {
  const map = JSON.parse(
    fs.readFileSync(new URL("../src/curriculum.json", import.meta.url)),
  );
  assert.equal(map.books.length, 12);
  assert.equal(map.units.length, 72);
  for (const u of map.units)
    assert.equal(Q.filter((q) => q.unitId === u.id).length, 6);
  for (const q of Q) {
    const u = map.units.find((u) => u.id === q.unitId);
    assert.equal(u.grade, q.grade);
    assert.equal(u.semester, q.semester);
    assert.deepEqual(q.sourcePages.pdf, u.pdf_pages);
    assert.ok(!/___/.test(q.listen));
    assert.ok(!/[\u3400-\u9fff]/.test(q.speak));
  }
});
test("twenty-four cards have distinct illustration slots without changing old combat attributes", () => {
  assert.equal(new Set(CARDS.map((c) => c.art)).size, 24);
  assert.equal(CARD.golem.atk, 4);
  assert.equal(CARD.golem.hp, 7);
});
test("new rituals use a finite shared rule for player and computer", () => {
  let s = createMatch({ seed: "RUNES" });
  for (let i = 0; i < 4; i++) {
    const before = s.players[0].ritualsLeft;
    s = ritual(s, "spark", i % 2 === 0, "hero");
    assert.equal(s.players[0].ritualsLeft, before - 1);
    s = act(s, { type: "end" });
    s = act(s, { type: "end" });
  }
  assert.equal(s.players[0].ritualsLeft, 0);
  assert.equal(ritual(s, "spark", true), s);
  let n = createMatch({ seed: "BOT-RUNES" });
  assert.equal(act(n, { type: "power", kind: "spark", target: "hero" }), n);
  n = act(n, { type: "end" });
  const once = act(n, { type: "power", kind: "spark", target: "hero" });
  assert.equal(once.players[1].ritualsLeft, 3);
  assert.equal(once.players[0].hp, 16);
  assert.equal(
    act(once, { type: "power", kind: "spark", target: "hero" }),
    once,
  );
});
test("full health and full hand cannot waste a new player ritual", () => {
  const s = createMatch();
  assert.equal(ritual(s, "bloom", true), s);
  s.players[0].hand = Array(7).fill("sprout");
  assert.equal(ritual(s, "insight", true), s);
});
test("legacy battles retain their resource rules and original score calculation", () => {
  const s = createMatch();
  s.rules = "1.0";
  delete s.players[0].ritualsLeft;
  delete s.players[1].ritualsLeft;
  let n = s;
  for (let i = 0; i < 5; i++) {
    n.players[0].ritualUsed = false;
    n = ritual(n, "spark", false);
  }
  assert.equal(n.players[0].armor, 5);
  n.active = 1;
  assert.ok(!legalActions(n).some((a) => a.type === "power"));
  const before = scoreMatch(n);
  n.correct++;
  assert.equal(scoreMatch(n) - before, 45);
  const current = createMatch();
  const v = scoreMatch(current);
  current.correct = 4;
  assert.equal(scoreMatch(current), v);
  assert.equal(
    validateSave({ ...freshSave(), match: s }, Q).match.rules,
    "1.0",
  );
});
test("powers can bypass guard while attacks must still target it", () => {
  const s = state();
  s.active = 1;
  s.players[1].board = [unit("dragon", "u1")];
  s.players[0].board = [unit("turtle", "u2")];
  assert.ok(
    legalActions(s).some((a) => a.type === "power" && a.target === "hero"),
  );
  assert.ok(
    !legalActions(s).some((a) => a.type === "attack" && a.target === "hero"),
  );
});
function tacticalState() {
  const s = createMatch({ seed: "TACTICS" });
  s.active = 1;
  s.seq = 100;
  for (const p of s.players)
    Object.assign(p, {
      hp: 18,
      armor: 0,
      hand: [],
      board: [],
      mana: 6,
      maxMana: 6,
      ritualsLeft: 0,
      deck: ["sprout", "sprout", "sprout"],
    });
  return s;
}
for (const style of ["aggro", "control", "value"]) {
  test(`${style} prevents a public nine-damage lethal with guard, not insufficient armor`, () => {
    const s = tacticalState();
    s.players[1].hp = 6;
    s.players[1].mana = 3;
    s.players[1].hand = ["owl", "turtle"];
    s.players[0].board = [unit("golem", "u1"), unit("dragon", "u2")];
    assert.equal(
      publicLethalThreat(act(s, { type: "play", index: 0 }), 1),
      true,
    );
    assert.equal(
      publicLethalThreat(act(s, { type: "play", index: 1 }), 1),
      false,
    );
    assert.deepEqual(chooseAI(s, style), { type: "play", index: 1 });
    s.players[0].ritualsLeft = 1;
    assert.equal(
      publicLethalThreat(act(s, { type: "play", index: 1 }), 1),
      true,
    );
  });
  test(`${style} finds a three-action guard-clearing lethal`, () => {
    let s = tacticalState();
    s.players[0].hp = 5;
    s.players[0].board = [{ ...unit("turtle", "u1"), hp: 4 }];
    s.players[1].board = [
      unit("rabbit", "u2"),
      unit("fox", "u3"),
      unit("dragon", "u4"),
    ];
    assert.equal(findLethal(s).length, 3);
    for (let i = 0; i < 3; i++) s = act(s, chooseAI(s, style));
    assert.equal(s.winner, 1);
  });
  test(`${style} cannot foresee deck order or play unknown future draws`, () => {
    const s = tacticalState();
    s.players[1].mana = 5;
    s.players[1].hand = ["moon", "owl"];
    s.players[0].hp = 3;
    s.players[1].deck = ["spark", "bloom", "sprout"];
    const b = structuredClone(s);
    b.players[1].deck = ["bloom", "sprout", "spark"];
    assert.equal(findLethal(s), null);
    assert.deepEqual(chooseAI(s, style), chooseAI(b, style));
    assert.deepEqual(s.players[1].deck, ["spark", "bloom", "sprout"]);
  });
}

for (const style of ["aggro", "control", "value"])
  test(`${style} can sacrifice then clear a threat and open a guard slot`, () => {
    let s = tacticalState();
    s.players[1].hp = 1;
    s.players[1].hand = ["turtle", "turtle"];
    s.players[1].board = [
      unit("sprout", "u1"),
      unit("sprout", "u2"),
      unit("owl", "u3"),
      unit("owl", "u4"),
    ];
    s.players[0].board = [unit("dragon", "u5"), unit("dragon", "u6")];
    assert.equal(publicLethalThreat(s, 1), true);
    const line = findSafeLine(s);
    assert.ok(line && line.length <= 4);
    for (let i = 0; i < 6 && publicLethalThreat(s, 1); i++) {
      const a = chooseAI(s, style);
      assert.notEqual(a.type, "end");
      s = act(s, a);
    }
    assert.equal(publicLethalThreat(s, 1), false);
    assert.ok(s.players[1].board.some((u) => u.cardId === "turtle"));
  });
test("same-day correction leaves the urgent queue without granting a mastery stage", () => {
  const save = freshSave();
  const t = new Date(2026, 9, 6, 12).getTime();
  recordLearning(save, Q[0], false, t);
  recordLearning(save, Q[0], true, t + 1000);
  assert.equal(save.mastery[Q[0].id].streak, 0);
  assert.equal(save.mastery[Q[0].id].due, t + 1000 + 86400000);
  recordLearning(save, Q[0], true, t + 2000);
  assert.equal(save.mastery[Q[0].id].streak, 0);
  recordLearning(save, Q[0], true, t + 86400000);
  assert.equal(save.mastery[Q[0].id].streak, 1);
  recordLearning(save, Q[0], false, t + 86400001);
  assert.equal(save.mastery[Q[0].id].due, t + 86400001);
  assert.equal(save.mastery[Q[0].id].streak, 0);
});
