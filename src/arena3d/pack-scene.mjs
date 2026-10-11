/**
 * Spellwood's original forest gift opening. Presentation only: this module never
 * draws cards, awards dust, writes storage, or reveals an uncommitted result.
 * Click/drag and external buttons express the same intents. The owner persists
 * a result before setOpening/launch and persists a reveal before reveal(index).
 */
import {
  Scene, PerspectiveCamera, WebGLRenderer, Group, Mesh, Color, Vector2, Vector3,
  Raycaster, HemisphereLight, DirectionalLight, MeshStandardMaterial,
  MeshBasicMaterial, BoxGeometry, CylinderGeometry, PlaneGeometry,
  TorusGeometry, OctahedronGeometry, SRGBColorSpace, ACESFilmicToneMapping,
  Texture, CanvasTexture, Sprite, SpriteMaterial, LinearFilter, CatmullRomCurve3, TubeGeometry,
} from "three";
import { extrudeShape, roundedRectShape, leafSolid } from "./model-utils.mjs";
import { CardTextures } from "./card-textures.mjs";
import { SoftwareRenderer } from "./software-renderer.mjs";

const PI = Math.PI;
const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const ease = v => 1 - (1 - clamp(v)) ** 3;
const mix = (a, b, t) => a + (b - a) * t;
const FINISH = Object.freeze({ leaf: 0x92c987, silver: 0xbfdfed, star: 0xba9ce8, gold: 0xf2ce75 });
const BUSY = new Set(["charging", "opening", "dealing"]);
const DURATION = 3650;

/** All nodes are genuinely volumetric; supplied textures remain caller-owned. */
export class PackScene {
  constructor({ canvas, onReveal = () => {}, onOpenRequested = () => {},
    onReady = () => {}, onStatus = () => {}, onSound = () => {}, reduced = false } = {}) {
    if (!canvas) throw new TypeError("PackScene requires a canvas");
    Object.assign(this, { canvas, onReveal, onOpenRequested, onReady, onStatus, onSound, reduced: !!reduced });
    this.destroyed = false; this.hidden = false; this.phase = "idle";
    this.opening = null; this.revealed = 0; this.focusedIndex = null;
    this.cards = []; this.animations = new Map(); this.resources = new Set();
    this.raf = null; this.dirty = true; this.lastFrame = -Infinity; this.readyEmitted = false;
    this.raycaster = new Raycaster(); this.pointer = new Vector2();
    this.scene = new Scene(); this.scene.background = new Color(0x071b20);
    this.camera = new PerspectiveCamera(36, 1, .1, 70);
    try {
      this.renderer = this.createRenderer(canvas);
      this.rendererName = this.renderer.isSoftwareRenderer ? "CPU · 兼容三维" : "WebGL2";
      this.renderer.outputColorSpace = SRGBColorSpace;
      this.renderer.toneMapping = ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.12;
    } catch (error) {
      this.rendererName = "unavailable"; this.error = String(error?.message || error);
      canvas.dataset.renderer = "unavailable"; this.status(); return;
    }
    canvas.dataset.renderer = this.rendererName;
    const sky = new HemisphereLight(0xe1f4d6, 0x284138, 2.25);
    const sun = new DirectionalLight(0xffd9a6, 3); sun.position.set(-4, 6, 9);
    const rim = new DirectionalLight(0x72d9c3, 1.8); rim.position.set(5, 3, -4);
    this.scene.add(sky, sun, rim);
    this.textures = new CardTextures({ onChange: () => { this.queueTextureWarmup(); this.requestRender(); } });
    this.makeStage(); this.makeGift(); this.makeLeaves(); this.makeLightEffects();
    this.bind(); this.resize(); this.poseSealed(); this.status(); this.requestRender();
  }

  createRenderer(canvas) {
    try { return new WebGLRenderer({ canvas, alpha: false, antialias: true, powerPreference: "default" }); }
    catch { return new SoftwareRenderer(canvas); }
  }

  own(resource) { this.resources.add(resource); return resource; }
  material(color, extras = {}) {
    const material=this.own(new MeshStandardMaterial({ color, roughness: .65, metalness: .05, ...extras }));
    material.userData.cpuSmooth=true;return material;
  }
  mesh(parent, geometry, material, position = [0, 0, 0], rotation = [0, 0, 0]) {
    this.own(geometry); const mesh = new Mesh(geometry, material);
    mesh.position.set(...position); mesh.rotation.set(...rotation); parent.add(mesh); return mesh;
  }
  slab(w, h, d, radius = .1) {
    return extrudeShape(roundedRectShape(w, h, radius), d, .018, 2);
  }

  makeStage() {
    this.stage = new Group(); this.stage.name = "original-forest-gift-stage";
    this.stage.userData.cpuStatic = true;
    const stone = this.material(0x183f3a), trim = this.material(0x8a8258, { metalness: .35 });
    this.mesh(this.stage, new CylinderGeometry(3.1, 3.35, .28, 36), stone, [0, -2.4, -.9]);
    this.mesh(this.stage, new TorusGeometry(3.06, .032, 4, 36), trim, [0, -2.247, -.9], [-PI / 2, 0, 0]);
    // Inlaid copper leaves are geometry rather than borrowed symbols or textures.
    const leaf = this.own(leafSolid(.4, .2, .04));
    for (let i = 0; i < 8; i++) {
      const angle = i * PI / 4;
      const m = new Mesh(leaf, trim); m.position.set(Math.sin(angle) * 2.72, -2.22, -.9 + Math.cos(angle) * 2.72);
      m.rotation.set(-PI / 2, 0, angle); this.stage.add(m);
    }
    this.stage.traverse(node => { node.userData.cpuStatic = true; }); this.scene.add(this.stage);
  }

