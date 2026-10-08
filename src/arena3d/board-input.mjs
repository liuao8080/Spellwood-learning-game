// Copy only stable entity identifiers. A picker may return a mutable scene object.
function entity(hit) {
  if (!hit) return null;
  const id = value => typeof value === "string" && value.length > 0 || typeof value === "number" && Number.isFinite(value);
  if (hit.kind === "unit" && id(hit.uid) && (hit.seat === 0 || hit.seat === 1))
    return { kind: "unit", uid: hit.uid, seat: hit.seat };
  if (hit.kind === "hero" && (hit.relativeSeat === 0 || hit.relativeSeat === 1))
    return { kind: "hero", relativeSeat: hit.relativeSeat };
  if (hit.kind === "card" && Number.isInteger(hit.index) && hit.index >= 0 && id(hit.cardId))
    return { kind: "card", index: hit.index, cardId: hit.cardId };
  return null;
}

/**
 * Pointer intents only: no game state changes or native scrolling interception.
 * pick(event) returns a unit {uid, seat}, hero {relativeSeat}, card {index, cardId},
 * or null for unrelated controls. It must resolve the current coordinates even
 * during capture; delegated DOM pickers can use document.elementFromPoint().
 * delegated skips explicit capture and lets keyboard clicks reach the adapter.
 * Call cancel() when changing views/revisions; pending actions also check revision.
 */
export class BoardInput {
  constructor({ element, pick, getRevision = () => null, isEnabled = () => true,
    onActivate = () => {}, onInspect = () => {}, onHover = () => {},
    delegated = false, allowKeyboardClick = delegated, longPressMs = 420,
    setTimer = (fn, delay) => setTimeout(fn, delay), clearTimer = id => clearTimeout(id),
    now = () => globalThis.performance?.now?.() ?? Date.now(),
    windowTarget = globalThis.window, documentTarget = globalThis.document } = {}) {
    if (!element || typeof pick !== "function") throw new TypeError("BoardInput requires an element and picker");
    Object.assign(this, { element, pick, getRevision, isEnabled, onActivate, onInspect, onHover,
      delegated, allowKeyboardClick, longPressMs, setTimer, clearTimer, now, windowTarget, documentTarget });
    this.active = null; this.contextPress = null; this.hovered = null;
    this.longTimer = null; this.destroyed = false;
    this.handlers = {
      pointerdown: event => this.down(event), pointermove: event => this.move(event),
      pointerup: event => this.up(event), pointercancel: event => this.cancelPointer(event),
      lostpointercapture: event => this.cancelPointer(event), pointerleave: event => this.leave(event),
      contextmenu: event => this.context(event), click: event => this.click(event),
    };
    // Capture the compatibility click before an older delegated click listener.
    for (const [name, handler] of Object.entries(this.handlers)) element.addEventListener(name, handler, name === "click");
    this.blurHandler = () => this.cancel();
    this.visibilityHandler = () => { if (documentTarget?.hidden) this.cancel(); };
    windowTarget?.addEventListener?.("blur", this.blurHandler);
    documentTarget?.addEventListener?.("visibilitychange", this.visibilityHandler);
  }

  same(a, b) {
    if (!a || !b || a.kind !== b.kind) return false;
    if (a.kind === "unit") return a.uid === b.uid && a.seat === b.seat;
    if (a.kind === "hero") return a.relativeSeat === b.relativeSeat;
    return a.kind === "card" && a.index === b.index && a.cardId === b.cardId;
  }
  enabled() { return !this.destroyed && !this.documentTarget?.hidden && this.isEnabled(); }
  valid(press) { return this.enabled() && !press.cancelled && this.getRevision() === press.revision; }
  hit(event) { return entity(this.pick(event)); }
  intent(hit, source, revision = this.getRevision()) { return { ...hit, revision, source }; }
  distance(press, event) { return Math.hypot(event.clientX - press.x, event.clientY - press.y); }
  clearLong() {
    if (this.longTimer !== null) this.clearTimer(this.longTimer);
    this.longTimer = null;
  }
  clearHover() { if (this.hovered) { this.hovered = null; this.onHover(null); } }
  release(press) {
    if (!press?.captured) return;
    press.captured = false;
    try { this.element.releasePointerCapture?.(press.pointerId); } catch { /* Capture may already be gone. */ }
  }
  finish() {
    const press = this.active; this.active = null; this.clearLong();
    if (press) { press.until = this.now() + 1000; this.release(press); }
    return press;
  }
  cancel() {
    if (this.contextPress) this.contextPress.cancelled = true;
    this.finish(); this.clearHover();
  }
  cancelPointer(event) {
    if (this.active?.pointerId === event.pointerId) this.cancel();
  }
  leave(event) {
    this.clearHover();
    if (this.active?.pointerId === event.pointerId && !this.active.captured) this.cancel();
  }

