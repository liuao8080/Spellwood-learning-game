import test from "node:test";
import assert from "node:assert/strict";
import WebSocket from "ws";
import http from "node:http";
import { once } from "node:events";
import {
  startServer,
  Client,
  pair,
  openBoth,
  activeClient,
  sleep,
} from "./network-helpers.mjs";
const options = { grade: 1, course: "s1-u1", deckId: "grove" };
test("reclaiming an expired active turn lets the proxy finish and restores a timed next turn", async (t) => {
  const s = await startServer({ turnMs: 10000, aiDelayMs: 30 }); t.after(() => s.close());
  const clients = await pair(s, options); await openBoth(clients);
  const a = activeClient(clients), peer = clients.find((c) => c !== a), side = a.view.youSeat;
  const room = s.service.rooms.get(a.view.roomId);
  room.turnDeadline = Date.now() - 1; s.service.onTurnTimeout(room);
  await a.wait((m) => m.type === "room.snapshot" && m.self.controller === "proxy");
  const scheduled = room.timers.get("ai"); assert(scheduled);
  for (let i = 0; i < 3; i++) assert((await a.command("room.reclaim")).ok);
  assert.equal(room.seats[side].controller, "proxy"); assert.equal(room.seats[side].wantsHuman, true);
  assert.equal(a.view.self.controlRequestPending, true);
  assert.equal(Object.hasOwn(a.view.opponent, "controlRequestPending"), false);
  assert.equal(a.view.state.players[side].controlRequestPending, true);
  assert.equal(Object.hasOwn(a.view.state.players[1 - side], "controlRequestPending"), false);
  assert.equal(room.timers.get("ai"), scheduled, "repeated requests cannot postpone the original proxy action");
  await peer.wait((m) => m.type === "room.snapshot" && m.canAct);
  assert((await peer.command("battle.action", { action: { type: "end" } })).ok);
  const restored = await a.wait((m) => m.type === "room.snapshot" && m.canAct && m.turn > 1);
  assert.equal(restored.self.controller, "human"); assert.equal(restored.self.controlRequestPending, false); assert(restored.turnDeadline > Date.now());
});

test("absolute session expiry rejects a command before the periodic sweep and does not advance play", async (t) => {
  const s = await startServer({ sessionTtlMs: 10000, aiDelayMs: 1000 }); t.after(() => s.close());
  const clients = await pair(s, options); await openBoth(clients); const a = activeClient(clients);
  const room = s.service.rooms.get(a.view.roomId), turn = room.state.turn;
  s.service.sessions.get(a.session.sessionId).createdAt = Date.now() - 10001;
  a.ws.send(JSON.stringify({ type: "battle.action", commandId: "expired-session-command", clientSeq: a.nextSeq,
    roomId: a.view.roomId, expectedRevision: a.view.revision, payload: { action: { type: "end" } } }));
  const error = await a.wait((m) => m.type === "session.error");
  assert.equal(error.code, "SESSION_EXPIRED"); assert.equal(room.state.turn, turn);
  assert.equal(s.service.sessions.has(a.session.sessionId), false);
});

