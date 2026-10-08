import test from "node:test";
import assert from "node:assert/strict";
import { SpeechDirector } from "../src/av/speech.mjs";
function harness() {
  const nodes = [],
    utterances = [],
    notifications = [],
    ducked = [],
    buttons = [{ dataset: {} }];
  globalThis.document = {
    querySelectorAll: () => buttons,
    body: {
      appendChild(a) {
        nodes.push(a);
      },
    },
  };
  globalThis.window = {
    speechSynthesis: {
      cancel() {},
      getVoices: () => [],
      speak(u) {
        utterances.push(u);
      },
    },
  };
  globalThis.SpeechSynthesisUtterance = class {
    constructor(text) {
      this.text = text;
    }
  };
  globalThis.Audio = class {
    constructor(src) {
      this.src = src;
      this.dataset = {};
      this.events = {};
      this.paused = true;
    }
    setAttribute() {}
    addEventListener(k, f) {
      this.events[k] = f;
    }
    pause() {
      this.paused = true;
    }
    remove() {
      this.removed = true;
    }
    play() {
      this.paused = false;
      return Promise.resolve();
    }
  };
  const director = new SpeechDirector(
    { book: "assets/speech/book.mp3" },
    { duck: (x) => ducked.push(x), notify: (x) => notifications.push(x) },
  );
  return { director, nodes, utterances, notifications, ducked, buttons };
}
test("bundled pronunciation starts on demand and ducks only after real playing", () => {
  const h = harness();
  h.director.play("book");
  const a = h.nodes[0];
  assert.equal(a.dataset.state, "loading");
  assert.equal(h.ducked.at(-1), false);
  a.events.playing();
  assert.equal(h.ducked.at(-1), true);
  assert.equal(h.buttons[0].dataset.speaking, "true");
  a.events.ended();
  assert.equal(h.ducked.at(-1), false);
  assert.equal(a.dataset.state, "idle");
});
test("old clip callbacks cannot restart audio feedback after cancellation", () => {
  const h = harness();
  h.director.play("book");
  const old = h.nodes[0];
  h.director.stop();
  old.events.playing();
  old.events.error();
  assert.ok(old.removed);
  assert.equal(h.utterances.length, 0);
  assert.equal(h.ducked.at(-1), false);
});
test("repeated media errors use system fallback only once", () => {
  const h = harness();
  h.director.play("book");
  const a = h.nodes[0];
  a.events.error();
  a.events.error();
  assert.equal(h.utterances.length, 1);
  assert.equal(h.utterances[0].text, "book");
});
test("hidden page cancels speech and becoming visible never auto-starts it", () => {
  const h = harness();
  h.director.play("book");
  h.director.visibility(true);
  h.director.play("book");
  assert.equal(h.nodes.length, 1);
  assert.ok(h.nodes[0].paused);
  h.director.visibility(false);
  assert.equal(h.nodes.length, 1);
});
test("disabled pronunciation stays silent and gives a clear control hint", () => {
  const h = harness();
  h.director.play("book", false);
  assert.equal(h.nodes.length, 0);
  assert.match(h.notifications[0], /设置/);
});
test("the visible stop control cancels the same clip, and a later click can replay", () => {
  const h = harness();
  h.director.play("book");
  h.nodes[0].events.playing();
  assert.equal(h.buttons[0].textContent, "■ 停止朗读");
  h.director.play("book");
  assert.equal(h.director.status, "idle");
  assert.equal(h.nodes.length, 1);
  h.director.play("book");
  assert.equal(h.nodes.length, 2);
});