  makeGift() {
    this.gift = new Group(); this.gift.name = "original-teal-paper-and-wood-gift";
    this.box = new Group(); this.lid = new Group(); this.seal = new Group();
    this.gift.add(this.box, this.lid, this.seal); this.scene.add(this.gift);
    const wood = this.material(0x9f8d74), edge = this.material(0xb78a50, { metalness: .28, roughness: .48 });
    const bark=this.own(new Texture());bark.colorSpace=SRGBColorSpace;bark.minFilter=bark.magFilter=LinearFilter;bark.generateMipmaps=false;wood.map=bark;wood.userData.cpuLitTexture=true;
    if(typeof Image==='function'){this.giftImage=new Image();this.giftImage.onload=()=>{if(this.destroyed)return;bark.image=this.giftImage;bark.needsUpdate=true;this.requestRender();};this.giftImage.src='/assets/materials/grove-bark-v1.webp';}
    const paper = this.material(0x2b7c6b), paperLight = this.material(0x4a9c7c);
    const interior = this.material(0x174438), copper = this.material(0xd6ad68, { metalness: .55, roughness: .34 });
    this.lightMaterial = this.material(0xc8e9a4, { emissive: 0xa1e7a9, emissiveIntensity: .05, roughness: .3 });
    // A hollow wooden box: four walls and a floor, not a solid painted billboard.
    this.mesh(this.box, new BoxGeometry(2.68, .16, 1.3), wood, [0, -1.43, 0]);
    for (const side of [-1, 1]) {
      this.mesh(this.box, new BoxGeometry(.16, 2.83, 1.3), wood, [side * 1.26, 0, 0]);
      this.mesh(this.box, new BoxGeometry(2.53, 2.83, .12), wood, [0, 0, side * .59]);
      this.mesh(this.box, this.slab(2.34, 2.6, .035, .13), paper, [0, 0, side * .674]);
      this.mesh(this.box, new BoxGeometry(.13, 2.84, .06), edge, [side * .95, 0, .716]);
      this.mesh(this.box, new BoxGeometry(2.55, .12, .075), copper, [0, side * 1.17, .716]);
    }
    this.mesh(this.box, new BoxGeometry(2.35, .07, 1.03), interior, [0, -1.3, 0]);
    this.mesh(this.box, new BoxGeometry(2.1, .05, .9), this.lightMaterial, [0, .84, 0]);
    // Deliberate paper folds and a slim central band make the volume legible.
    this.mesh(this.box, new BoxGeometry(.19, 2.72, .045), paperLight, [0, 0, .709]);
    for (const side of [-1, 1]) {
      this.mesh(this.box, new BoxGeometry(.036, 2.7, .04), edge, [side * .19, 0, .724]);
      const fold = this.mesh(this.box, leafSolid(.63, .39, .045), paperLight, [side * .91, -.98, .729]);
      fold.rotation.z = side * -.65;
    }
    // Inset framing, copper corner rivets and paired carved leaves are authored
    // volumes. Their shared geometry keeps the detail inexpensive to redraw.
    const stud=this.own(new OctahedronGeometry(.055,1)),carving=this.own(leafSolid(.36,.18,.045));
    for(const x of[-1,1])for(const y of[-1,1]){const pin=new Mesh(stud,copper);pin.position.set(x*1.1,y*1.21,.79);this.box.add(pin);for(let k=0;k<3;k++){const leaf=new Mesh(carving,k%2?edge:paperLight);leaf.position.set(x*(.69-k*.15),y*(.96-k*.07),.765);leaf.rotation.z=x*y*(1.1+k*.36)+(y<0?PI:0);this.box.add(leaf);}}
    this.mesh(this.lid, this.slab(2.9, 1.46, .24, .12), edge, [0, 0, 0], [-PI / 2, 0, 0]);
    this.mesh(this.lid, this.slab(2.74, 1.31, .06, .1), paper, [0, .156, 0], [-PI / 2, 0, 0]);
    this.mesh(this.lid, new BoxGeometry(.24, .028, 1.31), copper, [0, .206, 0]);
    this.lid.position.y = 1.51;
    const medallion = this.mesh(this.seal, new CylinderGeometry(.43, .43, .095, 24), copper, [0, 0, .02], [PI / 2, 0, 0]);
    this.mesh(this.seal,new TorusGeometry(.35,.019,4,28),edge,[0,0,.075]);
    medallion.name = "copper-leaf-seal";
    this.sealLeaves = [];
    for (const side of [-1, 1]) {
      const m = this.mesh(this.seal, leafSolid(.53, .28, .09), this.lightMaterial, [side * -.035, -.25, .093], [0, 0, side * -.52]);
      this.sealLeaves.push(m);
    }
    this.seal.position.set(0, .08, .755);
    this.gift.userData.packGift = true;
  }

  makeLeaves() {
    this.leaves = new Group(); this.leaves.name = "sixteen-solid-leaf-motes";
    const geometry = this.own(leafSolid(.22, .115, .033));
    this.moteMaterial = this.material(0xd6dfa0, { emissive: 0xaccd75, emissiveIntensity: .3 });
    for (let i = 0; i < 16; i++) {
      const m = new Mesh(geometry, this.moteMaterial); m.visible = false; this.leaves.add(m);
    }
    this.scene.add(this.leaves);
  }

