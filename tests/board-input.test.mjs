import test from "node:test";
import assert from "node:assert/strict";
import { BoardInput } from "../src/arena3d/board-input.mjs";

const unit = { kind: "unit", uid: "fox-1", seat: 0 };
const hero = { kind: "hero", relativeSeat: 1 };
const card = { kind: "card", index: 2, cardId: "owl" };

function target() {
  const listeners = new Map(), captures = new Set();
  const result = {
    listeners, captures,
    addEventListener(name, fn, capture = false) {
      listeners.set(name, [...listeners.get(name) ?? [], { fn, capture }]);
    },
    removeEventListener(name, fn, capture = false) {
      const remaining = (listeners.get(name) ?? []).filter(listener => listener.fn !== fn || listener.capture !== capture);
      if (remaining.length) listeners.set(name, remaining); else listeners.delete(name);
    },
    emit(name, event = {}) {
      for (const { fn } of [...listeners.get(name) ?? []].sort((a, b) => Number(b.capture) - Number(a.capture))) {
        fn(event); if (event.immediateStopped) break;
      }
    },
    setPointerCapture: id => captures.add(id),
    releasePointerCapture(id) {
      if (captures.delete(id)) result.emit("lostpointercapture", { pointerId: id });
    },
  };
  return result;
}

function harness(t, options = {}) {
  const element = options.element ?? target(), windowTarget = target(), documentTarget = { ...target(), hidden: false };
  const timers = new Map(), activated = [], inspected = [], hovered = [];
  let clock = 0, serial = 0, revision = 1, enabled = true, currentHit = { ...unit };
  const input = new BoardInput({ element, windowTarget, documentTarget,
    pick: event => Object.hasOwn(event, "hit") ? event.hit : currentHit,
    getRevision: () => revision, isEnabled: () => enabled,
    onActivate: intent => activated.push(intent), onInspect: intent => inspected.push(intent), onHover: intent => hovered.push(intent),
    now: () => clock,
    setTimer: (fn, ms) => { const id = ++serial; timers.set(id, { fn, at: clock + ms }); return id; },
    clearTimer: id => timers.delete(id), ...options });
  const fire = (name, values = {}) => {
    const button = values.button ?? 0;
    const event = { clientX: 30, clientY: 20, pointerId: 1, pointerType: "touch", isPrimary: true, detail: 1, button,
      buttons: name === "pointerdown" ? (button === 0 ? 1 : button === 2 ? 2 : 4) : name === "pointermove" && input.active ? (input.active.button === 0 ? 1 : 2) : 0,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; },
      stopImmediatePropagation() { this.immediateStopped = true; }, ...values };
    element.emit(name, event); return event;
  };
  const advance = ms => {
    const end = clock + ms;
    while (true) {
      const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      clock = next[1].at; timers.delete(next[0]); next[1].fn();
    }
    clock = end;
  };
  t.after(() => input.dispose());
  return { input, element, windowTarget, documentTarget, timers, activated, inspected, hovered, fire, advance,
    elapseWithoutTimers: ms => { clock += ms; },
    setHit: hit => { currentHit = hit; }, revise: () => revision++, disable: () => { enabled = false; } };
}

test("requires a picker and element, but needs no browser globals", t => {
  assert.throws(() => new BoardInput(), TypeError);
  assert.throws(() => new BoardInput({ element: target() }), TypeError);
  const h = harness(t, { windowTarget: undefined, documentTarget: undefined });
  h.fire("pointerdown"); h.fire("pointerup"); assert.equal(h.activated.length, 1);
});

for (const hit of [unit, hero, card]) test(`short ${hit.kind} taps emit truthful identifiers exactly once`, t => {
  const h = harness(t); h.setHit(hit);
  const down = h.fire("pointerdown"); h.advance(419); const up = h.fire("pointerup");
  const click = h.fire("click"); h.advance(1000);
  assert.deepEqual(h.activated, [{ ...hit, revision: 1, source: "pointer" }]);
  assert.deepEqual(h.inspected, []); assert.equal(h.element.captures.size, 0); assert.equal(h.timers.size, 0);
  assert.equal(down.defaultPrevented, undefined); assert.equal(up.defaultPrevented, undefined);
  assert.equal(click.defaultPrevented, true); assert.equal(click.immediateStopped, true);
});

