/** A bounded, independent 3D hand. Owns only presentation, never battle or storage state.
 *
 * Canvas CSS bounds define the hand window, independent of the battlefield canvas.
 * onSelect/onInspect receive {kind:'card',index,cardId,revision,source}; the owner
 * decides what those intents mean. setHand is the only selected-state authority.
 * getCardRects returns canvas-local and client-space CSS rectangles for semantics.
 * This scene owns its CardTextures instance; it never borrows opening/arena maps.
 */
import { Scene, OrthographicCamera, WebGLRenderer, Group, Mesh, Color, Vector2, Vector3,
  Raycaster, HemisphereLight, DirectionalLight, MeshStandardMaterial, MeshBasicMaterial,
  PlaneGeometry, SRGBColorSpace, ACESFilmicToneMapping } from "three";
import { extrudeShape, roundedRectShape } from "./model-utils.mjs";
import { CARD } from "../cards.mjs";
import { CardTextures } from "./card-textures.mjs";
import { SoftwareRenderer } from "./software-renderer.mjs";
import { HandInput } from "./hand-input.mjs";
import { HAND_MODEL, handLayout, scrollForHandIndex } from "./hand-layout.mjs";

const FINISH = Object.freeze({ base: 0xc2a06b, leaf: 0xa9cd78, silver: 0xc1e4e9, star: 0xc8a0ee, gold: 0xffd57a });
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const ease = value => 1 - (1 - clamp(value, 0, 1)) ** 3;

export class HandScene {
  constructor({ canvas, onSelect = () => {}, onInspect = () => {}, onHover = () => {},
    onFocus = () => {}, onLayout = () => {}, onStatus = () => {}, reduced = false,
    mode = "auto" } = {}) {
    if (!canvas) throw new TypeError("HandScene requires a canvas");
    Object.assign(this, { canvas, onSelect, onInspect, onHover, onFocus, onLayout, onStatus,
      reduced: !!reduced, mode });
    this.cards = []; this.ids = []; this.finishes = {}; this.resources = new Set();
    this.revision = null; this.inputRevision = 0; this.selectedIndex = this.focusedIndex = this.hoveredIndex = null;
    this.scroll = 0; this.width = 1; this.height = 1; this.interactive = true;
    this.destroyed = false; this.hidden = false; this.pageHidden = !!globalThis.document?.hidden;
    this.raf = null; this.dirty = true; this.lastFrame = -Infinity; this.motionStart = null;
    this.pointer = new Vector2(); this.raycaster = new Raycaster();
    this.scene = new Scene(); this.scene.background = new Color(0x071b20);
    this.camera = new OrthographicCamera(-1, 1, 1, -1, .1, 1000); this.camera.position.z = 500;
    try {
      this.renderer = this.createRenderer(canvas);
      this.renderer.outputColorSpace = SRGBColorSpace; this.renderer.toneMapping = ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.05;
      this.rendererName = this.renderer.isSoftwareRenderer ? "CPU · 兼容三维" : "WebGL2";
    } catch (error) {
      this.error = String(error?.message || error); this.rendererName = "unavailable";
      canvas.dataset.renderer = "unavailable"; this.status(); return;
    }
    canvas.dataset.renderer = this.rendererName;
    // Horizontal gestures belong to this bounded card window; page/pinch gestures
    // may still cancel pointers and must not accidentally select a card.
    this.previousTouchAction = canvas.style.touchAction; canvas.style.touchAction = "pan-y pinch-zoom";
    this.scene.add(new HemisphereLight(0xf2edda, 0x234c3c, 2.1));
    const light = new DirectionalLight(0xffe1a4, 2.8); light.position.set(-3, 5, 8); this.scene.add(light);
    this.textures = new CardTextures({ onChange: () => this.requestRender() });
    this.makeResources(); this.bind(); this.resize(); this.status();
  }

