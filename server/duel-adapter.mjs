import { randomBytes, randomInt } from "node:crypto";
import {
  CARD,
  DECKS,
  PRACTICE_DECK,
  validateCustomDeck,
  RULES,
  RITUAL_LIMIT,
} from "../src/cards.mjs";
import {
  createMatch,
  act,
  ritual,
  chooseAI,
  legalActions,
} from "../src/engine.mjs";

export const id = (bytes = 16) => randomBytes(bytes).toString("base64url");
export function secureShuffle(items) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export function createDuel(
  deckIds,
  { computerSeat = -1, computer = null, customDecks = [] } = {},
) {
  const s = createMatch({
    deckId: deckIds[0],
    seed: id(18),
    offerOpening: false,
  });
  // createMatch is only a schema factory. Its offline draws/AI opening are
  // discarded; authoritative online orders are independent crypto shuffles.
  s.id = id();
  s.seed = "";
  s.rules = RULES;
  s.turn = 1;
  s.active = 0;
  s.seq = 0;
  s.log = [];
  s.opening = { player: [], opponent: [] };
  s.players = deckIds.map((deckId, side) => {
    const template =
      side === computerSeat && computer?.deckPolicy === "foundation"
        ? PRACTICE_DECK
        : deckId === "custom" && validateCustomDeck(customDecks[side])
          ? { id: "custom", ids: [...customDecks[side]] }
          : DECKS.find((d) => d.id === deckId);
    if (!template) throw Error("INVALID_DECK");
    const cards = secureShuffle(template.ids);
    return {
      hp: 18,
      armor: 0,
      mana: side === 0 ? 1 : 0,
      maxMana: side === 0 ? 1 : 0,
      hand: cards.splice(0, 4),
      deck: cards,
      board: [],
      fatigue: 0,
      ritualUsed: false,
      ritualsLeft: RITUAL_LIMIT,
    };
  });
  return s;
}
export function changeOpening(state, side, indices) {
  if (
    !Array.isArray(indices) ||
    indices.length > 2 ||
    new Set(indices).size !== indices.length ||
    indices.some((i) => !Number.isInteger(i) || i < 0 || i > 3)
  )
    throw Error("INVALID_OPENING");
  const s = structuredClone(state),
    p = s.players[side];
  if (p.hand.length !== 4) throw Error("INVALID_OPENING");
  const chosen = [...indices].sort((a, b) => a - b);
  if (!chosen.length) return s;
  const returned = chosen.map((i) => p.hand[i]);
  for (const index of chosen) p.hand[index] = p.deck.shift();
  p.deck = secureShuffle([...p.deck, ...returned]);
  return s;
}
export function ritualChoices(s, side) {
  if (s.phase !== "playing" || s.active !== side) return [];
  const p = s.players[side],
    e = s.players[1 - side];
  if (p.ritualUsed || p.ritualsLeft <= 0) return [];
  const a = [];
  if (p.hand.length < 7 && p.deck.length)
    a.push({ kind: "insight", target: "hero" });
  if (p.hp < 18) a.push({ kind: "bloom", target: "hero" });
  a.push({ kind: "spark", target: "hero" });
  for (const u of e.board) a.push({ kind: "spark", target: u.uid });
  return a;
}
export function applyRitual(s, side, kind, correct, target = "hero") {
  if (side === 0) return ritual(s, kind, correct, target);
  const flipped = structuredClone(s);
  flipped.players.reverse();
  flipped.active = 0;
  const next = ritual(flipped, kind, correct, target);
  if (next === flipped) return s;
  next.players.reverse();
  next.active = side;
  if (next.winner === 0) next.winner = 1;
  else if (next.winner === 1) next.winner = 0;
  return next;
}
export function combatActions(s) {
  return legalActions(s).filter((a) => a.type !== "power");
}
export function applyCombat(s, a) {
  return a.type === "power" ? s : act(s, a);
}
export function chooseComputer(
  s,
  side,
  style,
  allowPower = true,
  difficulty = "tactical",
) {
  const view = structuredClone(s);
  if (side === 0) view.players.reverse();
  view.active = 1;
  if (!allowPower) view.players[1].ritualUsed = true;
  return chooseAI(view, style, difficulty);
}
export function applyComputer(s, side, a) {
  return a.type === "power"
    ? applyRitual(s, side, a.kind, true, a.target || "hero")
    : applyCombat(s, a);
}
export function publicEvent(before, after, action, seat) {
  const e = { kind: action.type, actorSeat: seat };
  if (action.type === "play") {
    e.cardId = before.players[seat].hand[action.index];
    const old = new Set(before.players[seat].board.map((u) => u.uid));
    const created = after.players[seat].board.find((u) => !old.has(u.uid));
    if (created) e.newUnitUid = created.uid;
  }
  if (action.uid) e.sourceUid = action.uid;
  if (action.type === "ritual" && ["bloom", "insight"].includes(action.kind))
    e.targetSeat = seat;
  else if (action.target === "hero") e.targetSeat = 1 - seat;
  else if (action.target) e.targetUid = action.target;
  if (action.kind) e.ritualKind = action.kind;
  e.changes = [];
  for (let side = 0; side < 2; side++) {
    const p = before.players[side],
      n = after.players[side];
    if (p.hp !== n.hp || p.armor !== n.armor)
      e.changes.push({
        seat: side,
        hpDelta: n.hp - p.hp,
        armorDelta: n.armor - p.armor,
      });
    for (const u of p.board) {
      const next = n.board.find((v) => v.uid === u.uid);
      if (
        !next ||
        next.hp !== u.hp ||
        next.atk !== u.atk ||
        !!next.shield !== !!u.shield
      )
        e.changes.push({
          seat: side,
          uid: u.uid,
          hpDelta: (next?.hp || 0) - u.hp,
          atkDelta: (next?.atk ?? u.atk) - u.atk,
          removed: !next,
          ...(u.shield && !next?.shield ? { shieldLost: true } : {}),
        });
    }
  }
  return e;
}
