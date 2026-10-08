import test from "node:test";
import assert from "node:assert/strict";
import { createMatch, chooseAI } from "../src/engine.mjs";
import { startServer, Client, pair, openBoth } from "./network-helpers.mjs";
function chooseFromVisible(v) {
  const s = createMatch();
  s.active = 1;
  s.turn = v.turn;
  s.seq = v.revision;
  s.opening = { player: [], opponent: [] };
  s.log = [];
  s.players = v.state.players.map((p) => ({
    hp: p.hp,
    armor: p.armor,
    mana: p.mana,
    maxMana: p.maxMana,
    hand: p.hand ? [...p.hand] : Array(p.handCount).fill("_unknown"),
    deck: Array(p.deckCount).fill("_unknown"),
    board: structuredClone(p.board),
    fatigue: p.fatigue,
    ritualUsed: p.ritualUsed,
    ritualsLeft: p.ritualsLeft,
  }));
  if (v.youSeat === 0) s.players.reverse();
  return chooseAI(s, "control");
}
async function move(client) {
  const view = client.view,
    action = chooseFromVisible(view);
  if (action.type === "power") {
    const a = await client.command("ritual.begin", {
      kind: action.kind,
      ...(action.target ? { target: action.target } : {}),
    });
    assert(a.ok, JSON.stringify(a));
    const challenge = await client.wait(
      (m) =>
        m.type === "private.challenge" && m.revision === client.view.revision,
    );
    // The scripted client knows only the displayed choices. Always choosing the
    // first shuffled choice intentionally allows server-scored wrong answers.
    const result = await client.command("ritual.answer", {
      challengeId: challenge.challengeId,
      optionId: challenge.question.options[0].id,
    });
    assert(result.ok, JSON.stringify(result));
  } else {
    const a = await client.command("battle.action", { action });
    assert(a.ok, JSON.stringify(a));
  }
}
function publicState(v) {
  return {
    phase: v.phase,
    active: v.activeSeat,
    turn: v.turn,
    revision: v.revision,
    winner: v.result?.winnerSeat,
    players: v.state.players.map(({ hand, controlRequestPending, ...p }) => p),
  };
}
test("two real protocol clients finish an entire PvP game using only their own filtered views", async (t) => {
  const server = await startServer({ turnMs: 20000, commandRate: 2000 });
  t.after(() => server.close());
  const clients = await pair(server, {
    grade: 1,
    course: "all",
    deckId: "ember",
  });
  await openBoth(clients);
  let moves = 0;
  while (!clients.some((c) => c.view.phase === "finished") && moves++ < 600) {
    const latest = clients.reduce((a, b) =>
      a.view.revision > b.view.revision ? a : b,
    ).view;
    const current = clients.find((c) => c.view.youSeat === latest.activeSeat);
    if (current.view.revision < latest.revision)
      await current.wait(
        (m) => m.type === "room.snapshot" && m.revision >= latest.revision,
      );
    await move(current);
  }
  assert(moves < 600, "game should terminate");
  await Promise.all(
    clients.map((c) =>
      c.wait((m) => m.type === "room.snapshot" && m.phase === "finished"),
    ),
  );
  assert.deepEqual(publicState(clients[0].view), publicState(clients[1].view));
  assert.equal(clients[0].view.mode, "pvp");
  assert.equal(clients[0].view.assisted, false);
  for (const c of clients) {
    assert(c.view.result.ownLearning.attempts <= 4);
    assert(c.messages.some((m) => m.type === "private.challenge"));
    assert(!Object.hasOwn(c.view.opponent, "hand"));
  }
});
test("a waiting real client plays a complete server-side AI fallback match, never a local fake room", async (t) => {
  const server = await startServer({
    queueMs: 15,
    aiDelayMs: 2,
    turnMs: 20000,
    commandRate: 2000,
  });
  t.after(() => server.close());
  const c = await new Client(server).open();
  await c.command("queue.join", { grade: 1, course: "all", deckId: "ember" });
  await c.wait((m) => m.type === "room.snapshot");
  assert.equal(c.view.mode, "pve");
  assert.equal(c.view.opponent.controller, "bot");
  await c.command("opening.choose", { indices: [] });
  let moves = 0;
  while (c.view.phase !== "finished" && moves++ < 400) {
    if (c.view.activeSeat !== c.view.youSeat) {
      const rev = c.view.revision;
      await c.wait(
        (m) =>
          m.type === "room.snapshot" &&
          m.revision > rev &&
          (m.phase === "finished" || m.activeSeat === m.youSeat),
        { timeout: 10000 },
      );
    } else await move(c);
  }
  assert(moves < 400);
  assert.equal(c.view.phase, "finished");
  assert.equal(c.view.mode, "pve");
  assert.equal(c.view.assisted, false);
  assert(
    c.messages.some(
      (m) =>
        m.type === "room.snapshot" && m.event?.actorSeat === 1 - c.view.youSeat,
    ),
  );
});
