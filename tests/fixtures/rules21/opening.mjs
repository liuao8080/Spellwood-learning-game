import { CARD, RULES } from "./cards.mjs";
import { rng, shuffle } from "./random.mjs";
// Only this hand and public card definitions enter the policy. No deck argument.
/** @param {string[]} hand @param {string} style @returns {number[]} */
export function chooseMulligan(hand, style = "control") {
  const creature = (i) => CARD[hand[i]].type !== "spell";
  const all = hand.map((_, i) => i),
    keep = new Set();
  const preferred1 = style === "aggro" ? "rabbit" : "sprout";
  const preferred2 = style === "control" ? "sprite" : "fox";
  const one = all
    .filter((i) => creature(i) && CARD[hand[i]].cost === 1)
    .sort(
      (a, b) =>
        Number(hand[b] === preferred1) - Number(hand[a] === preferred1) ||
        a - b,
    )[0];
  if (one !== undefined) keep.add(one);
  const follow = all
    .filter((i) => i !== one && creature(i) && CARD[hand[i]].cost <= 2)
    .sort(
      (a, b) =>
        CARD[hand[b]].cost - CARD[hand[a]].cost ||
        Number(hand[b] === preferred2) - Number(hand[a] === preferred2) ||
        a - b,
    )[0];
  if (follow !== undefined) keep.add(follow);
  const curveReady = one !== undefined && follow !== undefined;
  const priority = (i) => {
    const c = CARD[hand[i]];
    return (
      c.cost * 10 +
      (c.keyword === "restore"
        ? 35
        : c.keyword === "insight"
          ? 12
          : c.keyword === "damage"
            ? 5
            : 0)
    );
  };
  return all
    .filter((i) => !keep.has(i) && (!curveReady || priority(i) >= 40))
    .sort((a, b) => priority(b) - priority(a) || b - a)
    .slice(0, 2)
    .sort((a, b) => a - b);
}
// Replacements come from the remaining deck BEFORE returned cards are shuffled.
/** @param {string[]} hand @param {string[]} deck @param {number[]} chosen @param {string} seed @param {number} side */
export function redeal(hand, deck, chosen, seed, side) {
  if (!Array.isArray(chosen)) throw Error("Invalid mulligan selection");
  const indices = [...chosen].sort((a, b) => a - b);
  if (
    indices.length > 2 ||
    new Set(indices).size !== indices.length ||
    indices.some((i) => !Number.isInteger(i) || i < 0 || i >= hand.length)
  )
    throw Error("Invalid mulligan selection");
  if (!indices.length) return { hand: [...hand], deck: [...deck] };
  if (deck.length < indices.length) throw Error("Not enough replacement cards");
  const h = [...hand],
    d = [...deck],
    old = indices.map((i) => h[i]);
  for (const i of indices) h[i] = d.shift();
  return {
    hand: h,
    deck: shuffle(
      [...d, ...old],
      rng(`${seed}:opening-1:${side}:${indices.join(",")}`),
    ),
  };
}

/** @param {import("./types.js").Match} state */
export const openingPending = (state) =>
  state?.rules === RULES && state.opening?.player === null;
