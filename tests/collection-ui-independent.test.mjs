import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { CARDS, CARD } from "../src/cards.mjs";
import {
  FINISHES,
  FINISH,
  COLLECTION_TEST_MODE,
  rewardBalance,
  dayKey,
  qualifyDay,
} from "../src/collection.mjs";
import { artThumb } from "../src/network/card-library.mjs";
import { ProgressStore, PROGRESS_KEY, createProgressModel } from "../src/network/progress.mjs";
import { RemoteProgressStore } from "../src/network/remote-progress.mjs";
import { LearningAttention } from "../src/network/learning-attention.mjs";
import { StudyDesk } from "../src/network/study-desk.mjs";

// Independent-origin DOM/event regression model, updated for 3.2 by implementation owner.
// This rerun is not a fresh independent 3.2 audit. Actual CollectionView and ProgressStore.
// Scene is an observable presentation boundary. This does not claim browser,
// pixel, physical keyboard/touch, WebGL, or accessibility-tree validation.
const questions = Array.from({ length: 432 }, (_, i) => ({
  id: `ui-audit-q-${i}`,
  grade: 1,
  semester: 1,
  unitId: "g1-s1-u1",
}));
const source =
  readFileSync(
    new URL("../src/network/collection-view.mjs", import.meta.url),
    "utf8",
  )
    .replace(/^import .*;\n/gm, "")
    .replace("export class CollectionView", "class CollectionView") +
  "\nglobalThis.View=CollectionView;";
const appSource = readFileSync(
  new URL("../src/network/app.mjs", import.meta.url),
  "utf8",
);
const keySource = appSource.slice(
  appSource.indexOf('document.addEventListener("keydown",'),
  appSource.indexOf('document.addEventListener("visibilitychange",'),
);
const defer = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
const copy = (x) => structuredClone(x);

function dom() {
  let document;
  class Element {
    constructor(tag = "div", attrs = {}) {
      this.tagName = tag.toUpperCase();
      this.attrs = attrs;
      this.children = [];
      this.parentElement = null;
      this.listeners = new Map();
      this.style = {};
      this.dataset = {};
      this.hidden = false;
      this.disabled = Object.hasOwn(attrs, "disabled");
      this.id = attrs.id || "";
      this.value = attrs.value || "";
      this.classes = new Set((attrs.class || "").split(/\s+/).filter(Boolean));
      for (const [k, v] of Object.entries(attrs))
        if (k.startsWith("data-"))
          this.dataset[
            k.slice(5).replace(/-([a-z])/g, (_, x) => x.toUpperCase())
          ] = v;
      this.classList = {
        toggle: (key, on) => {
          if (on ?? !this.classes.has(key)) this.classes.add(key);
          else this.classes.delete(key);
        },
        contains: (key) => this.classes.has(key),
      };
    }
    setAttribute(name,value) { this.attrs[name]=String(value); }
    getAttribute(name) { return this.attrs[name] ?? null; }
    set className(value) { this.classes = new Set(String(value).split(/\s+/).filter(Boolean)); }
    get className() { return [...this.classes].join(" "); }
    remove() { if (!this.parentElement) return; this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; }
    get isConnected() {
      return document.body.contains(this);
    }
    get ownerDocument() {
      return document;
    }
    contains(el) {
      return (
        this === el ||
        this.children.some((c) => typeof c !== "string" && c.contains(el))
      );
    }
    appendChild(el) {
      el.parentElement = this;
      this.children.push(el);
      return el;
    }
    replaceChildren(...children) {
      if (
        document.activeElement !== this &&
        this.contains(document.activeElement)
      )
        document.activeElement = document.body;
      for (const c of this.children)
        if (typeof c !== "string") c.parentElement = null;
      this.children = [];
      for (const c of children) this.appendChild(c);
    }
    set innerHTML(html) {
      this.replaceChildren();
      const stack = [this];
      for (const token of String(html).match(/<[^>]+>|[^<]+/g) || []) {
        if (token.startsWith("</")) {
          if (stack.length > 1) stack.pop();
          continue;
        }
        if (token.startsWith("<")) {
          const m = token.match(/^<([\w-]+)([\s\S]*?)\/?\s*>$/);
          if (!m) continue;
          const attrs = {};
          for (const a of m[2].matchAll(/([^\s=]+)(?:="([^"]*)")?/g))
            attrs[a[1]] = a[2] ?? "";
          const el = new Element(m[1], attrs);
          stack.at(-1).appendChild(el);
          if (
            !["input", "img", "br", "hr", "meta", "link"].includes(m[1]) &&
            !token.endsWith("/>")
          )
            stack.push(el);
        } else stack.at(-1).children.push(token);
      }
    }
    get innerHTML() {
      return this.children
        .map((c) =>
          typeof c === "string"
            ? c
            : `<${c.tagName.toLowerCase()}${Object.entries(c.attrs)
                .map(([k, v]) => ` ${k}="${v}"`)
                .join("")}>${c.innerHTML}</${c.tagName.toLowerCase()}>`,
        )
        .join("");
    }
    set textContent(text) {
      this.replaceChildren();
      this.children.push(String(text));
    }
    get textContent() {
      return this.children
        .map((c) => (typeof c === "string" ? c : c.textContent))
        .join("");
    }
    matches(selector) {
      return selector.split(",").some((s) => {
        s = s.trim();
        if (s.endsWith(":not(:disabled)"))
          return (
            !this.disabled &&
            this.matches(s.slice(0, -":not(:disabled)".length))
          );
        if (s.startsWith(".")) return this.classes.has(s.slice(1));
        if (s.startsWith("#")) return this.id === s.slice(1);
        const attr = s.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
        if (attr)
          return (
            Object.hasOwn(this.attrs, attr[1]) &&
            (attr[2] === undefined || this.attrs[attr[1]] === attr[2])
          );
        return this.tagName.toLowerCase() === s;
      });
    }
    querySelectorAll(selector) {
      const out = [];
      for (const c of this.children)
        if (typeof c !== "string") {
          if (c.matches(selector)) out.push(c);
          out.push(...c.querySelectorAll(selector));
        }
      return out;
    }
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }
    closest(selector) {
      return this.matches(selector)
        ? this
        : this.parentElement?.closest(selector) || null;
    }
    focus() {
      if (this.isConnected && !this.disabled) document.activeElement = this;
    }
    scrollIntoView() {
      this.scrolled = true;
    }
    addEventListener(name, fn) {
      if (!this.listeners.has(name)) this.listeners.set(name, []);
      this.listeners.get(name).push(fn);
    }
    removeEventListener(name, fn) {
      this.listeners.set(
        name,
        (this.listeners.get(name) || []).filter((x) => x !== fn),
      );
    }
    dispatch(name, extra = {}) {
      const event = {
        target: this,
        key: "",
        shiftKey: false,
        prevented: false,
        stopped: false,
        preventDefault() {
          this.prevented = true;
        },
        stopPropagation() {
          this.stopped = true;
        },
        ...extra,
      };
      let node = this;
      while (node) {
        for (const fn of node.listeners.get(name) || []) fn(event);
        if (event.stopped) break;
        node = node.parentElement;
      }
      return event;
    }
  }
  document = { activeElement: null, createElement: (tag) => new Element(tag) };
  document.body = new Element("body");
  document.activeElement = document.body;
  document.querySelector = (s) => document.body.querySelector(s);
  document.querySelectorAll = (s) => document.body.querySelectorAll(s);
  document.addEventListener = (...args) =>
    document.body.addEventListener(...args);
  return { document, Element };
}

