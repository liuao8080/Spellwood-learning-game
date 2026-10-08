import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createMatch,
  finishOpening,
  legalActions,
  act,
  ritual,
  chooseAI,
  evaluate,
  scoreMatch,
} from "../src/engine.mjs";
import { chooseMulligan, redeal, openingPending } from "../src/opening.mjs";
import { RULES, DECKS, OPPONENTS, hasFiniteRituals } from "../src/cards.mjs";
import {
  freshSave,
  validateSave,
  validateMatch,
  addRecord,
} from "../src/learning.mjs";
import * as old from "./fixtures/rules2/engine.mjs";
import { domHarness } from "./dom-harness.mjs";
const dir = fileURLToPath(new URL("../src", import.meta.url));
const Q = JSON.parse(
  fs.readFileSync(new URL("../src/questions.json", import.meta.url)),
);
const count = (a) => [...a].sort();
test("opening has four cards each, player one mana, and no legal battle actions before confirmation", () => {
  const s = createMatch({ offerOpening: true });
  assert.equal(openingPending(s), true);
  assert.equal(s.turn, 1);
  assert.equal(s.players[0].mana, 1);
  assert.equal(s.players[0].hand.length, 4);
  assert.equal(s.players[1].hand.length, 4);
  assert.deepEqual(legalActions(s), []);
  assert.equal(act(s, { type: "end" }), s);
  assert.equal(ritual(s, "spark", true, "hero"), s);
  assert.ok(validateMatch(s));
});
for (const indices of [[], [0], [3, 1]])
  test(`confirming ${indices.length} opening replacements is single-use and preserves resources`, () => {
    const s = createMatch({ seed: "OPEN-CONSERVE", offerOpening: true });
    const t = finishOpening(s, indices);
    assert.notEqual(t, s);
    assert.equal(openingPending(t), false);
    assert.equal(t.players[0].hand.length, 4);
    assert.equal(t.players[0].mana, 1);
    assert.equal(t.turn, 1);
    assert.equal(t.questionIndex, 0);
    assert.equal(t.players[0].ritualsLeft, 4);
    assert.deepEqual(
      count([...t.players[0].hand, ...t.players[0].deck]),
      count([...s.players[0].hand, ...s.players[0].deck]),
    );
    assert.deepEqual(t.players[1], s.players[1]);
    assert.equal(finishOpening(t, [0, 1]), t);
    assert.ok(validateMatch(t));
    const enemyTurn = act(t, { type: "end" });
    assert.equal(enemyTurn.players[1].hand.length, 5);
    assert.equal(enemyTurn.players[1].mana, 1);
  });
