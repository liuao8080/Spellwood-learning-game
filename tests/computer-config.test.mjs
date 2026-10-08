import test from "node:test";
import assert from "node:assert/strict";
import { GameService } from "../server/service.mjs";
import { OPPONENTS, PRACTICE_DECK, DECKS } from "../src/cards.mjs";
import { selectDifficulty } from "../src/combat-rating.mjs";
import { payload, versions } from "../server/protocol.mjs";
function harness(config = {}) {
  const service = new GameService({
    questions: { createDeck: () => [] },
    send: () => {},
    config: { ...config, openingMs: 100000 },
  });
  const human = () => service.makeSession({ readyState: 1 });
  const options = { grade: 1, course: "all", deckId: "grove" };
  return { service, human, options };
}
test("PVE computer policy is locked when the room opens and exposed without leaking cards", (t) => {
  const plan = selectDifficulty();
  const { service, human, options } = harness({ computerDifficulty: plan });
  t.after(() => service.close());
  const session = human();
  service.makeRoom([
    { session, options },
    { bot: OPPONENTS[0], options: { ...options, deckId: "ember" } },
  ]);
  const room = [...service.rooms.values()][0],
    seat = service.seat(room, session),
    computerSeat = 1 - seat;
  assert.deepEqual(room.computer, plan);
  assert.deepEqual(
    [
      ...room.state.players[computerSeat].hand,
      ...room.state.players[computerSeat].deck,
    ].sort(),
    [...PRACTICE_DECK.ids].sort(),
  );
  plan.level = "tactical";
  service.config.computerDifficulty = "tactical";
  assert.equal(room.computer.level, "easy");
  const view = service.view(room, seat);
  assert.equal(view.computer.level, "easy");
  assert.equal(view.opponent.hand, undefined);
  assert.equal(view.self.deck, undefined);
  assert.equal(view.opponent.deck, undefined);
  assert.equal(view.computer.ritualLimit, 2);
  service.finish(room, computerSeat, "resigned", seat);
  const result = service.resultFor(room, seat);
  assert.equal(result.ownScore, 0);
  assert.equal(result.computer.level, "easy");
});
test("server default honestly declares fixed advanced AI, while PVP has no computer policy", (t) => {
  const { service, human, options } = harness();
  t.after(() => service.close());
  const a = human();
  service.makeRoom([
    { session: a, options },
    { bot: OPPONENTS[0], options: { ...options, deckId: "ember" } },
  ]);
  const first = [...service.rooms.values()][0];
  assert.equal(first.computer.level, "tactical");
  assert.equal(first.computer.mode, "fixed");
  const b = human(),
    c = human();
  service.config.computerDifficulty = "easy";
  service.makeRoom([
    { session: b, options },
    { session: c, options },
  ]);
  const second = [...service.rooms.values()][1];
  assert.equal(second.computer, null);
  assert.equal(
    service.view(second, service.seat(second, b)).computer,
    undefined,
  );
  for (const p of second.state.players)
    assert.deepEqual([...p.hand, ...p.deck].sort(), [...DECKS[0].ids].sort());
});
test("network version matching rejects old rules and never accepts client difficulty or rating fields", () => {
  assert.equal(versions.ruleset, "net-2.3");
  assert.equal(versions.combatRules, "2.3");
  const options = { grade: 1, course: "all", deckId: "grove" };
  for (const extra of [
    { combatRules: "2.1" },
    { combatRules: "2.2" },
    { ruleset: "net-1.1" },
    { ruleset: "net-1.0" },
    { combatRating: 400 },
    { computerDifficulty: "easy" },
  ])
    assert.throws(() =>
      payload({ type: "queue.join", payload: { ...options, ...extra } }),
    );
});
