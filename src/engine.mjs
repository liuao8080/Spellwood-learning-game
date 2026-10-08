import { rng, shuffle } from "./random.mjs";
import { chooseMulligan, redeal, openingPending } from "./opening.mjs";
import { normalizeDifficulty } from "./combat-rating.mjs";
export { rng, shuffle };
import {
  CARD,
  DECKS,
  OPPONENTS,
  RULES,
  hasFiniteRituals,
  CONTENT_VERSION,
  validCourse,
  RITUAL_LIMIT,
  hasOpening,
  isCardAvailable,
} from "./cards.mjs";
const copy = (s) => structuredClone(s);
const note = (s, text) => {
  s.log.unshift(text);
  s.log = s.log.slice(0, 30);
};
function damageHero(p, n) {
  n = Math.max(0, n);
  const blocked = Math.min(p.armor, n);
  p.armor -= blocked;
  p.hp -= n - blocked;
  return n - blocked;
}
function damageUnit(u, n) {
  if (n <= 0) return 0;
  if (u.shield) {
    u.shield = false;
    return 0;
  }
  u.hp -= n;
  return n;
}
// Mutates only an owned state. Callers of public transitions clone first.
// 2.2/2.1/2.0 saves retain their original shape and combat behavior.
export function ensureHandIds(s) {
  if (s.rules !== RULES) return s;
  const valid = (id) => typeof id === "string" && /^h[1-9][0-9]*$/.test(id);
  s.handSeq = Math.max(
    Number.isSafeInteger(s.handSeq) ? s.handSeq : 0,
    ...s.players.flatMap((p) =>
      (Array.isArray(p.handIds) ? p.handIds : [])
        .filter(valid)
        .map((id) => Number(id.slice(1))),
    ),
  );
  const used = new Set();
  for (const p of s.players) {
    if (
      !Array.isArray(p.handIds) ||
      p.handIds.length !== p.hand.length ||
      p.handIds.some((id) => !valid(id) || used.has(id)) ||
      new Set(p.handIds).size !== p.handIds.length
    ) {
      p.handIds = p.hand.map(() => `h${++s.handSeq}`);
    }
    for (const id of p.handIds) used.add(id);
    if (p.handBoosts)
      for (const id of Object.keys(p.handBoosts))
        if (!p.handIds.includes(id)) delete p.handBoosts[id];
  }
  return s;
}
export function effectiveCardCost(s, side, index) {
  const p = s.players[side],
    c = CARD[p.hand[index]];
  if (!c) return Infinity;
  // Malformed parallel identity arrays cannot turn an unaffordable action
  // into a legal one before ensureHandIds repairs them on the cloned state.
  const validIds =
    Array.isArray(p.handIds) &&
    p.handIds.length === p.hand.length &&
    p.handIds.every(
      (id) => typeof id === "string" && /^h[1-9][0-9]*$/.test(id),
    ) &&
    new Set(p.handIds).size === p.handIds.length &&
    !s.players[1 - side].handIds?.includes(p.handIds[index]);
  const boost = p.handBoosts?.[p.handIds?.[index]];
  return s.rules === RULES &&
    validIds &&
    s.active === side &&
    boost?.turn === s.turn &&
    boost.amount === 1
    ? Math.max(0, c.cost - 1)
    : c.cost;
}
function addToHand(s, side, cardId) {
  const p = s.players[side];
  if (p.hand.length >= 7) {
    note(s, "手牌已满，一张牌化作星尘");
    return;
  }
  p.hand.push(cardId);
  if (s.rules === RULES) p.handIds.push(`h${++s.handSeq}`);
}
function healUnit(u, n) {
  if (u && u.hp > 0) u.hp = Math.min(u.maxHp, u.hp + n);
}
function draw(s, side, n = 1) {
  const p = s.players[side];
  for (let i = 0; i < n; i++) {
    if (!p.deck.length) {
      p.fatigue++;
      damageHero(p, p.fatigue);
      note(s, `${side ? "对手" : "你"}受到${p.fatigue}点疲劳伤害`);
    } else {
      const c = p.deck.shift();
      addToHand(s, side, c);
    }
  }
}
function finish(s) {
  const departed = [];
  const deaths = [];
  for (const [side, p] of s.players.entries()) {
    for (const u of p.board.filter((u) => u.hp <= 0)) {
      departed.push(`${side ? "对手的" : "你的"}${CARD[u.cardId].name}`);
      deaths.push({ side, cardId: u.cardId });
    }
    p.board = p.board.filter((c) => c.hp > 0);
  }
  // Every unit has already received its simultaneous damage and left the board.
  // Resolve death effects in seat order, then board order, before judging winners.
  for (const death of deaths) {
    const c = CARD[death.cardId];
    if (s.rules === RULES && c.keyword === "deathArmor")
      s.players[death.side].armor += c.amount;
  }
  if (departed.length) {
    const action = s.log.shift() || "交战结束";
    note(s, `${action} · ${departed.join("、")}退场`);
  }
  if (s.players[0].hp <= 0 && s.players[1].hp <= 0) s.winner = "draw";
  else if (s.players[0].hp <= 0) s.winner = 1;
  else if (s.players[1].hp <= 0) s.winner = 0;
  if (s.winner !== null) s.phase = "finished";
}
function startTurn(s, side) {
  s.active = side;
  s.turn++;
  if (s.rules === RULES)
    for (const player of s.players)
      if (player.handBoosts)
        for (const [id, boost] of Object.entries(player.handBoosts))
          if (boost.turn !== s.turn || !player.handIds?.includes(id))
            delete player.handBoosts[id];
  const p = s.players[side];
  p.maxMana = Math.min(6, p.maxMana + 1);
  p.mana = p.maxMana;
  p.ritualUsed = false;
  for (const u of p.board) {
    u.ready = true;
    if (CARD[u.cardId].keyword === "grow") u.atk++;
  }
  draw(s, side);
  note(s, `${side ? "对手" : "你的"}回合 · ${p.mana}点能量`);
  finish(s);
}
/** @returns {import("./types.js").Match} */
export function createMatch({
  grade = 1,
  seed = "FOREST",
  deckId = "grove",
  opponentId = "moss",
  course = "all",
  offerOpening = false,
} = {}) {
  const normalizedSeed = String(seed).slice(0, 24);
  const random = rng(normalizedSeed),
    op = OPPONENTS.find((x) => x.id === opponentId) || OPPONENTS[1];
  const deck = DECKS.find((d) => d.id === deckId) || DECKS[0];
  const other = DECKS.find((d) => d.id === op.deck);
  const s = {
    schema: 1,
    rules: RULES,
    contentVersion: CONTENT_VERSION,
    course: validCourse(course) ? course : "all",
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    grade,
    seed: normalizedSeed,
    deckId: deck.id,
    opponentId: op.id,
    players: [deck, other].map((d) => ({
      hp: 18,
      armor: 0,
      mana: 0,
      maxMana: 0,
      board: [],
      hand: [],
      handIds: [],
      deck: shuffle(d.ids, random),
      fatigue: 0,
      ritualUsed: false,
      ritualsLeft: RITUAL_LIMIT,
    })),
    active: 0,
    turn: 0,
    seq: 0,
    handSeq: 0,
    phase: "playing",
    winner: null,
    log: [],
    questions: [],
    questionIndex: 0,
    correct: 0,
    attempts: 0,
    review: [],
    archivedReview: [],
    pending: null,
    recorded: false,
    opening: { player: offerOpening ? null : [], opponent: [] },
  };
  ensureHandIds(s);
  draw(s, 0, 3);
  draw(s, 1, 4);
  startTurn(s, 0);
  const openingChoice = chooseMulligan(s.players[1].hand, op.style);
  Object.assign(
    s.players[1],
    redeal(s.players[1].hand, s.players[1].deck, openingChoice, s.seed, 1),
  );
  s.opening.opponent = openingChoice;
  for (const index of openingChoice)
    s.players[1].handIds[index] = `h${++s.handSeq}`;
  return s;
}
/** @param {import("./types.js").Match} state @param {number[]} indices @returns {import("./types.js").Match} */
export function finishOpening(state, indices) {
  if (state.phase !== "playing" || !openingPending(state)) return state;
  const s = copy(state),
    p = s.players[0];
  ensureHandIds(s);
  try {
    Object.assign(p, redeal(p.hand, p.deck, indices, s.seed, 0));
  } catch {
    return state;
  }
  s.opening.player = [...indices].sort((a, b) => a - b);
  if (s.rules === RULES)
    for (const index of s.opening.player) p.handIds[index] = `h${++s.handSeq}`;
  note(
    s,
    indices.length ? `你调整了${indices.length}张起手` : "你保留了全部起手",
  );
  return s;
}
/** @param {import("./types.js").Match} s @returns {import("./types.js").Action[]} */
export function legalActions(s) {
  if (s.phase !== "playing" || openingPending(s)) return [];
  const side = s.active,
    p = s.players[side],
    e = s.players[1 - side],
    actions = [];
  p.hand.forEach((id, index) => {
    const c = CARD[id];
    if (
      !c ||
      !isCardAvailable(id, s.rules) ||
      effectiveCardCost(s, side, index) > p.mana
    )
      return;
    if (hasFiniteRituals(s.rules) && c.keyword === "restore" && p.hp >= 18)
      return;
    if (c.type !== "spell" && p.board.length >= 4) return;
    const friendly = p.board.filter((u) => u.hp > 0);
    const enemy = e.board.filter((u) => u.hp > 0);
    const targets =
      c.target === "enemy-unit"
        ? enemy
        : c.target === "friendly-unit"
          ? friendly
          : c.target === "friendly-wounded-unit"
            ? friendly.filter((u) => u.hp < u.maxHp)
            : c.target === "friendly-unshielded-unit"
              ? friendly.filter((u) => !u.shield)
              : null;
    if (targets) {
      for (const u of targets)
        actions.push({ type: "play", index, target: u.uid });
      if (!targets.length && c.type !== "spell")
        actions.push({ type: "play", index });
    } else if (c.target === "all-enemy-units") {
      if (enemy.length) actions.push({ type: "play", index });
    } else if (c.target === "all-friendly-wounded-units") {
      if (friendly.some((u) => u.hp < u.maxHp))
        actions.push({ type: "play", index });
    } else if (c.type !== "spell") {
      actions.push({ type: "play", index });
    } else if (c.keyword === "damage") {
      actions.push({ type: "play", index, target: "hero" });
      for (const u of e.board)
        actions.push({ type: "play", index, target: u.uid });
    } else actions.push({ type: "play", index });
  });
  const guards = e.board.filter((x) => CARD[x.cardId].keyword === "guard");
  for (const u of p.board) {
    if (!u.ready) continue;
    const targets = guards.length ? guards : e.board;
    for (const v of targets)
      actions.push({ type: "attack", uid: u.uid, target: v.uid });
    if (!guards.length)
      actions.push({ type: "attack", uid: u.uid, target: "hero" });
  }
  if (
    hasFiniteRituals(s.rules) &&
    side === 1 &&
    !p.ritualUsed &&
    p.ritualsLeft > 0
  ) {
    if (p.hand.length < 7 && p.deck.length)
      actions.push({ type: "power", kind: "insight" });
    if (p.hp < 18) actions.push({ type: "power", kind: "bloom" });
    actions.push({ type: "power", kind: "spark", target: "hero" });
    for (const u of e.board)
      actions.push({ type: "power", kind: "spark", target: u.uid });
  }
  actions.push({ type: "end" });
  return actions;
}
/** @param {import("./types.js").Match} s @param {import("./types.js").Action} a */
export function isLegal(s, a) {
  return legalActions(s).some((x) => JSON.stringify(x) === JSON.stringify(a));
}
/** @param {import("./types.js").Match} state @param {import("./types.js").Action} action @returns {import("./types.js").Match} */
export function act(state, action) {
  if (!isLegal(state, action)) return state;
  const s = copy(state),
    side = s.active,
    p = s.players[side],
    e = s.players[1 - side];
  ensureHandIds(s);
  s.seq++;
  if (action.type === "end") {
    startTurn(s, 1 - side);
    return s;
  }
  if (action.type === "power") {
    applyRitual(s, side, action.kind, true, action.target || "hero");
    finish(s);
    return s;
  }
  if (action.type === "play") {
    const c = CARD[p.hand[action.index]];
    const cost = effectiveCardCost(s, side, action.index);
    const handId = p.handIds?.[action.index];
    p.hand.splice(action.index, 1);
    if (s.rules === RULES) p.handIds.splice(action.index, 1);
    if (s.rules === RULES && p.handBoosts) delete p.handBoosts[handId];
    p.mana -= cost;
    note(s, `${side ? "对手" : "你"}使用了${c.name}`);
    if (c.type === "spell") {
      if (c.keyword === "damage") {
        if (action.target === "hero") damageHero(e, c.amount || 3);
        else
          damageUnit(
            e.board.find((u) => u.uid === action.target),
            c.amount || 3,
          );
      }
      if (c.keyword === "restore") p.hp = Math.min(18, p.hp + (c.amount || 5));
      if (c.keyword === "insight") draw(s, side, c.amount || 2);
      if (c.keyword === "sweep")
        for (const u of e.board) if (u.hp > 0) damageUnit(u, c.amount);
      if (c.keyword === "rain") for (const u of p.board) healUnit(u, c.amount);
      if (c.keyword === "blessing") {
        const u = p.board.find((u) => u.uid === action.target);
        u.maxHp += c.amount;
        healUnit(u, c.amount);
      }
      if (c.keyword === "recall") {
        const index = p.board.findIndex((u) => u.uid === action.target);
        const [u] = p.board.splice(index, 1);
        // The spell was consumed first. Only the base ID enters the newly
        // allocated hand instance; no unit buffs or death effects survive.
        addToHand(s, side, u.cardId);
      }
    } else {
      if (c.keyword === "rally") for (const u of p.board) u.atk++;
      p.board.push({
        uid: `u${s.seq}`,
        cardId: c.id,
        atk: c.atk,
        hp: c.hp,
        maxHp: c.hp,
        ready: c.keyword === "rush",
        ...(c.keyword === "barrier" ? { shield: true } : {}),
      });
      if (c.keyword === "draw") draw(s, side);
      if (c.keyword === "armor") p.armor += 2;
      if (c.keyword === "heal") p.hp = Math.min(18, p.hp + 3);
      const friend = p.board.find((u) => u.uid === action.target);
      const enemy = e.board.find((u) => u.uid === action.target);
      if (c.keyword === "mend") healUnit(friend, c.amount);
      if (c.keyword === "grantShield" && friend) friend.shield = true;
      if (c.keyword === "weaken" && enemy)
        enemy.atk = Math.max(0, enemy.atk - c.amount);
      if (c.keyword === "arrivalDamage" && enemy) damageUnit(enemy, c.amount);
      if (c.keyword === "companyArmor")
        p.armor += Math.min(c.limit, p.board.length - 1) * c.amount;
    }
  }
  if (action.type === "attack") {
    const u = p.board.find((x) => x.uid === action.uid);
    u.ready = false;
    if (action.target === "hero") {
      const hpDamage = damageHero(e, u.atk);
      note(s, `${CARD[u.cardId].name}造成${u.atk}点伤害`);
      if (
        s.rules === RULES &&
        CARD[u.cardId].keyword === "heroHitDraw" &&
        hpDamage > 0 &&
        u.kingfisherDrawTurn !== s.turn
      ) {
        u.kingfisherDrawTurn = s.turn;
        draw(s, side, CARD[u.cardId].amount);
      }
    } else {
      const v = e.board.find((x) => x.uid === action.target);
      const attack =
          u.atk +
          (s.rules === RULES && CARD[u.cardId].keyword === "unitCharge"
            ? CARD[u.cardId].amount
            : 0),
        retaliation = v.atk;
      const dealt = damageUnit(v, attack),
        returned = damageUnit(u, retaliation);
      note(
        s,
        `${CARD[u.cardId].name}造成${dealt}伤害，${CARD[v.cardId].name}还击${returned}伤害${dealt < attack || returned < retaliation ? " · 护盾抵挡伤害" : ""}`,
      );
    }
  }
  finish(s);
  return s;
}
/** @param {import("./types.js").Match} state @param {string} kind @param {boolean} correct @param {string} target @returns {import("./types.js").Match} */
export function ritual(state, kind, correct, target = "hero") {
  if (openingPending(state)) return state;
  if (
    state.phase !== "playing" ||
    state.active !== 0 ||
    state.players[0].ritualUsed ||
    (hasFiniteRituals(state.rules) && state.players[0].ritualsLeft <= 0) ||
    (hasFiniteRituals(state.rules) &&
      ((kind === "bloom" && state.players[0].hp >= 18) ||
        (kind === "insight" &&
          (state.players[0].hand.length >= 7 ||
            state.players[0].deck.length === 0)))) ||
    !["insight", "spark", "bloom"].includes(kind)
  )
    return state;
  if (
    kind === "spark" &&
    target !== "hero" &&
    !state.players[1].board.some((u) => u.uid === target)
  )
    return state;
  const s = copy(state);
  ensureHandIds(s);
  s.seq++;
  applyRitual(s, 0, kind, correct, target);
  finish(s);
  return s;
}
function applyRitual(s, side, kind, correct, target) {
  const p = s.players[side],
    e = s.players[1 - side];
  p.ritualUsed = true;
  if (hasFiniteRituals(s.rules)) p.ritualsLeft--;
  if (correct) {
    if (kind === "insight") draw(s, side, 1);
    if (kind === "spark") {
      if (target === "hero") damageHero(e, 2);
      else
        damageUnit(
          e.board.find((u) => u.uid === target),
          2,
        );
    }
    if (kind === "bloom") p.hp = Math.min(18, p.hp + 3);
    const name = {
      insight: "灵光 · 抽1张牌",
      spark: "火花 · 2点伤害",
      bloom: "守护 · 恢复生命",
    }[kind];
    note(s, `${side ? "对手" : "你"}唤醒了${name}`);
  } else {
    p.armor++;
    note(s, "星光守护 · 获得1点护甲，下次再试");
  }
}
/** @param {import("./types.js").Match} s @param {number} side @param {string} style @returns {number} */
export function evaluate(s, side, style = "control") {
  if (s.winner === side) return 100000;
  if (s.winner === 1 - side) return -100000;
  if (s.winner === "draw") return 0;
  const p = s.players[side],
    e = s.players[1 - side];
  const ag = style === "aggro",
    val = style === "value";
  function units(a) {
    return a.board.reduce(
      (n, u) =>
        n +
        u.atk * 1.7 +
        u.hp * 1.15 +
        (CARD[u.cardId].keyword === "guard" ? 1.7 : 0) +
        (u.shield ? 2 : 0) +
        (CARD[u.cardId].keyword === "grow" ? 2.5 : 0),
      0,
    );
  }
  return (
    (p.hp + p.armor) * 1.15 -
    Math.max(0, 8 - p.hp - p.armor) * 2 -
    (e.hp + e.armor) * (ag ? 2.2 : 1.35) +
    units(p) * (val ? 1.15 : 1) -
    units(e) * (ag ? (hasOpening(s.rules) ? 1.05 : 0.82) : 1.18) +
    [5, 4.3, 3.3, 2.4, 1.5, 0.8, 0.2]
      .slice(0, p.hand.length)
      .reduce((n, x) => n + x, 0) *
      (val ? 1.25 : ag ? 0.8 : 1) +
    (hasFiniteRituals(s.rules)
      ? (p.ritualsLeft || 0) * 3.5 - (e.ritualsLeft || 0) * 1.5
      : 0) -
    e.hand.length * 0.35 +
    p.mana * 0.07
  );
}
// Planning never gets the real order of either deck or the opposing hand.
// Unknown draws have resource value, but cannot be played in a predicted line.
function decisionView(state) {
  const s = copy(state);
  s.log = [];
  for (let i = 0; i < 2; i++) {
    s.players[i].deck = s.players[i].deck.map(() => "_unknown");
    if (i !== s.active) {
      s.players[i].hand = s.players[i].hand.map(() => "_unknown");
      delete s.players[i].handBoosts;
    }
  }
  return s;
}
function threatKey(s, side) {
  return JSON.stringify([
    s.rules,
    side,
    s.players.map((p, i) => [
      p.hp,
      p.armor,
      i === side ? 0 : p.ritualsLeft,
      i === side ? 0 : p.deck.length,
      i === side ? 0 : p.fatigue,
      p.board
        .map((u) => [
          u.cardId,
          u.atk,
          u.hp,
          u.maxHp,
          !!u.shield,
          u.kingfisherDrawTurn,
        ])
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    ]),
  ]);
}
function tacticalKey(s) {
  return JSON.stringify([
    s.active,
    ...s.players.map((p) => [
      p.hp,
      p.armor,
      p.mana,
      p.ritualUsed,
      p.ritualsLeft,
      p.hand,
      p.handIds?.map((id) => p.handBoosts?.[id]),
      p.board.map((u) => [
        u.uid,
        u.cardId,
        u.atk,
        u.hp,
        u.maxHp,
        u.ready,
        !!u.shield,
        u.kingfisherDrawTurn,
      ]),
    ]),
  ]);
}
function lethalActions(s) {
  const seen = new Set();
  return legalActions(s)
    .filter((a) => {
      if (a.type === "end") return false;
      if (a.type === "power") return a.kind === "spark";
      if (a.type === "attack") return true;
      const c = CARD[s.players[s.active].hand[a.index]];
      if (
        ![
          "damage",
          "rush",
          "rally",
          "arrivalDamage",
          "sweep",
          "recall",
        ].includes(c.keyword)
      )
        return false;
      const k =
        c.id +
        ":" +
        effectiveCardCost(s, s.active, a.index) +
        ":" +
        (a.target || "");
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort(
      (a, b) =>
        ("target" in b && b.target === "hero" ? 1 : 0) -
        ("target" in a && a.target === "hero" ? 1 : 0),
    );
}
/** @param {import("./types.js").Match} state @param {number} nodeLimit @returns {import("./types.js").Action[] | null} */
export function findLethal(state, nodeLimit = 1500) {
  const side = state.active,
    seen = new Set();
  let visited = 0;
  function walk(s, path) {
    if (s.winner === side) return path;
    if (s.phase !== "playing" || ++visited > nodeLimit || path.length >= 18)
      return null;
    const k = tacticalKey(s);
    if (seen.has(k)) return null;
    seen.add(k);
    const p = s.players[side],
      e = s.players[1 - side];
    const creatureDamage =
      p.board.filter((u) => u.ready).reduce((n, u) => n + u.atk, 0) +
      p.hand.reduce(
        (n, id) => n + (CARD[id]?.keyword === "rush" ? CARD[id].atk : 0),
        0,
      ) +
      p.hand.filter((id) => CARD[id]?.keyword === "rally").length *
        (p.board.filter((u) => u.ready).length +
          p.hand.filter((id) => CARD[id]?.keyword === "rush").length);
    const spellDamage =
      p.hand.reduce(
        (n, id) =>
          n + (CARD[id]?.keyword === "damage" ? CARD[id].amount || 3 : 0),
        0,
      ) +
      (hasFiniteRituals(s.rules) && !p.ritualUsed && p.ritualsLeft > 0 ? 2 : 0);
    const guardHealth = e.board
      .filter((u) => CARD[u.cardId].keyword === "guard")
      .reduce((n, u) => n + u.hp, 0);
    // Damage spent breaking guard cannot also hit the hero. This optimistic
    // upper bound cheaply rejects impossible lines without assuming card order.
    const upper = spellDamage + Math.max(0, creatureDamage - guardHealth);
    // New guard removal and recalling a rush/battlecry unit can open lines that
    // the old bound did not model. Keep the old fast bound for old-only hands.
    const flexible =
      s.rules === RULES &&
      (p.hand.some((id) =>
        ["arrivalDamage", "sweep", "recall"].includes(CARD[id]?.keyword),
      ) ||
        p.board.some(
          (u) => u.ready && CARD[u.cardId].keyword === "unitCharge",
        ));
    if (upper < e.hp + e.armor && !flexible) return null;
    for (const a of lethalActions(s)) {
      const result = walk(act(s, a), [...path, a]);
      if (result) return result;
    }
    return null;
  }
  return walk(decisionView(state), []);
}
/** @param {import("./types.js").Match} state @param {number} side @returns {boolean} */
export function publicLethalThreat(state, side) {
  if (state.phase !== "playing") return state.winner === 1 - side;
  const n = decisionView(state);
  // Only public existing units, growth, fatigue and available ritual damage.
  n.players[1 - side].hand = [];
  startTurn(n, 1 - side);
  if (n.phase !== "playing") return n.winner === 1 - side;
  const enemy = n.players[1 - side],
    p = n.players[side];
  const power = hasFiniteRituals(n.rules) && enemy.ritualsLeft > 0;
  if (
    enemy.board.reduce((v, u) => v + u.atk, 0) + (power ? 2 : 0) <
    p.hp + p.armor
  )
    return false;
  if (findLethal(n, 600)) return true;
  if (power && n.active === 0) {
    for (const target of ["hero", ...p.board.map((u) => u.uid)]) {
      const r = ritual(n, "spark", true, target);
      if (r.winner === 0 || findLethal(r, 600)) return true;
    }
  }
  return false;
}
function defensiveActions(s) {
  const p = s.players[s.active],
    seen = new Set();
  return legalActions(s).filter((a) => {
    let key;
    if (a.type === "attack") {
      if (a.target === "hero") return false;
      const u = p.board.find((u) => u.uid === a.uid);
      key = ["attack", u.cardId, u.atk, u.hp, a.target].join(":");
    } else if (a.type === "play") {
      const c = CARD[p.hand[a.index]];
      if (c.keyword === "damage") {
        if (a.target === "hero") return false;
      } else if (
        ![
          "guard",
          "armor",
          "heal",
          "restore",
          "rush",
          "mend",
          "weaken",
          "grantShield",
          "companyArmor",
          "arrivalDamage",
          "sweep",
          "rain",
          "recall",
          "blessing",
          "deathArmor",
        ].includes(c.keyword)
      )
        return false;
      key = [
        "play",
        c.id,
        effectiveCardCost(s, s.active, a.index),
        a.target || "",
      ].join(":");
    } else if (a.type === "power") {
      if (a.kind !== "bloom" && !(a.kind === "spark" && a.target !== "hero"))
        return false;
      key = ["power", a.kind, a.target || ""].join(":");
    } else return false;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
/** Search only when already under a public lethal threat. Sacrificing units can
 * open a slot for a guard several actions later; a two-action estimate misses it.
 * @param {import("./types.js").Match} state @param {number} nodeLimit
 * @returns {import("./types.js").Action[] | null} */
export function findSafeLine(state, nodeLimit = 450) {
  const root = decisionView(state),
    side = root.active,
    cache = new Map(),
    seen = new Set([tacticalKey(root)]);
  const dangerous = (s) => {
    const key = threatKey(s, side);
    if (!cache.has(key)) cache.set(key, publicLethalThreat(s, side));
    return cache.get(key);
  };
  if (!dangerous(root)) return [];
  const queue = [{ state: root, path: [] }];
  let read = 0,
    generated = 0;
  while (read < queue.length && generated < nodeLimit) {
    const item = queue[read++];
    if (item.path.length >= 6) continue;
    for (const action of defensiveActions(item.state)) {
      const next = act(item.state, action),
        key = tacticalKey(next);
      if (seen.has(key) || next.phase !== "playing") continue;
      seen.add(key);
      generated++;
      const path = [...item.path, action];
      if (!dangerous(next)) return path;
      queue.push({ state: next, path });
      if (generated >= nodeLimit) break;
    }
  }
  return null;
}
function practiceActions(s, plan) {
  const p = s.players[s.active],
    round = Math.ceil(s.turn / 2);
  const mayUseRitual =
    RITUAL_LIMIT - (p.ritualsLeft || 0) < plan.ritualLimit &&
    round >= plan.ritualStartRound &&
    (round - plan.ritualStartRound) % plan.ritualInterval === 0;
  return legalActions(s).filter((a) => a.type !== "power" || mayUseRitual);
}
// A visible, fixed beginner policy: develop a creature, take a safe exchange,
// then attack the hero. It never inspects hidden cards or changes battle stats.
function chooseBasic(s, style, plan) {
  const side = s.active,
    p = s.players[side],
    e = s.players[1 - side];
  const actions = practiceActions(s, plan).filter((a) => a.type !== "end");
  const winning = actions.find((a) => act(s, a).winner === side);
  if (winning) return winning;
  const creatures = actions.filter(
    (a) => a.type === "play" && CARD[p.hand[a.index]].type !== "spell",
  );
  if (creatures.length)
    return creatures.sort(
      (a, b) =>
        (b.type === "play" ? CARD[p.hand[b.index]].cost : 0) -
          (a.type === "play" ? CARD[p.hand[a.index]].cost : 0) ||
        (a.type === "play" &&
        b.type === "play" &&
        (CARD[p.hand[a.index]].introducedRules ||
          CARD[p.hand[b.index]].introducedRules)
          ? evaluate(act(s, b), side, style) - evaluate(act(s, a), side, style)
          : 0),
    )[0];
  const safeTrade = actions.find((a) => {
    if (a.type !== "attack" || a.target === "hero") return false;
    const u = p.board.find((u) => u.uid === a.uid),
      v = e.board.find((u) => u.uid === a.target);
    const attack =
      u.atk +
      (s.rules === RULES && CARD[u.cardId].keyword === "unitCharge"
        ? CARD[u.cardId].amount
        : 0);
    return !v.shield && attack >= v.hp && (u.shield || u.hp > v.atk);
  });
  if (safeTrade) return safeTrade;
  const face = actions.find((a) => a.type === "attack" && a.target === "hero");
  if (face) return face;
  // A one-step card/power choice is also allowed. No deliberately losing trade,
  // skipped playable creature, manufactured draw, or guaranteed player win.
  const options = actions.filter((a) => a.type !== "attack");
  let best = /** @type {import('./types.js').Action} */ ({ type: "end" }),
    bestScore = evaluate(s, side, style) - 0.1;
  for (const a of options) {
    const score = evaluate(act(s, a), side, style);
    if (score > bestScore) {
      best = a;
      bestScore = score;
    }
  }
  return best;
}
function chooseSingleStep(s, style, plan) {
  let best = /** @type {import('./types.js').Action} */ ({ type: "end" }),
    bestScore = evaluate(s, s.active, style) - 0.6;
  for (const a of practiceActions(s, plan)) {
    if (a.type === "end") continue;
    const score = evaluate(act(s, a), s.active, style);
    if (score > bestScore) {
      best = a;
      bestScore = score;
    }
  }
  return best;
}
/** @param {import("./types.js").Match} s @param {string} style @param {string|object} difficulty @returns {import("./types.js").Action} */
export function chooseAI(s, style, difficulty = "tactical") {
  const view = decisionView(s),
    side = view.active;
  const plan = normalizeDifficulty(difficulty);
  if (plan.level === "easy") return chooseBasic(view, style, plan);
  if (plan.level === "standard") return chooseSingleStep(view, style, plan);
  const lethal = findLethal(view);
  if (lethal?.length) return lethal[0];
  if (publicLethalThreat(view, side)) {
    const safe = findSafeLine(view);
    if (safe?.length) return safe[0];
  }
  const dangerCache = new Map();
  const value = (state) => {
    if (state.phase !== "playing") return evaluate(state, side, style);
    const key = threatKey(state, side);
    let danger = dangerCache.get(key);
    if (danger === undefined) {
      danger = publicLethalThreat(state, side);
      dangerCache.set(key, danger);
    }
    return evaluate(state, side, style) - (danger ? 20000 : 0);
  };
  let best = /** @type {import('./types.js').Action} */ ({ type: "end" }),
    score = -Infinity;
  const baseline = value(view);
  for (const a of legalActions(view)) {
    if (a.type === "end") continue;
    const next = act(view, a);
    let v = value(next),
      further = v;
    const replies = legalActions(next)
      .filter((x) => x.type !== "end")
      .map((action) => ({ action, state: act(next, action) }))
      .sort(
        (a, b) =>
          evaluate(b.state, side, style) - evaluate(a.state, side, style),
      )
      .slice(0, 10);
    for (const reply of replies)
      further = Math.max(further, value(reply.state));
    v += 0.35 * (further - v);
    if (v > score) {
      score = v;
      best = a;
    }
  }
  return score >= baseline - 0.6 ? best : { type: "end" };
}
/** @param {import("./types.js").Match} s @returns {number} */
export function scoreMatch(s) {
  return (
    (s.winner === 0 ? 600 : s.winner === "draw" ? 300 : 100) +
    (s.rules === "1.0" ? s.correct * 45 : 0) +
    Math.max(0, s.players[0].hp) * 5 +
    Math.max(0, 140 - Math.ceil(s.turn / 2) * 8)
  );
}
