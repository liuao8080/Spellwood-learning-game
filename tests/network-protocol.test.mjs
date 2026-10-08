import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  startServer,
  Client,
  pair,
  openBoth,
  activeClient,
  sleep,
} from "./network-helpers.mjs";
const options = { grade: 1, course: "s1-u1", deckId: "grove" };
function safe(s) {
  assert.equal(s.state.players.length, 2);
  assert(Array.isArray(s.state.players[s.youSeat].hand));
  assert(!Object.hasOwn(s.state.players[1 - s.youSeat], "hand"));
  assert(!Object.hasOwn(s.opponent, "hand"));
  for (const p of s.state.players) {
    assert(!Object.hasOwn(p, "deck"));
    assert(!Object.hasOwn(p, "seed"));
  }
  assert(!Object.hasOwn(s.state, "seed"));
}
test("real independent WebSocket sessions share authoritative room, private hands and two openings", async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const [a, b] = await pair(server, options);
  assert.notEqual(a.session.sessionId, b.session.sessionId);
  assert.equal(a.view.roomId, b.view.roomId);
  assert.notEqual(a.view.youSeat, b.view.youSeat);
  for (const c of [a, b]) {
    safe(c.view);
    assert.equal(c.view.self.hand.length, 4);
    assert.equal(c.view.self.deckCount, 16);
  }
  const rev = a.view.revision;
  const responses = await Promise.all([
    a.command("opening.choose", { indices: [0, 2] }, { expectedRevision: rev }),
    b.command("opening.choose", { indices: [] }, { expectedRevision: rev }),
  ]);
  assert(responses.every((x) => x.ok));
  await Promise.all(
    [a, b].map((c) =>
      c.wait((m) => m.type === "room.snapshot" && m.phase === "playing"),
    ),
  );
  let active = activeClient([a, b]);
  assert.equal(active.view.youSeat, 0);
  assert.equal(active.view.self.hand.length, 4);
  assert(
    (await active.command("battle.action", { action: { type: "end" } })).ok,
  );
  await Promise.all(
    [a, b].map((c) =>
      c.wait((m) => m.type === "room.snapshot" && m.activeSeat === 1),
    ),
  );
  active = activeClient([a, b]);
  assert.equal(active.view.self.hand.length, 5);
  assert.equal(active.view.self.mana, 1);
  safe(active.view);
});
test("seat-bound actions, duplicate command receipts, old revisions, power/correct injection rejected", async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const clients = await pair(server, options);
  await openBoth(clients);
  const active = activeClient(clients),
    other = clients.find((x) => x !== active);
  assert.equal(
    (await other.command("battle.action", { action: { type: "end" } })).code,
    "NOT_YOUR_TURN",
  );
  assert.equal(
    (
      await active.command("battle.action", {
        action: { type: "power", kind: "spark", target: "hero" },
      })
    ).code,
    "FORBIDDEN_ACTION",
  );
  assert.equal(
    (
      await active.command("ritual.begin", {
        kind: "spark",
        target: "hero",
        correct: true,
      })
    ).code,
    "BAD_PAYLOAD",
  );
  const oldRev = active.view.revision;
  assert(
    (await active.command("battle.action", { action: { type: "end" } })).ok,
  );
  const c = active.lastCommand;
  const newRev = active.view.revision;
  assert(newRev > oldRev);
  assert((await active.raw(c)).ok);
  assert.equal(active.view.revision, newRev);
  assert.equal(
    (
      await active.raw({
        ...c,
        payload: { action: { type: "play", index: 0 } },
      })
    ).code,
    "SEQ_REUSE",
  );
  assert.equal(
    (
      await other.command(
        "battle.action",
        { action: { type: "end" } },
        { expectedRevision: oldRev },
      )
    ).code,
    "STALE_STATE",
  );
});
test("each seat gets own opaque question; answers judged on server and duplicate answer cannot grant twice", async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  const clients = await pair(server, options);
  await openBoth(clients);
  for (let turn = 0; turn < 2; turn++) {
    const active = activeClient(clients),
      other = clients.find((x) => x !== active),
      otherCount = other.messages.length;
    assert(
      (await active.command("ritual.begin", { kind: "spark", target: "hero" }))
        .ok,
    );
    const challenge = await active.wait(
      (m) =>
        m.type === "private.challenge" && m.revision === active.view.revision,
    );
    const text = JSON.stringify(challenge);
    assert(!text.includes("correctOptionId"));
    assert(!Object.hasOwn(challenge.question, "answer"));
    assert(!Object.hasOwn(challenge.question, "target"));
    assert(!Object.hasOwn(challenge.question, "id"));
    assert(!Object.hasOwn(challenge.question, "explanation"));
    assert.equal(
      (
        await other.command(
          "ritual.answer",
          {
            challengeId: challenge.challengeId,
            optionId: challenge.question.options[0].id,
          },
          { expectedRevision: active.view.revision },
        )
      ).code,
      "NOT_YOUR_TURN",
    );
    assert.equal(
      (await active.command("battle.action", { action: { type: "end" } })).code,
      "CHALLENGE_PENDING",
    );
    assert.equal(
      (
        await active.command("ritual.answer", {
          challengeId: challenge.challengeId,
          optionId: "made-up",
        })
      ).code,
      "INVALID_OPTION",
    );
    assert(
      (
        await active.command("ritual.answer", {
          challengeId: challenge.challengeId,
          optionId: challenge.question.options[0].id,
        })
      ).ok,
    );
    const sent = active.lastCommand,
      feedback = await active.wait(
        (m) =>
          m.type === "private.feedback" &&
          m.challengeId === challenge.challengeId,
      );
    assert(["correct", "wrong"].includes(feedback.outcome));
    assert.equal(feedback.learning.qid, feedback.questionId);
    const rev = active.view.revision;
    assert.equal(active.view.self.ritualsLeft, 3);
    assert((await active.raw(sent)).ok);
    assert.equal(active.view.revision, rev);
    assert.equal(active.view.self.ritualsLeft, 3);
    assert(
      !other.messages
        .slice(otherCount)
        .some(
          (m) =>
            m.type === "private.challenge" || m.type === "private.feedback",
        ),
    );
    assert(
      (await active.command("battle.action", { action: { type: "end" } })).ok,
    );
    await other.wait(
      (m) =>
        m.type === "room.snapshot" &&
        m.activeSeat === other.view.youSeat &&
        m.turn === turn + 2,
    );
  }
});
test("unmatched course never pairs; cancellation is idempotent; waiting creates visibly marked bot", async (t) => {
  const server = await startServer({ queueMs: 100, aiDelayMs: 10 });
  t.after(() => server.close());
  const a = await new Client(server).open(),
    b = await new Client(server).open();
  await a.command("queue.join", { ...options, course: "s1-u1" });
  await b.command("queue.join", { ...options, course: "s1-u2" });
  await a.command("queue.cancel");
  const cmd = a.lastCommand;
  assert((await a.raw(cmd)).ok);
  const room = await b.wait((m) => m.type === "room.snapshot");
  assert.equal(room.mode, "pve");
  assert.equal(room.opponent.controller, "bot");
  assert(["Ember", "Moss", "Luna"].includes(room.opponent.name));
  await sleep(120);
  assert.equal(a.view, null);
});
test("reconnection restores same seat and pending challenge without history replay or re-dealing", async (t) => {
  const server = await startServer({ reconnectMs: 500 });
  t.after(() => server.close());
  const clients = await pair(server, options);
  await openBoth(clients);
  const old = activeClient(clients);
  await old.command("ritual.begin", { kind: "spark", target: "hero" });
  const question = await old.wait((m) => m.type === "private.challenge"),
    hand = [...old.view.self.hand],
    roomId = old.view.roomId,
    seat = old.view.youSeat,
    token = old.token;
  old.close();
  await sleep(10);
  const resumed = await new Client(server, token).open();
  const view = await resumed.wait((m) => m.type === "room.snapshot");
  assert.equal(view.roomId, roomId);
  assert.equal(view.youSeat, seat);
  assert.deepEqual(view.self.hand, hand);
  assert.equal(view.event, null);
  assert.equal(view.resync, true);
  const q = await resumed.wait((m) => m.type === "private.challenge");
  assert.equal(q.challengeId, question.challengeId);
  assert.deepEqual(q.question.options, question.question.options);
});
test("question timeout grants armor once without learning mistake; client cannot answer expired challenge", async (t) => {
  const server = await startServer({
    turnMs: 70,
    questionMs: 100,
    aiDelayMs: 1000,
  });
  t.after(() => server.close());
  const clients = await pair(server, options);
  await openBoth(clients);
  const active = activeClient(clients);
  await active.command("ritual.begin", { kind: "spark", target: "hero" });
  const q = await active.wait((m) => m.type === "private.challenge");
  const f = await active.wait(
    (m) => m.type === "private.feedback" && m.challengeId === q.challengeId,
    { timeout: 1000 },
  );
  assert.equal(f.outcome, "unanswered");
  assert(!Object.hasOwn(f, "learning"));
  assert.equal(active.view.self.armor, 1);
  assert.equal(active.view.self.ritualsLeft, 3);
  assert.equal(active.view.self.controller, "proxy");
  assert.equal(
    (
      await active.command("ritual.answer", {
        challengeId: q.challengeId,
        optionId: q.question.options[0].id,
      })
    ).code,
    "INVALID_CHALLENGE",
  );
});
test("HTTP exposes only explicit public assets and answer-free metadata, then one intentional study feedback", async (t) => {
  const server = await startServer();
  t.after(() => server.close());
  for (const endpoint of [
    "/src/questions.json",
    "/src/speech-assets.json",
    "/dist/index.html",
    "/package.json",
    "/server/questions.mjs",
    "/assets/../src/questions.json",
  ])
    assert.equal((await fetch(server.origin + endpoint)).status, 404, endpoint);
  const meta = await (await fetch(server.origin + "/api/curriculum")).json();
  assert.equal(meta.questions.length, 432);
  assert(!JSON.stringify(meta).includes('"answer"'));
  assert(!JSON.stringify(meta).includes('"target"'));
  const qid = meta.questions[0].id,
    q = await (await fetch(server.origin + "/api/study/" + qid)).json();
  assert(!Object.hasOwn(q.question, "answer"));
  const response = await fetch(
    server.origin + "/api/study/" + qid + "/answer",
    {
      method: "POST",
      headers: { Origin: server.origin, "Content-Type": "application/json" },
      body: JSON.stringify({
        challengeId: q.challengeId,
        optionId: q.question.options[0].id,
      }),
    },
  );
  assert.equal(response.status, 200);
  const feedback = await response.json();
  assert(feedback.explanation);
  assert.equal(feedback.questionId, qid);
  const asset = q.question.visual?.assetUrl;
  if (asset) assert.equal((await fetch(server.origin + asset)).status, 200);
});
