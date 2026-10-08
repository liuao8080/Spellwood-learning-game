/** Two simulated protocol clients against an already running authority.
 * No browser, private answer lookup, shared storage or server-state injection. */
import WebSocket from "ws";
import { pathToFileURL } from "node:url";
import { CARD } from "../src/cards.mjs";
import { DuelConnection } from "../src/network/client.mjs";

const pause = (ms) => new Promise((r) => setTimeout(r, ms));
function bounded(promise, label, ms = 6000) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`Timed out: ${label}`)), ms); })]).finally(() => clearTimeout(timer));
}
async function until(fn, label, timeout = 6000) {
  const end = Date.now() + timeout;
  while (!fn()) { if (Date.now() > end) throw Error(`Timed out: ${label}`); await pause(10); }
  return fn();
}
function makeClient(origin) {
  const state = { room: null, challenge: null, learningReplies: 0 };
  state.connection = new DuelConnection({ url: origin.replace(/^http/, "ws") + "/ws", storage: null,
    socketFactory: (url) => new WebSocket(url, { origin }),
    onMessage(message) {
      if (message.type === "room.snapshot") state.room = message;
      if (message.type === "private.challenge") state.challenge = message;
      if (message.type === "private.feedback") { state.challenge = null; if (message.learning && !message.replayed) state.learningReplies++; }
    },
  });
  state.connection.connect(); return state;
}
function command(client, type, payload) {
  const s = client.room;
  return bounded(client.connection.command(type, payload, s ? { roomId: s.roomId, expectedRevision: s.revision } : {}), type);
}
function chooseVisibleMove(s) {
  const p = s.self, enemy = s.opponent;
  const guards = enemy.board.filter((u) => CARD[u.cardId].keyword === "guard");
  const attacker = p.board.find((u) => u.ready && u.atk > 0);
  if (attacker) return { type: "attack", uid: attacker.uid, target: guards.sort((a, b) => a.hp - b.hp)[0]?.uid || "hero" };
  const choices = p.hand.map((id, index) => ({ card: CARD[id], index })).filter(({ card }) => card.cost <= p.mana && (card.type === "spell" || p.board.length < 4));
  choices.sort((a, b) => a.card.cost - b.card.cost);
  for (const { card, index } of choices) {
    if (card.keyword === "restore" && p.hp > 13) continue;
    if (card.keyword === "insight" && (p.hand.length >= 6 || p.deckCount === 0)) continue;
    return { type: "play", index, ...(card.keyword === "damage" ? { target: guards.find((u) => u.hp <= 3)?.uid || "hero" } : {}) };
  }
  return { type: "end" };
}

export async function runSmoke(origin = "http://127.0.0.1:4173", { paceMs = 80, maxCommands = 300, solo = false } = {}) {
  origin = new URL(origin).origin;
  if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(origin).hostname)) throw Error("Use a dedicated local development server with no other participants");
  const get = (path, options = {}) => fetch(origin + path, { ...options, signal: AbortSignal.timeout(5000) });
  const started = Date.now(), health = await get("/health").then((r) => r.json());
  if (health.status !== "ok" || health.ruleset !== "net-1.0") throw Error("Unexpected authority health");
  const index = await get("/"), html = await index.text();
  if (index.status !== 200 || !html.includes('content="3.0.0-dev"')) throw Error("Network frontend missing");
  const asset = await get("/assets/creatures.webp", { method: "HEAD" });
  if (asset.status !== 200 || !asset.headers.get("content-type")?.includes("image/webp")) throw Error("Artwork route missing");
  const source = await get("/src/questions.json");
  if (![403, 404].includes(source.status)) throw Error("Private source route was exposed");
  const clients = Array.from({ length: solo ? 1 : 2 }, () => makeClient(origin));
  let commands = 0;
  try {
    await until(() => clients.every((c) => c.connection.state === "ready"), "two sessions");
    const options = { grade: 1, course: "s1-u1", deckId: "grove" };
    await Promise.all(clients.map((c) => bounded(c.connection.command("queue.join", options), "join queue")));
    await until(() => clients.every((c) => c.room?.phase === "opening"), "matched room", solo ? 15000 : 6000);
    if (solo ? clients[0].room.mode !== "pve" || clients[0].room.opponent.controller !== "bot" : clients[0].room.roomId !== clients[1].room.roomId || clients[0].room.youSeat === clients[1].room.youSeat) throw Error("Unexpected matched seats; use a dedicated development service");
    await Promise.all(clients.map((c) => command(c, "opening.choose", { indices: [] })));
    await until(() => clients.every((c) => c.room?.phase === "playing"), "opening confirmation");
    while (!clients.every((c) => c.room.phase === "finished")) {
      if (commands >= maxCommands || Date.now() - started > (solo ? 120000 : 60000)) throw Error("Simulation exceeded its bounded game budget");
      const client = clients.find((c) => c.room.canAct);
      if (!client) { await pause(10); continue; }
      if (Object.hasOwn(client.room.opponent, "hand") || Object.hasOwn(client.room.opponent, "deck")) throw Error("Opponent hidden data was exposed");
      const s = client.room;
      if (!s.self.ritualUsed && !s.self.ritualReserved && s.self.ritualsLeft > 0) {
        await command(client, "ritual.begin", { kind: "spark", target: "hero" }); commands++;
        const challenge = await until(() => client.challenge, "private challenge");
        // The script sees only the displayed options. It intentionally makes no
        // attempt to inspect answer keys or manufacture correct learning.
        await command(client, "ritual.answer", { challengeId: challenge.challengeId, optionId: challenge.question.options[0].id }); commands++;
      } else { await command(client, "battle.action", { action: chooseVisibleMove(s) }); commands++; }
      await pause(paceMs);
    }
    const [a, b] = clients.map((c) => c.room);
    if (b && JSON.stringify(a.state.players.map((p) => ({ hp: p.hp, armor: p.armor, board: p.board }))) !== JSON.stringify(b.state.players.map((p) => ({ hp: p.hp, armor: p.armor, board: p.board })))) throw Error("Final public states diverged");
    return { simulatedProtocolClients: clients.length, origin, health, frontendStatus: index.status, artworkStatus: asset.status, privateSourceStatus: source.status,
      matched: true, mode: a.mode, terminalPhase: a.phase, winnerSeat: a.result.winnerSeat, rounds: a.result.rounds, commands,
      learningReplies: clients.map((c) => c.learningReplies), publicFinalStatesEqual: b ? true : null, opponentController: solo ? a.opponent.controller : null, elapsedMs: Date.now() - started,
      browserOrHumanPlaytest: false };
  } finally { clients.forEach((c) => c.connection.disconnect()); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  runSmoke(args.find((arg) => !arg.startsWith("--")), { solo: args.includes("--solo") }).then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error("Protocol smoke failed:", error.message); process.exitCode = 1; });
}
