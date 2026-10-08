import test from "node:test";
import assert from "node:assert/strict";
import {
  CARD,
  DECKS,
  PRACTICE_DECK,
  validateCustomDeck,
} from "../src/cards.mjs";
import { payload } from "../server/protocol.mjs";
import { createDuel } from "../server/duel-adapter.mjs";
import { selectDifficulty } from "../src/combat-rating.mjs";
import { startServer, Client } from "./network-helpers.mjs";
const custom = () => [...DECKS[1].ids];
const options = (customDeck = custom()) => ({
  grade: 1,
  course: "all",
  deckId: "custom",
  customDeck,
});
test("custom deck validation accepts exactly twenty known IDs with at most three copies and never card attributes", () => {
  assert.equal(validateCustomDeck(custom()), true);
  for (const bad of [
    null,
    {},
    [],
    Array(20),
    custom().slice(1),
    [...custom(), "sprout"],
    Array(20).fill("sprout"),
    ["__proto__", ...custom().slice(1)],
    ["not-a-card", ...custom().slice(1)],
    [{ id: "sprout", atk: 99 }, ...custom().slice(1)],
  ]) {
    assert.equal(validateCustomDeck(bad), false);
    assert.throws(() => payload({ type: "queue.join", payload: options(bad) }));
  }
  assert.throws(() =>
    payload({ type: "queue.join", payload: { ...options(), deckId: "grove" } }),
  );
  assert.throws(() =>
    payload({
      type: "queue.join",
      payload: { grade: 1, course: "all", deckId: "custom" },
    }),
  );
  const request = options(),
    clean = payload({ type: "queue.join", payload: request });
  request.customDeck[0] = "phoenix";
  assert.notDeepEqual(clean.customDeck, request.customDeck);
});
test("authority revalidates each custom deck and copies it at game creation; easy bot keeps its fixed foundation", () => {
  const ids = custom();
  const s = createDuel(["custom", "moon"], {
    customDecks: [ids],
    computerSeat: 1,
    computer: selectDifficulty(),
  });
  const all = (p) => [...p.hand, ...p.deck].sort();
  assert.deepEqual(all(s.players[0]), [...ids].sort());
  assert.deepEqual(all(s.players[1]), [...PRACTICE_DECK.ids].sort());
  ids.fill("phoenix");
  assert.deepEqual(all(s.players[0]), custom().sort());
  assert.throws(
    () => createDuel(["custom", "grove"], { customDecks: [ids] }),
    /INVALID_DECK/,
  );
  assert.throws(
    () => createDuel(["custom", "custom"], { customDecks: [custom()] }),
    /INVALID_DECK/,
  );
});
test("real clients can match custom and preset decks without revealing the custom construction", async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const a = await new Client(server).open(),
    b = await new Client(server).open();
  t.after(() => {
    a.close();
    b.close();
  });
  assert.equal((await a.command("queue.join", options())).ok, true);
  assert.equal(
    (
      await b.command("queue.join", {
        grade: 1,
        course: "all",
        deckId: "grove",
      })
    ).ok,
    true,
  );
  await Promise.all([
    a.wait((m) => m.type === "room.snapshot"),
    b.wait((m) => m.type === "room.snapshot"),
  ]);
  assert.equal(a.view.roomId, b.view.roomId);
  assert.equal(a.view.mode, "pvp");
  for (const c of [a, b]) {
    assert.equal(c.view.opponent.hand, undefined);
    assert.equal(c.view.opponent.customDeck, undefined);
    assert.equal(c.view.customDeck, undefined);
    assert.ok(c.view.self.hand.every((id) => CARD[id]));
  }
});