  makeLightEffects() {
    // Small, real solid meshes supply the light on both renderers. No bloom
    // pass, full-screen flash, billboard stack or additional texture buffers.
    const light = (color, opacity = 1) => this.own(new MeshBasicMaterial({
      color, transparent: opacity < 1, opacity, depthWrite: opacity === 1,
    }));
    this.chargeLight = new Group(); this.chargeLight.name = "copper-leaf-light-awakening";
    this.chargeLight.visible = false; this.gift.add(this.chargeLight);
    this.seamLightMaterial = light(0xe0f7b0, .68);
    this.chargeRingMaterial = light(0xc1f5b9, .48);
    this.chargeRing = this.mesh(this.chargeLight, new TorusGeometry(.50, .031, 3, 18), this.chargeRingMaterial, [0, .08, .89]);
    for (const side of [-1, 1]) {
      this.mesh(this.chargeLight, new BoxGeometry(.027, 2.44, .028), this.seamLightMaterial, [side * 1.08, 0, .753]);
      this.mesh(this.chargeLight, new BoxGeometry(2.18, .026, .028), this.seamLightMaterial, [0, side * 1.225, .753]);
    }
    this.boxRays = new Group(); this.boxRays.name = "three-solid-forest-light-rays";
    this.boxRays.visible = false; this.gift.add(this.boxRays);
    this.rayShellMaterial = light(0xb9eac2, .23);
    this.rayCoreMaterial = light(0xeff7b9, .74);
    const shell = this.own(new CylinderGeometry(.15, .045, .92, 4, 1));
    const core = this.own(new CylinderGeometry(.037, .016, .92, 4, 1));
    for (const side of [-1, 0, 1]) {
      const ray = new Group(); ray.position.set(side * .67, 1.38, .26);
      ray.rotation.z = -side * .23; ray.rotation.x = .10;
      for (const [geometry, material] of [[shell, this.rayShellMaterial], [core, this.rayCoreMaterial]]) {
        const mesh = new Mesh(geometry, material); mesh.position.y = .46; ray.add(mesh);
      }
      this.boxRays.add(ray);
    }

    const glowCanvas=document.createElement('canvas');glowCanvas.width=glowCanvas.height=64;
    const ctx=glowCanvas.getContext('2d'),gradient=ctx.createRadialGradient(32,32,1,32,32,31);
    gradient.addColorStop(0,'rgba(243,255,202,.75)');gradient.addColorStop(.2,'rgba(183,239,172,.35)');gradient.addColorStop(.62,'rgba(126,219,181,.10)');gradient.addColorStop(1,'rgba(96,205,173,0)');ctx.fillStyle=gradient;ctx.fillRect(0,0,64,64);
    this.packGlowTexture=this.own(new CanvasTexture(glowCanvas));this.packGlowTexture.minFilter=LinearFilter;this.packGlowTexture.generateMipmaps=false;
    this.packGlowMaterial=this.own(new SpriteMaterial({map:this.packGlowTexture,transparent:true,opacity:0,depthWrite:false}));
    this.packGlow=new Sprite(this.packGlowMaterial);this.packGlow.name='local-forest-light-bloom';this.packGlow.position.set(0,.1,.88);this.packGlow.scale.set(4.1,4.1,1);this.chargeLight.add(this.packGlow);
    this.ribbons=new Group();this.ribbons.name='two-solid-rising-light-ribbons';this.gift.add(this.ribbons);this.ribbonMaterial=light(0xc8eabb,.0);
    const path=Array.from({length:29},(_,i)=>{const t=i/28,a=t*PI*1.72;return new Vector3(Math.cos(a)*1.55,-1.35+t*3.05,Math.sin(a)*.86);});
    const ribbonGeo=this.own(new TubeGeometry(new CatmullRomCurve3(path),28,.017,3,false));
    for(const side of[-1,1]){const ribbon=new Mesh(ribbonGeo,this.ribbonMaterial);ribbon.rotation.y=side<0?PI:0;this.ribbons.add(ribbon);}
    this.ribbons.visible=false;

    // A two-slot pool bounds reveal-all cost. Both geometry and materials are
    // retained until disposal; repeated openings never allocate particle jobs.
    const halo = this.own(new TorusGeometry(1, .080, 3, 18));
    const line = this.own(new TorusGeometry(1, .016, 3, 18));
    const leaf = this.own(leafSolid(.17, .087, .027));
    const star = this.own(new OctahedronGeometry(.056, 0));
    this.revealLights = Array.from({ length: 2 }, (_, slot) => {
      const root = new Group(); root.name = `finish-light-burst-${slot}`; root.visible = false; this.scene.add(root);
      const haloMaterial = light(FINISH.leaf, .19), lineMaterial = light(FINISH.leaf, .78), moteMaterial = light(FINISH.leaf);
      const rings = [];
      for (const [geometry, material] of [[halo, haloMaterial], [line, lineMaterial]]) {
        const mesh = new Mesh(geometry, material); mesh.scale.set(.69, 1.0, 1); mesh.position.z = -.13;
        root.add(mesh); rings.push(mesh);
      }
      const motes = [];
      for (let i = 0; i < 9; i++) {
        const mesh = new Mesh(i < 6 ? leaf : star, moteMaterial); root.add(mesh); motes.push(mesh);
      }
      return { root, rings, motes, haloMaterial, lineMaterial, moteMaterial, index: null, start: null };
    });
  }

  clearLightEffects() {
    if (this.chargeLight) this.chargeLight.visible = false;
    if (this.boxRays) this.boxRays.visible = false;
    if (this.ribbons) this.ribbons.visible=false;
    if (this.packGlowMaterial) this.packGlowMaterial.opacity=0;
    for (const effect of this.revealLights || []) {
      effect.root.visible = false; effect.index = effect.start = null;
    }
  }

