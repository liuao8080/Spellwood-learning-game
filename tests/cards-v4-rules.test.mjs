import test from "node:test";
import assert from "node:assert/strict";
import {
  CARD,
  CARDS,
  DECKS,
  RULES,
  LEGACY_EXPANDED_RULES,
  hasOpening,
  hasFiniteRituals,
  isCardAvailable,
  validateCustomDeck,
} from "../src/cards.mjs";
import {
  createMatch,
  act,
  ritual,
  legalActions,
  chooseAI,
  ensureHandIds,
  effectiveCardCost,
  findLethal,
  rng,
  shuffle,
} from "../src/engine.mjs";
import { cardGuide } from "../src/card-guide.mjs";

const additions = CARDS.filter((c) => c.introducedRules === "2.3");
const unit = (id, uid, extra = {}) => ({
  uid,
  cardId: id,
  atk: CARD[id].atk,
  hp: CARD[id].hp,
  maxHp: CARD[id].hp,
  ready: true,
  ...extra,
});
function state(hand = []) {
  const s = createMatch({ seed: "CARDS-V4" });
  s.seq = 100;
  for (const p of s.players)
    Object.assign(p, {
      hp: 18,
      armor: 0,
      mana: 6,
      maxMana: 6,
      hand: [],
      handIds: [],
      board: [],
      deck: ["sprout", "fox", "turtle"],
      ritualsLeft: 0,
    });
  s.players[0].hand = [...hand];
  ensureHandIds(s);
  return s;
}
const plays = (s) => legalActions(s).filter((a) => a.type === "play");
const play = (s, index = 0, target) =>
  act(s, { type: "play", index, ...(target === undefined ? {} : { target }) });

test("36 free base cards preserve the old deck rules and twelve specified varied cards", () => {
  assert.equal(RULES, "2.3");
  assert.equal(LEGACY_EXPANDED_RULES, "2.2");
  assert.equal(CARDS.length, 36);
  assert.equal(new Set(CARDS.map((c) => c.id)).size, 36);
  assert.equal(additions.length, 12);
  assert.equal(additions.filter((c) => c.type !== "spell").length, 8);
  for (const c of additions) {
    assert.equal(typeof c.keyword, "string");
    assert.equal(isCardAvailable(c.id, "2.3"), true);
    assert.equal(c.artPath, `/assets/cards-v4/${c.id}.webp`);
    const guide = cardGuide(c.id);
    assert.equal(guide.rule, c.text);
    assert.equal(guide.cost, c.cost);
    assert.notEqual(
      guide.example,
      "先观察能量、伙伴位置和双方生命，再决定出牌。",
    );
    if (c.target?.includes("unit") && !c.target.startsWith("all"))
      assert.match(guide.target, /选择/);
  }
  for (const d of DECKS) assert.equal(validateCustomDeck(d.ids), true);
  assert.equal(
    validateCustomDeck([...DECKS[0].ids.slice(0, 19), "acorn_squirrel"]),
    true,
  );
  assert.equal(validateCustomDeck(Array(20).fill("acorn_squirrel")), false);
});

for (const rules of ["2.2", "2.1", "2.0", "1.0"])
  test(`${rules} keeps the legacy card catalog and resource rules`, () => {
    const s = state(["acorn_squirrel", "sprout"]);
    s.rules = rules;
    delete s.handSeq;
    for (const p of s.players) delete p.handIds;
    assert.equal(isCardAvailable("sprout", rules), true);
    assert.equal(isCardAvailable("acorn_squirrel", rules), false);
    assert.deepEqual(plays(s), [{ type: "play", index: 1 }]);
    const n = play(s, 1);
    assert.equal("handSeq" in n, false);
    assert.equal("handIds" in n.players[0], false);
    assert.equal(hasOpening(rules), ["2.2", "2.1"].includes(rules));
    assert.equal(hasFiniteRituals(rules), rules !== "1.0");
  });