for (const [before, after] of [
  [unit, { ...unit, uid: "fox-2" }], [unit, { ...unit, seat: 1 }],
  [hero, { ...hero, relativeSeat: 0 }], [card, { ...card, index: 1 }], [card, { ...card, cardId: "fox" }],
  [unit, hero], [unit, null],
]) test(`release must match the original entity: ${JSON.stringify(after)}`, t => {
  const h = harness(t); h.setHit(before); h.fire("pointerdown"); h.setHit(after);
  h.fire("pointerup", { clientX: 32 });
  assert.deepEqual(h.activated, []); assert.deepEqual(h.inspected, []);
});

test("mutating the picker's original object cannot change a pending press identity", t => {
  const h = harness(t), mutable = { ...unit }; h.setHit(mutable); h.fire("pointerdown"); mutable.seat = 1;
  h.advance(420); h.fire("pointerup"); assert.deepEqual(h.activated, []); assert.deepEqual(h.inspected, []);
});

test("unknown and incomplete entities are not owned or captured", t => {
  const h = harness(t);
  for (const hit of [null, { kind: "unit", uid: "a" }, { kind: "hero", seat: 0 }, { kind: "card", index: 0 }, { ...card, index: -1 }, { kind: "button" }]) {
    h.setHit(hit); h.fire("pointerdown"); h.advance(500); h.fire("pointerup");
    const click = h.fire("click"); assert.equal(click.defaultPrevented, undefined);
    assert.equal(h.element.captures.size, 0); assert.equal(h.timers.size, 0);
  }
  assert.deepEqual(h.activated, []); assert.deepEqual(h.inspected, []);
});

for (const menuBeforeUp of [true, false]) test(`right click only inspects, with contextmenu ${menuBeforeUp ? "before" : "after"} release`, t => {
  const h = harness(t);
  h.fire("pointerdown", { pointerType: "mouse", button: 2 }); h.advance(500);
  if (!menuBeforeUp) h.fire("pointerup", { pointerType: "mouse", button: 2 });
  const menu = h.fire("contextmenu", { pointerType: "mouse", button: 2 });
  if (menuBeforeUp) h.fire("pointerup", { pointerType: "mouse", button: 2 });
  h.fire("click"); h.fire("pointerup");
  assert.deepEqual(h.activated, []);
  assert.deepEqual(h.inspected, [{ ...unit, revision: 1, source: "contextmenu" }]);
  assert.equal(menu.defaultPrevented, true); assert.equal(h.element.captures.size, 0);
  h.fire("pointerdown", { button: 2 }); h.fire("contextmenu", { button: 2 });
  assert.equal(h.inspected.length, 2, "a fresh right click may inspect the same unit again");
});

test("420ms unit inspection consumes release, compatibility click and native touch menu", t => {
  const h = harness(t); h.fire("pointerdown"); h.advance(419); assert.deepEqual(h.inspected, []);
  h.advance(1); assert.deepEqual(h.inspected, [{ ...unit, revision: 1, source: "longpress" }]);
  h.fire("contextmenu"); h.fire("pointerup"); h.fire("click"); h.fire("contextmenu"); h.advance(1000);
  assert.equal(h.inspected.length, 1); assert.deepEqual(h.activated, []); assert.equal(h.timers.size, 0);
});

test("a synchronous view change during inspection cannot resurrect activation", t => {
  let h;
  h = harness(t, { onInspect: intent => { h.inspected.push(intent); h.input.cancel(); h.revise(); } });
  h.fire("pointerdown"); h.advance(420); h.fire("pointerup"); h.fire("click");
  assert.equal(h.inspected.length, 1); assert.deepEqual(h.activated, []);
});

test("a busy event loop cannot activate an expired hold before its timer runs", t => {
  const h = harness(t);
  for (const hit of [unit, hero, card]) {
    h.setHit(hit); h.fire("pointerdown"); h.elapseWithoutTimers(420); h.fire("pointerup");
  }
  assert.deepEqual(h.activated, []); assert.deepEqual(h.inspected, []); assert.equal(h.timers.size, 0);
});