  beginRevealLight(index, now) {
    const card = this.cards[index];
    const effect = this.revealLights.find(item => item.index === index || item.index === null)
      || this.revealLights.find(item => item.index !== this.focusedIndex) || this.revealLights[0];
    const color = FINISH[card.data.finish] || FINISH.leaf;
    for (const material of [effect.haloMaterial, effect.lineMaterial, effect.moteMaterial]) material.color.setHex(color);
    effect.index = index; effect.start = now; effect.root.visible = false;
  }

  animateRevealLights(now) {
    for (const effect of this.revealLights) {
      if (effect.index === null) continue;
      const card = this.cards[effect.index], progress = (now - effect.start - 115) / 425;
      if (!card || progress >= 1 || this.reduced) {
        effect.root.visible = false; effect.index = effect.start = null; continue;
      }
      effect.root.visible = progress >= 0 && card.root.visible;
      if (!effect.root.visible) continue;
      const t = clamp(progress), energy = Math.sin(PI * t) ** .7, spread = ease(t);
      effect.root.position.copy(card.root.position); effect.root.scale.copy(card.root.scale);
      effect.root.rotation.set(-.035, 0, card.root.rotation.z);
      effect.haloMaterial.opacity = .22 * energy; effect.lineMaterial.opacity = .82 * energy;
      for (const ring of effect.rings) ring.scale.set(.69 * (1 + spread * .07), 1 + spread * .07, 1);
      for (let i = 0; i < effect.motes.length; i++) {
        const mote = effect.motes[i], angle = i * PI * 2 / effect.motes.length + .17;
        mote.position.set(Math.cos(angle) * (.68 + spread * .11), Math.sin(angle) * (.96 + spread * .12), -.02 + Math.sin(angle * 3 + t) * .08);
        mote.rotation.set(t * 2.2 + i, t * 1.4, angle - PI / 2 + t * .7);
        mote.scale.setScalar((i < 6 ? 1 : .8) * energy);
      }
    }
  }

  makeCard(data, index) {
    const root = new Group(); root.name = `opening-card-${index}`; root.userData.packIndex = index;
    const resources = new Set(), own = value => { resources.add(value); return value; };
    const width = 1.25, height = 1.8, thickness = .075;
    const finish = FINISH[data.finish] || FINISH.leaf;
    const edge = own(new MeshStandardMaterial({ color: finish, metalness: .35, roughness: .42 }));
    const paper = own(new MeshStandardMaterial({ color: 0xdfd3aa, roughness: .85 }));
    for (const [w, h, d, mat] of [[width, height, thickness, edge], [width - .055, height - .055, thickness + .012, paper]]) {
      const g = own(extrudeShape(roundedRectShape(w, h, .105), d, .009, 2)); root.add(new Mesh(g, mat));
    }
    for (const face of [1, -1]) {
      const mat = own(new MeshBasicMaterial({ map: face > 0 ? this.textures.get(data.cardId, data.finish) : this.textures.back, color: 0xffffff }));
      const mesh = new Mesh(own(new PlaneGeometry(width - .12, height - .12)), mat);
      mesh.position.z = face * .058; mesh.rotation.y = face < 0 ? PI : 0;
      mesh.name = face > 0 ? "saved-card-front" : "original-card-back"; root.add(mesh);
    }
    // Four inset finish corner tabs remain visible on the front, including CPU.
    const corner = own(new BoxGeometry(.13, .025, .012));
    for (const x of [-1, 1]) for (const y of [-1, 1]) {
      const tab = new Mesh(corner, edge); tab.position.set(x * .515, y * .837, .067); root.add(tab);
    }
    this.scene.add(root);
    return { root, resources, index, data: { ...data }, angle: PI, target: new Vector3(), targetScale: 1, targetZ: 0 };
  }

  /** Passing null returns to the sealed sample gift. Result objects are copied. */
  setOpening(opening, { intro = true } = {}) {
    if (this.destroyed || !this.renderer) return;
    if (opening !== null && (!opening || !Array.isArray(opening.cards) || opening.cards.length !== 10 || opening.id == null))
      throw new TypeError("An opening needs its persisted id and exactly ten saved cards");
    if (opening && opening.id === this.opening?.id) {
      // Reconciliation accepts only the persisted reveal mask. Same-id results
      // are immutable even if a caller accidentally supplies a different array.
      const saved = Number(opening.revealed) & 1023;
      for (let i = 0; i < 10; i++) if ((saved & (1 << i)) && !(this.revealed & (1 << i))) this.reveal(i);
      return;
    }
    this.cancelGesture();
    this.clearCards(); this.animations.clear(); this.startTime = null; this.readyEmitted = false;
    this.focusedIndex = null; this.revealed = 0;
    this.opening = opening ? { id: opening.id, cards: opening.cards.map(card => ({ ...card })), revealed: Number(opening.revealed) & 1023 } : null;
    if (!this.opening) { this.phase = "idle"; this.poseSealed(); this.status(); this.requestRender(); return; }
    this.revealed = this.opening.revealed;
    this.cards = this.opening.cards.map((card, index) => this.makeCard(card, index));
    this.queueTextureWarmup();
    this.layout();
    if (intro && !this.revealed) { this.phase = "sealed"; this.poseSealed(); }
    else { this.settle(false); }
    this.status(); this.requestRender();
  }

