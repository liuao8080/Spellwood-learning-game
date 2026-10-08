import test from "node:test";
import assert from "node:assert/strict";
import { PictureReadiness } from "../src/av/pictures.mjs";
function fixture() {
  const images = [],
    timers = [];
  const director = new PictureReadiness({
    createImage() {
      const image = {};
      images.push(image);
      return image;
    },
    background: (node) => node.background,
    later(fn) {
      timers.push(fn);
      return timers.length;
    },
    cancel() {},
  });
  function node(source = "assets/learning/home-words.webp") {
    const caption = {};
    return {
      dataset: {},
      isConnected: true,
      caption,
      background: `url("${source}")`,
      parentElement: { querySelector: () => caption },
    };
  }
  return {
    images,
    timers,
    director,
    node,
    connect(...nodes) {
      director.connect({ querySelectorAll: () => nodes });
    },
  };
}
test("meaning pictures show loading then the real loaded state", () => {
  const h = fixture(),
    n = h.node();
  h.connect(n);
  assert.equal(n.dataset.pictureState, "loading");
  assert.equal(n.caption.textContent, "图示载入中…");
  h.images[0].onload();
  assert.equal(n.dataset.pictureState, "ready");
});
test("one pending download supports multiple visits and cached pictures need no duplicate", () => {
  const h = fixture(),
    a = h.node(),
    b = h.node();
  h.connect(a);
  h.connect(b);
  assert.equal(h.images.length, 1);
  h.images[0].onload();
  assert.equal(a.dataset.pictureState, "ready");
  assert.equal(b.dataset.pictureState, "ready");
  const c = h.node();
  h.connect(c);
  assert.equal(h.images.length, 1);
  assert.equal(c.dataset.pictureState, "ready");
});
test("failed image keeps a truthful readable fallback and a later visit retries", () => {
  const h = fixture(),
    n = h.node();
  h.connect(n);
  h.images[0].onerror();
  assert.equal(n.dataset.pictureState, "failed");
  assert.match(n.caption.textContent, /可以先读题/);
  const next = h.node();
  h.connect(next);
  assert.equal(h.images.length, 2);
  h.images[1].onload();
  assert.equal(next.dataset.pictureState, "ready");
});
test("slow download shows usable fallback after ten seconds then accepts a late success", () => {
  const h = fixture(),
    n = h.node();
  h.connect(n);
  h.timers[0]();
  assert.equal(n.dataset.pictureState, "failed");
  h.images[0].onload();
  assert.equal(n.dataset.pictureState, "ready");
});
test("late callbacks do not mutate detached question elements", () => {
  const h = fixture(),
    old = h.node();
  h.connect(old);
  old.isConnected = false;
  h.images[0].onload();
  assert.equal(old.dataset.pictureState, "loading");
});
test("offline embedded data images use the exact CSS source", () => {
  const h = fixture(),
    n = h.node("data:image/webp;base64,AAAA");
  h.connect(n);
  assert.equal(h.images[0].src, "data:image/webp;base64,AAAA");
  h.images[0].onload();
  assert.equal(n.dataset.pictureState, "ready");
});