test("session TTL expiry still triggers disconnected room abandonment and cleanup", async (t) => {
  const s = await startServer({
    sessionTtlMs: 150,
    roomTtlMs: 5000,
    abandonMs: 60,
    finishedMs: 30,
    turnMs: 2000,
    reconnectMs: 10,
  });
  t.after(() => s.close());
  const cs = await pair(s, options);
  await openBoth(cs);
  await sleep(370);
  assert.equal(s.service.sessions.size, 0);
  assert.equal(s.service.rooms.size, 0);
  assert.equal(s.service.queues.size, 0);
});
test("lost answer feedback can be recovered by the same seat without a second effect or learning attempt", async (t) => {
  const s = await startServer();
  t.after(() => s.close());
  const cs = await pair(s, options);
  await openBoth(cs);
  const a = activeClient(cs);
  await a.command("ritual.begin", { kind: "spark", target: "hero" });
  const q = await a.wait((m) => m.type === "private.challenge");
  await a.command("ritual.answer", {
    challengeId: q.challengeId,
    optionId: q.question.options[0].id,
  });
  const old = a.lastCommand,
    original = await a.wait((m) => m.type === "private.feedback"),
    revision = a.view.revision;
  const token = a.token;
  a.close();
  await sleep(5);
  const restored = await new Client(s, token, a.cookie).open();
  const feedback = await restored.wait((m) => m.type === "private.feedback");
  assert.equal(feedback.replayed, true);
  assert.equal(feedback.challengeId, original.challengeId);
  assert.deepEqual(feedback.learning, original.learning);
  assert((await restored.raw(old)).ok);
  assert.equal(restored.view.revision, revision);
  assert.equal(
    s.service.rooms.get(restored.view.roomId).seats[restored.view.youSeat]
      .learning.attempts,
    1,
  );
  assert(
    (await restored.command("battle.action", { action: { type: "end" } })).ok,
  );
});
test("one active socket per resume token; old socket is replaced and cannot create a second seat", async (t) => {
  const s = await startServer();
  t.after(() => s.close());
  const old = await new Client(s).open();
  const replacement = await new Client(s, old.token, old.cookie).open();
  const event = await old.wait((m) => m.type === "session.replaced");
  assert(event);
  assert.equal(replacement.session.sessionId, old.session.sessionId);
  assert.equal(s.service.sessions.size, 1);
  await sleep(10);
  assert.notEqual(old.ws.readyState, 1);
  assert((await replacement.command("queue.join", options)).ok);
});
test("strict origins, hosts, message size and authentication reject unknown browser contexts", async (t) => {
  const s = await startServer();
  t.after(() => s.close());
  const bad = new WebSocket(s.origin.replace(/^http/, "ws") + "/ws", {
    origin: "https://unrelated.invalid",
  });
  bad.on("error", () => {});
  const [, res] = await once(bad, "unexpected-response");
  assert.equal(res.statusCode, 403);
  res.resume();
  bad.terminate();
  const rejected = await new Promise((resolve, reject) => {
    http
      .get(
        s.origin + "/health",
        { headers: { Host: "unrelated.invalid" } },
        (r) => {
          r.resume();
          resolve(r.statusCode);
        },
      )
      .on("error", reject);
  });
  assert.equal(rejected, 403);
  const c = await new Client(s).open();
  c.ws.send("x".repeat(9000));
  const [code] = await once(c.ws, "close");
  assert.equal(code, 1009);
});
test("opening expiry keeps original hands; expired finished rooms are reclaimed without reviving via old commands", async (t) => {
  const s = await startServer({ openingMs: 40, finishedMs: 35 });
  t.after(() => s.close());
  const [a, b] = await pair(s, options);
  const hand = [...a.view.self.hand];
  await a.wait((m) => m.type === "room.snapshot" && m.phase === "playing");
  assert.deepEqual(a.view.self.hand, hand);
  await a.command("room.resign");
  const oldId = a.view.roomId;
  await a.wait((m) => m.type === "room.expired");
  assert(!s.service.rooms.has(oldId));
  assert.equal(
    (await a.command("room.resync", {}, { roomId: oldId })).code,
    "NOT_YOUR_ROOM",
  );
  assert((await a.command("queue.join", options)).ok);
});

test("ready explicitly has no room after an offline peer missed resignation and room expiry", async (t) => {
  const s = await startServer({ finishedMs: 35, reconnectMs: 500 });
  t.after(() => s.close());
  const cs = await pair(s, options);
  await openBoth(cs);
  const a = cs[0],
    b = cs[1],
    token = a.token,
    oldRoom = a.view.roomId;
  assert.equal(a.session.roomId, null);
  a.close();
  await sleep(5);
  assert((await b.command("room.resign")).ok);
  await b.wait((m) => m.type === "room.expired");
  assert(!s.service.rooms.has(oldRoom));
  const restored = await new Client(s, token, a.cookie).open();
  assert(Object.hasOwn(restored.session, "roomId"));
  assert.equal(restored.session.roomId, null);
  await sleep(10);
  assert(!restored.messages.some((m) => m.type === "room.snapshot"));
  assert.equal(s.service.sessions.get(restored.session.sessionId).roomId, null);
});

test("opponent resignation cancels an open question and reconnect never revives it", async (t) => {
  const s = await startServer();
  t.after(() => s.close());
  const cs = await pair(s, options);
  await openBoth(cs);
  const a = activeClient(cs),
    b = cs.find((c) => c !== a);
  await a.command("ritual.begin", { kind: "spark", target: "hero" });
  const q = await a.wait((m) => m.type === "private.challenge");
  assert(
    (await b.command("room.resign", {}, { expectedRevision: a.view.revision }))
      .ok,
  );
  await a.wait((m) => m.type === "room.snapshot" && m.phase === "finished");
  assert.equal(a.view.canAnswer, false);
  assert.equal(a.view.self.ritualReserved, false);
  const token = a.token;
  a.close();
  await sleep(5);
  const restored = await new Client(s, token, a.cookie).open();
  const state = await restored.wait((m) => m.type === "room.snapshot");
  assert.equal(state.phase, "finished");
  await sleep(10);
  assert(!restored.messages.some((m) => m.type === "private.challenge"));
  assert(
    !restored.messages.some(
      (m) => m.type === "private.feedback" && m.challengeId === q.challengeId,
    ),
  );
  assert.equal(state.result.ownLearning.attempts, 0);
});