for (const id of [
  "mushroom_medic",
  "reed_frog",
  "glass_snail",
  "ember_salamander",
])
  test(`${id}: explicit legal target, empty-board summon, full-board and energy rejection`, () => {
    const s = state([id]);
    const c = CARD[id];
    const empty = play(s);
    assert.notEqual(empty, s);
    assert.equal(empty.players[0].board[0].cardId, id);
    const friendly = ["mushroom_medic", "glass_snail"].includes(id);
    s.players[friendly ? 0 : 1].board = [
      unit("sprout", "u1", { hp: 1 }),
      unit("bear", "u2", { hp: 3 }),
    ];
    const legal = plays(s);
    assert.deepEqual(
      legal.map((a) => a.target),
      ["u1", "u2"],
    );
    assert.equal(play(s), s);
    assert.equal(play(s, 0, "hero"), s);
    assert.equal(play(s, 0, "missing"), s);
    s.players[friendly ? 1 : 0].board.push(unit("rabbit", "u3"));
    assert.equal(play(s, 0, "u3"), s);
    const snapshot = structuredClone(s);
    const n = play(s, 0, "u1");
    assert.notEqual(n, s);
    assert.deepEqual(s, snapshot);
    assert.equal(n.players[0].mana, 6 - c.cost);
    assert.equal(n.players[0].hand.length, 0);
    s.players[0].mana = c.cost - 1;
    assert.equal(play(s, 0, "u1"), s);
    s.players[0].mana = 6;
    s.players[0].board = Array.from({ length: 4 }, (_, i) =>
      unit("sprout", "u" + (10 + i), { hp: 1 }),
    );
    assert.equal(plays(s).length, 0);
    s.active = 1;
    assert.equal(play(s), s);
  });

test("medic heals only a living injured ally, caps healing and never picks a target implicitly", () => {
  const s = state(["mushroom_medic"]);
  s.players[0].board = [
    unit("bear", "u1", { hp: 2 }),
    unit("sprout", "u2"),
    unit("rabbit", "u3", { hp: 0 }),
  ];
  assert.deepEqual(plays(s), [{ type: "play", index: 0, target: "u1" }]);
  let n = play(s, 0, "u1");
  assert.equal(n.players[0].board[0].hp, 5);
  assert.equal(
    n.players[0].board.some((u) => u.uid === "u3"),
    false,
  );
  s.players[0].board[0].hp = 5;
  n = play(s, 0, "u1");
  assert.equal(n.players[0].board[0].hp, 6);
  s.players[0].board = [unit("sprout", "u1")];
  assert.notEqual(play(s), s);
});

test("frog reaches zero attack, remains weakened across turns, and zero attacks do not break shields", () => {
  let s = state(["reed_frog", "reed_frog"]);
  s.players[1].board = [unit("sprout", "u1")];
  s = play(s, 0, "u1");
  s = play(s, 0, "u1");
  assert.equal(s.players[1].board[0].atk, 0);
  s.players[0].board = [unit("otter", "u2", { shield: true })];
  s = act(s, { type: "end" });
  assert.equal(s.players[1].board[0].atk, 0);
  s = act(s, { type: "attack", uid: "u1", target: "u2" });
  assert.equal(s.players[0].board[0].shield, true);
  assert.equal(s.players[1].board[0].hp, 1);
  assert.equal(s.players[1].board[0].ready, false);
});

test("snail cannot stack shields or target itself and is summonable if all allies already have shields", () => {
  const s = state(["glass_snail"]);
  s.players[0].board = [
    unit("sprout", "u1", { shield: true }),
    unit("bear", "u2"),
  ];
  assert.deepEqual(plays(s), [{ type: "play", index: 0, target: "u2" }]);
  const n = play(s, 0, "u2");
  assert.equal(n.players[0].board[1].shield, true);
  assert.equal(n.players[0].board[2].shield, undefined);
  s.players[0].board[1].shield = true;
  assert.notEqual(play(s), s);
  assert.equal(play(s, 0, "u1"), s);
});

test("salamander bypasses guard but targets only enemy units, and shield blocks its entire arrival hit", () => {
  const s = state(["ember_salamander"]);
  s.players[1].board = [
    unit("turtle", "u1"),
    unit("otter", "u2", { shield: true }),
  ];
  const n = play(s, 0, "u2");
  assert.equal(n.players[1].board[1].hp, 2);
  assert.equal(n.players[1].board[1].shield, false);
  assert.equal(n.players[0].board[0].hp, 5);
  assert.equal(n.players[1].hp, 18);
  assert.equal(play(s, 0, "hero"), s);
});

