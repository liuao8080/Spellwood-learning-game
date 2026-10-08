import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { domHarness } from "./dom-harness.mjs";
const dir = fileURLToPath(new URL("../src", import.meta.url));
function scrollingHarness() {
  const h = domHarness(dir);
  let html = h.app.innerHTML,
    list = { scrollTop: 0 },
    panel = { scrollTop: 0 };
  const feedback = [];
  const original = h.ctx.document.querySelector;
  Object.defineProperty(h.app, "innerHTML", {
    get: () => html,
    set: (value) => {
      html = value;
      list = { scrollTop: 0 };
      panel = { scrollTop: 0 };
    },
  });
  h.ctx.document.querySelector = (s) => {
    if (s === ".word-list")
      return html.includes('class="word-list"') ? list : null;
    if (s === ".modal-card")
      return html.includes('class="modal-card') ? panel : null;
    if (s === ".review-question .explanation")
      return html.includes('class="explanation"')
        ? {
            scrollIntoView: (opts) => {
              feedback.push({ top: panel.scrollTop, opts });
              panel.scrollTop = 190;
            },
          }
        : null;
    return original(s);
  };
  return { ...h, list: () => list, panel: () => panel, feedback };
}
test("returning from a word retains list position, with separate positions for different scopes", () => {
  const h = scrollingHarness();
  h.run("save.grade=6;save.course='all'");
  h.click("book");
  h.click("book-filter", { value: "all" });
  h.list().scrollTop = 2712;
  h.click("review-item", { value: "pep1-g6-s2-u6-q1" });
  h.click("review-back");
  assert.equal(h.list().scrollTop, 2712);
  h.click("book-grade", { value: "1" });
  assert.equal(h.list().scrollTop, 0);
  h.list().scrollTop = 135;
  h.click("book-grade", { value: "6" });
  assert.equal(h.list().scrollTop, 2712);
  h.click("curriculum");
  h.click("return-book");
  assert.equal(h.list().scrollTop, 2712);
});
test("answering a long review keeps its reading position and reveals feedback once; the next item starts at the top", () => {
  const h = scrollingHarness();
  h.run("save.grade=6;save.course='all'");
  h.click("book");
  const q = h.Q.find((q) => q.grade === 6 && q.text?.includes("Nora"));
  h.click("review-item", { value: q.id });
  h.panel().scrollTop = 73;
  h.click("review-answer", { index: String(q.answer) });
  assert.equal(h.feedback.length, 1);
  assert.equal(h.feedback[0].top, 73);
  assert.equal(h.feedback[0].opts.block, "nearest");
  assert.equal(h.panel().scrollTop, 190);
  h.run("render()");
  assert.equal(h.feedback.length, 1);
  assert.equal(h.panel().scrollTop, 190);
  h.click("review-next");
  assert.equal(h.panel().scrollTop, 0);
  assert.notEqual(h.run("reviewQ.id"), q.id);
});