  launch() {
    if (this.destroyed || !this.renderer || !this.opening || !["sealed", "idle"].includes(this.phase)) return false;
    this.cancelGesture();
    if (this.reduced || this.hidden) { this.settle(); return true; }
    this.phase = "charging"; this.startTime = performance.now(); this.readyEmitted = false;
    this.sound("pack-charge"); this.status(); this.requestRender(); return true;
  }

  /** Finish the opening motion only. Reveal ownership remains with persistence. */
  skip() {
    if (this.destroyed || !this.opening) return false;
    this.settle(); return true;
  }

  settle(emitReady = true) {
    this.cancelGesture();
    this.startTime = null; this.animations.clear(); this.phase = this.revealed === 1023 ? "complete" : "ready";
    this.gift.visible = false; this.leaves.visible = false; this.clearLightEffects(); this.layout();
    for (const card of this.cards) {
      card.angle = this.revealed & (1 << card.index) ? 0 : PI;
      card.root.visible = true; this.applyCardPose(card, true);
    }
    this.status(); this.requestRender();
    if (!this.destroyed && emitReady && !this.readyEmitted) { this.readyEmitted = true; this.onReady(); }
  }

  /** Call only after saving this reveal. This cannot award or modify card data. */
  reveal(index) {
    if (this.destroyed || !Number.isInteger(index) || index < 0 || index >= this.cards.length || (this.revealed & (1 << index))) return false;
    this.revealed |= 1 << index; this.opening.revealed = this.revealed;
    const card = this.cards[index];
    if (!BUSY.has(this.phase) && this.phase !== "sealed" && !this.reduced && !this.hidden) {
      const start = performance.now();
      this.animations.set(index, { start, from: card.angle }); this.beginRevealLight(index, start);
    } else { card.angle = 0; }
    if (!BUSY.has(this.phase) && this.phase !== "sealed") this.phase = this.revealed === 1023 ? "complete" : "ready";
    if (this.reduced) this.applyCardPose(card, true);
    this.sound(`pack-reveal-${card.data.finish || "leaf"}`); this.status(); this.requestRender(); return true;
  }

  /** External focus buttons are equivalent to selecting an already revealed card. */
  focus(index = null) {
    if (this.destroyed || (index !== null && (!Number.isInteger(index) || index < 0 || index >= this.cards.length))) return false;
    if (BUSY.has(this.phase) || this.phase === "sealed" || this.phase === "idle") return false;
    if (this.focusedIndex === index) return true;
    this.focusedIndex = index; this.layout();
    this.focusStart = this.reduced ? null : performance.now();
    for (const card of this.cards) {
      card.fromPosition = card.root.position.clone(); card.fromScale = card.root.scale.x;
      if (this.reduced) this.applyCardPose(card, true);
    }
    this.status(); this.requestRender(); return true;
  }

  layout() {
    const portrait = this.aspect < .8;
    for (const card of this.cards) {
      const i = card.index;
      if (this.focusedIndex === null) {
        const col = portrait ? (i === 9 ? 0 : i % 3 - 1) : i % 5 - 2;
        const row = portrait ? 1.5 - Math.floor(i / 3) : i < 5 ? .5 : -.5;
        card.target.set(col * 1.53, row * 2.12 + .08, .35 + Math.abs(col) * -.085);
        card.targetScale = 1; card.targetZ = col * -.026;
      } else if (i === this.focusedIndex) {
        card.target.set(0, this.visibleHeight * .025, 2.0);
        const depth = 1 - 2 / this.camera.position.z;
        card.targetScale = Math.min(4.7, this.visibleHeight * .76 * depth / 1.8, this.visibleHeight * this.aspect * .78 * depth / 1.25); card.targetZ = 0;
      } else {
        const slot = i - (i > this.focusedIndex ? 1 : 0);
        card.target.set((slot - 4) * .74, -this.visibleHeight * .41 - Math.abs(slot - 4) * .017, -.15);
        card.targetScale = .55; card.targetZ = (slot - 4) * -.045;
      }
    }
  }

  applyCardPose(card, settled = false) {
    const root = card.root;
    if (settled || !this.focusStart) {
      root.position.copy(card.target); root.scale.setScalar(card.targetScale);
    }
    root.rotation.set(-.035, card.angle, card.targetZ);
  }

  poseSealed() {
    if (!this.gift) return;
    this.gift.visible = true; this.gift.position.set(0, -.13, 0); this.gift.rotation.set(-.045, -.3, -.018); this.gift.scale.setScalar(this.giftScale || 1);
    this.lid.position.set(0, 1.51, 0); this.lid.rotation.set(0, 0, 0);
    this.seal.position.set(0, .08, .755); this.seal.rotation.set(0, 0, 0); this.seal.scale.setScalar(1);
    this.lightMaterial.emissiveIntensity = .05; this.leaves.visible = false; this.clearLightEffects();
    for (const card of this.cards) { card.root.visible = false; card.angle = this.revealed & (1 << card.index) ? 0 : PI; }
  }