test("thorn sweep resolves all shields and deaths together, each squirrel gives armor once", () => {
  let s = state(["thorn_sweep"]);
  s.players[1].board = [
    unit("otter", "u1", { shield: true }),
    unit("glass_snail", "u2", { shield: true }),
    unit("acorn_squirrel", "u3", { hp: 1 }),
    unit("acorn_squirrel", "u4", { hp: 1 }),
  ];
  s = play(s);
  assert.equal(s.players[1].board.length, 2);
  assert.equal(s.players[1].armor, 4);
  assert.deepEqual(
    s.players[1].board.map((u) => [u.hp, u.shield]),
    [
      [2, false],
      [4, false],
    ],
  );
  assert.equal(s.players[0].hp, 18);
  assert.equal(s.players[1].hp, 18);
  s = act(s, { type: "end" });
  assert.equal(s.players[1].armor, 4);
  const empty = state(["thorn_sweep"]);
  assert.equal(play(empty), empty);
  assert.equal(play(empty, 0, "hero"), empty);
});

test("simultaneous combat kills both squirrels and armor never revives a dead hero", () => {
  const s = state();
  s.players[0].board = [unit("acorn_squirrel", "u1", { hp: 1 })];
  s.players[1].board = [unit("acorn_squirrel", "u2", { hp: 1 })];
  const n = act(s, { type: "attack", uid: "u1", target: "u2" });
  assert.deepEqual(
    n.players.map((p) => [p.board.length, p.armor]),
    [
      [0, 2],
      [0, 2],
    ],
  );
  const dead = state(["thorn_sweep"]);
  dead.players[1].hp = 0;
  dead.players[1].board = [unit("acorn_squirrel", "u1", { hp: 1 })];
  const finished = play(dead);
  assert.equal(finished.players[1].hp, 0);
  assert.equal(finished.players[1].armor, 2);
  assert.equal(finished.winner, 0);
});

test("rain heals living allies together, caps at max HP, excludes heroes and requires an injured ally", () => {
  const s = state(["mending_rain"]);
  s.players[0].hp = 10;
  s.players[0].board = [
    unit("sprout", "u1", { hp: 1 }),
    unit("bear", "u2", { hp: 5 }),
    unit("rabbit", "u3", { hp: 0 }),
  ];
  s.players[1].board = [unit("bear", "u4", { hp: 1 })];
  const n = play(s);
  assert.deepEqual(
    n.players[0].board.map((u) => u.hp),
    [3, 6],
  );
  assert.equal(n.players[0].hp, 10);
  assert.equal(n.players[1].board[0].hp, 1);
  s.players[0].board = [unit("sprout", "u1")];
  assert.equal(play(s), s);
  s.players[0].board = [unit("sprout", "u1", { hp: 0 })];
  assert.equal(play(s), s);
});

test("blessing increases max HP before healing, works on full HP and never resurrects or changes readiness", () => {
  const s = state(["sunseed_blessing"]);
  s.players[0].board = [
    unit("storm_kingfisher", "u1", { hp: 1, ready: false }),
  ];
  let n = play(s, 0, "u1");
  assert.deepEqual(
    [
      n.players[0].board[0].hp,
      n.players[0].board[0].maxHp,
      n.players[0].board[0].ready,
    ],
    [3, 4, false],
  );
  s.players[0].board[0].hp = 2;
  n = play(s, 0, "u1");
  assert.equal(n.players[0].board[0].hp, 4);
  s.players[0].board[0].hp = 0;
  assert.equal(play(s, 0, "u1"), s);
  assert.equal(play(s, 0, "hero"), s);
  assert.equal(play(s), s);
});

test("badger armor counts other allies at arrival, with zero to three armor and unchanged hero HP", () => {
  for (let count = 0; count <= 3; count++) {
    const s = state(["sun_badger"]);
    s.players[0].board = Array.from({ length: count }, (_, i) =>
      unit("sprout", "u" + (i + 1)),
    );
    const n = play(s);
    assert.equal(n.players[0].armor, count);
    assert.equal(n.players[0].hp, 18);
  }
});

