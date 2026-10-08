import test from "node:test";
import assert from "node:assert/strict";
import { SaveSession } from "../src/save-session.mjs";
import { SaveSession as LegacySession } from "./fixtures/save-session-2.6.mjs";
import { domHarness } from "./dom-harness.mjs";
import { fileURLToPath } from "node:url";
const dir = fileURLToPath(new URL("../src", import.meta.url));
const flush = async () => {
  for (let i = 0; i < 14; i++) await Promise.resolve();
};
function lab() {
  let id = 0;
  const pools = new Map(),
    channels = new Set(),
    timers = new Map(),
    messages = [],
    changes = [],
    sessions = [];
  const pool = (name) => {
    if (!pools.has(name)) pools.set(name, { held: null, queue: [] });
    return pools.get(name);
  };
  const pump = (name) => {
    const p = pool(name);
    if (p.held || !p.queue.length) return;
    const r = p.queue.shift();
    p.held = r;
    queueMicrotask(() => {
      if (r.aborted) {
        p.held = null;
        pump(name);
        return;
      }
      Promise.resolve(r.callback({ name })).then(
        () => {
          if (p.held === r) p.held = null;
          r.resolve();
          pump(name);
        },
        (e) => {
          if (p.held === r) p.held = null;
          r.reject(e);
          pump(name);
        },
      );
    });
  };
  const locks = {
    request(name, options, callback) {
      return new Promise((resolve, reject) => {
        const p = pool(name);
        if (options.ifAvailable && (p.held || p.queue.length)) {
          queueMicrotask(() =>
            Promise.resolve(callback(null)).then(resolve, reject),
          );
          return;
        }
        const r = { callback, resolve, reject, aborted: false };
        options.signal?.addEventListener("abort", () => {
          if (p.held === r) return;
          const i = p.queue.indexOf(r);
          if (i >= 0) p.queue.splice(i, 1);
          r.aborted = true;
          const e = Error("Aborted");
          e.name = "AbortError";
          reject(e);
        });
        p.queue.push(r);
        pump(name);
      });
    },
  };
  const createChannel = (name) => {
    const channel = {
      name,
      onmessage: null,
      closed: false,
      postMessage(data) {
        messages.push(data);
        for (const c of channels)
          if (c !== channel && c.name === name)
            queueMicrotask(() => {
              if (!c.closed) c.onmessage?.({ data: structuredClone(data) });
            });
      },
      close() {
        channel.closed = true;
        channels.delete(channel);
      },
    };
    channels.add(channel);
    return channel;
  };
  const make = (name, extra = {}, SessionClass = SaveSession) => {
    const s = new SessionClass({
      locks,
      createChannel,
      later(fn) {
        const key = ++id;
        timers.set(key, fn);
        return key;
      },
      cancel: (key) => timers.delete(key),
      onChange(status) {
        changes.push([name, status]);
        const counts = new Map();
        for (const x of sessions.filter((x) => x.status === "active")) {
          const key = x.lockName || "spellwood.save.v1.writer";
          counts.set(key, (counts.get(key) || 0) + 1);
        }
        assert.ok(
          [...counts.values()].every((n) => n <= 1),
          "one writer per storage generation",
        );
      },
      ...extra,
    });
    sessions.push(s);
    return s;
  };
  return {
    locks,
    make,
    messages,
    changes,
    timers,
    get queue() {
      return [...pools.values()].flatMap((p) => p.queue);
    },
    close() {
      for (const s of sessions) s.suspend();
    },
  };
}
test("one page owns writes while a second page is read-only", async () => {
  const h = lab(),
    a = h.make("a"),
    b = h.make("b");
  a.start();
  b.start();
  await flush();
  assert.equal(a.status, "active");
  assert.equal(b.status, "readonly");
  assert.equal(a.canWrite, true);
  assert.equal(b.canWrite, false);
  h.close();
});
test("cooperative handoff disables the previous page before granting the new writer", async () => {
  const h = lab(),
    a = h.make("a"),
    b = h.make("b");
  a.start();
  b.start();
  await flush();
  b.start(true);
  await flush();
  assert.equal(a.status, "readonly");
  assert.equal(b.status, "active");
  const off = h.changes.findIndex((x) => x[0] === "a" && x[1] === "readonly"),
    on = h.changes.findIndex((x) => x[0] === "b" && x[1] === "active");
  assert.ok(off < on);
  h.close();
});
test("unsaved progress refuses handoff rather than silently discarding the active page", async () => {
  const h = lab(),
    a = h.make("a", { beforeYield: () => false }),
    b = h.make("b");
  a.start();
  b.start();
  await flush();
  b.start(true);
  await flush();
  assert.equal(a.status, "active");
  assert.equal(b.status, "readonly");
  assert.equal(b.reason, "unsaved");
  assert.equal(h.timers.size, 0);
  h.close();
});
test("closing or suspending the writer releases it, and a returning page rechecks ownership", async () => {
  const h = lab(),
    a = h.make("a"),
    b = h.make("b");
  a.start();
  b.start();
  await flush();
  a.suspend();
  await flush();
  b.start();
  await flush();
  assert.equal(b.status, "active");
  a.start();
  await flush();
  assert.equal(a.status, "readonly");
  h.close();
});
test("no-response handoff times out safely without allowing concurrent writes", async () => {
  const h = lab(),
    a = h.make("a", { createChannel: () => null }),
    b = h.make("b", { createChannel: () => null });
  a.start();
  b.start();
  await flush();
  b.start(true);
  await flush();
  [...h.timers.values()][0]();
  await flush();
  assert.equal(a.status, "active");
  assert.equal(b.status, "readonly");
  assert.equal(b.reason, "no-response");
  assert.equal(b.canWrite, false);
  h.close();
});
test("a failed lock service blocks writes until an explicit single-window fallback", async () => {
  const s = new SaveSession({
    locks: { request: () => Promise.reject(Error("Unavailable")) },
    createChannel: () => null,
  });
  s.start();
  await flush();
  assert.equal(s.status, "blocked");
  assert.equal(s.canWrite, false);
  s.singleWindowFallback();
  assert.equal(s.status, "unsupported");
  assert.equal(s.canWrite, true);
  s.suspend();
});
test("browsers without the lock API are identified as single-window-only", () => {
  const s = new SaveSession({ locks: null });
  s.start();
  assert.equal(s.status, "unsupported");
  assert.equal(s.canWrite, true);
});
test("repeated takeover clicks do not enqueue multiple lock requests", async () => {
  const h = lab(),
    a = h.make("a", { createChannel: () => null }),
    b = h.make("b", { createChannel: () => null });
  a.start();
  b.start();
  await flush();
  b.start(true);
  b.start(true);
  b.start(true);
  assert.equal(h.queue.length, 1);
  h.close();
  await flush();
});
test("a suspended page ignores a late initial acquisition callback", async () => {
  const h = lab(),
    a = h.make("a");
  a.start();
  a.suspend();
  await flush();
  assert.equal(a.canWrite, false);
  const b = h.make("b");
  b.start();
  await flush();
  assert.equal(b.status, "active");
  h.close();
});
test("handoff channel carries coordination identifiers only, no saved profile", async () => {
  const h = lab(),
    a = h.make("a"),
    b = h.make("b");
  a.start();
  b.start();
  await flush();
  b.start(true);
  await flush();
  assert.ok(h.messages.length);
  for (const m of h.messages)
    assert.ok(
      Object.keys(m).every((k) =>
        [
          "type",
          "sender",
          "target",
          "expiresAt",
          "protocol",
          "reason",
        ].includes(k),
      ),
    );
  h.close();
});
test("read-only app blocks battle, preference, learning and restore mutations", async () => {
  const h = domHarness(dir);
  h.run(
    "startReady('READONLY');openQuestion('spark','hero');SESSION.change('readonly')",
  );
  const before = h.run("JSON.stringify(save)"),
    disk = h.storage.get("spellwood.save.v2");
  h.click("grade", { value: "6" });
  h.click("start");
  h.run("startReady('IGNORE')");
  await h.run("step({type:'end'})");
  h.run("importCandidate=freshSave();importCandidate.nickname='Wrong'");
  h.click("confirm-import");
  assert.equal(h.run("JSON.stringify(save)"), before);
  assert.equal(h.storage.get("spellwood.save.v2"), disk);
  assert.equal(h.run("canRunAI()"), false);
  assert.ok(h.app.innerHTML.includes("在这里继续"));
});
test("owner change stops old effects and reloads the latest durable save on return", () => {
  const h = domHarness(dir);
  h.run(
    "startReady('HANDOFF');locked=true;selected={type:'card',index:0};SESSION.change('readonly')",
  );
  assert.equal(h.run("locked"), false);
  assert.equal(h.run("selected"), null);
  const next = JSON.parse(h.run("JSON.stringify(save)"));
  next.nickname = "FromOtherPage";
  h.storage.set("spellwood.save.v2", JSON.stringify(next));
  h.run("SESSION.change('active')");
  assert.equal(h.run("save.nickname"), "FromOtherPage");
  assert.equal(h.run("SESSION.canWrite"), true);
});