  animateOpening(now) {
    const elapsed = Math.max(0, now - this.startTime);
    if (elapsed >= DURATION) { this.settle(); return; }
    const next = elapsed < 1000 ? "charging" : elapsed < 1730 ? "opening" : "dealing";
    if (next !== this.phase) { this.phase = next; this.status(); if (next === "opening") this.sound("pack-open"); }
    const charge = clamp(elapsed / 1000), opened = ease((elapsed - 1000) / 760), dealt = ease((elapsed - 1880) / 1550);
    this.gift.visible = true; this.leaves.visible = true;
    this.gift.position.set(0, -.13 - opened * .35 - dealt * 1.55, -dealt * 1.3);
    this.gift.scale.setScalar((this.giftScale || 1) * (1 - opened * .18) * (1 - dealt * .67));
    this.gift.rotation.set(-.045, -.3 + Math.sin(charge * PI * 2) * .04 * (1 - opened), -.018);
    this.lightMaterial.emissiveIntensity = .05 + charge * 1.15 * (1 - dealt);
    this.moteMaterial.emissiveIntensity = .3 + charge * .52 * (1 - dealt);
    // Light accumulates once, then escapes through the open mouth. The narrow
    // meshes cover only box/card edges, preserving a calm dark background.
    this.chargeLight.visible = elapsed < 2050;
    this.packGlowMaterial.opacity=(.04+charge*.4)*(1-clamp((elapsed-1450)/600));
    this.packGlow.scale.setScalar(3.1+charge*1.0+opened*.6);
    this.ribbons.visible=elapsed<2300;this.ribbonMaterial.opacity=(.08+charge*.5)*(1-clamp((elapsed-1650)/650));this.ribbons.rotation.y=elapsed*.0013;this.ribbons.scale.setScalar(1+opened*.35);
    this.seamLightMaterial.opacity = (.12 + charge * .64) * (1 - opened * .72);
    this.chargeRingMaterial.opacity = (.16 + charge * .55) * (1 - opened);
    this.chargeRing.scale.setScalar(1.18 - charge * .18 + opened * .7);
    const rayEnergy = clamp((elapsed - 1020) / 250) * (1 - clamp((elapsed - 1850) / 590));
    this.boxRays.visible = rayEnergy > 0;
    this.rayShellMaterial.opacity = rayEnergy * .23; this.rayCoreMaterial.opacity = rayEnergy * .74;
    for (let i = 0; i < this.boxRays.children.length; i++) {
      this.boxRays.children[i].scale.y = (.45 + opened * .55) * (i === 1 ? 1 : .80);
    }
    this.lid.position.set(opened * .46, 1.51 + opened * .70, -opened * .95);
    this.lid.rotation.set(opened * .36, opened * .24, opened * -.10);
    this.seal.position.set(opened * 1.8, .08 + opened * .48, .755 + opened * .8);
    this.seal.rotation.set(opened * .7, opened * 1.45, opened * .8); this.seal.scale.setScalar(1 - opened * .5);
    for (let i = 0; i < this.leaves.children.length; i++) {
      const mote = this.leaves.children[i], a = i * 2.39996 + elapsed * .00065;
      const radius = elapsed < 1000 ? 2.3 - charge * .8 : 1.5 + opened * 1.6;
      mote.visible = elapsed > i * 34 && elapsed < 2860 + i * 25;
      mote.position.set(Math.cos(a) * radius, Math.sin(a) * radius * .8 + opened * .45, Math.sin(i * 1.71) * .65 + .9);
      mote.rotation.set(a * .38, a * .6, -a); mote.scale.setScalar((.45 + charge * .55) * (1 - dealt * .7));
    }
    for (const card of this.cards) {
      const launch = 1730 + card.index * 75, t = clamp((elapsed - launch) / 1050), travel = ease(t);
      card.root.visible = elapsed >= launch;
      if (!card.root.visible) continue;
      const arc = this.aspect < .8 ? Math.max(0, Math.min(.35, (this.visibleHeight / 2 - Math.abs(card.target.y) - 1.35) * .4)) : Math.min(1.05, Math.max(.14, (this.visibleHeight / 2 - 2.05) * (this.aspect > 1.55 ? .30 : .72)));
      card.root.position.set(mix(0, card.target.x, travel), mix(.6, card.target.y, travel) + Math.sin(t * PI) * arc, mix(.2, card.target.z, travel) + Math.sin(t * PI) * .4);
      card.root.scale.setScalar(mix(.48, 1, travel));
      card.angle = this.revealed & (1 << card.index) ? 0 : PI;
      card.root.rotation.set(-.035 + Math.sin(t * PI) * .5, card.angle + Math.sin(t * PI) * (card.index % 2 ? .66 : -.66), mix((card.index - 4.5) * .12, card.targetZ, travel));
    }
  }

  animate(now) {
    if (this.startTime !== null && this.startTime !== undefined) this.animateOpening(now);
    for (const [index, animation] of this.animations) {
      const t = clamp((now - animation.start) / 540), card = this.cards[index];
      if (!card) { this.animations.delete(index); continue; }
      card.angle = mix(animation.from, 0, ease(t)); this.applyCardPose(card);
      if (!this.focusStart) card.root.position.z = card.target.z + Math.sin(t * PI) * .38;
      if (t >= 1) this.animations.delete(index);
    }
    if (this.focusStart != null) {
      const t = ease((now - this.focusStart) / 420);
      for (const card of this.cards) {
        card.root.position.lerpVectors(card.fromPosition, card.target, t);
        card.root.scale.setScalar(mix(card.fromScale, card.targetScale, t)); this.applyCardPose(card);
      }
      if (t >= 1) { this.focusStart = null; for (const card of this.cards) this.applyCardPose(card, true); }
    }
    this.animateRevealLights(now);
  }

  gestureEnabled() {
    return !this.destroyed && !!this.renderer && !this.hidden && !this.pageHidden && !this.contextLost && !this.frameFault && !BUSY.has(this.phase);
  }

  cancelGesture() {
    const down = this.down; this.down = null;
    // Clear ownership before releasing: lostpointercapture may fire immediately.
    if (!down?.captured) return;
    down.captured = false;
    try { if (!this.canvas.hasPointerCapture || this.canvas.hasPointerCapture(down.id)) this.canvas.releasePointerCapture?.(down.id); }
    catch { /* The browser may already have released or cancelled this pointer. */ }
  }