  createRenderer(canvas) {
    try { return new WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "default" }); }
    catch { return new SoftwareRenderer(canvas); }
  }
  own(resource) { this.resources.add(resource); return resource; }
  makeResources() {
    this.bodyGeometry = this.own(extrudeShape(roundedRectShape(1.25, 1.8, .095), .08, .012, 2));
    this.paperGeometry = this.own(extrudeShape(roundedRectShape(1.20, 1.75, .09), .087, .006, 2));
    this.faceGeometry = this.own(new PlaneGeometry(HAND_MODEL.faceWidth, HAND_MODEL.faceHeight));
    const frame = roundedRectShape(1.247, 1.797, .105);
    frame.holes.push(roundedRectShape(1.193, 1.743, .083));
    this.focusGeometry = this.own(extrudeShape(frame, .005, 0, 2));
    this.paperMaterial = this.own(new MeshStandardMaterial({ color: 0xeaddba, roughness: .85 }));
    this.backMaterial = this.own(new MeshBasicMaterial({ map: this.textures.back }));
    this.selectedMaterial = this.own(new MeshBasicMaterial({ color: 0xffdb83 }));
    this.focusMaterial = this.own(new MeshBasicMaterial({ color: 0xa2fff0 }));
  }
  makeCard(id, index) {
    const root = new Group(); root.name = `hand-card-${index}`;
    root.userData.handCard = { kind: "card", index, cardId: id };
    const finish = Object.hasOwn(FINISH, this.finishes[id]) ? this.finishes[id] : "base";
    const frontTexture = this.textures.get(id, finish, "hand");
    const edge = new MeshStandardMaterial({ color: FINISH[finish], roughness: .45, metalness: .3 });
    const front = new MeshBasicMaterial({ map: frontTexture });
    root.add(new Mesh(this.bodyGeometry, edge), new Mesh(this.paperGeometry, this.paperMaterial));
    const face = new Mesh(this.faceGeometry, front); face.position.z = .06; face.name = "hand-card-front";
    const back = new Mesh(this.faceGeometry, this.backMaterial); back.position.z = -.06; back.rotation.y = Math.PI;
    root.add(face, back);
    const focus = new Mesh(this.focusGeometry, this.focusMaterial); focus.position.z = .072; focus.visible = false;
    focus.name = "hand-card-focus-outline"; root.add(focus); this.scene.add(root);
    return { root, face, focus, frontTexture, resources: [edge, front], index, cardId: id, finish };
  }

  setHand(ids, { revision = this.revision, selectedIndex = this.selectedIndex, finishes = this.finishes } = {}) {
    if (this.destroyed || !this.renderer) return;
    if (!Array.isArray(ids) || ids.length > 7 || ids.some(id => !CARD[id])) throw new TypeError("HandScene expects up to seven valid card ids");
    const key = ids.map(id => `${id}:${finishes?.[id] || "base"}`).join("|");
    const changed = key !== this.handKey, revised = revision !== this.revision;
    const nextSelected = Number.isInteger(selectedIndex) && selectedIndex >= 0 && selectedIndex < ids.length ? selectedIndex : null;
    if (!changed && !revised && nextSelected === this.selectedIndex) return;
    if (changed || revised) { this.inputRevision++; this.input.cancel(); }
    this.revision = revision; this.ids = [...ids]; this.finishes = { ...finishes };
    if (changed) {
      this.clearCards(); this.handKey = key;
      this.cards = ids.map((id, index) => this.makeCard(id, index));
      // Old meshes no longer reference disposed entries; at most seven fronts
      // and their original art remain live, regardless of finish switching.
      this.textures.retainTextures(this.cards.map(card => card.frontTexture));
      this.hoveredIndex = null;
      if (this.focusedIndex != null && this.focusedIndex >= ids.length) this.focusedIndex = ids.length ? ids.length - 1 : null;
    }
    this.selectedIndex = nextSelected;
    this.layout(!changed); this.status();
  }

  layout(animate = false) {
    if (this.destroyed || !this.renderer) return;
    this.layoutInfo = handLayout({ width: this.width, height: this.height, count: this.cards.length,
      scroll: this.scroll, selectedIndex: this.selectedIndex, hoveredIndex: this.hoveredIndex,
      focusedIndex: this.focusedIndex, mode: this.mode });
    this.scroll = this.layoutInfo.scroll;
    this.motionStart = animate && !this.reduced && !this.hidden ? performance.now() : null;
    this.motionDuration = 160;
    for (const [index, card] of this.cards.entries()) {
      card.target = this.layoutInfo.cards[index];
      card.from = { x: card.root.position.x, y: card.root.position.y, z: card.root.position.z,
        rotationX: card.root.rotation.x, rotationY: card.root.rotation.y, rotationZ: card.root.rotation.z, scale: card.root.scale.x };
      card.focus.visible = card.target.focused || card.target.selected || card.target.hovering;
      card.focus.material = card.target.focused ? this.focusMaterial : this.selectedMaterial;
    }
    if (this.motionStart === null) this.applyPose(1);
    this.requestRender();
  }
  animateDraw(count = 1) {
    if (!this.renderer || this.destroyed || this.hidden || this.reduced) return;
    this.layout();
    for (const card of this.cards.slice(-Math.min(2, Math.max(0, count)))) {
      card.from.x = this.width / 2 + card.target.width;
      card.from.y = card.target.y + 28;
      card.from.rotationZ = -.18;
    }
    this.motionDuration = 420; this.motionStart = performance.now();
    this.applyPose(0); this.requestRender();
  }
  applyPose(progress) {
    const amount = ease(progress);
    for (const card of this.cards) {
      const target = card.target, from = card.from;
      if (!target || !from) continue;
      const value = key => from[key] + (target[key] - from[key]) * amount;
      card.root.position.set(value("x"), value("y"), value("z"));
      card.root.rotation.set(value("rotationX"), value("rotationY"), value("rotationZ"));
      card.root.scale.setScalar(value("scale"));
    }
    this.scene.updateMatrixWorld(true); this.camera.updateMatrixWorld(true);
  }

  resize({ width, height, mode = this.mode } = {}) {
    if (this.destroyed || !this.renderer) return;
    const box = this.canvas.getBoundingClientRect();
    this.input?.cancel();
    const nextWidth = width ?? box.width, nextHeight = height ?? box.height;
    // A hidden/collapsed canvas does not describe a new usable hand window.
    if (!(nextWidth > 0 && nextHeight > 0) || !Number.isFinite(nextWidth + nextHeight)) return;
    this.width = nextWidth; this.height = nextHeight; this.mode = mode;
    const scale = this.renderer.isSoftwareRenderer ? Math.min(1, Math.sqrt(240000 / (this.width * this.height))) : 1;
    const size = { ratio: Math.min(globalThis.devicePixelRatio || 1, this.renderer.isSoftwareRenderer ? 1 : 1.5), width: Math.round(this.width * scale), height: Math.round(this.height * scale) };
    const previous = this.backingSize;
    this.pendingSize = !previous || Object.keys(size).some(key => size[key] !== previous[key]) ? size : null;
    Object.assign(this.camera, { left: -this.width / 2, right: this.width / 2, top: this.height / 2, bottom: -this.height / 2 });
    this.camera.updateProjectionMatrix(); this.camera.updateMatrixWorld(true); this.layout();
  }

  flushResize() {
    if (!this.pendingSize) return;
    const size = this.pendingSize;
    // Canvas resizing clears its image, so resize and repaint in one frame.
    this.renderer.setPixelRatio(size.ratio); this.renderer.setSize(size.width, size.height, false);
    this.backingSize = size; this.pendingSize = null;
  }

  pick(event) {
    if (!this.enabled()) return null;
    const box = this.canvas.getBoundingClientRect();
    if (!box.width || !box.height || event.clientX < box.left || event.clientX > box.left + box.width || event.clientY < box.top || event.clientY > box.top + box.height) return null;
    this.pointer.set((event.clientX - box.left) / box.width * 2 - 1, -(event.clientY - box.top) / box.height * 2 + 1);
    this.scene.updateMatrixWorld(true); this.camera.updateMatrixWorld(true); this.raycaster.setFromCamera(this.pointer, this.camera);
    for (const hit of this.raycaster.intersectObjects(this.cards.map(card => card.root), true)) {
      if (hit.object.visible === false || hit.object.material?.visible === false) continue;
      let item = hit.object;
      while (item && !item.userData.handCard) item = item.parent;
      if (item) return { ...item.userData.handCard };
    }
    return null;
  }

  enabled() { return !!this.renderer && !this.destroyed && !this.hidden && !this.pageHidden && !this.contextLost && !this.frameFault && !this.pendingSize && this.interactive; }
  emit(kind, index, source) {
    const card = this.cards[index]; if (!this.enabled() || !card) return false;
    const intent = { kind: "card", index, cardId: card.cardId, revision: this.revision, source };
    (kind === "inspect" ? this.onInspect : this.onSelect)(intent); return true;
  }
  select(index, source = "keyboard") { return this.emit("select", index, source); }
  inspect(index = this.focusedIndex ?? this.selectedIndex, source = "button") { return this.emit("inspect", index, source); }
  hover(index, source = "pointer") {
    index = this.cards[index] ? index : null;
    if (index === this.hoveredIndex) return;
    this.hoveredIndex = index; this.layout(true);
    this.onHover(index === null ? null : { kind: "card", index, cardId: this.ids[index], revision: this.revision, source });
  }
  focus(index, { scroll = true, source = "keyboard" } = {}) {
    if (this.destroyed) return;
    index = this.cards[index] ? index : null;
    const changed = index !== this.focusedIndex;
    this.focusedIndex = index;
    if (changed) this.input?.cancel();
    this.layout(true);
    if (scroll && index !== null) this.scrollToIndex(index);
    if (changed) this.onFocus(index === null ? null : { kind: "card", index, cardId: this.ids[index], revision: this.revision, source });
  }
  scrollBy(delta, { gesture = false } = {}) {
    if (!this.layoutInfo || !Number.isFinite(delta)) return false;
    const next = clamp(this.scroll + delta, 0, this.layoutInfo.maxScroll);
    if (next === this.scroll) return false;
    if (!gesture) this.input?.cancel();
    this.scroll = next; this.layout(); return true;
  }
  scrollToIndex(index) {
    if (!this.layoutInfo || !this.cards[index]) return;
    this.scrollBy(scrollForHandIndex(this.layoutInfo, index) - this.scroll);
  }
  handleKey(event) {
    if (!this.enabled() || !this.cards.length || event.altKey || event.ctrlKey || event.metaKey) return false;
    const current = this.focusedIndex ?? this.selectedIndex ?? 0, last = this.cards.length - 1;
    let next = null;
    if (event.key === "ArrowRight") next = Math.min(last, current + 1);
    else if (event.key === "ArrowLeft") next = Math.max(0, current - 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = last;
    else if (event.key === "Enter" || event.key === " ") { if (!event.repeat) this.select(current); }
    else if (event.key?.toLowerCase() === "i" || (event.key === "F10" && event.shiftKey) || event.key === "ContextMenu") { if (!event.repeat) this.inspect(current, "keyboard"); }
    else if (event.key === "Escape") this.focus(null);
    else return false;
    if (next !== null) this.focus(next);
    event.preventDefault?.(); return true;
  }

  getCardRects() {
    if (!this.renderer || this.destroyed) return [];
    this.scene.updateMatrixWorld(true); this.camera.updateMatrixWorld(true);
    const canvas = this.canvas.getBoundingClientRect(), project = (card, x, y, z) => {
      const point = new Vector3(x, y, z).applyMatrix4(card.root.matrixWorld).project(this.camera);
      return { x: (point.x + 1) * this.width / 2, y: (1 - point.y) * this.height / 2 };
    };
    return this.cards.map(card => {
      const corners = [];
      for (const x of [-HAND_MODEL.width / 2, HAND_MODEL.width / 2]) for (const y of [-HAND_MODEL.height / 2, HAND_MODEL.height / 2]) for (const z of [-.06, .075]) corners.push(project(card, x, y, z));
      const x = Math.min(...corners.map(point => point.x)), y = Math.min(...corners.map(point => point.y));
      const right = Math.max(...corners.map(point => point.x)), bottom = Math.max(...corners.map(point => point.y));
      const left = Math.max(0, x), top = Math.max(0, y), visibleWidth = Math.max(0, Math.min(this.width, right) - left), visibleHeight = Math.max(0, Math.min(this.height, bottom) - top);
      return { index: card.index, cardId: card.cardId, x, y, width: right - x, height: bottom - y,
        centerX: (x + right) / 2, centerY: (y + bottom) / 2,
        clientX: canvas.left + x * canvas.width / this.width, clientY: canvas.top + y * canvas.height / this.height,
        clientWidth: (right - x) * canvas.width / this.width, clientHeight: (bottom - y) * canvas.height / this.height,
        visible: visibleWidth > 0 && visibleHeight > 0, visibleRect: { x: left, y: top, width: visibleWidth, height: visibleHeight },
        selected: this.selectedIndex === card.index, focused: this.focusedIndex === card.index };
    });
  }

  bind() {
    this.input = new HandInput({ element: this.canvas, pick: event => this.pick(event),
      getRevision: () => this.inputRevision, isEnabled: () => this.enabled(),
      onSelect: intent => { if (intent.revision === this.inputRevision) this.select(intent.index, intent.source); },
      onInspect: intent => { if (intent.revision === this.inputRevision) this.inspect(intent.index, intent.source); },
      onHover: intent => this.hover(intent?.index ?? null, "pointer"),
      canPan: () => this.layoutInfo?.maxScroll > 0, onPan: delta => this.scrollBy(delta, { gesture: true }) });
    this.handlers = {
      resize: () => this.resize(),
      visibility: () => { this.pageHidden = !!document.hidden; if (this.pageHidden) { this.input.cancel(); this.stop(); } else { this.layout(); this.requestRender(); } },
      wheel: event => {
        if (!this.enabled() || event.ctrlKey || !this.layoutInfo?.maxScroll) return;
        const delta = (Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY) * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.width : 1);
        if (this.scrollBy(delta)) event.preventDefault?.();
      },
      lost: event => { event.preventDefault(); this.contextLost = true; this.input.cancel(); this.stop(); this.status(); },
      restored: () => { if (!this.destroyed) { this.contextLost = this.frameFault = false; this.layout(); this.status(); } },
    };
    globalThis.window?.addEventListener?.("resize", this.handlers.resize);
    globalThis.document?.addEventListener?.("visibilitychange", this.handlers.visibility);
    this.canvas.addEventListener("wheel", this.handlers.wheel, { passive: false });
    this.canvas.addEventListener("webglcontextlost", this.handlers.lost);
    this.canvas.addEventListener("webglcontextrestored", this.handlers.restored);
    if (globalThis.ResizeObserver) { this.observer = new ResizeObserver(this.handlers.resize); this.observer.observe(this.canvas); }
  }

  requestRender() {
    this.dirty = true;
    if (!this.renderer || this.destroyed || this.hidden || this.pageHidden || this.contextLost || this.frameFault || this.raf !== null) return;
    this.raf = requestAnimationFrame(now => this.frame(now));
  }
  frame(now) {
    this.raf = null;
    if (!this.renderer || this.destroyed || this.hidden || this.pageHidden || this.contextLost || this.frameFault) return;
    const moving = this.motionStart !== null;
    if (moving && this.renderer.isSoftwareRenderer && now - this.lastFrame < 33) { this.requestRender(); return; }
    try {
      if (moving) {
        const progress = (now - this.motionStart) / (this.motionDuration || 160); this.applyPose(progress);
        if (progress >= 1) this.motionStart = null;
      }
      if (this.dirty || moving) {
        const start = performance.now(); this.flushResize(); this.renderer.render(this.scene, this.camera);
        this.renderCost = performance.now() - start; this.lastFrame = now; this.dirty = false;
        this.onLayout({ ...this.layoutInfo, cards: this.getCardRects() });
      }
    } catch (error) { this.error = String(error?.message || error); this.frameFault = true; this.input.cancel(); this.stop(); this.status(); }
    if (this.motionStart !== null) this.requestRender();
  }
  stop() { if (this.raf !== null) cancelAnimationFrame(this.raf); this.raf = null; }
  setHidden(value) {
    if (this.destroyed) return;
    if (this.hidden === !!value) return;
    this.hidden = !!value;
    if (this.hidden) { this.input?.cancel(); this.stop(); this.motionStart = null; }
    else this.resize();
  }
  setInteractive(value) { this.interactive = !!value; if (!this.interactive) this.input?.cancel(); }
  setReduced(value) { this.reduced = !!value; if (this.reduced) this.layout(); }
  status() { this.onStatus({ available: !!this.renderer && !this.contextLost && !this.frameFault, renderer: this.rendererName,
    reason: this.error || (this.contextLost ? "context-lost" : null), cards: this.cards.length,
    triangles: this.renderer?.info?.render?.triangles ?? 0, renderMs: Math.round(this.renderCost || 0) }); }
  clearCards() {
    for (const card of this.cards) { card.root.removeFromParent(); for (const resource of card.resources) resource.dispose(); }
    this.cards = [];
  }
  dispose() {
    if (this.destroyed) return;
    this.destroyed = true; this.stop(); this.input?.dispose(); this.observer?.disconnect();
    if (this.handlers) {
      globalThis.window?.removeEventListener?.("resize", this.handlers.resize);
      globalThis.document?.removeEventListener?.("visibilitychange", this.handlers.visibility);
      this.canvas.removeEventListener("wheel", this.handlers.wheel);
      this.canvas.removeEventListener("webglcontextlost", this.handlers.lost);
      this.canvas.removeEventListener("webglcontextrestored", this.handlers.restored);
    }
    this.clearCards(); for (const resource of this.resources) resource.dispose(); this.resources.clear();
    this.textures?.dispose(); this.renderer?.dispose(); this.canvas.style.touchAction = this.previousTouchAction || "";
  }
}