test("right click never inspects heroes or cards; long holds consume release without inspecting", t => {
  const h = harness(t);
  for (const hit of [hero, card]) {
    h.setHit(hit); h.fire("pointerdown", { button: 2 }); h.advance(500); h.fire("pointerup", { button: 2 });
    const menu = h.fire("contextmenu", { button: 2 }); assert.equal(menu.defaultPrevented, undefined);
    h.fire("pointerdown"); h.advance(500); h.fire("pointerup"); h.fire("click");
  }
  assert.deepEqual(h.inspected, []); assert.deepEqual(h.activated, []);
});

test("movement beyond 10px cancels permanently without trapping scroll or pinch", t => {
  const h = harness(t); const down = h.fire("pointerdown");
  const moved = h.fire("pointermove", { clientX: 41 }); h.fire("pointermove"); h.advance(500); h.fire("pointerup");
  assert.deepEqual(h.inspected, []); assert.deepEqual(h.activated, []);
  assert.equal(down.defaultPrevented, undefined); assert.equal(moved.defaultPrevented, undefined);
  assert.equal(h.element.captures.size, 0); assert.equal(h.timers.size, 0);
  assert.equal(h.element.listeners.has("wheel"), false); assert.equal(h.element.style, undefined);
});

test("10px radial jitter is accepted; distant pointerup cancels even without a move event", t => {
  const h = harness(t); h.fire("pointerdown"); h.fire("pointermove", { clientX: 36, clientY: 28 }); h.fire("pointerup", { clientX: 36, clientY: 28 });
  assert.equal(h.activated.length, 1);
  h.fire("pointerdown"); h.fire("pointerup", { clientY: 31 }); assert.equal(h.activated.length, 1);
});

test("foreign pointer moves, releases and capture loss cannot consume the active pointer", t => {
  const h = harness(t); h.fire("pointerdown"); h.fire("pointermove", { pointerId: 2, clientX: 100 });
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) h.fire(name, { pointerId: 2 });
  assert.ok(h.input.active); h.fire("pointerup"); assert.equal(h.activated.length, 1);
});

for (const name of ["pointercancel", "lostpointercapture", "blur", "hidden", "manual", "multitouch", "revision", "disabled", "button-chord", "wrong-up-button", "nonprimary-up", "buttons-still-held"])
  test(`${name} suppresses inspection and activation and releases capture`, t => {
    const h = harness(t); h.fire("pointerdown");
    if (name === "blur") h.windowTarget.emit("blur");
    else if (name === "hidden") { h.documentTarget.hidden = true; h.documentTarget.emit("visibilitychange"); }
    else if (name === "manual") h.input.cancel();
    else if (name === "multitouch") h.fire("pointerdown", { pointerId: 2, isPrimary: false });
    else if (name === "revision") h.revise();
    else if (name === "disabled") h.disable();
    else if (name === "button-chord") h.fire("pointermove", { buttons: 3 });
    else if (name === "wrong-up-button") h.fire("pointerup", { button: 2 });
    else if (name === "nonprimary-up") h.fire("pointerup", { isPrimary: false });
    else if (name === "buttons-still-held") h.fire("pointerup", { buttons: 2 });
    else h.fire(name);
    h.advance(500); h.fire("pointerup"); h.fire("click"); h.fire("contextmenu");
    assert.deepEqual(h.inspected, []); assert.deepEqual(h.activated, []);
    assert.equal(h.timers.size, 0); assert.equal(h.element.captures.size, 0);
  });

test("nonprimary, middle-button, button-chord and invalid pointer starts are ignored", t => {
  const h = harness(t);
  for (const event of [{ isPrimary: false }, { button: 1 }, { buttons: 3 }, { pointerId: undefined }, { clientX: NaN }]) {
    h.fire("pointerdown", event); h.advance(500); h.fire("pointerup", event);
    assert.equal(h.input.active, null); assert.equal(h.timers.size, 0);
  }
  h.fire("contextmenu", { button: 1 });
  assert.deepEqual(h.activated, []); assert.deepEqual(h.inspected, []);
});

test('a native context menu without the primary flag still inspects the preceding primary mouse press', t => {
  const h=harness(t);
  h.fire('pointerdown',{pointerType:'mouse',button:2});
  h.fire('contextmenu',{pointerType:'mouse',button:2,isPrimary:false});
  h.fire('pointerup',{pointerType:'mouse',button:2});h.fire('click',{button:2});
  assert.equal(h.inspected.length,1);assert.equal(h.inspected[0].source,'contextmenu');
  assert.deepEqual(h.activated,[]);
});