test("ram bonus is one shieldable active unit hit, never hero damage or retaliation", () => {
  const s = state();
  s.players[0].board = [unit("crystal_ram", "u1")];
  s.players[1].board = [unit("turtle", "u2")];
  let n = act(s, { type: "attack", uid: "u1", target: "u2" });
  assert.equal(n.players[1].board.length, 0);
  assert.equal(n.players[0].board[0].hp, 3);
  assert.equal(n.players[0].board[0].atk, 4);
  s.players[1].board = [unit("glass_snail", "u2", { shield: true })];
  n = act(s, { type: "attack", uid: "u1", target: "u2" });
  assert.equal(n.players[1].board[0].hp, 4);
  assert.equal(n.players[1].board[0].shield, false);
  s.players[1].board = [];
  n = act(s, { type: "attack", uid: "u1", target: "hero" });
  assert.equal(n.players[1].hp, 14);
  s.players[1].board = [unit("bear", "u2")];
  s.active = 1;
  n = act(s, { type: "attack", uid: "u2", target: "u1" });
  assert.equal(n.players[1].board[0].hp, 2);
});

test("kingfisher needs real hero HP damage, respects guards, and draws at most once per own turn", () => {
  const s = state();
  s.players[0].board = [unit("storm_kingfisher", "u1")];
  s.players[1].armor = 3;
  let n = act(s, { type: "attack", uid: "u1", target: "hero" });
  assert.equal(n.players[0].hand.length, 0);
  assert.equal(n.players[0].board[0].kingfisherDrawTurn, undefined);
  s.players[1].armor = 1;
  n = act(s, { type: "attack", uid: "u1", target: "hero" });
  assert.equal(n.players[1].hp, 16);
  assert.equal(n.players[0].hand.length, 1);
  assert.equal(n.players[0].board[0].kingfisherDrawTurn, n.turn);
  n.players[0].board[0].ready = true;
  n = act(n, { type: "attack", uid: "u1", target: "hero" });
  assert.equal(n.players[0].hand.length, 1);
  n = act(n, { type: "end" });
  n = act(n, { type: "end" });
  const count = n.players[0].hand.length;
  n = act(n, { type: "attack", uid: "u1", target: "hero" });
  assert.equal(n.players[0].hand.length, count + 1);
  s.players[1].board = [unit("turtle", "u2")];
  assert.equal(act(s, { type: "attack", uid: "u1", target: "hero" }), s);
});

test("kingfisher full-hand draw burns a card and empty-deck fatigue may lose or draw the match", () => {
  const full = state(Array(7).fill("sprout"));
  full.players[0].board = [unit("storm_kingfisher", "u1")];
  let n = act(full, { type: "attack", uid: "u1", target: "hero" });
  assert.equal(n.players[0].hand.length, 7);
  assert.equal(n.players[0].handIds.length, 7);
  assert.equal(n.players[0].deck.length, 2);
  for (const opponentHp of [18, 3]) {
    const s = state();
    s.players[0].hp = 1;
    s.players[0].deck = [];
    s.players[0].board = [unit("storm_kingfisher", "u1")];
    s.players[1].hp = opponentHp;
    n = act(s, { type: "attack", uid: "u1", target: "hero" });
    assert.equal(n.players[0].fatigue, 1);
    assert.equal(n.winner, opponentHp === 3 ? "draw" : 1);
  }
});

