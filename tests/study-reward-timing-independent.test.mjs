// Independent-origin timing regressions; 3.2 DOM surface adapted by implementation owner.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { performance } from "node:perf_hooks";
import { StudyDesk } from "../src/network/study-desk.mjs";
import { LearningAttention } from "../src/network/learning-attention.mjs";
import { PROGRESS_KEY } from "../src/network/progress.mjs";
import { CARDS, CARD } from "../src/cards.mjs";
import {
  FINISHES,
  FINISH,
  COLLECTION_TEST_MODE,
  rewardBalance,
  dayKey,
} from "../src/collection.mjs";
import { artThumb } from "../src/network/card-library.mjs";
import { GameService, DEFAULTS } from "../server/service.mjs";

// Actual StudyDesk, ProgressStore, CollectionView home rendering, and app click
// handler. Tiny DOM slots cover routing/render updates, not browser rendering.
const appSource = readFileSync(
  new URL("../src/network/app.mjs", import.meta.url),
  "utf8",
);
const clickSource = appSource.slice(
  appSource.indexOf('document.addEventListener("click",'),
  appSource.indexOf("function previewControl("),
);
const connectionSource = appSource.slice(
  appSource.indexOf("const link = new DuelConnection("),
  appSource.indexOf("function stateForScene("),
);
const clearSource = appSource.slice(
  appSource.indexOf("function clearRoom("),
  appSource.indexOf("function applySceneState("),
);
const viewSource =
  readFileSync(
    new URL("../src/network/collection-view.mjs", import.meta.url),
    "utf8",
  )
    .replace(/^import .*;\n/gm, "")
    .replace("export class CollectionView", "class CollectionView") +
  "\nglobalThis.CollectionView=CollectionView;";
const questions = Array.from({ length: 432 }, (_, i) => ({
  id: `timing-q-${String(i).padStart(3, "0")}`,
  grade: 1,
  semester: 1,
  unitId: "g1-s1-u1",
  displayLabel: `Question ${i}`,
}));
const defer = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};
const nextTurn = () => new Promise((r) => setImmediate(r));
const count = (data) =>
  Object.values(data.collection.days).reduce(
    (sum, day) => sum + day.qids.length,
    0,
  );

