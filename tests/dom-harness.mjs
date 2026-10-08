import fs from "node:fs";
import vm from "node:vm";
import { normalizeDifficulty } from "../src/combat-rating.mjs";
export function domHarness(
  dir,
  { raw = null, legacyRaw = null, failWrites = false, failReads = false } = {},
) {
  const Q = JSON.parse(fs.readFileSync(dir + "/questions.json"));
  const events = {},
    documentEvents = {},
    windowEvents = {},
    fileEvents = {},
    timers = new Map(),
    storage = new Map();
  let nextTimer = 0;
  if (raw !== null) storage.set("spellwood.save.v2", raw);
  if (legacyRaw !== null) storage.set("spellwood.save.v1", legacyRaw);
  const app = {
    innerHTML: "",
    addEventListener: (type, f) => (events[type] = f),
  };
  const handNode = {
    scrollLeft: 0,
    scrollBy({ left }) {
      this.scrollLeft = Math.max(0, this.scrollLeft + left);
    },
  };
  const generic = {
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {},
    focus() {},
    scrollIntoView() {},
    addEventListener() {},
    value: "",
    textContent: "",
  };
  const document = {
    body: generic,
    activeElement: generic,
    querySelector: (s) =>
      s === "#app"
        ? app
        : s === "#import-file"
          ? {
              ...generic,
              addEventListener: (type, f) => (fileEvents[type] = f),
            }
          : s === ".hand-row"
            ? app.innerHTML.includes('class="hand-row"')
              ? handNode
              : null
            : generic,
    querySelectorAll: () => [],
    addEventListener: (type, f) => (documentEvents[type] = f),
    hidden: false,
    createElement: () => ({ click() {} }),
  };
  const window = {
    addEventListener: (t, f) => (windowEvents[t] = f),
    scrollTo() {},
    speechSynthesis: true,
    location: {
      reload() {
        window.reloads = (window.reloads || 0) + 1;
      },
    },
  };
  const ctx = vm.createContext({
    QUESTIONS: Q,
    normalizeDifficulty,
    SPEECH_ASSETS: {},
    CURRICULUM: JSON.parse(fs.readFileSync(dir + "/curriculum.json")),
    FX: {
      reduced: false,
      cancel() {},
      capture() {},
      before: async () => {},
      after() {},
      victory() {},
      projectile: async () => {},
    },
    SOUND: {
      duckSpeech() {},
      sync() {},
      reflect() {},
      unlock() {},
      play() {},
      visibility() {},
    },
    document,
    window,
    getComputedStyle: () => ({ backgroundImage: "none" }),
    localStorage: {
      getItem: (k) => {
        if (
          failReads === true ||
          (Array.isArray(failReads) && failReads.includes(k))
        )
          throw Error("unreadable");
        return storage.get(k);
      },
      setItem: (k, v) => {
        if (failWrites) throw Error("quota");
        storage.set(k, v);
      },
    },
    structuredClone,
    console,
    setTimeout: (f, t) => {
      const id = ++nextTimer;
      timers.set(id, f);
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    innerWidth: 1000,
    Blob,
    URL,
    Date,
    Math,
    SpeechSynthesisUtterance: class {
      constructor(t) {
        this.text = t;
      }
    },
    speechSynthesis: {
      cancel() {},
      capture() {},
      getVoices() {
        return [];
      },
      speak(u) {
        window.spoken = u.text;
      },
    },
  });
  window.speechSynthesis = ctx.speechSynthesis;
  const src = [
    "cards",
    "random",
    "opening",
    "engine",
    "learning",
    "learning-visuals",
    "save-session",
    "av/speech",
    "av/pictures",
    "app",
  ]
    .map((f) =>
      fs
        .readFileSync(dir + "/" + f + ".mjs", "utf8")
        .replace(/^import [\s\S]*?;\n/gm, "")
        .replace(/^export \{[^}]*\};\n/gm, "")
        .replace(/^export /gm, ""),
    )
    .join("\n");
  vm.runInContext(src, ctx);
  // Existing tests start from an already-confirmed battle; opening UI has its own tests.
  vm.runInContext(
    `function startReady(seed, config) { start(seed, config); if (openingPending(save.match)) { save.match = finishOpening(save.match, []); persist(); render(); } }`,
    ctx,
  );
  return {
    Q,
    ctx,
    app,
    handNode,
    storage,
    window,
    windowEvents,
    documentEvents,
    fileEvents,
    pendingTimers: () => timers.size,
    timerCallback: (id) => timers.get(id),
    run: (s) => vm.runInContext(s, ctx),
    settle: async (promise) => {
      let done = false,
        error;
      promise.then(
        () => {
          done = true;
        },
        (e) => {
          done = true;
          error = e;
        },
      );
      for (let i = 0; i < 100 && !done; i++) {
        await Promise.resolve();
        const entry = timers.entries().next().value;
        if (entry) {
          timers.delete(entry[0]);
          entry[1]();
        }
        await Promise.resolve();
      }
      if (error) throw error;
      if (!done)
        throw Error("App action did not settle within the bounded timer drain");
    },
    click: (action, extra = {}) => {
      const b = { dataset: { action, ...extra }, disabled: false };
      events.click({ target: { closest: () => b } });
    },
  };
}