  down(event) {
    if (this.destroyed) return;
    if (this.active && event.pointerId !== this.active.pointerId) { this.cancel(); return; }
    this.cancel(); this.contextPress = null;
    if (!this.enabled() || event.isPrimary === false || !Number.isFinite(event.pointerId) ||
      !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
    const button = event.button ?? 0;
    if (button !== 0 && button !== 2) return;
    if (event.buttons != null && event.buttons !== (button === 0 ? 1 : 2)) return;
    const hit = this.hit(event);
    if (!hit || button === 2 && hit.kind !== "unit") return;
    const press = this.active = this.contextPress = { hit, button, pointerId: event.pointerId,
      x: event.clientX, y: event.clientY, revision: this.getRevision(), lastEvent: event, started: this.now(),
      cancelled: false, consumed: false, captured: false, until: Infinity };
    if (!this.delegated && this.element.setPointerCapture) {
      try { this.element.setPointerCapture(press.pointerId); press.captured = true; } catch { /* Cancellation can race capture. */ }
    }
    if (button === 0) this.longTimer = this.setTimer(() => {
      this.longTimer = null;
      if (this.active !== press || press.consumed) return;
      if (!this.valid(press) || !this.same(hit, this.hit(press.lastEvent))) { this.cancel(); return; }
      press.consumed = true;
      if (hit.kind === "unit") this.onInspect(this.intent(hit, "longpress", press.revision));
    }, this.longPressMs);
  }

  move(event) {
    if (this.destroyed) return;
    const press = this.active;
    if (press) {
      if (event.pointerId !== press.pointerId) return;
      press.lastEvent = event;
      if (!this.valid(press) || event.isPrimary === false || !(this.distance(press, event) <= 10) ||
        event.buttons != null && event.buttons !== (press.button === 0 ? 1 : 2)) this.cancel();
      return;
    }
    if (!this.enabled() || event.isPrimary === false || event.pointerType === "touch" || event.buttons > 0) {
      this.clearHover(); return;
    }
    const hit = this.hit(event), revision = this.getRevision();
    if (this.same(hit, this.hovered) && this.hovered.revision === revision) return;
    this.clearHover();
    if (hit) { this.hovered = this.intent(hit, "hover", revision); this.onHover(this.hovered); }
  }

  up(event) {
    if (!this.active || event.pointerId !== this.active.pointerId) return;
    const press = this.finish();
    if (!this.valid(press) || event.isPrimary === false || (event.button ?? 0) !== press.button ||
      event.buttons != null && event.buttons !== 0 ||
      !(this.distance(press, event) <= 10) || !this.same(press.hit, this.hit(event))) {
      press.cancelled = true; return;
    }
    // A delayed timer must not turn an already long hold into a short tap.
    if (press.button === 0 && this.now() - press.started >= this.longPressMs) press.consumed = true;
    if (press.button === 0 && !press.consumed) this.onActivate(this.intent(press.hit, "pointer", press.revision));
  }

  context(event) {
    // contextmenu is a semantic inspect request. Its primary-pointer flag may
    // be unset even when the preceding real mouse press was primary. Pointer
    // starts/releases still require primary identity; this path cannot attack.
    if (!this.enabled() || event.button != null && event.button !== 0 && event.button !== 2) return;
    const hit = this.hit(event);
    if (hit?.kind !== "unit") return;
    event.preventDefault?.(); event.stopPropagation?.();
    const press = this.active ?? (this.contextPress?.until > this.now() ? this.contextPress : null);
    if (press) {
      // Native menus can arrive before or after pointerup, including after a
      // touch long press. Keep its consumed/cancelled state through both orders.
      if (press.consumed) return;
      if (!this.valid(press) ||
        Number.isFinite(event.pointerId) && event.pointerId >= 0 && event.pointerId !== press.pointerId ||
        !this.same(hit, press.hit) || !(this.distance(press, event) <= 10)) {
        this.cancel(); return;
      }
      press.consumed = true; this.finish(); this.clearHover();
      this.onInspect(this.intent(hit, "contextmenu", press.revision));
    } else {
      // Also accept a standalone native/keyboard context menu without requiring
      // a synthetic pointerdown. A following compatibility click is still inert.
      this.contextPress = { hit, revision: this.getRevision(), consumed: true, until: this.now() + 1000 };
      this.clearHover(); this.onInspect(this.intent(hit, "contextmenu", this.contextPress.revision));
    }
  }

  click(event) {
    if (this.destroyed || this.allowKeyboardClick && event.detail === 0 || !this.hit(event)) return;
    // The picker defines the owned controls; unrelated delegated buttons retain
    // their normal click behavior, even when the board is currently disabled.
    event.preventDefault?.(); event.stopPropagation?.(); event.stopImmediatePropagation?.();
  }

  dispose() {
    if (this.destroyed) return;
    this.destroyed = true; this.cancel(); this.contextPress = null;
    for (const [name, handler] of Object.entries(this.handlers)) this.element.removeEventListener(name, handler, name === "click");
    this.windowTarget?.removeEventListener?.("blur", this.blurHandler);
    this.documentTarget?.removeEventListener?.("visibilitychange", this.visibilityHandler);
  }
}
