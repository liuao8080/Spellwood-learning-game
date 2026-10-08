import test from "node:test";
import assert from "node:assert/strict";
import {
  createDuel,
  applyRitual,
  publicEvent,
} from "../server/duel-adapter.mjs";
import {
  startServer,
  pair,
  openBoth,
  activeClient,
} from "./network-helpers.mjs";
test("public ritual events target the affected own hero for healing/drawing and do not reveal drawn cards", () => {
  let s = createDuel(["grove", "moon"]);
  s.players[0].hp = 10;
  const healed = applyRitual(s, 0, "bloom", true);
  const e = publicEvent(
    s,
    healed,
    { type: "ritual", kind: "bloom", target: "hero" },
    0,
  );
  assert.equal(e.targetSeat, 0);
  assert.equal(e.changes[0].hpDelta, 3);
  assert(!Object.hasOwn(e, "hand"));
  assert(!Object.hasOwn(e, "deck"));
  s = createDuel(["grove", "moon"]);
  const drawn = applyRitual(s, 0, "insight", true);
  const d = publicEvent(s, drawn, { type: "ritual", kind: "insight" }, 0);
  assert.equal(d.targetSeat, 0);
  assert(!Object.hasOwn(d, "cardId"));
});
test("room expiry also discards private feedback retained in command receipts", async (t) => {
  const server = await startServer({ finishedMs: 40 });
  t.after(() => server.close());
  const clients = await pair(server, {
    grade: 1,
    course: "all",
    deckId: "grove",
  });
  await openBoth(clients);
  const c = activeClient(clients);
  await c.command("ritual.begin", { kind: "spark", target: "hero" });
  const q = await c.wait((m) => m.type === "private.challenge");
  await c.command("ritual.answer", {
    challengeId: q.challengeId,
    optionId: q.question.options[0].id,
  });
  assert(
    [
      ...server.service.sessions.get(c.session.sessionId).receipts.values(),
    ].some((x) => x.feedback),
  );
  await c.command("room.resign");
  await c.wait((m) => m.type === "room.expired");
  assert(
    ![
      ...server.service.sessions.get(c.session.sessionId).receipts.values(),
    ].some((x) => x.feedback),
  );
});
