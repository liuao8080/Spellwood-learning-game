// A reproducible policy simulation, not a human playtest or a win guarantee.
// Usage: node scripts/simulate-difficulty.mjs [games-per-cell=60] [levels=easy,standard,tactical]
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { CARD, DECKS, OPPONENTS, PRACTICE_DECK } from "../src/cards.mjs";
import { createMatch, rng, shuffle, legalActions } from "../src/engine.mjs";
import {
  chooseComputer,
  applyCombat,
  applyRitual,
  ritualChoices,
} from "../server/duel-adapter.mjs";
import { chooseMulligan, redeal } from "../src/opening.mjs";
import { normalizeDifficulty } from "../src/combat-rating.mjs";

function novice(s, side, random) {
  const p = s.players[side],
    e = s.players[1 - side];
  // Simple novice: cheapest available creature, then random legal target.
  // It recognizes healing at full HP and drawing into a full hand as wasteful.
  const actions = legalActions(s).filter(
    (a) => a.type !== "power" && a.type !== "end",
  );
  const creatures = actions.filter(
    (a) => a.type === "play" && CARD[p.hand[a.index]].type !== "spell",
  );
  if (creatures.length)
    return creatures.sort(
      (a, b) => CARD[p.hand[a.index]].cost - CARD[p.hand[b.index]].cost,
    )[0];
  const attacks = actions.filter((a) => a.type === "attack");
  if (attacks.length) return attacks[Math.floor(random() * attacks.length)];
  const spells = actions.filter(
    (a) =>
      a.type === "play" &&
      (CARD[p.hand[a.index]].keyword !== "insight" ||
        (p.hand.length < 6 && p.deck.length)),
  );
  return spells[Math.floor(random() * spells.length)] || { type: "end" };
}
function playerRitual(s, side, policy) {
  const choices = ritualChoices(s, side);
  if (!choices.length) return null;
  if (policy === "novice")
    return choices.find((a) => a.kind === "spark" && a.target === "hero");
  const p = s.players[side],
    e = s.players[1 - side];
  if (p.hp <= 12) return choices.find((a) => a.kind === "bloom");
  const kill = e.board.find((u) => u.hp <= 2 && !u.shield);
  if (kill)
    return choices.find((a) => a.kind === "spark" && a.target === kill.uid);
  if (p.hand.length <= 2 && p.deck.length)
    return choices.find((a) => a.kind === "insight");
  return choices.find((a) => a.kind === "spark" && a.target === "hero");
}
export function simulateGame({
  seed,
  level = "easy",
  policy = "novice",
  accuracy = 0.5,
  humanSide = 0,
  deckId = "grove",
  opponentId = "moss",
}) {
  const plan = normalizeDifficulty(level),
    op = OPPONENTS.find((x) => x.id === opponentId);
  let s = createMatch({ seed, deckId, opponentId });
  const random = rng(seed + ":deals"),
    answerRandom = rng(seed + ":answers"),
    moveRandom = rng(seed + ":moves");
  for (let side = 0; side < 2; side++) {
    const template =
      side === humanSide
        ? DECKS.find((d) => d.id === deckId)
        : level === "easy"
          ? PRACTICE_DECK
          : DECKS.find((d) => d.id === op.deck);
    const deck = shuffle(template.ids, random),
      hand = deck.splice(0, 4);
    Object.assign(s.players[side], {
      hand,
      deck,
      mana: side === 0 ? 1 : 0,
      maxMana: side === 0 ? 1 : 0,
    });
    // Both policies keep two affordable creatures when possible; no deck peeking.
    Object.assign(
      s.players[side],
      redeal(
        hand,
        deck,
        chooseMulligan(hand, side === humanSide ? "control" : op.style),
        seed,
        side,
      ),
    );
  }
  let actions = 0;
  while (s.phase === "playing" && actions++ < 1000) {
    const side = s.active;
    if (side === humanSide) {
      const spell = playerRitual(s, side, policy);
      if (spell) {
        s = applyRitual(
          s,
          side,
          spell.kind,
          answerRandom() < accuracy,
          spell.target,
        );
        continue;
      }
    }
    const a =
      side !== humanSide
        ? chooseComputer(s, side, op.style, true, plan)
        : policy === "novice"
          ? novice(s, side, moveRandom)
          : chooseComputer(s, side, "control", false, "standard");
    const next =
      a.type === "power"
        ? applyRitual(s, side, a.kind, true, a.target)
        : applyCombat(s, a);
    assert.notEqual(next, s, "policy must choose a legal progressing action");
    s = next;
  }
  assert.equal(s.phase, "finished", "simulation must terminate naturally");
  return {
    result:
      s.winner === "draw" ? "draw" : s.winner === humanSide ? "win" : "loss",
    rounds: Math.ceil(s.turn / 2),
  };
}
export function runSimulation({
  games = 60,
  levels = ["easy", "standard", "tactical"],
} = {}) {
  const cells = [];
  for (const policy of ["novice", "intermediate"])
    for (const accuracy of [0.5, 0.75])
      for (const level of levels) {
        const tally = {
          policy,
          ritualAccuracy: accuracy,
          level,
          games,
          wins: 0,
          losses: 0,
          draws: 0,
          maxRounds: 0,
        };
        for (let i = 0; i < games; i++) {
          const outcome = simulateGame({
            seed: "difficulty-v1-" + i,
            level,
            policy,
            accuracy,
            humanSide: i % 2,
            deckId: DECKS[Math.floor(i / 2) % 3].id,
            opponentId: OPPONENTS[Math.floor(i / 6) % 3].id,
          });
          tally[
            outcome.result === "win"
              ? "wins"
              : outcome.result === "loss"
                ? "losses"
                : "draws"
          ]++;
          tally.maxRounds = Math.max(tally.maxRounds, outcome.rounds);
        }
        tally.winRate = Math.round((tally.wins / games) * 1000) / 10;
        cells.push(tally);
        console.log(JSON.stringify(tally));
      }
  return cells;
}
if (import.meta.url === pathToFileURL(process.argv[1]).href)
  runSimulation({
    games: Number(process.argv[2] || 60),
    levels: (process.argv[3] || "easy,standard,tactical").split(","),
  });