test("recall spends the spell first at seven-card hand, preserves unrelated IDs and resets every unit field", () => {
  const s = state(["tidal_recall", ...Array(6).fill("sprout")]);
  s.players[0].board = [
    unit("storm_kingfisher", "u1", {
      atk: 7,
      hp: 1,
      maxHp: 8,
      shield: true,
      ready: true,
      kingfisherDrawTurn: s.turn,
      temporaryBoost: 2,
    }),
  ];
  const ids = [...s.players[0].handIds];
  const n = play(s, 0, "u1");
  assert.equal(n.players[0].hand.length, 7);
  assert.equal(n.players[0].hand.at(-1), "storm_kingfisher");
  assert.equal(n.players[0].board.length, 0);
  assert.equal(n.players[0].mana, 5);
  assert.deepEqual(n.players[0].handIds.slice(0, 6), ids.slice(1));
  assert.ok(!ids.includes(n.players[0].handIds.at(-1)));
  const back = play(n, 6);
  assert.deepEqual(
    back.players[0].board[0],
    unit("storm_kingfisher", "u102", { ready: false }),
  );
  const sq = state(["tidal_recall"]);
  sq.players[0].board = [unit("acorn_squirrel", "u1", { hp: 1 })];
  assert.equal(play(sq, 0, "u1").players[0].armor, 0);
  sq.players[1].board = [unit("sprout", "u2")];
  assert.equal(play(sq, 0, "u2"), sq);
  assert.equal(play(sq, 0, "hero"), sq);
  assert.equal(play(sq), sq);
});

test("hand identities distinguish duplicate cards, synchronize draws and consumption, and initialize cloned bare states", () => {
  const s = state(["fox", "fox"]);
  const before = structuredClone(s);
  assert.equal(new Set(s.players[0].handIds).size, 2);
  const old = [...s.players[0].handIds];
  const n = play(s, 1);
  assert.equal(n.players[0].handIds[0], old[0]);
  assert.ok(!old.includes(n.players[0].handIds[1]));
  assert.deepEqual(s, before);
  delete s.handSeq;
  for (const p of s.players) delete p.handIds;
  const bare = structuredClone(s);
  const initialized = play(s);
  assert.deepEqual(s, bare);
  assert.equal(
    initialized.players[0].handIds.length,
    initialized.players[0].hand.length,
  );
  const all = initialized.players.flatMap((p) => p.handIds);
  assert.equal(new Set(all).size, all.length);
  const ritualState = state();
  ritualState.players[0].ritualsLeft = 1;
  const drawn = ritual(ritualState, "insight", true);
  assert.equal(drawn.players[0].handIds.length, 1);
});

test("discount belongs to only the chosen hand instance, is consumed once and can reduce one energy to zero", () => {
  const s = state(["acorn_squirrel", "acorn_squirrel"]);
  const [first, second] = s.players[0].handIds;
  s.players[0].handBoosts = { [second]: { turn: s.turn, amount: 1 } };
  s.players[0].mana = 0;
  assert.equal(effectiveCardCost(s, 0, 0), 1);
  assert.equal(effectiveCardCost(s, 0, 1), 0);
  assert.deepEqual(plays(s), [{ type: "play", index: 1 }]);
  assert.equal(play(s, 0), s);
  const n = play(s, 1);
  assert.equal(n.players[0].mana, 0);
  assert.deepEqual(n.players[0].handIds, [first]);
  assert.deepEqual(n.players[0].handBoosts, {});
  assert.equal(play(n), n);
  assert.equal(s.players[0].handBoosts[second].amount, 1);
});

test("discount expires at turn transition on both seats, ignores invalid grants, and never follows recall", () => {
  const s = state(["mushroom_medic", "tidal_recall"]);
  const id = s.players[0].handIds[0];
  s.players[0].handBoosts = { [id]: { turn: s.turn, amount: 1 } };
  let n = play(s, 0);
  const uid = n.players[0].board[0].uid;
  n = play(n, 0, uid);
  assert.equal(n.players[0].hand[0], "mushroom_medic");
  assert.notEqual(n.players[0].handIds[0], id);
  assert.equal(effectiveCardCost(n, 0, 0), 2);
  const ended = act(s, { type: "end" });
  assert.deepEqual(ended.players[0].handBoosts, {});
  assert.equal(effectiveCardCost(ended, 0, 0), 2);
  const boost = s.players[0].handBoosts[id];
  boost.amount = 2;
  assert.equal(effectiveCardCost(s, 0, 0), 2);
  boost.amount = 1;
  boost.turn = s.turn - 1;
  assert.equal(effectiveCardCost(s, 0, 0), 2);
  boost.turn = s.turn;
  s.rules = "2.2";
  assert.equal(effectiveCardCost(s, 0, 0), 2);
});