async function fixture({ locked = true } = {}) {
  let now = 0,
    desk,
    view,
    challengeSeq = 0,
    gate = null,
    tail = Promise.resolve(),
    failures = 0;
  const values = new Map(),
    events = [],
    finishes = [],
    notices = [],
    handlers = new Map(),
    issued = new Map();
  const storage = {
    getItem: (k) => values.get(k) ?? null,
    setItem(k, v) {
      if (k === PROGRESS_KEY && failures) {
        failures--;
        events.push({ kind: "failed-write", at: performance.now() });
        throw Error("quota");
      }
      values.set(k, String(v));
      if (k === PROGRESS_KEY)
        events.push({
          kind: "write",
          at: performance.now(),
          count: count(JSON.parse(v)),
        });
    },
  };
  const locks = {
    request(name, options, fn) {
      const waiting = gate?.promise;
      const task = tail.then(async () => {
        if (waiting) await waiting;
        return fn();
      });
      tail = task.catch(() => {});
      return task;
    },
  };
  const content = { innerHTML: "" },
    panel = {
      id: "collection-panel",
      dataset: {},
      isConnected: true,
      focus() {
        document.activeElement = this;
      },
    };
  const rootClasses = new Set();
  const root = {
    classList: { toggle(name, active) { if (active) rootClasses.add(name); else rootClasses.delete(name); } },
    hidden: true,
    innerHTML: "",
    dataset: {},
    addEventListener() {},
    querySelector: (s) =>
      s === ".collection-panel"
        ? panel
        : s === ".collection-content"
          ? content
          : null,
    querySelectorAll: () => [],
    contains: (el) => el === panel,
    replaceChildren() {
      content.innerHTML = "";
    },
  };
  const document = {
    activeElement: null,
    hidden: false,
    querySelector: () => null,
    addEventListener: (name, fn) => handlers.set(name, fn),
  };
  const sandbox = {
    document,
    CARDS,
    CARD,
    FINISHES,
    FINISH,
    COLLECTION_TEST_MODE,
    rewardBalance,
    dayKey,
    artThumb,
    PackScene: class {},
    ResizeObserver: undefined,
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(viewSource, sandbox);
  desk = new StudyDesk({
    storage,
    locks: locked ? locks : null,
    getPreferences: () => ({ grade: 1, course: "s1" }),
    fetcher: async (path, options = {}) => {
      if (path === "/api/curriculum")
        return { ok: true, json: async () => ({ questions }) };
      const qid = decodeURIComponent(path.split("/")[3]);
      if (options.method === "POST") {
        const { challengeId } = JSON.parse(options.body),
          q = issued.get(challengeId);
        assert.equal(q, qid);
        return {
          ok: true,
          json: async () => ({
            challengeId,
            learning: { qid, answeredAt: Date.now(), correct: true },
            outcome: "correct",
            correctOptionId: "answer-a",
            explanation: "A complete explanation",
          }),
        };
      }
      const challengeId = `timing-challenge-${++challengeSeq}`;
      issued.set(challengeId, qid);
      return {
        ok: true,
        json: async () => ({
          challengeId,
          question: {
            prompt: "How ___ are you?",
            options: [
              { id: "answer-a", text: "old" },
              { id: "answer-b", text: "name" },
            ],
          },
        }),
      };
    },
    onChange() {
      if (!desk?.data) return;
      events.push({
        kind: "change",
        at: performance.now(),
        count: count(desk.data),
        view: desk.view,
        dirty: desk.store?.dirty,
      });
      view?.render();
    },
    onNotice(text) {
      notices.push(text);
      events.push({ kind: "notice", at: performance.now(), text });
    },
  });
  await desk.initialize();
  assert.equal(desk.status, "ready");
  desk.attention = new LearningAttention({ now: () => now });
  const originalFinish = desk.finishAttention.bind(desk);
  desk.finishAttention = (id) => {
    const at = performance.now();
    events.push({ kind: "finish-start", at, id });
    const p = originalFinish(id);
    finishes.push(p);
    p.then(() =>
      events.push({ kind: "finish-end", at: performance.now(), id }),
    );
    return p;
  };
  view = new sandbox.CollectionView({
    root,
    store: () => desk.store,
    preferences: () => ({ reduced: true }),
    onClose() {
      sandbox.panel = null;
    },
    onStudy() {
      sandbox.openDesk("study");
    },
    onNotice: (text) => notices.push(text),
    onSound() {},
  });
  Object.assign(sandbox, {
    // These tests deliberately exercise the local practice receipt/store lifecycle.
    isPractice: true,
    desk,
    collectionView: view,
    panel: null,
    selected: null,
    waiting: false,
    room: null,
    SOUND: { unlock() {} },
    cancelVoice() {},
    render() {},
    openDesk(name) {
      sandbox.panel = name;
      desk.open(name);
    },
    DuelConnection: class {
      constructor(options) {
        Object.assign(this, options);
      }
    },
    sceneEpoch: 0,
    scene: { cancel() {}, showGallery() {} },
    sceneTransition: Promise.resolve(),
    visualBusy: false,
    serverClock: { reset() {} },
    latestRoom: null,
    displayRoom: null,
    challenge: null,
    feedback: null,
    lastBattleFeedback: null,
    recapExpanded: false,
    openingSelection: [],
    sceneRevision: null,
    visibleEvents: new Set(),
    sceneFault: false,
    notice(text) {
      events.push({ kind: "app-notice", text });
    },
  });
  vm.runInContext(
    connectionSource +
      clearSource +
      clickSource +
      "\nglobalThis.testLink=link;",
    sandbox,
  );
  const h = {
    desk,
    view,
    sandbox,
    events,
    notices,
    values,
    finishes,
    advance(ms) {
      now += ms;
    },
    failNextWrite() {
      failures++;
    },
    hold() {
      gate = defer();
      const held = gate;
      return () => {
        gate = null;
        held.resolve();
      };
    },
    click(action, data = {}) {
      const target = {
        dataset: { action, ...data },
        disabled: false,
        closest() {
          return this;
        },
      };
      handlers.get("click")({ target, preventDefault() {} });
    },
    html: () => content.innerHTML,
    durable: () => JSON.parse(values.get(PROGRESS_KEY)),
    count: () => count(desk.data),
    async idle() {
      await Promise.all([...finishes]);
      if (desk.flushDone) await desk.flushDone;
      await desk.store._serial;
      await nextTurn();
    },
    async openStudy() {
      h.click("study");
      await desk.store._serial;
      assert.equal(desk.view, "study");
      desk.filter = "all";
    },
    async seed(n = 5) {
      for (let i = 0; i < n; i++) {
        const id = `timing-seed-${i}`;
        await desk.store.applyLearning({
          challengeId: id,
          learning: {
            qid: questions[i].id,
            answeredAt: Date.now(),
            correct: false,
          },
        });
        await desk.store.qualifyLearning(id, {
          questionMs: 2000,
          feedbackMs: 1200,
        });
      }
      assert.equal(h.count(), n);
    },
    async answer(q = 5, { questionMs = 2000, feedbackMs = 15000 } = {}) {
      await desk.study(questions[q].id);
      assert.ok(desk.question);
      h.advance(questionMs);
      await desk.answerStudy("answer-a");
      await desk.flush();
      h.advance(feedbackMs);
      assert.ok(desk.answer);
      return desk.question.challengeId;
    },
  };
  return h;
}

for (const method of ["close-panel", "desk-back", "desk-next"])
  test(`${method}: sixth receipt saves and notifies without reopening any panel`, async () => {
    const h = await fixture();
    await h.seed();
    await h.openStudy();
    await h.answer();
    const start = performance.now();
    h.click(method);
    assert.equal(
      h.count(),
      5,
      "The event handler schedules qualification asynchronously",
    );
    if (method === "close-panel") {
      assert.equal(h.desk.question, null);
      assert.equal(h.desk.answer, null);
      assert.equal(h.desk.view, null);
    }
    await nextTurn();
    assert.equal(h.count(), 6);
    assert.equal(count(h.durable()), 6);
    assert.equal(h.desk.data.collection.totalDays, 1);
    assert.equal(
      h.notices.filter((x) => x.includes("累计1个学习日")).length,
      1,
    );
    assert.ok(h.events.find((x) => x.kind === "notice").at >= start);
    await h.idle();
  });

test("opening collection in the same turn initially sees 5/6 and repaints itself to 6/6", async () => {
  const h = await fixture();
  await h.seed();
  await h.openStudy();
  await h.answer();
  h.click("close-panel");
  h.click("collection");
  assert.match(h.html(), /今日 5\/6/);
  await nextTurn();
  assert.match(h.html(), /今日 6\/6/);
  assert.equal(h.view.opened, true);
  assert.equal(h.sandbox.panel, "collection");
  assert.equal(h.notices.length, 1);
});

test("four battle items, next-item credit, too-fast close, then 15s feedback finishes the day", async () => {
  const h = await fixture();
  await h.seed(4);
  await h.openStudy();
  await h.answer(4);
  h.click("desk-next");
  await h.idle();
  assert.equal(h.count(), 5);
  h.desk.close();
  await h.idle();
  await h.openStudy();
  const shortId = await h.answer(5, { feedbackMs: 0 });
  h.click("close-panel");
  await h.idle();
  assert.equal(h.count(), 5);
  assert.equal(h.desk.attention.entries.has(shortId), false);
  await h.openStudy();
  await h.answer(6, { feedbackMs: 15000 });
  h.click("close-panel");
  h.click("collection");
  await nextTurn();
  assert.equal(h.count(), 6);
  assert.match(h.html(), /今日 6\/6/);
  assert.equal(h.notices.length, 1);
});

test("insufficient feedback is consumed on close and cannot later mature by reopening", async () => {
  const h = await fixture();
  await h.seed();
  await h.openStudy();
  await h.answer(5, { feedbackMs: 1199 });
  h.click("close-panel");
  await h.idle();
  assert.equal(h.count(), 5);
  h.advance(30000);
  await h.openStudy();
  await h.idle();
  assert.equal(h.count(), 5);
  assert.equal(h.notices.length, 0);
  assert.equal(h.desk.attention.entries.size, 0);
});

test("duplicate knowledge and hidden time never become a sixth item on a later open", async () => {
  const h = await fixture();
  await h.seed();
  await h.openStudy();
  await h.answer(2);
  h.click("close-panel");
  await h.idle();
  assert.equal(h.count(), 5);
  await h.openStudy();
  await h.answer(5, { feedbackMs: 200 });
  h.desk.visibility(false);
  h.advance(15000);
  h.desk.visibility(true);
  h.advance(999);
  h.click("close-panel");
  await h.idle();
  assert.equal(h.count(), 5);
  await h.openStudy();
  await h.idle();
  assert.equal(h.count(), 5);
  assert.equal(h.notices.length, 0);
});

test("queued store lock delays qualification but release alone completes it without open", async () => {
  const h = await fixture();
  await h.seed();
  await h.openStudy();
  await h.answer();
  const release = h.hold();
  h.click("close-panel");
  h.click("collection");
  await nextTurn();
  assert.equal(count(h.durable()), 5);
  assert.equal(h.notices.length, 0);
  assert.equal(h.desk.store.dirty, true);
  release();
  await h.idle();
  assert.equal(count(h.durable()), 6);
  assert.match(h.html(), /今日 6\/6/);
  assert.equal(h.notices.length, 1);
});

test("reopening cannot bypass a still-held lock or cause a second qualification", async () => {
  const h = await fixture();
  await h.seed();
  await h.openStudy();
  await h.answer();
  const release = h.hold();
  h.click("close-panel");
  await nextTurn();
  h.click("study");
  await nextTurn();
  assert.equal(count(h.durable()), 5);
  assert.equal(h.finishes.length, 1);
  release();
  await h.idle();
  assert.equal(count(h.durable()), 6);
  assert.equal(h.notices.length, 1);
  assert.equal(h.finishes.length, 1);
});

test("a failed qualification save is retried on open but does not produce a late completion toast", async () => {
  const h = await fixture();
  await h.seed();
  await h.openStudy();
  await h.answer();
  h.failNextWrite();
  h.click("close-panel");
  await h.idle();
  assert.equal(count(h.durable()), 5);
  assert.equal(h.count(), 6);
  assert.equal(h.desk.store.issue.code, "WRITE_FAILED");
  h.click("collection");
  assert.match(h.html(), /先保管好你的记录/);
  assert.equal(h.notices.length, 0);
  h.view.close();
  await h.openStudy();
  await h.idle();
  assert.equal(count(h.durable()), 6);
  assert.equal(
    h.notices.length,
    0,
    "retry itself never runs finishAttention notification",
  );
});

test("an answer response that arrives after close records mastery without pretending feedback was read", async () => {
  const h = await fixture();
  await h.seed();
  await h.openStudy();
  await h.desk.study(questions[5].id);
  h.advance(2000);
  const fetcher = h.desk.fetcher,
    gate = defer();
  h.desk.fetcher = async (...args) => {
    const result = await fetcher(...args);
    if (args[1]?.method === "POST") await gate.promise;
    return result;
  };
  const answer = h.desk.answerStudy("answer-a");
  await nextTurn();
  h.click("close-panel");
  gate.resolve();
  await answer;
  await h.idle();
  assert.equal(h.desk.data.legacy.mastery[questions[5].id].seen, 1);
  assert.equal(h.count(), 5);
  h.advance(15000);
  await h.openStudy();
  await h.idle();
  assert.equal(h.count(), 5);
  assert.equal(h.notices.length, 0);
});

test("an abandoned desk answer precisely reproduces delayed completion on the next open", async () => {
  const h = await fixture();
  await h.seed();
  await h.openStudy();
  await h.answer();
  // This deliberately models a panel-only dismissal, not close-panel/back/next.
  // It isolates what must be true for open()'s initial close() to award a day.
  h.sandbox.panel = null;
  h.click("collection");
  await h.idle();
  assert.match(h.html(), /今日 5\/6/);
  assert.ok(h.desk.answer);
  assert.equal(h.finishes.length, 0);
  h.view.close();
  await h.openStudy();
  await h.idle();
  assert.equal(h.count(), 6);
  assert.equal(h.notices.length, 1);
  assert.equal(h.finishes.length, 1);
});

test("REGRESSION: expiry of a previous battle must not dismiss an unrelated active study feedback", async (t) => {
  const h = await fixture();
  await h.seed();
  assert.equal(DEFAULTS.finishedMs, 300000);
  const oldRoom = {
    id: "old-finished-room",
    timers: new Map(),
    aiPlan: null,
    seats: [
      {
        sessionId: "old-session",
        feedbacks: new Map(),
        questionDeck: [],
        pending: null,
      },
    ],
  };
  const service = new GameService({
    questions: {},
    send: (socket, message) => h.sandbox.testLink.onMessage(message),
  });
  t.after(() => service.close());
  service.rooms.set(oldRoom.id, oldRoom);
  service.sessions.set("old-session", {
    id: "old-session",
    roomId: oldRoom.id,
    ws: {},
    receipts: new Map(),
    seqIds: new Map(),
  });
  h.sandbox.room = { roomId: oldRoom.id, phase: "finished" };
  h.click("new-match");
  assert.equal(h.sandbox.room, null);
  assert.equal(service.sessions.get("old-session").roomId, oldRoom.id);
  await h.openStudy();
  const id = await h.answer();
  service.expire(oldRoom);
  await nextTurn();
  assert.equal(
    h.sandbox.panel,
    "study",
    "An old room.expired clears current panel without finalizing its feedback",
  );
  assert.equal(h.desk.question?.challengeId, id);
  assert.equal(h.count(), 5);
  h.click("close-panel");
  await h.idle();
  assert.equal(h.count(), 6);
  assert.equal(h.notices.length, 1);
});

test("an expiry message for the currently displayed battle still exits that battle", async () => {
  const h = await fixture();
  h.sandbox.room = { roomId: "currently-displayed-room", phase: "playing" };
  h.sandbox.panel = "opponent";
  h.sandbox.testLink.onMessage({
    type: "room.expired",
    roomId: "currently-displayed-room",
  });
  assert.equal(h.sandbox.room, null);
  assert.equal(h.sandbox.panel, null);
  assert.equal(
    h.events.some(
      (e) => e.kind === "app-notice" && e.text.includes("临时房间已结束"),
    ),
    true,
  );
});

test("uncontended close-to-durable timing has no timer or reopen dependency", async (t) => {
  const durations = [];
  for (let i = 0; i < 20; i++) {
    const h = await fixture({ locked: i % 2 === 0 });
    await h.seed();
    await h.openStudy();
    await h.answer();
    const at = performance.now();
    h.click("close-panel");
    await nextTurn();
    assert.equal(count(h.durable()), 6);
    const write = h.events
      .filter((e) => e.kind === "write" && e.count === 6)
      .at(-1);
    durations.push(write.at - at);
    assert.equal(h.notices.length, 1);
  }
  durations.sort((a, b) => a - b);
  t.diagnostic(
    `20 Node DOM/store runs, half serial-lock/half no-lock: close→durable median=${durations[10].toFixed(3)}ms, maximum=${durations.at(-1).toFixed(3)}ms. Browser CPU/lock latency is not measured.`,
  );
});