test("an expired broadcast cannot interrupt the current writer", async () => {
  const h = lab(),
    a = h.make("a", { now: () => 9000 });
  a.start();
  await flush();
  a.channel.onmessage({
    data: { type: "request", sender: "late", expiresAt: 8000 },
  });
  await flush();
  assert.equal(a.status, "active");
  h.close();
});
test("the old writer reclaims a handoff when the requester has already withdrawn", async () => {
  const h = lab(),
    a = h.make("a", { now: () => 1000 });
  a.start();
  await flush();
  a.channel.onmessage({
    data: { type: "request", sender: "withdrawn", expiresAt: 8000 },
  });
  await flush();
  assert.equal(a.status, "active");
  h.close();
});
test("taking ownership restores pronunciation after a read-only visibility event", () => {
  const h = domHarness(dir);
  h.run("SESSION.change('readonly')");
  h.documentEvents.visibilitychange();
  assert.equal(h.run("SPEECH.hidden"), true);
  h.run("SESSION.change('active')");
  assert.equal(h.run("SPEECH.hidden"), false);
});

test("legacy lock and message queues cannot intercept two current pages handing over", async () => {
  const h = lab(),
    legacy = h.make("legacy", {}, LegacySession),
    a = h.make("newA", {
      lockName: "spellwood.save.v2.writer",
      channelName: "spellwood.save.v2.session",
    }),
    b = h.make("newB", {
      lockName: "spellwood.save.v2.writer",
      channelName: "spellwood.save.v2.session",
    });
  legacy.start();
  a.start();
  b.start();
  await flush();
  assert.equal(legacy.status, "active");
  assert.equal(a.status, "active");
  assert.equal(b.status, "readonly");
  for (let i = 0; i < 8; i++) {
    const next = i % 2 === 0 ? b : a;
    next.start(true);
    await flush();
    assert.equal(next.status, "active");
    assert.equal(legacy.status, "active");
  }
  h.close();
});
test("an unsaved legacy page cannot cancel a newer generation's handoff", async () => {
  const h = lab(),
    legacy = h.make("legacy", { beforeYield: () => false }, LegacySession),
    a = h.make("a", { lockName: "v2.writer", channelName: "v2.session" }),
    b = h.make("b", { lockName: "v2.writer", channelName: "v2.session" });
  legacy.start();
  a.start();
  b.start();
  await flush();
  b.start(true);
  await flush();
  assert.equal(b.status, "active");
  assert.equal(a.status, "readonly");
  assert.equal(legacy.status, "active");
  h.close();
});
test("application uses the same new generation for the storage, lock and channel", () => {
  const h = domHarness(dir);
  assert.equal(h.run("STORAGE_KEY"), "spellwood.save.v2");
  assert.equal(h.run("SESSION.lockName"), "spellwood.save.v2.writer");
  assert.equal(h.run("SESSION.channelName"), "spellwood.save.v2.session");
});
