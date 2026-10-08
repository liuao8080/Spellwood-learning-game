import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createGameServer } from "../server/index.mjs";
import { PROTOCOL } from "../server/protocol.mjs";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function startServer(config = {}, extra = {}) {
  const s = createGameServer({
    port: 0,
    config: {
      queueMs: 500,
      openingMs: 3000,
      turnMs: 10000,
      questionMs: 5000,
      aiDelayMs: 5,
      commandRate: 1000,
      ...config,
    },
    messageRate: 2000,
    ...extra,
  });
  await s.listen();
  return s;
}
export class Client {
  constructor(server, token, cookie = '') {
    this.server = server;
    this.messages = [];
    this.waiters = [];
    this.nextSeq = 1;
    this.counter = 0;
    this.commandPrefix = randomUUID();
    this.view = null;
    this.token = token;
    this.cookie = cookie;
    this.ws = new WebSocket(server.origin.replace(/^http/, "ws") + "/ws", {
      origin: server.origin,
      ...(cookie ? {headers: {Cookie: cookie}} : {}),
    });
    this.ws.on('upgrade', response => {
      const jar = new Map(this.cookie.split(';').filter(Boolean).map(p => p.trim().split(/=(.*)/s).slice(0, 2)));
      for (const item of response.headers['set-cookie'] || []) {
        const pair = item.split(';')[0], at = pair.indexOf('=');
        const name = pair.slice(0, at), value = pair.slice(at + 1);
        if (/Max-Age=0(?:;|$)/i.test(item)) jar.delete(name); else jar.set(name, value);
      }
      this.cookie = [...jar].map(([k,v]) => `${k}=${v}`).join('; ');
    });
    this.ws.on("error", () => {});
    this.ws.on("message", (raw) => {
      const m = JSON.parse(String(raw));
      this.messages.push(m);
      if (m.type === "session.ready") {
        this.session = m;
        this.nextSeq = m.nextClientSeq;
        this.token = m.resumeToken || this.token;
      }
      if (m.type === "room.snapshot") this.view = m;
      for (const w of [...this.waiters]) w();
    });
  }
  async open() {
    await once(this.ws, "open");
    this.ws.send(
      JSON.stringify(
        this.token
          ? { type: "session.resume", protocol: PROTOCOL, resumeToken: this.token }
          : { type: "session.open", protocol: PROTOCOL },
      ),
    );
    const m = await this.wait(
      (m) => m.type === "session.ready" || m.type === "session.error",
    );
    if (m.type === "session.error")
      throw Object.assign(Error(m.code), { code: m.code });
    return this;
  }
  wait(predicate, { after = 0, timeout = 3000 } = {}) {
    const found = this.messages.slice(after).find(predicate);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      let timer;
      const check = () => {
        const m = this.messages.slice(after).find(predicate);
        if (m) {
          clearTimeout(timer);
          this.waiters = this.waiters.filter((w) => w !== check);
          resolve(m);
        }
      };
      this.waiters.push(check);
      timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w !== check);
        reject(
          Error(
            "Network message timeout; recent=" +
              JSON.stringify(this.messages.slice(-3)),
          ),
        );
      }, timeout);
    });
  }
  async command(type, payload = {}, overrides = {}) {
    const c = {
      type,
      commandId: this.commandPrefix + "-" + ++this.counter,
      clientSeq: this.nextSeq++,
      payload,
      ...(type.startsWith("room.") ||
      type.startsWith("opening.") ||
      type.startsWith("battle.") ||
      type.startsWith("draw.") ||
      type.startsWith("ritual.")
        ? { roomId: this.view?.roomId, expectedRevision: this.view?.revision }
        : {}),
      ...overrides,
    };
    this.lastCommand = c;
    return this.raw(c);
  }
  async raw(c) {
    const after = this.messages.length;
    this.ws.send(JSON.stringify(c));
    const ack = await this.wait(
      (m) => m.type === "command.ack" && m.commandId === c.commandId,
      { after },
    );
    this.nextSeq = ack.nextClientSeq;
    return ack;
  }
  close() {
    this.ws.terminate();
  }
}
export async function pair(
  server,
  options = { grade: 1, course: "all", deckId: "grove" },
) {
  const a = await new Client(server).open(),
    b = await new Client(server).open();
  await a.command("queue.join", options);
  await b.command("queue.join", options);
  await Promise.all([
    a.wait((m) => m.type === "room.snapshot"),
    b.wait((m) => m.type === "room.snapshot"),
  ]);
  return [a, b];
}
export async function openBoth(clients) {
  const revision = clients[0].view.revision;
  await Promise.all(
    clients.map((c) =>
      c.command(
        "opening.choose",
        { indices: [] },
        { expectedRevision: revision },
      ),
    ),
  );
  await Promise.all(
    clients.map((c) =>
      c.wait((m) => m.type === "room.snapshot" && m.phase === "playing"),
    ),
  );
}
export const activeClient = (clients) =>
  clients.find((c) => c.view.youSeat === c.view.activeSeat);
