import test from "node:test";
import assert from "node:assert/strict";
import { HandInput } from "../src/arena3d/hand-input.mjs";

function target() {
  const listeners = new Map(), captures = new Set();
  return { listeners, captures, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name),
    setPointerCapture: id => captures.add(id), hasPointerCapture: id => captures.has(id), releasePointerCapture: id => captures.delete(id) };
}
function harness(t) {
  const element = target(), windowTarget = target(), documentTarget = { ...target(), hidden: false };
  const timers = new Map(), selected = [], inspected = [], hovered = [], panned = [];
  let clock = 0, serial = 0, revision = 1, enabled = true;
  const input = new HandInput({ element, windowTarget, documentTarget,
    pick: event => event.clientX >= 0 && event.clientX < 200 ? { index: Math.floor(event.clientX / 100), cardId: event.clientX < 100 ? "fox" : "owl" } : null,
    getRevision: () => revision, isEnabled: () => enabled,
    onSelect: intent => selected.push(intent), onInspect: intent => inspected.push(intent), onHover: intent => hovered.push(intent),
    canPan: () => true, onPan: delta => panned.push(delta), now: () => clock,
    setTimer: (fn, ms) => { const id = ++serial; timers.set(id, { fn, at: clock + ms }); return id; }, clearTimer: id => timers.delete(id) });
  const fire = (name, values = {}) => {
    const event = { clientX: 30, clientY: 20, pointerId: 1, pointerType: "touch", button: 0, isPrimary: true,
      preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...values };
    element.listeners.get(name)?.(event); return event;
  };
  const advance = ms => { clock += ms; for (const [id, timer] of [...timers]) if (timer.at <= clock) { timers.delete(id); timer.fn(); } };
  t.after(() => input.dispose());
  return { input, element, windowTarget, documentTarget, timers, selected, inspected, hovered, panned, fire, advance,
    revise: () => revision++, disable: () => { enabled = false; } };
}

test("a short press selects exactly once; compatibility click does not select again", t => {
  const h = harness(t); h.fire("pointerdown"); h.advance(419); h.fire("pointerup");
  const click = h.fire("click"); h.advance(500);
  assert.equal(h.selected.length, 1); assert.equal(h.inspected.length, 0); assert.equal(h.timers.size, 0);
  assert.equal(click.prevented, true); assert.equal(click.stopped, true);
  assert.deepEqual(h.selected[0], { kind: "card", index: 0, cardId: "fox", revision: 1, source: "pointer" });
});
test("420ms inspects once without selecting, including release and a native long-press menu", t => {
  const h = harness(t); h.fire("pointerdown"); h.advance(419); assert.equal(h.inspected.length, 0);
  h.advance(1); assert.equal(h.inspected.length, 1); h.fire("pointerup"); h.fire("click");
  h.fire("contextmenu"); assert.equal(h.inspected.length, 1); assert.equal(h.selected.length, 0);
  assert.equal(h.inspected[0].source, "longpress");
  h.fire("pointerdown", { button: 2 }); h.fire("contextmenu", { button: 2 });
  assert.equal(h.inspected.length, 2, "a later real right click remains available");
});
test("crossing 10px permanently cancels even after returning to the start", t => {
  const h = harness(t); h.fire("pointerdown"); h.fire("pointermove", { clientX: 41 });
  h.fire("pointermove", { clientX: 30 }); h.advance(800); h.fire("pointerup");
  assert.equal(h.inspected.length, 0); assert.equal(h.selected.length, 0); assert.equal(h.timers.size, 0);
  assert.deepEqual(h.panned, [-11, 11]);
});
test("10px jitter is accepted; a farther release is cancelled without needing pointermove", t => {
  const h = harness(t); h.fire("pointerdown"); h.fire("pointermove", { clientX: 40 }); h.fire("pointerup", { clientX: 40 });
  assert.equal(h.selected.length, 1); h.fire("pointerdown"); h.fire("pointerup", { clientY: 31 }); assert.equal(h.selected.length, 1);
});
test("press/release card identity, pointer id and current revision must all agree", t => {
  const h = harness(t); h.fire("pointerdown", { clientX: 99 }); h.fire("pointerup", { clientX: 101 });
  assert.equal(h.selected.length, 0, "a 2px move across a card boundary cannot select another card");
  h.fire("pointerdown"); h.fire("pointerup", { pointerId: 2 }); assert.ok(h.input.active);
  h.revise(); h.advance(420); h.fire("pointerup");
  assert.equal(h.selected.length, 0); assert.equal(h.inspected.length, 0);
});
for (const cancellation of ["pointercancel", "lostpointercapture", "blur", "hidden", "manual", "multitouch"]) test(`${cancellation} clears every pending gesture`, t => {
  const h = harness(t); h.fire("pointerdown");
  if (cancellation === "blur") h.windowTarget.listeners.get("blur")();
  else if (cancellation === "hidden") { h.documentTarget.hidden = true; h.documentTarget.listeners.get("visibilitychange")(); }
  else if (cancellation === "manual") h.input.cancel();
  else if (cancellation === "multitouch") h.fire("pointerdown", { pointerId: 2, isPrimary: false });
  else h.fire(cancellation);
  h.advance(1000); h.fire("pointerup");
  assert.equal(h.inspected.length, 0); assert.equal(h.selected.length, 0); assert.equal(h.timers.size, 0); assert.equal(h.element.captures.size, 0);
});
test("disabled state suppresses pending input and hover never emits a selection", t => {
  const h = harness(t); h.fire("pointermove", { pointerType: "mouse" }); h.advance(179); assert.equal(h.hovered.length, 0);
  h.advance(1); assert.equal(h.hovered[0].cardId, "fox"); h.fire("pointerleave", { pointerType: "mouse" }); assert.equal(h.hovered.at(-1), null);
  h.fire("pointerdown"); h.disable(); h.advance(420); h.fire("pointerup");
  assert.equal(h.selected.length, 0); assert.equal(h.inspected.length, 0);
});
test("vertical movement cancels inspection without panning, while disposal removes listeners and timers", t => {
  const h = harness(t); h.fire("pointerdown"); h.fire("pointermove", { clientY: 40 }); assert.equal(h.panned.length, 0);
  h.input.dispose(); h.advance(1000);
  assert.equal(h.timers.size, 0); assert.equal(h.element.listeners.size, 0); assert.equal(h.windowTarget.listeners.size, 0); assert.equal(h.documentTarget.listeners.size, 0);
});