test("invalid parallel IDs cannot authorize a discounted play that later charges more than available mana", () => {
  const s = state(["sprout", "sprout"]);
  const id = s.players[0].handIds[0];
  s.players[0].handIds = [id, id];
  s.players[0].mana = 0;
  s.players[0].handBoosts = { [id]: { turn: s.turn, amount: 1 } };
  assert.equal(effectiveCardCost(s, 0, 0), 1);
  assert.equal(play(s), s);
  assert.equal(s.players[0].mana, 0);
});

test("tactical AI distinguishes discounted same-name instances when finding lethal", () => {
  const s = state(["spark", "spark"]);
  s.players[1].hp = 6;
  s.players[0].mana = 3;
  s.players[0].handBoosts = {
    [s.players[0].handIds[1]]: { turn: s.turn, amount: 1 },
  };
  const line = findLethal(s);
  assert.ok(line);
  const n = line.reduce((n, a) => act(n, a), s);
  assert.equal(n.winner, 0);
  assert.equal(n.players[0].mana, 0);
});

test("all twelve cards reject stale plays, insufficient energy, explicit targets on area spells and actions after finish", () => {
  for (const c of additions) {
    const s = state([c.id]);
    s.players[0].board = [unit("sprout", "u1", { hp: 1 })];
    s.players[1].board = [unit("sprout", "u2")];
    const a = plays(s)[0];
    assert.ok(a, c.id);
    const n = act(s, a);
    assert.notEqual(n, s, c.id);
    assert.equal(act(n, a), n, c.id);
    s.players[0].mana = 0;
    assert.equal(act(s, a), s, c.id);
    s.players[0].mana = 6;
    s.phase = "finished";
    s.winner = 0;
    assert.equal(act(s, a), s, c.id);
  }
  for (const id of ["thorn_sweep", "mending_rain"]) {
    const s = state([id]);
    s.players[0].board = [unit("sprout", "u1", { hp: 1 })];
    s.players[1].board = [unit("sprout", "u2")];
    assert.equal(play(s, 0, "u1"), s);
    assert.equal(play(s, 0, "u2"), s);
  }
});

test("AI enumerates new friendly and enemy target actions legally without hidden-hand or deck-order access", () => {
  for (const c of additions) {
    const s = state([c.id]);
    s.players[0].board = [
      unit("sprout", "u1", { hp: 1 }),
      unit("bear", "u2", { hp: 3 }),
    ];
    s.players[1].board = [
      unit("otter", "u3", { shield: true }),
      unit("sprout", "u4"),
    ];
    s.players[1].hand = ["sprout", "dew"];
    const hidden = structuredClone(s);
    hidden.players[1].hand = ["phoenix", "frost"];
    for (const p of hidden.players) p.deck.reverse();
    for (const level of ["easy", "standard", "tactical"])
      for (const style of ["aggro", "control", "value"]) {
        const before = structuredClone(s);
        const a = chooseAI(s, style, level);
        assert.ok(
          legalActions(s).some((v) => JSON.stringify(v) === JSON.stringify(a)),
          `${c.id} ${level} ${style}`,
        );
        assert.deepEqual(a, chooseAI(hidden, style, level));
        assert.deepEqual(s, before);
      }
  }
});

test("lethal search handles new guard-removal and recall-reused rush lines", () => {
  const s = state(["thorn_sweep"]);
  s.players[0].board = [unit("rabbit", "u1")];
  s.players[1].board = [unit("hedgehog", "u2", { hp: 1 })];
  s.players[1].hp = 2;
  const line = findLethal(s);
  assert.ok(line);
  assert.equal(line.reduce((n, a) => act(n, a), s).winner, 0);
  const bounce = state(["tidal_recall"]);
  bounce.players[0].board = [unit("rabbit", "u1", { ready: false })];
  bounce.players[1].hp = 2;
  const second = findLethal(bounce);
  assert.ok(second);
  assert.equal(second.reduce((n, a) => act(n, a), bounce).winner, 0);
});

