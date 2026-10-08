import { CARD } from "../cards.mjs";

/** Presentation hints from the public board. The server still validates moves. */
export function targetPreview(state, seat, selection) {
  const none = { source: null, targets: [] };
  if (!state || state.phase !== "playing" || state.active !== seat || !selection) return none;
  const own = state.players[seat], enemy = state.players[1 - seat];
  if (!own || !enemy || own.controller === "proxy") return none;
  const all = [...enemy.board.map((unit) => unit.uid), `hero:${1 - seat}`];
  if (selection.kind === "unit") {
    const unit = own.board.find((item) => item.uid === selection.uid);
    if (!unit?.ready || unit.atk < 1) return none;
    const guards = enemy.board.filter((item) => CARD[item.cardId]?.keyword === "guard");
    return { source: unit.uid, targets: guards.length ? guards.map((item) => item.uid) : all };
  }
  if (selection.kind === "card") {
    const card = CARD[own.hand?.[selection.index]];
    if (card?.keyword === "damage" && own.mana >= card.cost) return { source: `hero:${seat}`, targets: all };
  }
  if (selection.kind === "ritual" && selection.ritual === "spark" && !own.ritualUsed && !own.ritualReserved && own.ritualsLeft > 0)
    return { source: `hero:${seat}`, targets: all };
  return none;
}