function io() {
  const values = new Map(),
    events = [];
  let failures = 0,
    hold = null,
    tail = Promise.resolve();
  return {
    values,
    events,
    fail(n = 1) {
      failures = n;
    },
    pause() {
      hold = defer();
      return () => {
        hold.resolve();
        hold = null;
      };
    },
    storage: {
      getItem: (k) => values.get(k) ?? null,
      setItem(k, v) {
        if (k === PROGRESS_KEY && failures > 0) {
          failures--;
          events.push("write-failed");
          throw Error("quota");
        }
        values.set(k, String(v));
        events.push(`write:${k}`);
      },
    },
    locks: {
      request(name, options, fn) {
        const gate = hold?.promise;
        const task = tail.then(async () => {
          if (gate) await gate;
          return fn();
        });
        tail = task.catch(() => {});
        return task;
      },
    },
  };
}

async function harness({ env = io(), seed, remote } = {}) {
  if (seed) env.values.set(PROGRESS_KEY, JSON.stringify(seed));
  const { document, Element } = dom(),
    root = document.body.appendChild(
      new Element("div", { id: "collection-root" }),
    ),
    trigger = document.body.appendChild(
      new Element("button", { "data-action": "collection" }),
    );
  root.hidden = true;
  trigger.focus();
  const scenes = [],
    notices = [],
    actions = [];
  let view,
    closed = 0,
    studied = 0;
  const storeOptions = {
    storage: env.storage,
    locks: env.locks,
    questions,
    onChange: () => view?.render(),
  };
  const store = remote ? new RemoteProgressStore({ questions, ...remote, onChange: storeOptions.onChange }) : new ProgressStore(storeOptions);
  assert.equal((await store.load()).ok, true);
  const originalOpen = store.openPack.bind(store),
    originalAction = store.collectionAction.bind(store);
  store.openPack = (...args) => {
    actions.push({ kind: "open", mode: args[0] });
    return originalOpen(...args);
  };
  store.collectionAction = (action) => {
    actions.push(copy(action));
    // The view runs in this test's VM realm; real browsers share the store's
    // realm. Clone only that boundary so the real intent validator still runs.
    return originalAction(remote ? copy(action) : action);
  };
  class Scene {
    constructor(options) {
      Object.assign(this, options);
      this.calls = [];
      this.phase = "idle";
      this.available = true;
      this.disposed = false;
      scenes.push(this);
      env.events.push("scene-created");
    }
    status() {
      this.onStatus({
        phase: this.phase,
        available: this.available,
        focusedIndex: this.focusedIndex ?? null,
        renderer: "CPU model",
      });
    }
    setOpening(opening, { intro = true } = {}) {
      assert.equal(store.dirty, false, "scene fronts may only advance after an acknowledged save");
      assert.equal(store.issue, null);
      const saved = remote ? store.data : JSON.parse(env.values.get(PROGRESS_KEY));
      assert.deepEqual(
        copy(opening),
        saved.collection.opening,
        "UI may present only a durable opening",
      );
      this.calls.push({ kind: "setOpening", opening: copy(opening), intro });
      if (this.opening?.id !== opening.id) {
        this.opening = copy(opening);
        this.phase =
          intro && !opening.revealed
            ? "sealed"
            : opening.revealed === 1023
              ? "complete"
              : "ready";
      } else {
        this.opening = copy(opening);
        if (opening.revealed === 1023) this.phase = "complete";
      }
      this.status();
    }
    launch() {
      this.phase = "charging";
      this.calls.push({ kind: "launch" });
      this.status();
    }
    skip() {
      this.phase = this.opening.revealed === 1023 ? "complete" : "ready";
      this.calls.push({ kind: "skip" });
      this.status();
      this.onReady();
    }
    focus(index) {
      this.focusedIndex = index;
      this.calls.push({ kind: "focus", index });
      this.status();
    }
    setHidden(hidden) {
      this.hidden = hidden;
    }
    dispose() {
      this.disposed = true;
      this.calls.push({ kind: "dispose" });
    }
  }
  const sandbox = {
    document,
    console,
    CARDS,
    CARD,
    FINISHES,
    FINISH,
    COLLECTION_TEST_MODE,
    rewardBalance,
    dayKey,
    artThumb,
    PackScene: Scene,
    ResizeObserver: undefined,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  view = new sandbox.View({
    root,
    store: () => store,
    preferences: () => ({ reduced: false }),
    onClose: () => closed++,
    onStudy: () => studied++,
    onNotice: (x) => notices.push(x),
    onSound() {},
  });
  return {
    env,
    store,
    view,
    root,
    document,
    trigger,
    scenes,
    actions,
    notices,
    get closed() {
      return closed;
    },
    get studied() {
      return studied;
    },
    scene: () => scenes.at(-1),
    html: () => root.innerHTML,
    button(action, value) {
      return root
        .querySelectorAll("[data-action]")
        .find(
          (el) =>
            el.dataset.action === action &&
            (value === undefined || el.dataset.value === String(value)),
        );
    },
    async click(action, value, finish) {
      await view.click(action, value, finish);
      await tick();
    },
    async settle() {
      await tick();
      await store._serial;
      await tick();
    },
  };
}

async function remoteHarness() {
  const model = createProgressModel({ questions }), when = Date.UTC(2026, 9, 10, 12), owner = "collection-owner-0001";
  let progress = model.fresh(owner, "Asia/Shanghai"), nextGate = null, failures = 0;
  progress = model.collection(progress, { kind: "open-pack", id: "collection-opening-0001", mode: "test", createdAt: when,
    cards: Array.from({ length: 10 }, (_, i) => ({ cardId: CARDS[i % CARDS.length].id, finish: "leaf" })) }).data;
  const requests = [], changes = [];
  const response = (payload, status = 200) => ({ ok: status >= 200 && status < 300, status, async json() { return copy(payload); } });
  const success = () => response({ data: progress, playerId: progress.profileId, revision: progress.revision, serverNow: when });
  const fetcher = async (path, options) => {
    if (options.method !== "POST") return success();
    const body = JSON.parse(options.body), gate = nextGate; nextGate = null;
    requests.push({ path, body, playerId: options.headers["X-Spellwood-Player"] });
    if (gate) await gate.promise;
    if (options.headers["X-Spellwood-Player"] !== progress.profileId) return response({ code: "PROGRESS_IDENTITY_MISMATCH" }, 409);
    if (failures) { failures--; return response({ code: "WRITE_FAILED" }, 503); }
    progress = model.collection(progress, body.action).data;
    return success();
  };
  const h = await harness({ remote: { playerId: owner, fetcher } });
  const onChange = h.store.onChange;
  h.store.onChange = (data, meta) => { changes.push({ data: copy(data), dirty: meta.dirty, issue: meta.issue }); onChange(data, meta); };
  return { ...h, requests, changes,
    get serverData() { return copy(progress); },
    pause() { const gate = nextGate = defer(); return () => gate.resolve(); },
    fail() { failures++; },
    replaceIdentity(playerId) { progress = model.fresh(playerId, "Asia/Shanghai"); h.store.setPlayerId(playerId); },
  };
}

test("real remote pending notification keeps the saved canvas and backs until the reveal acknowledgement", async () => {
  const h = await remoteHarness(); h.view.open();
  const canvas = h.root.querySelector("#pack-canvas"), scene = h.scene(), before = h.store.data.collection, calls = scene.calls.length;
  const release = h.pause(), work = h.view.reveal(2); await tick();
  assert.equal(h.store.dirty, true); assert.equal(h.changes.at(-1).dirty, true, "the actual RemoteProgressStore pending notification ran");
  assert.equal(h.root.querySelector("#pack-canvas"), canvas); assert.equal(canvas.isConnected, true); assert.equal(scene.disposed, false);
  assert.equal(scene.calls.length, calls, "no setOpening or reveal was sent before the acknowledgement");
  assert.equal(scene.opening.revealed, 0); assert.equal(h.store.data.collection.opening.revealed, 0);
  assert.equal(h.root.querySelector("#pack-count").textContent, "已揭开 0/10"); assert.equal(h.root.querySelector("#pack-results").textContent, "");
  assert.equal(h.root.querySelector(".pack-stage").inert, true); assert.equal(h.root.querySelector("#pack-controls").inert, true);
  assert.equal(h.button("collection-reveal", "2").disabled, true); assert.match(h.root.querySelector("#pack-instruction").textContent, /正在保存/);
  for (let i = 0; i < 3; i++) h.view.render();
  assert.equal(h.root.querySelector("#pack-canvas"), canvas); assert.equal(scene.calls.length, calls);
  await h.view.reveal(3); assert.equal(h.requests.length, 1, "pending input cannot queue a second reveal");
  release(); await work; await h.settle();
  assert.equal(h.store.dirty, false); assert.equal(h.root.querySelector("#pack-canvas"), canvas); assert.equal(h.scenes.length, 1);
  assert.equal(scene.opening.revealed, 4); assert.equal(scene.calls.filter(call => call.kind === "setOpening").at(-1).intro, false);
  assert.equal(h.root.querySelector("#pack-count").textContent, "已揭开 1/10"); assert.equal(h.root.querySelector(".pack-stage").inert, false);
  assert.deepEqual(h.store.data.collection.opening.cards, before.opening.cards); assert.deepEqual(h.store.data.collection.test, before.test);
});

test("a failed remote reveal disposes the backs safely and retries the original request without revealing early", async () => {
  const h = await remoteHarness(); h.view.open();
  const scene = h.scene(), before = h.store.data.collection, release = h.pause(); h.fail();
  const work = h.view.reveal(2); await tick(); assert.equal(scene.disposed, false); assert.equal(scene.opening.revealed, 0);
  release(); await work;
  assert.equal(h.store.issue.code, "WRITE_FAILED"); assert.equal(h.store.dirty, true); assert.equal(scene.disposed, true);
  assert.equal(scene.calls.filter(call => call.kind === "setOpening").every(call => call.opening.revealed === 0), true);
  assert.equal(h.root.querySelector("#pack-canvas"), null); assert.equal(h.root.querySelector("#pack-results"), null); assert.match(h.html(), /先保管好你的记录/);
  assert.equal(h.serverData.collection.opening.revealed, 0);
  await h.click("collection-retry");
  assert.equal(h.requests.length, 2); assert.equal(h.requests[0].body.requestId, h.requests[1].body.requestId);
  assert.equal(h.scene().opening.revealed, 4); assert.deepEqual(h.store.data.collection.test, before.test);
  assert.deepEqual(h.store.data.collection.opening.cards, before.opening.cards);
});

test("identity reset while a remote reveal waits removes old results and ignores the late completion", async () => {
  const h = await remoteHarness(); h.view.open();
  const scene = h.scene(), canvas = h.root.querySelector("#pack-canvas"), release = h.pause(), work = h.view.reveal(2);
  await tick(); h.view.reset(); h.replaceIdentity("collection-owner-0002");
  assert.equal(scene.disposed, true); assert.equal(canvas.isConnected, false); assert.equal(h.view.pendingReveal, null);
  assert.equal((await h.store.load()).ok, true); h.view.open();
  assert.equal(h.root.querySelector("#pack-canvas"), null); assert.equal(h.store.data.collection.opening, null);
  release(); await work; await h.settle();
  assert.equal(h.store.playerId, "collection-owner-0002"); assert.equal(h.store.data.collection.opening, null);
  assert.equal(h.root.querySelector("#pack-canvas"), null); assert.equal(h.view.busy, false); assert.equal(h.notices.length, 0);
  assert.equal(h.scenes.length, 1, "a stale old-owner acknowledgement cannot construct another scene");
});

test("an unrelated dirty notification is still hidden rather than retaining an opening", async () => {
  const h = await remoteHarness(); h.view.open(); const scene = h.scene(), release = h.pause();
  const work = h.store.collectionAction({ kind: "equip-finish", mode: "test", cardId: CARDS[0].id, finish: "base" }); await tick();
  assert.equal(h.store.dirty, true);
  assert.equal(scene.disposed, true); assert.equal(h.root.querySelector("#pack-canvas"), null);
  assert.match(h.html(), /先保管好你的记录/); release(); await work;
});

test("UI creates presentation only after the ten-card transaction is durable", async () => {
  const h = await harness();
  h.view.open();
  await h.click("collection-open", "test");
  assert.equal(h.scenes.length, 1);
  assert.ok(
    h.env.events.indexOf("scene-created") >
      h.env.events.lastIndexOf(`write:${PROGRESS_KEY}`),
  );
  assert.equal(h.store.data.collection.opening.revealed, 0);
  assert.equal(h.root.querySelector("#pack-results").textContent, "");
  assert.match(h.html(), /体验十连/);
});

test('temporary pack mute is reachable during a transaction and never changes saved rewards',async()=>{
 const h=await harness(),changes=[];h.view.onMuteChange=value=>changes.push(value);h.view.open();await h.click('collection-open','test');
 const before=h.env.values.get(PROGRESS_KEY),id=h.store.data.collection.opening.id,actions=h.actions.length;
 h.view.busy=true;await h.click('collection-mute');assert.equal(h.view.muted,true);assert.equal(h.button('collection-mute').textContent,'恢复声音');
 assert.deepEqual(changes,[true]);assert.equal(h.env.values.get(PROGRESS_KEY),before);assert.equal(h.actions.length,actions);
 h.view.busy=false;await h.click('collection-close');await h.click('collection-confirm-close');
 assert.deepEqual(changes,[true,false]);assert.equal(h.store.data.collection.opening.id,id);assert.equal(h.env.values.get(PROGRESS_KEY),before);
 h.view.open();assert.equal(h.view.muted,false);assert.equal(h.button('collection-mute').textContent,'礼盒静音');
});

test("failed initial save hides generated cards and retry resumes the same batch", async () => {
  const h = await harness();
  h.view.open();
  const durable = h.env.values.get(PROGRESS_KEY);
  h.env.fail();
  await h.click("collection-open", "test");
  const pending = h.store.data.collection.opening;
  assert.ok(pending);
  assert.equal(h.store.dirty, true);
  assert.equal(h.env.values.get(PROGRESS_KEY), durable);
  assert.equal(h.scenes.length, 0);
  assert.equal(h.root.querySelector("#pack-results"), null);
  assert.match(h.html(), /先保管好你的记录/);
  await h.click("collection-retry");
  await h.click("collection-resume");
  assert.deepEqual(h.store.data.collection.opening, pending);
  assert.equal(h.actions.filter((a) => a.kind === "open").length, 1);
  assert.equal(h.scenes.length, 1);
});

test("failed reveal removes the presentation and never displays the unsaved front", async () => {
  const h = await harness();
  h.view.open();
  await h.click("collection-open", "test");
  await h.click("collection-launch");
  h.scene().skip();
  const first = h.scene(),
    durable = h.env.values.get(PROGRESS_KEY);
  h.env.fail();
  await h.click("collection-reveal", "2");
  assert.equal(h.env.values.get(PROGRESS_KEY), durable);
  assert.equal(h.store.data.collection.opening.revealed, 4);
  assert.equal(first.disposed, true);
  assert.equal(
    first.calls
      .filter((c) => c.kind === "setOpening")
      .every((c) => c.opening.revealed === 0),
    true,
  );
  assert.equal(h.root.querySelector("#pack-results"), null);
  await h.click("collection-retry");
  assert.equal(h.scene().opening.revealed, 4);
  await h.click("collection-summary");
  assert.equal(
    h.root
      .querySelectorAll("[data-action]")
      .filter((x) => x.dataset.action === "collection-focus").length,
    1,
  );
});

test("rapid DOM clicks and controller intents while storage waits generate one batch", async () => {
  const h = await harness();
  h.view.open();
  const release = h.env.pause(),
    button = h.button("collection-open", "test");
  button.focus();
  button.dispatch("click");
  const repeats = [];
  for (let i = 0; i < 20; i++) {
    h.button("collection-open", "test").dispatch("click");
    repeats.push(h.view.click("collection-open", "test"));
  }
  await Promise.all(repeats);
  await tick();
  assert.equal(h.view.busy, true);
  assert.equal(h.actions.filter((x) => x.kind === "open").length, 1);
  release();
  await h.settle();
  assert.equal(h.store.data.collection.openingIds.length, 1);
  assert.equal(
    Object.values(h.store.data.collection.test.cards).reduce(
      (a, b) => a + b,
      0,
    ),
    10,
  );
  assert.equal(h.view.busy, false);
});

test("close, reopen, and a fresh store preserve batch, wallet and individual reveal mask", async () => {
  const h = await harness();
  h.view.open();
  await h.click("collection-open", "test");
  h.scene().skip();
  await h.click("collection-reveal", "4");
  const before = h.store.data.collection,
    scene = h.scene();
  await h.click("collection-close");
  assert.equal(h.view.exitPrompt, true);
  assert.equal(h.root.hidden, false);
  assert.equal(scene.hidden, true);
  assert.equal(h.store.data.collection.opening.id, before.opening.id);
  await h.click("collection-confirm-close");
  assert.equal(scene.disposed, true);
  assert.equal(h.root.hidden, true);
  assert.equal(h.closed, 1);
  h.view.open();
  assert.equal(h.scene().opening.revealed, 16);
  assert.deepEqual(h.store.data.collection, before);
  const reload = await harness({ env: h.env });
  reload.view.open();
  assert.deepEqual(reload.scene().opening, before.opening);
  assert.deepEqual(reload.store.data.collection, before);
  assert.equal(reload.actions.length, 0);
});

test("skip and repeated reveal-all only advance the committed mask, never reroll or reward twice", async () => {
  const h = await harness();
  h.view.open();
  await h.click("collection-open", "test");
  const original = h.store.data.collection;
  await h.click("collection-launch");
  await h.click("collection-reveal-all");
  await h.click("collection-reveal-all");
  const next = h.store.data.collection;
  assert.deepEqual(next.opening.cards, original.opening.cards);
  assert.equal(next.opening.id, original.opening.id);
  assert.equal(next.opening.revealed, 1023);
  assert.deepEqual(next.test, original.test);
  assert.deepEqual(next.earned, original.earned);
  assert.deepEqual(next.openingIds, original.openingIds);
  assert.equal(h.actions.filter((x) => x.kind === "open").length, 1);
  await h.click("collection-summary");
  assert.equal(
    h.root
      .querySelectorAll("[data-action]")
      .filter((x) => x.dataset.action === "collection-focus").length,
    10,
  );
});

test("album mode, redemption, and equipment preserve test/earned wallet separation", async () => {
  const initial = await harness(),
    seed = initial.store.data;
  seed.collection.test.dust = 125;
  seed.collection.earned.dust = 5;
  const h = await harness({ seed });
  h.view.open();
  await h.click("collection-mode", "test");
  await h.click("collection-redeem", CARDS[0].id, "gold");
  assert.equal(h.store.data.collection.test.dust, 0);
  assert.equal(h.store.data.collection.earned.dust, 5);
  await h.click("collection-equip", CARDS[0].id, "gold");
  assert.deepEqual(h.store.data.collection.equipped[CARDS[0].id], {
    mode: "test",
    finish: "gold",
  });
  await h.click("collection-mode", "earned");
  assert.match(h.html(), /叶屑 5/);
  assert.equal(
    h.root
      .querySelectorAll("[data-action]")
      .find((x) => x.dataset.finish === "gold")?.disabled,
    true,
  );
  await h.click("collection-redeem", CARDS[1].id, "leaf");
  assert.equal(h.store.data.collection.earned.dust, 0);
  assert.equal(
    h.store.data.collection.test.cards[`${CARDS[1].id}:leaf`],
    undefined,
  );
  assert.equal(h.store.data.collection.earned.cards[`${CARDS[1].id}:leaf`], 1);
});

test("earned UI opening spends one learning gift without changing test holdings", async () => {
  const initial = await harness(),
    seed = initial.store.data;
  for (let d = 1; d <= 5; d++) {
    const at = Date.UTC(2026, 8, d, 12);
    for (let q = 0; q < 6; q++)
      qualifyDay(
        seed.collection,
        { qid: questions[q].id, answeredAt: at },
        { questionMs: 2000, feedbackMs: 1200, now: at + 1200, timeZone: "UTC" },
      );
  }
  seed.collection.test.dust = 17;
  const h = await harness({ seed });
  h.view.open();
  assert.equal(h.button("collection-open", "earned").disabled, false);
  await h.click("collection-open", "earned");
  assert.equal(rewardBalance(h.store.data.collection), 0);
  assert.equal(h.store.data.collection.test.dust, 17);
  assert.deepEqual(h.store.data.collection.test.cards, {});
  assert.match(h.root.querySelector(".opening-source").textContent, /正式收藏/);
});

test("card focus/unfocus and visibility do not alter collection or spend transactions", async () => {
  const h = await harness();
  h.view.open();
  await h.click("collection-open", "test");
  await h.click("collection-reveal-all");
  const before = h.env.values.get(PROGRESS_KEY),
    n = h.actions.length;
  await h.click("collection-summary");
  await h.click("collection-focus", "7");
  assert.equal(h.scene().focusedIndex, 7);
  assert.equal(h.view.summaryExpanded, false);
  assert.equal(h.root.querySelector(".pack-stage").scrolled, undefined);
  await h.click("collection-unfocus");
  assert.equal(h.scene().focusedIndex, null);
  h.view.visibility(true);
  assert.equal(h.scene().hidden, true);
  h.view.visibility(false);
  assert.equal(h.scene().hidden, false);
  assert.equal(h.env.values.get(PROGRESS_KEY), before);
  assert.equal(h.actions.length, n);
});

test("ordinary renders preserve the scene and canvas for the same durable opening", async () => {
  const h = await harness();
  h.view.open();
  await h.click("collection-open", "test");
  const canvas = h.root.querySelector("#pack-canvas"),
    scene = h.scene(),
    saved = h.env.values.get(PROGRESS_KEY);
  for (let i = 0; i < 30; i++) h.view.render();
  assert.equal(h.scenes.length, 1);
  assert.equal(h.scene(), scene);
  assert.equal(h.root.querySelector("#pack-canvas"), canvas);
  assert.equal(scene.disposed, false);
  assert.equal(h.env.values.get(PROGRESS_KEY), saved);
});

test("renderer failure retains accessible controls for the already saved batch", async () => {
  const h = await harness();
  h.view.open();
  await h.click("collection-open", "test");
  const before = h.store.data.collection.opening;
  h.scene().available = false;
  h.scene().phase = "idle";
  h.scene().status();
  assert.match(
    h.root.querySelector("#pack-instruction").textContent,
    /画面暂不可用/,
  );
  assert.equal(h.button("collection-reveal", "0").disabled, false);
  await h.click("collection-reveal-all");
  assert.equal(h.store.data.collection.opening.revealed, 1023);
  assert.deepEqual(h.store.data.collection.opening.cards, before.cards);
  await h.click("collection-summary");
  assert.equal(
    h.root
      .querySelectorAll("[data-action]")
      .filter((x) => x.dataset.action === "collection-focus").length,
    10,
  );
});

test("finishing and reopening gifts disposes the prior scene without duplicate collection grants", async () => {
  const h = await harness();
  h.view.open();
  await h.click("collection-open", "test");
  assert.equal(h.button("collection-finish"), undefined);
  await h.click("collection-reveal-all");
  const first = h.scene(),
    id = h.store.data.collection.opening.id;
  await h.click("collection-finish");
  assert.equal(first.disposed, true);
  assert.equal(h.store.data.collection.opening, null);
  assert.equal(h.store.data.collection.recent.length, 1);
  await h.click("collection-finish");
  assert.equal(h.store.data.collection.recent.length, 1);
  await h.click("collection-open", "test");
  assert.notEqual(h.store.data.collection.opening.id, id);
  assert.equal(h.scenes.length, 2);
  assert.equal(h.store.data.collection.openingIds.length, 2);
  assert.equal(
    Object.values(h.store.data.collection.test.cards).reduce(
      (a, b) => a + b,
      0,
    ),
    20,
  );
});

test("Escape requests saved-pack exit, can cancel, then explicitly leaves without rerolling", async () => {
  const h = await harness();
  h.view.open();
  await h.click("collection-open", "test");
  const before = h.env.values.get(PROGRESS_KEY);
  h.root.querySelector(".collection-panel").focus();
  const event = h.document.activeElement.dispatch("keydown", { key: "Escape" });
  assert.equal(event.stopped, true);
  assert.equal(h.view.exitPrompt, true);
  assert.equal(h.root.hidden, false);
  assert.equal(h.scene().hidden, true);
  await h.click("collection-cancel-close");
  assert.equal(h.view.exitPrompt, false);
  assert.equal(h.scene().hidden, false);
  assert.equal(h.env.values.get(PROGRESS_KEY), before);
  await h.click("collection-close");
  await h.click("collection-confirm-close");
  assert.equal(h.root.hidden, true);
  assert.equal(h.scene().disposed, true);
  assert.equal(h.env.values.get(PROGRESS_KEY), before);
});

test("an external profile replacement rejects pending old-pack writes and hides its results", async () => {
  const h = await harness(),
    other = new ProgressStore({
      storage: h.env.storage,
      locks: h.env.locks,
      questions,
    });
  await other.load();
  const empty = other.export();
  h.view.open();
  h.env.fail();
  await h.click("collection-open", "test");
  const pending = h.store.data.collection.opening;
  const prepared = other.prepareImport(empty);
  assert.equal((await other.restore(prepared, prepared.revision)).ok, true);
  const clean = h.env.values.get(PROGRESS_KEY);
  await h.click("collection-retry");
  assert.equal(h.store.issue.code, "PROFILE_CHANGED");
  assert.equal(h.env.values.get(PROGRESS_KEY), clean);
  assert.equal(h.root.querySelector("#pack-results"), null);
  assert.equal(h.scenes.length, 0);
  assert.deepEqual(h.store.data.collection.opening, pending);
});

test("keyboard focus remains in the collection when a navigation control is replaced", async () => {
  const h = await harness();
  h.view.open();
  const button = h.button("collection-album");
  button.focus();
  button.dispatch("click");
  await h.settle();
  assert.equal(h.view.view, "album");
  assert.equal(
    h.root.contains(h.document.activeElement),
    true,
    "Replacing innerHTML leaves focus on body, outside the modal",
  );
});

test("scene status refresh preserves the focused keyboard reveal control", async () => {
  const h = await harness();
  h.view.open();
  await h.click("collection-open", "test");
  h.scene().skip();
  const button = h.button("collection-reveal", "3");
  button.focus();
  h.scene().status();
  assert.equal(
    h.document.activeElement,
    h.button("collection-reveal", "3"),
    "Animation status must preserve the same logical keyboard control",
  );
});

test("opening reward rules preserves focus inside the collection", async () => {
  const h = await harness();
  h.view.open();
  const button = h.button("collection-rules");
  button.focus();
  button.dispatch("click");
  await h.settle();
  assert.equal(h.view.view, "rules");
  assert.equal(
    h.root.contains(h.document.activeElement),
    true,
    "Rules bypass render and can strand keyboard focus on body",
  );
});

test("Shift-Tab from the initially focused dialog panel wraps to the last control", async () => {
  const h = await harness();
  h.view.open();
  assert.equal(
    h.document.activeElement,
    h.root.querySelector(".collection-panel"),
  );
  const last = h.root
    .querySelectorAll('button:not(:disabled),select,[tabindex="0"]')
    .at(-1);
  const event = h.document.activeElement.dispatch("keydown", {
    key: "Tab",
    shiftKey: true,
  });
  assert.equal(
    event.prevented,
    true,
    "Initial reverse-tab must not escape to browser chrome or background UI",
  );
  assert.equal(h.document.activeElement, last);
});

test("app-level Escape from outside collection closes its root and uses the collection callback", async () => {
  const h = await harness();
  h.view.open();
  let closes = 0;
  const sandbox = {
    isPractice: true,
    document: h.document,
    collectionView: h.view,
    panel: "collection",
    modalRoot: h.document.createElement("div"),
    challenge: null,
    room: null,
    selected: null,
    desk: {
      close() {
        throw Error("Generic desk close must not replace collection close");
      },
    },
    render() {
      throw Error("Generic render must not bypass collection close");
    },
  };
  h.view.onClose = () => {
    closes++;
    sandbox.panel = null;
  };
  vm.createContext(sandbox);
  vm.runInContext(keySource, sandbox);
  h.document.body.focus();
  h.document.activeElement.dispatch("keydown", { key: "Escape" });
  assert.equal(closes, 1);
  assert.equal(sandbox.panel, null);
  assert.equal(h.root.hidden, true);
  assert.equal(h.view.opened, false);
});

test("app-level Escape while a pack transaction is pending cannot desynchronize overlay and panel", async () => {
  const h = await harness();
  h.view.open();
  const sandbox = {
    isPractice: true,
    document: h.document,
    collectionView: h.view,
    panel: "collection",
    modalRoot: h.document.createElement("div"),
    challenge: null,
    room: null,
    selected: null,
    desk: {
      close() {
        throw Error("Generic close reached");
      },
    },
    render() {
      throw Error("Generic render reached");
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(keySource, sandbox);
  const release = h.env.pause(),
    work = h.view.click("collection-open", "test");
  await tick();
  h.document.body.focus();
  h.document.activeElement.dispatch("keydown", { key: "Escape" });
  assert.equal(sandbox.panel, "collection");
  assert.equal(h.root.hidden, false);
  assert.equal(h.view.opened, true);
  release();
  await work;
  assert.equal(h.store.data.collection.openingIds.length, 1);
});

test("closing the collection restores focus to its entry button", async () => {
  const h = await harness();
  h.view.open();
  h.button("collection-close").focus();
  await h.click("collection-close");
  assert.equal(
    h.document.activeElement,
    h.trigger,
    "Dialog dismissal should restore the original launch control",
  );
});

test("attention excludes hidden time and one receipt can be finished only once", () => {
  let now = 0;
  const attention = new LearningAttention({ now: () => now });
  attention.begin("q");
  now = 2000;
  attention.feedback("q");
  now = 2200;
  attention.visibility(false);
  now = 62200;
  attention.visibility(true);
  now = 63200;
  assert.deepEqual(attention.finish("q"), {
    questionMs: 2000,
    feedbackMs: 1200,
  });
  assert.equal(attention.finish("q"), null);
});

test("restoring a learning profile clears old participation clocks as well as feedback", async () => {
  const env = io();
  let now = 0;
  const desk = new StudyDesk({
    storage: env.storage,
    locks: env.locks,
    fetcher: async () => ({ ok: true, json: async () => ({ questions }) }),
  });
  await desk.initialize();
  desk.attention = new LearningAttention({ now: () => now });
  const id = "attention-restore-0001";
  desk.beginAttention(id);
  now = 2000;
  desk.receiveFeedback(
    {
      challengeId: id,
      learning: {
        qid: questions[0].id,
        answeredAt: Date.now(),
        correct: false,
      },
    },
    "study",
  );
  await desk.flush();
  const prepared = desk.store.prepareImport(desk.store.export());
  assert.equal(
    (await desk.store.restore(prepared, prepared.revision)).ok,
    true,
  );
  now = 3200;
  await desk.finishAttention(id);
  assert.deepEqual(
    desk.store.data.collection.days,
    {},
    "A timer from the old profile must not qualify an imported receipt",
  );
  assert.equal(desk.attention.entries.size, 0);
});

test('switching collection pages resets navigation scroll while updates keep reading position', async()=>{
 const h=await harness();h.view.open();
 const panel=h.root.querySelector('.collection-panel');panel.scrollTop=380;
 await h.click('collection-album');assert.equal(panel.scrollTop,0);
 panel.scrollTop=160;h.view.render();assert.equal(panel.scrollTop,160);
 await h.click('collection-rules');assert.equal(panel.scrollTop,0);
});