const candidateDecks = [
  {
    id: "grove23",
    ids: [
      "sprout",
      "sprout",
      "acorn_squirrel",
      "acorn_squirrel",
      "sprite",
      "sprite",
      "mushroom_medic",
      "mushroom_medic",
      "glass_snail",
      "turtle",
      "turtle",
      "sun_badger",
      "bear",
      "bear",
      "mending_rain",
      "mending_rain",
      "sunseed_blessing",
      "sunseed_blessing",
      "dew",
      "lantern",
    ],
  },
  {
    id: "ember23",
    ids: [
      "rabbit",
      "rabbit",
      "acorn_squirrel",
      "acorn_squirrel",
      "fox",
      "fox",
      "reed_frog",
      "reed_frog",
      "wolf",
      "wolf",
      "storm_kingfisher",
      "storm_kingfisher",
      "crystal_ram",
      "crystal_ram",
      "ember_salamander",
      "spark",
      "spark",
      "thorn_sweep",
      "thorn_sweep",
      "lantern",
    ],
  },
  {
    id: "moon23",
    ids: [
      "firefly",
      "firefly",
      "fox",
      "fox",
      "otter",
      "otter",
      "mushroom_medic",
      "glass_snail",
      "storm_kingfisher",
      "storm_kingfisher",
      "crystal_ram",
      "ember_salamander",
      "tidal_recall",
      "tidal_recall",
      "sunseed_blessing",
      "sunseed_blessing",
      "mending_rain",
      "thorn_sweep",
      "frost",
      "lantern",
    ],
  },
];
function simulate(left, right, seed) {
  let s = state();
  s.seq = 0;
  s.turn = 1;
  s.players.forEach((p, side) => {
    const deck = shuffle((side ? right : left).ids, rng(`${seed}:${side}`));
    Object.assign(p, {
      hand: deck.splice(0, 4),
      handIds: [],
      deck,
      board: [],
      mana: side ? 0 : 1,
      maxMana: side ? 0 : 1,
    });
  });
  ensureHandIds(s);
  let count = 0;
  while (s.phase === "playing" && count++ < 500) {
    const a = chooseAI(s, ["control", "aggro"][s.active], "easy");
    const n = act(s, a);
    assert.notEqual(n, s, `stuck ${left.id}/${right.id}`);
    s = n;
    for (const p of s.players) {
      assert.ok(p.hand.length <= 7);
      assert.ok(p.board.length <= 4);
      assert.ok(p.mana >= 0);
      assert.equal(p.handIds.length, p.hand.length);
      assert.ok(
        p.board.every((u) => u.hp > 0 && u.hp <= u.maxHp && u.atk >= 0),
      );
    }
  }
  assert.equal(s.phase, "finished", `nonterminal ${left.id}/${right.id}`);
  return { winner: s.winner, turn: s.turn, actions: count };
}
test("fixed beginner-policy mirrored tournaments finish for old/new presets and all twelve three-copy extremes", (t) => {
  const summary = {
    oldWins: 0,
    newWins: 0,
    draws: 0,
    matches: 0,
    maxTurns: 0,
    extremeMatches: 0,
  };
  for (const deck of candidateDecks)
    assert.equal(validateCustomDeck(deck.ids), true);
  for (const old of DECKS)
    for (const next of candidateDecks)
      for (let seed = 0; seed < 2; seed++)
        for (const flipped of [false, true]) {
          const result = simulate(
            flipped ? next : old,
            flipped ? old : next,
            `mirror-${old.id}-${next.id}-${seed}`,
          );
          summary.matches++;
          summary.maxTurns = Math.max(summary.maxTurns, result.turn);
          if (result.winner === "draw") summary.draws++;
          else if (result.winner === (flipped ? 1 : 0)) summary.oldWins++;
          else summary.newWins++;
        }
  for (const c of additions) {
    const base = candidateDecks[1].ids.filter((id) => id !== c.id).slice(0, 17);
    const extreme = { id: `three-${c.id}`, ids: [c.id, c.id, c.id, ...base] };
    assert.equal(validateCustomDeck(extreme.ids), true);
    for (const flipped of [false, true]) {
      simulate(
        flipped ? DECKS[0] : extreme,
        flipped ? extreme : DECKS[0],
        `extreme-${c.id}`,
      );
      summary.extremeMatches++;
    }
  }
  t.diagnostic(
    `Beginner simulation only; no human balance or fun claim: ${JSON.stringify(summary)}`,
  );
});
