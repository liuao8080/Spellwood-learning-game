// Read-only production-code benchmark. All identities/data are fictitious and temporary.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fork, execFileSync } from "node:child_process";
import { performance, monitorEventLoopDelay } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { PROTOCOL } from "../server/protocol.mjs";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.resolve(
  process.env.SPELLWOOD_BENCH_OUTPUT ||
    path.join(ROOT, "test-results/server-capacity"),
);
fs.mkdirSync(OUT, { recursive: true });
const SMOKE = process.argv.includes("--smoke");
const ACTIVE_MS = SMOKE ? 2000 : 10000;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const summary = (values) => {
  const a = [...values].sort((a, b) => a - b);
  return {
    n: a.length,
    mean: a.length ? a.reduce((s, x) => s + x, 0) / a.length : null,
    p50: a.length ? a[Math.ceil(a.length * 0.5) - 1] : null,
    p95: a.length ? a[Math.ceil(a.length * 0.95) - 1] : null,
    max: a.at(-1) ?? null,
  };
};
const maybeRead = (p) => {
  try {
    return fs.readFileSync(p, "utf8").trim();
  } catch {
    return null;
  }
};
const gitInfo = (args) => {
  try {
    return execFileSync("git", args, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
};
function facts() {
  return {
    node: process.version,
    platform: process.platform,
    osRelease: os.release(),
    arch: process.arch,
    visibleLogicalCPUs: os.cpus().length,
    availableParallelism: os.availableParallelism(),
    visibleTotalMemoryBytes: os.totalmem(),
    visibleFreeMemoryBytes: os.freemem(),
    procCgroup: maybeRead("/proc/self/cgroup"),
    cgroupMounts: (maybeRead("/proc/mounts") || "")
      .split("\n")
      .filter((l) => l.includes("cgroup")),
    cgroupMemoryMax: maybeRead("/sys/fs/cgroup/memory.max"),
    cgroupCpuMax: maybeRead("/sys/fs/cgroup/cpu.max"),
    cgroupV1MemoryLimit: maybeRead(
      "/sys/fs/cgroup/memory/memory.limit_in_bytes",
    ),
    cgroupV1CpuQuota: maybeRead("/sys/fs/cgroup/cpu/cpu.cfs_quota_us"),
    cgroupV1CpuPeriod: maybeRead("/sys/fs/cgroup/cpu/cpu.cfs_period_us"),
    cgroupV1EffectiveCPUs: maybeRead(
      "/sys/fs/cgroup/cpuset/cpuset.effective_cpus",
    ),
    resourceCaveat:
      "Visible host resources are not a reservation or guaranteed capacity. Missing cgroup values mean unavailable, not unlimited.",
  };
}
if (process.argv[2] === "--server") {
  const { createGameServer } = await import(ROOT + "/server/index.mjs");
  const app = createGameServer({
    host: "127.0.0.1",
    port: 0,
    databasePath: process.argv[3],
  });
  let measurements = [],
    rssSamples = [],
    cpuStart = process.cpuUsage(),
    start = performance.now();
  const loop = monitorEventLoopDelay({ resolution: 10 });
  loop.enable();
  const commit = app.identityStore.commitPlayerEvent.bind(app.identityStore);
  app.identityStore.commitPlayerEvent = (...args) => {
    const t = performance.now();
    try {
      return commit(...args);
    } finally {
      measurements.push(performance.now() - t);
    }
  };
  const sample = setInterval(() => {
    rssSamples.push(process.memoryUsage().rss);
    if (process.memoryUsage().rss > 280 * 1024 ** 2) {
      process.send({
        type: "fatal",
        error: "Server RSS approached shared 384 MiB process-tree guard",
      });
      process.exit(86);
    }
  }, 100);
  sample.unref();
  const stats = () => {
    const elapsedMs = performance.now() - start,
      cpu = process.cpuUsage(cpuStart);
    return {
      elapsedMs,
      cpuUserMs: cpu.user / 1000,
      cpuSystemMs: cpu.system / 1000,
      cpuPercentOfOneCore: ((cpu.user + cpu.system) / 1000 / elapsedMs) * 100,
      rssBytes: process.memoryUsage().rss,
      rssSamples: summary(rssSamples),
      heapUsedBytes: process.memoryUsage().heapUsed,
      eventLoopDelayMs: {
        sampleCount: loop.count,
        mean: Number.isFinite(loop.mean) ? loop.mean / 1e6 : null,
        p50: loop.percentile(50) / 1e6,
        p95: loop.percentile(95) / 1e6,
        max: loop.max / 1e6,
        resolution: 10,
      },
      durableCommitCallMs: summary(measurements),
      sessions: app.service.sessions.size,
      rooms: app.service.rooms.size,
    };
  };
  process.on("message", async (m) => {
    try {
      let result;
      if (m.type === "fixtures") {
        result = Array.from({ length: m.count }, () => {
          const x = app.identityStore.createGuest();
          return {
            playerId: x.player.playerId,
            cookie: "sw_guest=" + x.session.token,
          };
        });
      } else if (m.type === "reset") {
        measurements = [];
        rssSamples = [];
        loop.reset();
        cpuStart = process.cpuUsage();
        start = performance.now();
        result = true;
      } else if (m.type === "stats") result = stats();
      else if (m.type === "profiles") {
        const rows = m.playerIds.map((id) =>
          app.identityStore.getPublicPlayer(id),
        );
        result = {
          count: rows.length,
          serializedProgressBytes: summary(
            rows.map((x) => Buffer.byteLength(JSON.stringify(x.progress))),
          ),
          distinctSeenQuestions: summary(
            rows.map(
              (x) =>
                Object.values(x.progress.legacy?.mastery || {}).filter(
                  (q) => q.seen > 0,
                ).length,
            ),
          ),
          totalLearningAttempts: summary(
            rows.map((x) =>
              Object.values(x.progress.legacy?.mastery || {}).reduce(
                (n, q) => n + (q.seen || 0),
                0,
              ),
            ),
          ),
          onlineMatchRecords: summary(
            rows.map((x) => x.progress.onlineRecords?.length || 0),
          ),
        };
      } else if (m.type === "verify") {
        result = m.events.every((x) =>
          app.identityStore.hasPlayerEvent(
            x.playerId,
            "preferences:" + x.requestId,
          ),
        );
      } else if (m.type === "close") {
        clearInterval(sample);
        loop.disable();
        await app.close();
        process.send({ id: m.id, result: true });
        process.disconnect();
        return;
      }
      process.send({ id: m.id, result });
    } catch (e) {
      process.send({ id: m.id, error: e.code || e.message });
    }
  });
  try {
    await app.listen();
    process.send({ type: "ready", origin: app.origin, pid: process.pid });
  } catch (e) {
    process.send({ type: "fatal", error: e.code || e.message });
    await app.close();
    process.exitCode = 1;
  }
} else if (process.argv[2] === "--password") {
  const { createIdentityStore } = await import(
    ROOT + "/server/identity-store.mjs"
  );
  const { DEFAULT_SCRYPT_PARAMETERS } = await import(
    ROOT + "/server/passwords.mjs"
  );
  const tmp = fs.mkdtempSync(
    path.join(os.tmpdir(), "spellwood-password-capacity-"),
  );
  const store = createIdentityStore({
    databasePath: path.join(tmp, "temporary.sqlite"),
  });
  let peak = process.memoryUsage().rss;
  const timer = setInterval(() => {
    peak = Math.max(peak, process.memoryUsage().rss);
    if (peak > 300 * 1024 ** 2) process.exit(86);
  }, 10);
  const trial = async (index) => {
    const guest = store.createGuest();
    const t = performance.now();
    await store.registerGuest({
      guestToken: guest.session.token,
      username: "Bench" + String.fromCharCode(65 + index),
      password: "Fictitious benchmark only 2026",
    });
    return performance.now() - t;
  };
  try {
    const idle = process.memoryUsage().rss;
    const t = performance.now(),
      cpu = process.cpuUsage();
    const sequential = [];
    for (let i = 0; i < 3; i++) sequential.push(await trial(i));
    const sequentialCpu = process.cpuUsage(cpu),
      sequentialElapsed = performance.now() - t;
    const t2 = performance.now(),
      cpu2 = process.cpuUsage();
    const paired = await Promise.all([trial(3), trial(4)]);
    const pairedCpu = process.cpuUsage(cpu2);
    const result = {
      mode: "production registerGuest, temporary SQLite; passwords and recovery-code hashing included",
      parameters: DEFAULT_SCRYPT_PARAMETERS,
      warmupRegistrations: 0,
      sequential: {
        samplesMs: sequential,
        latencyMs: summary(sequential),
        wallMs: sequentialElapsed,
        cpuUserMs: sequentialCpu.user / 1000,
        cpuSystemMs: sequentialCpu.system / 1000,
      },
      concurrentTwo: {
        samplesMs: paired,
        latencyMs: summary(paired),
        wallMs: performance.now() - t2,
        cpuUserMs: pairedCpu.user / 1000,
        cpuSystemMs: pairedCpu.system / 1000,
      },
      rssIdleBytes: idle,
      sampledRssPeakBytes: peak,
      rssSampleIntervalMs: 10,
    };
    fs.writeFileSync(
      path.join(OUT, "password-results.json"),
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify({ type: "password-result", ...result }));
  } finally {
    clearInterval(timer);
    store.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
} else {
  const { default: WebSocket } = await import(
    ROOT + "/node_modules/ws/wrapper.mjs"
  );
  const { CARD } = await import(ROOT + "/src/cards.mjs");
  let serial = 0;
  const pending = new Map();
  let child;
  function rpc(type, extra = {}) {
    const id = ++serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Error("Server IPC timeout " + type));
      }, 10000);
      pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      child.send({ id, type, ...extra });
    });
  }
  class Client {
    constructor(origin, identity) {
      this.origin = origin;
      this.identity = identity;
      this.seq = 1;
      this.view = null;
      this.challenge = null;
      this.waiters = new Map();
      this.stats = null;
      this.closedUnexpectedly = false;
      this.ws = new WebSocket(origin.replace("http:", "ws:") + "/ws", {
        origin,
        headers: { Cookie: identity.cookie },
      });
      this.ws.on("error", () => {});
      this.ws.on("close", () => {
        this.closedUnexpectedly = true;
      });
      this.ws.on("message", (raw) => {
        const m = JSON.parse(String(raw));
        if (this.stats) {
          this.stats.inboundBytes += raw.length;
          if (m.type === "room.snapshot")
            this.stats.snapshotBytes.push(raw.length);
        }
        if (m.type === "room.snapshot") this.view = m;
        if (m.type === "private.challenge") this.challenge = m;
        if (m.type === "private.feedback") this.challenge = null;
        if (m.type === "session.ready") {
          this.seq = m.nextClientSeq;
          this.ready = true;
        }
        if (m.type === "command.ack") {
          const w = this.waiters.get(m.commandId);
          if (w) {
            this.waiters.delete(m.commandId);
            this.seq = m.nextClientSeq;
            w(m);
          }
        }
      });
    }
    async open() {
      if (this.ws.readyState !== WebSocket.OPEN)
        await new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(Error("WebSocket open timeout")),
            5000,
          );
          this.ws.once("open", () => {
            clearTimeout(timer);
            resolve();
          });
          this.ws.once("error", (e) => {
            clearTimeout(timer);
            reject(e);
          });
        });
      this.ws.send(JSON.stringify({ type: "session.open", protocol: PROTOCOL }));
      await until(() => this.ready, "session.ready");
    }
    async command(type, payload = {}) {
      const c = {
        type,
        commandId: "capacity-" + ++serial,
        clientSeq: this.seq++,
        payload,
        ...(this.view && type !== "queue.join"
          ? { roomId: this.view.roomId, expectedRevision: this.view.revision }
          : {}),
      };
      const t = performance.now();
      const reply = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.waiters.delete(c.commandId);
          reject(Error("Command ACK timeout " + type));
        }, 5000);
        this.waiters.set(c.commandId, (m) => {
          clearTimeout(timer);
          resolve(m);
        });
      });
      const encoded = JSON.stringify(c);
      this.ws.send(encoded);
      const ack = await reply;
      if (this.stats) {
        this.stats.ackMs.push(performance.now() - t);
        this.stats.outboundBytes += Buffer.byteLength(encoded);
        const kind = type === "battle.action" ? payload.action.type : type;
        this.stats.actions[kind] = (this.stats.actions[kind] || 0) + 1;
        if (!ack.ok)
          this.stats.rejections[ack.code] =
            (this.stats.rejections[ack.code] || 0) + 1;
      }
      if (!ack.ok) throw Error(type + ": " + ack.code);
      return ack;
    }
  }
  async function until(fn, label) {
    const deadline = performance.now() + 5000;
    while (!fn()) {
      if (performance.now() > deadline) throw Error("Timeout " + label);
      await pause(5);
    }
  }
  function move(s) {
    const p = s.self,
      e = s.opponent,
      guards = e.board.filter((u) => CARD[u.cardId].keyword === "guard"),
      a = p.board.find((u) => u.ready && u.atk > 0);
    if (a)
      return {
        type: "attack",
        uid: a.uid,
        target: guards.sort((a, b) => a.hp - b.hp)[0]?.uid || "hero",
      };
    const choices = p.hand
      .map((id, index) => ({ card: CARD[id], index }))
      .filter(
        ({ card }) =>
          card.cost <= p.mana && (card.type === "spell" || p.board.length < 4),
      )
      .sort((a, b) => a.card.cost - b.card.cost);
    for (const { card, index } of choices) {
      if (card.keyword === "restore" && p.hp > 13) continue;
      if (
        card.keyword === "insight" &&
        (p.hand.length >= 6 || p.deckCount === 0)
      )
        continue;
      return {
        type: "play",
        index,
        ...(card.keyword === "damage"
          ? { target: guards.find((u) => u.hp <= 3)?.uid || "hero" }
          : {}),
      };
    }
    return { type: "end" };
  }
  async function run(count) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "spellwood-capacity-"));
    const clients = [],
      pairs = [],
      durableEvents = [];
    let childExited = false,
      measurementTimer = null;
    const ready = new Promise((resolve, reject) => {
      child = fork(
        fileURLToPath(import.meta.url),
        ["--server", path.join(tmp, "temporary.sqlite")],
        { stdio: ["ignore", "ignore", "inherit", "ipc"] },
      );
      child.on("message", (m) => {
        if (m.type === "ready") resolve(m);
        else if (m.type === "fatal") reject(Error(m.error));
        else if (m.id) {
          const p = pending.get(m.id);
          pending.delete(m.id);
          if (p) m.error ? p.reject(Error(m.error)) : p.resolve(m.result);
        }
      });
      child.on("exit", (code) => {
        childExited = true;
        if (code) reject(Error("Server exited " + code));
        for (const p of pending.values()) p.reject(Error("Server exited"));
        pending.clear();
      });
    });
    try {
      const { origin } = await ready;
      await rpc("reset");
      await pause(2000);
      const idle = await rpc("stats");
      console.log(
        JSON.stringify({ type: "idle", connections: count, server: idle }),
      );
      const identities = await rpc("fixtures", { count });
      for (let i = 0; i < count; i += 2) {
        const a = new Client(origin, identities[i]),
          b = new Client(origin, identities[i + 1]);
        clients.push(a, b);
        await a.open();
        await pause(80);
        await b.open();
        await pause(80);
        await a.command("queue.join", {
          grade: 6,
          course: "all",
          deckId: "grove",
        });
        await b.command("queue.join", {
          grade: 6,
          course: "all",
          deckId: "grove",
        });
        await until(() => a.view && b.view, "pair");
        await a.command("opening.choose", { indices: [] });
        await until(
          () => b.view.revision === a.view.revision,
          "opening update",
        );
        await b.command("opening.choose", { indices: [] });
        await until(
          () => a.view.phase === "playing" && b.view.phase === "playing",
          "playing",
        );
        pairs.push([a, b]);
      }
      async function tick(pair, index) {
        const pendingClient = pair.find((c) => c.challenge);
        if (pendingClient) {
          const q = pendingClient.challenge;
          await pendingClient.command("ritual.answer", {
            challengeId: q.challengeId,
            optionId: q.question.options[0].id,
          });
          return;
        }
        const c = pair.find((c) => c.view?.canAct);
        if (!c) return;
        if (
          index % 7 === 0 &&
          !c.view.self.ritualUsed &&
          !c.view.self.ritualReserved &&
          c.view.self.ritualsLeft > 0
        )
          await c.command("ritual.begin", { kind: "spark", target: "hero" });
        else await c.command("battle.action", { action: move(c.view) });
      }
      // Four warmup commands per room, excluded from measured statistics.
      for (let n = 0; n < 4; n++) {
        await Promise.all(pairs.map((p) => tick(p, n)));
        await pause(250);
      }
      const metrics = {
        ackMs: [],
        httpWriteMs: [],
        snapshotBytes: [],
        inboundBytes: 0,
        outboundBytes: 0,
        actions: {},
        rejections: {},
        httpErrors: {},
      };
      for (const c of clients) c.stats = metrics;
      await rpc("reset");
      const generatorCpu = process.cpuUsage(),
        started = performance.now();
      let generatorPeak = process.memoryUsage().rss;
      measurementTimer = setInterval(() => {
        generatorPeak = Math.max(generatorPeak, process.memoryUsage().rss);
      }, 100);
      const tasks = pairs.map(async (pair, roomIndex) => {
        await pause(roomIndex * 4);
        let n = 4;
        while (performance.now() - started < ACTIVE_MS) {
          const turnStart = performance.now();
          await tick(pair, n);
          if (n % 4 === 0) {
            const c = pair[Math.floor(n / 4) % 2],
              requestId = "capacity-write-" + ++serial;
            const t = performance.now();
            const response = await fetch(origin + "/api/progress/preferences", {
              method: "POST",
              headers: {
                Origin: origin,
                Cookie: c.identity.cookie,
                "Content-Type": "application/json",
                "X-Spellwood-Player": c.identity.playerId,
              },
              body: JSON.stringify({
                requestId,
                patch: { grade: 1 + (Math.floor(n / 4) % 6), course: "all" },
              }),
              signal: AbortSignal.timeout(5000),
            });
            const body = await response.json();
            metrics.httpWriteMs.push(performance.now() - t);
            if (!response.ok) {
              metrics.httpErrors[body.code] =
                (metrics.httpErrors[body.code] || 0) + 1;
              throw Error("HTTP write " + response.status + " " + body.code);
            }
            durableEvents.push({ playerId: c.identity.playerId, requestId });
          }
          n++;
          await pause(Math.max(0, 250 - (performance.now() - turnStart)));
        }
      });
      await Promise.all(tasks);
      clearInterval(measurementTimer);
      measurementTimer = null;
      const elapsedMs = performance.now() - started,
        server = await rpc("stats"),
        generator = process.cpuUsage(generatorCpu);
      for (const c of clients) c.stats = null;
      const durableEventsVerified = await rpc("verify", {
        events: durableEvents,
      });
      const profiles = await rpc("profiles", {
        playerIds: identities.map((x) => x.playerId),
      });
      const result = {
        connections: count,
        pairedRooms: pairs.length,
        profiles,
        elapsedMs,
        warmup: {
          serverIdleMs: 2000,
          commandsPerRoom: 4,
          minimumActiveWarmupMs: 1000,
          fixtureCreationMeasured: false,
        },
        serverIdle: idle,
        server,
        loadGenerator: {
          cpuUserMs: generator.user / 1000,
          cpuSystemMs: generator.system / 1000,
          cpuPercentOfOneCore:
            ((generator.user + generator.system) / 1000 / elapsedMs) * 100,
          rssBytes: process.memoryUsage().rss,
          sampledRssPeakBytes: generatorPeak,
        },
        actionAckMs: summary(metrics.ackMs),
        httpDurableWriteRoundTripMs: summary(metrics.httpWriteMs),
        snapshotPayloadBytes: summary(metrics.snapshotBytes),
        webSocketReceivedPayloadBytes: metrics.inboundBytes,
        webSocketSentPayloadBytes: metrics.outboundBytes,
        receivedPayloadBytesPerSecond:
          (metrics.inboundBytes / elapsedMs) * 1000,
        actionPattern: metrics.actions,
        actionRejections: metrics.rejections,
        httpErrors: metrics.httpErrors,
        durableHttpEventsVerified: durableEventsVerified,
        verifiedHttpEventCount: durableEvents.length,
        unexpectedSocketCloses: clients.filter((c) => c.closedUnexpectedly)
          .length,
        phases: clients.reduce(
          (x, c) => ((x[c.view.phase] = (x[c.view.phase] || 0) + 1), x),
          {},
        ),
        databaseFiles: fs
          .readdirSync(tmp)
          .map((name) => ({
            name,
            bytes: fs.statSync(path.join(tmp, name)).size,
          })),
      };
      fs.writeFileSync(
        path.join(OUT, `stage-${count}.json`),
        JSON.stringify(result, null, 2),
      );
      console.log(JSON.stringify({ type: "stage-result", ...result }));
      return result;
    } finally {
      clearInterval(measurementTimer);
      for (const c of clients) c.ws.terminate();
      if (child && !childExited) {
        try {
          await rpc("close");
        } catch {
          child.kill("SIGTERM");
        }
      }
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  const environment = facts();
  environment.head = gitInfo(["rev-parse", "HEAD"]);
  environment.sourceStatus = gitInfo(["status", "--short"]);
  environment.sourceNote = environment.head
    ? "Git checkout identity is recorded; uncommitted changes remain visible in sourceStatus."
    : "No Git metadata: record the source archive version separately.";
  fs.writeFileSync(
    path.join(OUT, "environment.json"),
    JSON.stringify(environment, null, 2),
  );
  console.log(JSON.stringify({ type: "environment", ...environment }));
  try {
    const results = [];
    for (const count of SMOKE ? [2] : [10, 20, 50])
      results.push(await run(count));
    fs.writeFileSync(
      path.join(OUT, "results.json"),
      JSON.stringify({ environment, results }, null, 2),
    );
  } catch (e) {
    console.error(
      JSON.stringify({ type: "failure", error: e.code || e.message }),
    );
    process.exitCode = 1;
  }
}