test("replacement is drawn before returned physical cards go back, and click order does not affect the result", () => {
  const h = ["A", "B", "C", "D"],
    d = ["E", "F", "G", "H"];
  const a = redeal(h, d, [2, 0], "seed", 0),
    b = redeal(h, d, [0, 2], "seed", 0);
  assert.deepEqual(a, b);
  assert.deepEqual(a.hand, ["E", "B", "F", "D"]);
  assert.deepEqual(count(a.deck), ["A", "C", "G", "H"]);
  assert.deepEqual(h, ["A", "B", "C", "D"]);
  assert.deepEqual(d, ["E", "F", "G", "H"]);
  assert.deepEqual(redeal(h, d, [], "seed", 0), { hand: h, deck: d });
});
test("invalid opening selections do not spend or change anything", () => {
  const s = createMatch({ offerOpening: true });
  for (const x of [null, "0", [0, 0], [0, 1, 2], [-1], [4], [1.5], ["1"]])
    assert.equal(finishOpening(s, x), s);
});
test("computer opening decisions use only its hand and have a modest style preference", () => {
  const hand = ["sprite", "sprite", "fox", "bloom"];
  assert.deepEqual(chooseMulligan(hand, "control"), [2, 3]);
  assert.deepEqual(chooseMulligan(hand, "value"), [1, 3]);
  const s = createMatch({ seed: "PRIVATE-OPEN", offerOpening: true });
  const a = finishOpening(s, [0]),
    b = finishOpening(s, [2, 3]);
  assert.deepEqual(a.opening.opponent, b.opening.opponent);
  assert.deepEqual(a.players[1], b.players[1]);
});
test("all decks conserve their twenty-card multiset across deterministic opening choices", () => {
  for (const deck of DECKS)
    for (const opponent of OPPONENTS)
      for (let n = 0; n < 12; n++) {
        const a = createMatch({
          deckId: deck.id,
          opponentId: opponent.id,
          seed: "MULTI-" + n,
          offerOpening: true,
        });
        const t = finishOpening(
          a,
          n % 3 === 0 ? [] : n % 3 === 1 ? [1] : [0, 3],
        );
        assert.deepEqual(
          count([...t.players[0].hand, ...t.players[0].deck]),
          count(deck.ids),
        );
        assert.deepEqual(
          count([...t.players[1].hand, ...t.players[1].deck]),
          count(DECKS.find((x) => x.id === opponent.deck).ids),
        );
        assert.ok(validateMatch(t));
      }
});
test("pending and completed opening saves survive import without redealing", () => {
  const s = freshSave();
  s.match = createMatch({ seed: "RESTORE-OPEN", offerOpening: true });
  const pending = validateSave(JSON.parse(JSON.stringify(s)), Q);
  assert.deepEqual(pending.match, s.match);
  s.match = finishOpening(s.match, [0, 2]);
  const done = validateSave(JSON.parse(JSON.stringify(s)), Q);
  assert.deepEqual(done.match, s.match);
  assert.equal(openingPending(done.match), false);
});
test("incomplete or impossible new-rule opening data is rejected instead of reinitialized", () => {
  const make = () => createMatch({ offerOpening: true });
  for (const corrupt of [
    (s) => delete s.opening,
    (s) => (s.opening.opponent = null),
    (s) => (s.opening.player = [0, 0]),
    (s) => (s.opening.opponent = [4]),
    (s) => (s.seq = 1),
    (s) => (s.players[0].hp = 17),
    (s) => s.players[1].hand.push("rabbit"),
    (s) => (s.attempts = 1),
    (s) => delete s.review,
  ]) {
    const s = make();
    corrupt(s);
    assert.equal(validateMatch(s), false);
  }
});
test("old rules2.0 retain exact legal actions, state transitions, values and AI choices", () => {
  let checked = 0;
  for (let n = 0; n < 8; n++) {
    let s = old.createMatch({
      seed: "COMPAT-" + n,
      deckId: DECKS[n % 3].id,
      opponentId: OPPONENTS[n % 3].id,
    });
    for (let i = 0; i < 10 && s.phase === "playing"; i++) {
      assert.deepEqual(legalActions(s), old.legalActions(s));
      for (const style of ["aggro", "control", "value"]) {
        assert.equal(
          evaluate(s, s.active, style),
          old.evaluate(s, s.active, style),
        );
        assert.deepEqual(chooseAI(s, style), old.chooseAI(s, style));
      }
      for (const a of old.legalActions(s))
        assert.deepEqual(act(s, a), old.act(s, a));
      assert.equal(scoreMatch(s), old.scoreMatch(s));
      assert.ok(validateMatch(s));
      const a = old.chooseAI(s, s.active ? "aggro" : "control");
      s = old.act(s, a);
      checked++;
    }
  }
  assert.ok(checked >= 60);
});
test("old finite and original unlimited ritual rules are distinct from the newest AI policy", () => {
  assert.equal(hasFiniteRituals("2.0"), true);
  assert.equal(hasFiniteRituals(RULES), true);
  assert.equal(hasFiniteRituals("1.0"), false);
  const s = old.createMatch({ seed: "OLD-POWERS" });
  s.players[0].ritualsLeft = 1;
  const t = ritual(s, "spark", false);
  assert.equal(t.players[0].ritualsLeft, 0);
  t.players[0].ritualUsed = false;
  assert.equal(ritual(t, "spark", true), t);
  const legacy = structuredClone(s);
  legacy.rules = "1.0";
  legacy.players[0].ritualsLeft = 0;
  assert.notEqual(ritual(legacy, "spark", true), legacy);
  const modern = createMatch();
  modern.players[0].board = [
    { uid: "u1", cardId: "rabbit", atk: 2, hp: 1, maxHp: 1, ready: true },
  ];
  modern.seq = 1;
  const previous = structuredClone(modern);
  previous.rules = "2.0";
  assert.ok(evaluate(modern, 1, "aggro") < evaluate(previous, 1, "aggro"));
  assert.equal(
    evaluate(modern, 1, "control"),
    evaluate(previous, 1, "control"),
  );
});
test("new-rule opening overlay blocks battle inputs and limits selection to two cards", () => {
  const h = domHarness(dir);
  h.run("start('UI-OPEN')");
  assert.equal(h.run("openingPending(save.match)"), true);
  const before = h.run("JSON.stringify(save.match)");
  h.click("end");
  h.click("ritual", { value: "spark" });
  assert.equal(h.run("JSON.stringify(save.match)"), before);
  h.click("opening-card", { index: "0" });
  h.click("opening-card", { index: "1" });
  h.click("opening-card", { index: "2" });
  assert.deepEqual([...h.run("openingSelection")], [0, 1]);
  h.click("opening-card", { index: "0" });
  assert.deepEqual([...h.run("openingSelection")], [1]);
  assert.ok(h.app.innerHTML.includes('aria-pressed="true"'));
});
test("opening confirm double click and reload cannot draw again or spend an extra turn", async () => {
  const h = domHarness(dir);
  h.run("start('UI-CONFIRM')");
  h.click("opening-card", { index: "1" });
  const p = h.run("confirmOpening()");
  const after = h.run("JSON.stringify(save.match)");
  h.click("opening-confirm");
  assert.equal(h.run("JSON.stringify(save.match)"), after);
  await h.settle(p);
  assert.equal(h.run("locked"), false);
  assert.equal(h.run("openingAnimation"), false);
  assert.equal(h.run("save.match.players[0].hand.length"), 4);
  const reloaded = domHarness(dir, { raw: h.storage.get("spellwood.save.v2") });
  assert.equal(reloaded.run("openingPending(save.match)"), false);
  assert.equal(reloaded.run("JSON.stringify(save.match)"), after);
});
test("leaving during the brief opening animation keeps the committed hand and removes the animation flag", async () => {
  const h = domHarness(dir);
  h.run("start('LEAVE-OPEN')");
  const p = h.run("confirmOpening()");
  const after = h.run("JSON.stringify(save.match)");
  h.click("home");
  await h.settle(p);
  assert.equal(h.run("view"), "lobby");
  assert.equal(h.run("openingAnimation"), false);
  assert.equal(h.run("JSON.stringify(save.match)"), after);
});
test("new and old finite rules occupy separate current and historical challenge lists", () => {
  const h = domHarness(dir);
  const s = old.createMatch({ seed: "OLD-RANK" });
  s.players[1].hp = 0;
  s.winner = 0;
  s.phase = "finished";
  const record = freshSave();
  addRecord(record, s);
  h.run(
    `save=validateSave(${JSON.stringify(record)},QUESTIONS);modal='ranks';render()`,
  );
  assert.equal((h.app.innerHTML.match(/class="rank-row"/g) || []).length, 0);
  h.click("rank-content", { value: "archive" });
  assert.equal((h.app.innerHTML.match(/class="rank-row"/g) || []).length, 1);
});
test("long supplied seeds are normalized before dealing so the stored seed reproduces the opening", () => {
  const a = createMatch({
      seed: "123456789012345678901234-extra",
      offerOpening: true,
    }),
    b = createMatch({ seed: "123456789012345678901234", offerOpening: true });
  assert.equal(a.seed, b.seed);
  assert.deepEqual(a.players, b.players);
  assert.deepEqual(a.opening, b.opening);
});
test("historical rules1.0 and2.0 are never ranked together in the selected history view", () => {
  const h = domHarness(dir);
  h.run(
    "for (const rule of ['1.0','2.0']) {const s=createMatch({seed:rule});s.rules=rule;s.players[1].hp=0;s.winner=0;s.phase='finished';addRecord(save,s)};modal='ranks';rankContent='archive';render()",
  );
  assert.equal((h.app.innerHTML.match(/class="rank-row"/g) || []).length, 1);
  assert.ok(h.app.innerHTML.includes("规则2.0"));
  h.run("rankHistoryRule='1.0';render()");
  assert.equal((h.app.innerHTML.match(/class="rank-row"/g) || []).length, 1);
  assert.ok(h.app.innerHTML.includes("规则1.0"));
});