  bind() {
    this.handlers = {
      resize: () => this.resize(),
      down: event => {
        if (this.down && event.pointerId !== this.down.id) { this.cancelGesture(); return; }
        this.cancelGesture();
        if (!this.gestureEnabled() || event.isPrimary !== true || event.button !== 0 ||
          !Number.isFinite(event.pointerId) || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY) ||
          event.buttons != null && event.buttons !== 1) return;
        const down = this.down = { x: event.clientX, y: event.clientY, id: event.pointerId, phase: this.phase,
          openingId: this.opening?.id, index: this.pick(event), captured: false };
        if (this.canvas.setPointerCapture) try { this.canvas.setPointerCapture(down.id); down.captured = true; }
        catch { /* Cancellation can race capture. */ }
      },
      up: event => {
        const down = this.down; if (!down || event.pointerId !== down.id) return;
        this.cancelGesture();
        if (!this.gestureEnabled() || event.isPrimary !== true || event.button !== 0 ||
          event.buttons != null && event.buttons !== 0 || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY) ||
          down.phase !== this.phase || down.openingId !== this.opening?.id) return;
        const distance = Math.hypot(event.clientX - down.x, event.clientY - down.y);
        if (["idle", "sealed"].includes(this.phase)) {
          if (distance < 12 || distance > 30) this.onOpenRequested();
          return;
        }
        if (distance > 12 || BUSY.has(this.phase)) return;
        const index = this.pick(event);
        if (index !== down.index) return;
        if (index !== null) {
          this.focus(index);
          if (!(this.revealed & (1 << index))) this.onReveal(index);
        } else if (this.focusedIndex !== null) this.focus(null);
      },
      cancel: event => { if (this.down?.id === event.pointerId) this.cancelGesture(); },
      blur: () => this.cancelGesture(),
      move: event => { this.canvas.style.cursor = ["idle", "sealed"].includes(this.phase) || this.pick(event) !== null ? "pointer" : "default"; },
      lost: event => { event.preventDefault(); this.cancelGesture(); this.contextLost = true; this.stop(); this.status(); },
      restored: () => { this.contextLost = false; this.status(); this.requestRender(); },
      visibility: () => { this.pageHidden = !!document.hidden; if (this.pageHidden) this.pause(); else this.resume(); },
    };
    this.bindings = [["pointerdown", "down"], ["pointerup", "up"], ["pointercancel", "cancel"], ["pointerleave", "cancel"], ["lostpointercapture", "cancel"], ["blur", "blur"], ["pointermove", "move"], ["webglcontextlost", "lost"], ["webglcontextrestored", "restored"]];
    for (const [event, key] of this.bindings) this.canvas.addEventListener(event, this.handlers[key]);
    window.addEventListener("resize", this.handlers.resize);
    window.addEventListener("blur", this.handlers.blur);
    document.addEventListener?.("visibilitychange", this.handlers.visibility);
    if (typeof ResizeObserver !== "undefined") { this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(this.canvas); }
  }

  pick(event) {
    if (!this.renderer || this.destroyed || this.hidden || BUSY.has(this.phase)) return null;
    const box = this.canvas.getBoundingClientRect(); if (!box.width || !box.height) return null;
    this.pointer.set((event.clientX - box.left) / box.width * 2 - 1, -(event.clientY - box.top) / box.height * 2 + 1);
    this.scene.updateMatrixWorld(true); this.camera.updateMatrixWorld(true); this.raycaster.setFromCamera(this.pointer, this.camera);
    for (const hit of this.raycaster.intersectObjects(this.cards.filter(card => card.root.visible).map(card => card.root), true)) {
      let node = hit.object;
      while (node && node.userData.packIndex == null) node = node.parent;
      if (node) return node.userData.packIndex;
    }
    return null;
  }

  resize() {
    this.cancelGesture();
    if (!this.renderer || this.destroyed) return;
    const r = this.canvas.getBoundingClientRect(), w = Math.max(1, r.width), h = Math.max(1, r.height);
    this.width = w; this.height = h; this.aspect = w / h;
    // CPU work is bounded to ~290k pixels, while pointer coordinates stay CSS-sized.
    const resolution = this.renderer.isSoftwareRenderer ? Math.min(1, Math.sqrt(290000 / (w * h))) : 1;
    this.renderer.setPixelRatio(this.renderer.isSoftwareRenderer ? 1 : Math.min(globalThis.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(Math.round(w * resolution), Math.round(h * resolution), false);
    this.camera.aspect = this.aspect;
    const visibleHeight = this.visibleHeight = this.aspect < .8 ? Math.max(9.15, 5.05 / this.aspect) : Math.max(5.15, 8.35 / this.aspect);
    this.giftScale = Math.min(1.55, visibleHeight / 4.0);
    const distance = visibleHeight / (2 * Math.tan(this.camera.fov * PI / 360));
    this.camera.position.set(0, .4, distance); this.camera.lookAt(0, 0, 0); this.camera.updateProjectionMatrix();
    this.layout(); this.focusStart = null;
    if (["sealed", "idle"].includes(this.phase)) this.poseSealed();
    if (!BUSY.has(this.phase) && !["sealed", "idle"].includes(this.phase)) for (const card of this.cards) this.applyCardPose(card, true);
    this.requestRender();
  }

  sound(cue) { if (!this.hidden && !this.pageHidden && !this.destroyed) this.onSound(cue); }
  queueTextureWarmup(){
    if(!this.renderer?.isSoftwareRenderer||!this.renderer.textureData||this.destroyed)return;
    this.warmQueue=[...new Set([this.textures?.back,...this.cards.map(card=>card.root.getObjectByName('saved-card-front')?.material.map)].filter(Boolean))];
    if(this.warmFrame!=null||this.hidden||this.pageHidden)return;
    const warm=()=>{this.warmFrame=null;if(this.destroyed||this.hidden||this.pageHidden)return;const map=this.warmQueue.shift();if(map?.image&&(map.image.width||map.image.naturalWidth))this.renderer.textureData(map);if(this.warmQueue.length)this.warmFrame=requestAnimationFrame(warm);};
    this.warmFrame=requestAnimationFrame(warm);
  }
  status() {
    this.onStatus({ available: !!this.renderer && !this.contextLost && !this.frameFault, renderer: this.rendererName,
      phase: this.phase, focusedIndex: this.focusedIndex, revealedCount: this.revealed.toString(2).replace(/0/g, "").length,
      reason: this.error || (this.contextLost ? "context-lost" : undefined) });
  }
  requestRender() {
    this.dirty = true;
    if (!this.renderer || this.destroyed || this.hidden || this.pageHidden || this.contextLost || this.frameFault || this.inFrame || this.raf !== null) return;
    this.raf = requestAnimationFrame(now => this.frame(now));
  }
  frame(now) {
    this.raf = null;
    if (this.destroyed || this.hidden || this.pageHidden || this.contextLost) return;
    const moving = BUSY.has(this.phase) || this.animations.size > 0 || this.focusStart != null;
    const interval = this.renderer.isSoftwareRenderer ? Math.max(1000 / 30, Math.min(1000 / 24, this.renderCost || 0)) : 1000 / 60;
    if (moving && now - this.lastFrame < interval) { this.requestRender(); return; }
    if (moving || this.dirty) {
      this.inFrame = true;
      try {
        this.animate(now);
        // Callbacks may dismiss the modal or replace its scene synchronously.
        if (this.destroyed || this.hidden || this.pageHidden) return;
        const start = performance.now(); this.renderer.render(this.scene, this.camera);
        this.renderCost = performance.now() - start;
        if(this.canvas.dataset){this.canvas.dataset.renderMs=String(Math.round(this.renderCost));if(moving&&Number.isFinite(this.lastFrame)){const interval=now-this.lastFrame;this.canvas.dataset.frameIntervalMs=String(Math.round(interval));if(interval>0&&interval<500)this.canvas.dataset.frameRate=String(Math.round(1000/interval));}}
        this.lastFrame = now; this.dirty = false;
      } catch (error) {
        this.frameFault = true; this.error = String(error?.message || error); this.cancelGesture(); this.stop(); this.status();
      } finally { this.inFrame = false; }
    }
    if (BUSY.has(this.phase) || this.animations.size || this.focusStart != null) this.requestRender();
  }
  stop() { if (this.raf !== null) cancelAnimationFrame(this.raf); this.raf = null; }
  pause() { this.cancelGesture(); if (this.pausedAt == null) this.pausedAt = performance.now(); this.stop();if(this.warmFrame!=null)cancelAnimationFrame(this.warmFrame);this.warmFrame=null; }
  resume() {
    if (this.hidden || this.pageHidden || this.destroyed) return;
    if (this.pausedAt != null) {
      const pause = performance.now() - this.pausedAt;
      if (this.startTime != null) this.startTime += pause;
      if (this.focusStart != null) this.focusStart += pause;
      for (const animation of this.animations.values()) animation.start += pause;
      for (const effect of this.revealLights || []) if (effect.start !== null) effect.start += pause;
      this.pausedAt = null;
    }
    this.requestRender();
    if(this.warmQueue?.length)this.queueTextureWarmup();
  }
  setHidden(value) {
    if (this.destroyed) return;
    this.hidden = !!value;
    if (this.hidden) { this.pause(); } else { this.resize(); this.resume(); }
  }
  setReduced(value) {
    if (this.destroyed) return;
    if (this.reduced !== !!value) this.cancelGesture();
    this.reduced = !!value;
    if (this.reduced) {
      if (BUSY.has(this.phase)) this.settle();
      this.focusStart = null; this.animations.clear(); this.clearLightEffects();
      for (const card of this.cards) { card.angle = this.revealed & (1 << card.index) ? 0 : PI; this.applyCardPose(card, true); }
      this.requestRender();
    }
  }
  clearCards() {
    this.clearLightEffects();
    for (const card of this.cards) { card.root.removeFromParent(); for (const resource of card.resources) resource.dispose(); }
    this.cards = []; this.focusStart = null;
  }
  dispose() {
    if (this.destroyed) return;
    this.destroyed = true; this.cancelGesture(); this.stop(); this.observer?.disconnect();
    if(this.warmFrame!=null)cancelAnimationFrame(this.warmFrame);this.warmFrame=null;this.warmQueue=[];
    if(this.giftImage){this.giftImage.onload=this.giftImage.onerror=null;this.giftImage=null;}
    if (this.handlers) {
      window.removeEventListener("resize", this.handlers.resize);
      window.removeEventListener("blur", this.handlers.blur);
      document.removeEventListener?.("visibilitychange", this.handlers.visibility);
      for (const [event, key] of this.bindings) this.canvas.removeEventListener(event, this.handlers[key]);
    }
    this.clearCards(); this.animations.clear();
    for (const resource of this.resources) resource.dispose(); this.resources.clear();
    this.textures?.dispose(); this.renderer?.dispose(); this.scene.clear();
    this.opening = null; this.down = null;
  }
}