for (const interruption of ["revision", "move", "entity", "cancel"])
  test(`right-click context menu respects ${interruption} between down and menu`, t => {
    const h = harness(t); h.fire("pointerdown", { button: 2 });
    if (interruption === "revision") h.revise();
    else if (interruption === "move") h.fire("pointermove", { clientX: 41 });
    else if (interruption === "entity") h.setHit({ ...unit, uid: "owl-2" });
    else h.fire("pointercancel");
    h.fire("contextmenu", { button: 2 }); h.fire("pointerup", { button: 2 });
    assert.deepEqual(h.inspected, []); assert.deepEqual(h.activated, []);
  });

test("hover reports current entity identities and clears on leave, touch and revisions", t => {
  const h = harness(t); h.fire("pointermove", { pointerType: "mouse" }); h.fire("pointermove", { pointerType: "mouse" });
  assert.deepEqual(h.hovered, [{ ...unit, revision: 1, source: "hover" }]);
  h.revise(); h.fire("pointermove", { pointerType: "mouse" }); assert.equal(h.hovered.at(-1).revision, 2);
  h.fire("pointermove", { pointerType: "touch" }); assert.equal(h.hovered.at(-1), null);
  h.setHit(hero); h.fire("pointermove", { pointerType: "mouse" }); assert.equal(h.hovered.at(-1).kind, "hero");
  h.fire("pointerleave"); assert.equal(h.hovered.at(-1), null);
  h.fire("pointermove", { pointerType: "mouse" }); h.disable(); h.fire("pointermove", { pointerType: "mouse" });
  assert.equal(h.hovered.at(-1), null); assert.deepEqual(h.activated, []); assert.deepEqual(h.inspected, []);
});

test("delegated DOM input suppresses owned pointer clicks before an older click handler only", t => {
  const element = target(), ownerClicks = [];
  element.addEventListener("click", event => ownerClicks.push(event.target));
  const unitLabel = { hit: unit }, heroButton = { hit: hero }, otherButton = { hit: null };
  const h = harness(t, { element, delegated: true, pick: event => event.pointTarget?.hit ?? event.target?.hit });
  h.fire("pointerdown", { target: unitLabel }); assert.equal(h.element.captures.size, 0);
  h.fire("pointerup", { target: unitLabel }); h.fire("click", { target: unitLabel });
  assert.equal(h.activated.length, 1); assert.deepEqual(ownerClicks, []);
  h.fire("click", { target: unitLabel, detail: 0 }); assert.deepEqual(ownerClicks, [unitLabel]);
  const other = h.fire("click", { target: otherButton }); assert.equal(other.defaultPrevented, undefined);
  assert.deepEqual(ownerClicks, [unitLabel, otherButton]);
  h.fire("pointerdown", { target: unitLabel }); h.fire("pointerup", { target: unitLabel, pointTarget: heroButton });
  h.fire("click", { target: heroButton }); assert.equal(h.activated.length, 1);
  assert.equal(h.element.listeners.get("click").find(listener => listener.fn === h.input.handlers.click).capture, true);
});

test("delegated pointerleave cancels and unrelated pointer events remain untouched", t => {
  const h = harness(t, { delegated: true }); h.fire("pointerdown"); h.fire("pointerleave"); h.advance(500); h.fire("pointerup");
  assert.deepEqual(h.activated, []); assert.deepEqual(h.inspected, []);
  h.setHit(null); const down = h.fire("pointerdown"); const move = h.fire("pointermove"); const menu = h.fire("contextmenu");
  for (const event of [down, move, menu]) { assert.equal(event.defaultPrevented, undefined); assert.equal(event.stopped, undefined); }
});

test("capture failure is harmless and disposal removes every listener and pending timer", t => {
  const element = target(); element.setPointerCapture = () => { throw new Error("already cancelled"); };
  const h = harness(t, { element }); h.fire("pointerdown"); h.fire("pointerup"); assert.equal(h.activated.length, 1);
  h.fire("pointerdown"); h.input.dispose(); h.input.dispose(); h.advance(1000); h.fire("pointerup");
  assert.equal(h.timers.size, 0); assert.equal(h.element.listeners.size, 0);
  assert.equal(h.windowTarget.listeners.size, 0); assert.equal(h.documentTarget.listeners.size, 0);
  assert.equal(h.activated.length, 1); assert.deepEqual(h.inspected, []);
});
