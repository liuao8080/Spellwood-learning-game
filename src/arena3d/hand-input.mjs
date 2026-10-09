/** Pointer intents only. This class cannot select game state, play a card or save. */
export class HandInput {
  constructor({ element, pick, getRevision = () => null, isEnabled = () => true,
    onSelect = () => {}, onInspect = () => {}, onHover = () => {},
    canPan = () => false, onPan = () => {}, longPressMs = 420, hoverMs = 180,
    setTimer = (fn, delay) => setTimeout(fn, delay), clearTimer = id => clearTimeout(id), now = () => performance.now(),
    windowTarget = globalThis.window, documentTarget = globalThis.document } = {}) {
    if (!element || typeof pick !== "function") throw new TypeError("HandInput requires an element and picker");
    Object.assign(this, { element, pick, getRevision, isEnabled, onSelect, onInspect, onHover,
      canPan, onPan, longPressMs, hoverMs, setTimer, clearTimer, now, windowTarget, documentTarget });
    this.active = null; this.hovered = null; this.hoverCandidate = null;
    this.longTimer = null; this.hoverTimer = null; this.destroyed = false;
    this.handlers = {
      pointerdown: event => this.down(event), pointermove: event => this.move(event),
      pointerup: event => this.up(event), pointercancel: event => this.cancelPointer(event),
      lostpointercapture: event => this.cancelPointer(event),
      blur: () => this.cancel(),
      pointerleave: event => { this.clearHover(); if (!this.element.hasPointerCapture?.(event.pointerId)) this.cancelPointer(event); },
      contextmenu: event => this.context(event),
      // Pointerup owns selection. Never let a compatibility click dispatch it again.
      click: event => { event.preventDefault?.(); event.stopPropagation?.(); },
    };
    for (const [name, handler] of Object.entries(this.handlers)) element.addEventListener(name, handler);
    this.blurHandler = () => this.cancel();
    this.visibilityHandler = () => { if (documentTarget?.hidden) this.cancel(); };
    windowTarget?.addEventListener?.("blur", this.blurHandler);
    documentTarget?.addEventListener?.("visibilitychange", this.visibilityHandler);
  }

  same(a, b) { return !!a && !!b && a.index === b.index && a.cardId === b.cardId; }
  clearLong() { if (this.longTimer !== null) this.clearTimer(this.longTimer); this.longTimer = null; }
  clearHover() {
    if (this.hoverTimer !== null) this.clearTimer(this.hoverTimer);
    this.hoverTimer = null; this.hoverCandidate = null;
    if (this.hovered) { this.hovered = null; this.onHover(null); }
  }
  release(pointerId) {
    try { if (this.element.hasPointerCapture?.(pointerId)) this.element.releasePointerCapture?.(pointerId); } catch { /* The browser may already have cancelled capture. */ }
  }
  cancel() {
    const active = this.active; this.active = null; this.clearLong(); this.clearHover();
    if (active) this.release(active.pointerId);
  }
  cancelPointer(event) { if (!this.active || event.pointerId === this.active.pointerId) this.cancel(); }
  valid(active) { return !this.destroyed && this.isEnabled() && this.getRevision() === active.revision; }
  intent(hit, source, revision = this.getRevision()) { return { kind: "card", index: hit.index, cardId: hit.cardId, revision, source }; }

  down(event) {
    if (this.destroyed || !this.isEnabled()) return;
    this.suppressContextUntil = 0;
    if (this.active && event.pointerId !== this.active.pointerId) { this.cancel(); return; }
    if (event.isPrimary === false || (event.button != null && event.button !== 0)) return;
    // A semantic button may still own keyboard focus. Transfer it before
    // capturing a fresh pointer intent: its focusout handler cancels old input.
    this.element.focus?.({ preventScroll: true });
    this.cancel();
    if (this.destroyed || !this.isEnabled()) return;
    if (this.element.dataset) this.element.dataset.inputModality = "pointer";
    const hit = this.pick(event), revision = this.getRevision();
    const active = this.active = { pointerId: event.pointerId, pointerType: event.pointerType,
      x: event.clientX, y: event.clientY, lastX: event.clientX, hit, revision,
      moved: false, panning: false, consumed: false, lastEvent: event };
    try { this.element.setPointerCapture?.(event.pointerId); } catch { /* Capturing a just-cancelled pointer is harmless. */ }
    if (hit) this.longTimer = this.setTimer(() => {
      this.longTimer = null;
      if (this.active !== active || active.moved || active.consumed || !this.valid(active) || !this.same(hit, this.pick(active.lastEvent))) return;
      active.consumed = true; this.suppressContextUntil = this.now() + 1000; this.suppressContextHit = hit;
      this.onInspect(this.intent(hit, "longpress", revision));
    }, this.longPressMs);
  }

  move(event) {
    if (this.destroyed) return;
    const active = this.active;
    if (active) {
      if (event.pointerId !== active.pointerId) return;
      if (!this.valid(active)) { this.cancel(); return; }
      active.lastEvent = event;
      const dx = event.clientX - active.x, dy = event.clientY - active.y;
      if (!active.moved && Math.hypot(dx, dy) > 10) {
        active.moved = true; this.clearLong();
        active.panning = !active.consumed && this.canPan() && Math.abs(dx) > Math.abs(dy);
      }
      if (active.panning) { this.onPan(active.lastX - event.clientX); event.preventDefault?.(); }
      active.lastX = event.clientX;
      return;
    }
    if (!this.isEnabled() || event.pointerType === "touch" || event.buttons > 0) { this.clearHover(); return; }
    const hit = this.pick(event);
    if (this.same(hit, this.hovered) || this.same(hit, this.hoverCandidate)) return;
    this.clearHover(); if (!hit) return;
    const revision = this.getRevision(); this.hoverCandidate = hit;
    this.hoverTimer = this.setTimer(() => {
      this.hoverTimer = null; this.hoverCandidate = null;
      if (this.destroyed || !this.isEnabled() || revision !== this.getRevision()) return;
      this.hovered = hit; this.onHover(this.intent(hit, "hover", revision));
    }, this.hoverMs);
  }

  up(event) {
    const active = this.active;
    if (!active || event.pointerId !== active.pointerId) return;
    this.active = null; this.clearLong(); this.release(active.pointerId);
    if (!this.valid(active) || active.moved || active.consumed || Math.hypot(event.clientX - active.x, event.clientY - active.y) > 10) return;
    const hit = this.pick(event);
    if (this.same(hit, active.hit)) this.onSelect(this.intent(hit, "pointer", active.revision));
  }

  context(event) {
    if (this.destroyed || !this.isEnabled()) return;
    const active = this.active;
    const hit = this.pick(event); this.cancel();
    if (!hit) return;
    event.preventDefault?.(); event.stopPropagation?.();
    const consumed = active?.consumed || (this.now() < this.suppressContextUntil && this.same(hit, this.suppressContextHit));
    if (!consumed) this.onInspect(this.intent(hit, "contextmenu"));
  }

  dispose() {
    if (this.destroyed) return;
    this.destroyed = true; this.cancel();
    for (const [name, handler] of Object.entries(this.handlers)) this.element.removeEventListener(name, handler);
    this.windowTarget?.removeEventListener?.("blur", this.blurHandler);
    this.documentTarget?.removeEventListener?.("visibilitychange", this.visibilityHandler);
  }
}
