import test from "node:test";
import assert from "node:assert/strict";
import { CARDS, CARD, DECKS, PRACTICE_DECK, RULES } from "../src/cards.mjs";
import {
  createMatch,
  act,
  ritual,
  legalActions,
  chooseAI,
  findLethal,
  evaluate,
} from "../src/engine.mjs";
import { validateMatch } from "../src/learning.mjs";
import { openingPending } from "../src/opening.mjs";
import {
  createDuel,
  chooseComputer,
  publicEvent,
} from "../server/duel-adapter.mjs";
import { selectDifficulty } from "../src/combat-rating.mjs";
import * as old from "./fixtures/rules21/engine.mjs";
const unit = (id, uid, shield = false) => ({
  uid,
  cardId: id,
  atk: CARD[id].atk,
  hp: CARD[id].hp,
  maxHp: CARD[id].hp,
  ready: true,
  ...(shield ? { shield: true } : {}),
});
function state() {
  const s = createMatch();
  s.seq = 100;
  for (const p of s.players)
    Object.assign(p, {
      mana: 6,
      maxMana: 6,
      hand: [],
      board: [],
      ritualsLeft: 4,
    });
  return s;
}
test("36 cards use four explicit elements, at most one keyword and all three legacy decks remain valid", () => {
  assert.equal(CARDS.length, 36);
  assert.equal(new Set(CARDS.map((c) => c.id)).size, 36);
  assert.ok(
    CARDS.every((c) =>
      ["fire", "water", "nature", "arcane"].includes(c.element),
    ),
  );
  assert.ok(
    CARDS.every(
      (c) => c.keyword === undefined || typeof c.keyword === "string",
    ),
  );
  for (const d of [...DECKS, PRACTICE_DECK]) {
    assert.equal(d.ids.length, 20);
    assert.ok(d.ids.every((id) => CARD[id]));
  }
  assert.equal(CARD.otter.keyword, "barrier");
  assert.equal(CARD.boar.keyword, "rally");
});
test("barrier blocks exactly the first positive spell/ritual/combat damage and still retaliates", () => {
  let s = state();
  s.players[0].hand = ["otter"];
  s = act(s, { type: "play", index: 0 });
  const otter = s.players[0].board[0];
  assert.equal(otter.shield, true);
  s.active = 1;
  s.players[1].hand = ["spark"];
  let n = act(s, { type: "play", index: 0, target: otter.uid });
  assert.equal(n.players[0].board[0].hp, 2);
  assert.equal(n.players[0].board[0].shield, false);
  assert.equal(
    publicEvent(s, n, { type: "play", index: 0, target: otter.uid }, 1)
      .changes[0].shieldLost,
    true,
  );
  n.players[1].board = [unit("sprout", "u1")];
  n = act(n, { type: "attack", uid: "u1", target: otter.uid });
  assert.equal(n.players[0].board[0].hp, 1);
  assert.equal(n.players[1].board[0].hp, 1);
  const r = state();
  r.players[1].board = [unit("otter", "u1", true)];
  const r1 = ritual(r, "spark", true, "u1");
  assert.equal(r1.players[1].board[0].hp, 2);
  assert.equal(r1.players[1].board[0].shield, false);
  const a = state();
  a.players[0].board = [unit("otter", "u1", true)];
  a.players[1].board = [unit("dragon", "u2")];
  const a1 = act(a, { type: "attack", uid: "u1", target: "u2" });
  assert.equal(a1.players[0].board[0].hp, 2);
  assert.equal(a1.players[1].board[0].hp, 2);
  assert.equal(a.players[0].board[0].shield, true);
  assert.ok(validateMatch(a1));
});
test("rally buffs only other friendly units and tactical search finds a rally-enabled lethal", () => {
  const s = state();
  s.players[0].hand = ["boar"];
  s.players[0].board = [unit("rabbit", "u1")];
  s.players[1].hp = 3;
  s.players[0].ritualsLeft = 0;
  const n = act(s, { type: "play", index: 0 });
  assert.equal(n.players[0].board[0].atk, 3);
  assert.equal(n.players[0].board[1].atk, 3);
  assert.equal(n.players[0].board[1].ready, false);
  assert.equal(s.players[0].board[0].atk, 2);
  assert.deepEqual(findLethal(s), [
    { type: "play", index: 0 },
    { type: "attack", uid: "u1", target: "hero" },
  ]);
});
test("new spell magnitudes are used in effects and lethal bounds", () => {
  const s = state();
  s.players[0].hand = ["frost", "dew", "lantern"];
  s.players[1].hp = 5;
  s.players[0].hp = 10;
  assert.equal(act(s, { type: "play", index: 0, target: "hero" }).winner, 0);
  assert.equal(act(s, { type: "play", index: 1 }).players[0].hp, 13);
  assert.equal(act(s, { type: "play", index: 2 }).players[0].hand.length, 3);
  assert.deepEqual(findLethal(s), [{ type: "play", index: 0, target: "hero" }]);
});
test("easy preset fixes its foundation deck and ritual cadence without changing unit stats or resources", () => {
  const plan = selectDifficulty();
  const s = createDuel(["grove", "ember"], { computerSeat: 1, computer: plan });
  assert.deepEqual(
    [...s.players[1].hand, ...s.players[1].deck].sort(),
    [...PRACTICE_DECK.ids].sort(),
  );
  assert.equal(s.players[1].ritualsLeft, 4);
  assert.equal(s.players[1].hp, 18);
  s.active = 1;
  s.players[1].hand = [];
  s.players[1].board = [];
  s.players[1].mana = 0;
  for (const round of [1, 2, 4, 6]) {
    s.turn = round * 2;
    assert.equal(chooseComputer(s, 1, "aggro", true, plan).type, "end");
  }
  s.turn = 6;
  assert.equal(chooseComputer(s, 1, "aggro", true, plan).type, "power");
  s.players[1].ritualsLeft = 2;
  assert.equal(chooseComputer(s, 1, "aggro", true, plan).type, "end");
});
test("all difficulty levels ignore hidden hands and deck order and choose legal actions without mutation", () => {
  const s = state();
  s.active = 1;
  s.players[1].hand = ["boar", "firefly", "frost"];
  s.players[0].board = [unit("otter", "u1", true)];
  s.players[1].board = [unit("rabbit", "u2")];
  const hidden = structuredClone(s);
  hidden.players[0].hand = ["phoenix", "spark", "frost"];
  s.players[0].hand = ["bloom", "dew", "sprout"];
  hidden.players[0].deck.reverse();
  hidden.players[1].deck.reverse();
  for (const level of ["easy", "standard", "tactical"]) {
    const before = structuredClone(s),
      a = chooseAI(s, "aggro", level);
    assert.deepEqual(a, chooseAI(hidden, "aggro", level));
    assert.ok(
      legalActions(s).some((x) => JSON.stringify(x) === JSON.stringify(a)),
    );
    assert.deepEqual(s, before);
  }
});
test("2.1 saved opening and subsequent old-card transitions/AI retain their exact behavior", () => {
  assert.equal(RULES, "2.3");
  const pending = old.createMatch({ offerOpening: true });
  assert.equal(openingPending(pending), true);
  assert.ok(validateMatch(pending));
  assert.deepEqual(legalActions(pending), []);
  for (let seed = 0; seed < 3; seed++) {
    let s = old.createMatch({ seed: "compat21-" + seed });
    for (let turn = 0; turn < 12 && s.phase === "playing"; turn++) {
      assert.ok(validateMatch(s));
      assert.deepEqual(legalActions(s), old.legalActions(s));
      for (const style of ["aggro", "control", "value"]) {
        assert.equal(
          evaluate(s, s.active, style),
          old.evaluate(s, s.active, style),
        );
        assert.deepEqual(chooseAI(s, style), old.chooseAI(s, style));
      }
      const action = old.chooseAI(s, "control");
      assert.deepEqual(act(s, action), old.act(s, action));
      s = act(s, action);
    }
  }
});
