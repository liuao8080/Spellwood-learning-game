import {
  Scene, PerspectiveCamera, WebGLRenderer, Color, FogExp2,
  HemisphereLight, DirectionalLight, Vector2, Vector3, Raycaster,
  Group, Mesh, Box3, TorusGeometry, MeshStandardMaterial,
  MeshBasicMaterial, BufferGeometry, Float32BufferAttribute,
  Points, PointsMaterial, AdditiveBlending, PCFShadowMap, ACESFilmicToneMapping,
  SRGBColorSpace, MathUtils, CanvasTexture, Sprite, SpriteMaterial,
  IcosahedronGeometry,
  CubicBezierCurve3, TubeGeometry, ConeGeometry, PlaneGeometry,
} from "three";
import { createModelLibrary } from "./models.mjs";
import { createHeroModel } from "./hero-models.mjs";
import { DEFAULT_HERO_SKIN, getHeroSkin } from "../hero-skins.mjs";
import { CardTextures } from "./card-textures.mjs";
import { BoardInput } from "./board-input.mjs";
import { CARD } from "../cards.mjs";
import { SoftwareRenderer } from "./software-renderer.mjs";
import { targetPreview } from "./targeting.mjs";
import { createElementalCast, createElementalBurst, createBarrierBadge } from "./elemental-effects.mjs";
import { AdaptiveQualityController } from "./adaptive-quality.mjs";
import { createEffectWarmup, primeHiddenEffectCanvas } from "./effect-warmup.mjs";
import { playMeleeSequence } from "./melee-sequence.mjs";

const lerp = MathUtils.lerp;
const smooth = (v) => 1 - (1 - v) ** 3;
const easeInOut = (v) => v < .5 ? 4 * v * v * v : 1 - (-2 * v + 2) ** 3 / 2;
const slots = [-4.8, -1.6, 1.6, 4.8];
const SELF_HERO_X = -6.2;
const colorFor = { damage: 0xffb264, heal: 0x92edac, shield: 0x8bdcff, grow: 0xe7ef98 };

/** Persistent perspective scene. Rule state belongs to the server, not this class. */
export class ArenaScene {
  constructor({ canvas, onPick = () => {}, onInspect = () => {}, getInputRevision = null, onAnchors = () => {}, onStatus = () => {}, onSound = () => {}, onHandDraw = () => {}, externalHand = false, reduced = false, quality = "medium", heroSkins = {} }) {
    this.canvas = canvas; this.onPick = onPick; this.onInspect = onInspect; this.getInputRevision = getInputRevision; this.inputRevision = 0; this.onAnchors = onAnchors; this.onStatus = onStatus;
    this.reduced = reduced; this.quality = quality;
    this.heroSkins = { self: getHeroSkin(heroSkins.self).id, opponent: getHeroSkin(heroSkins.opponent).id };
    this.onSound = onSound;
    this.externalHand = externalHand; this.onHandDraw = onHandDraw;
    this.units = new Map(); this.contactShadows = new Map(); this.cards = []; this.enemyCards = []; this.heroes = []; this.decks = []; this.jobs = new Set();
    this.floatLanes = new Map();
    this.barriers = new Map(); this.presentedEvents = new Set();
    this.targetRings = new Map(); this.aimObjects = []; this.targetKey = null;
    this.pointer = new Vector2(); this.raycaster = new Raycaster(); this.pickables = [];
    this.running = false; this.destroyed = false; this.hidden = false; this.selected = null;
    this.viewerSeat = 0; this.snapshot = null; this.lastEventId = null; this.generation = 0;
    this.lastTime = performance.now(); this.metricStart = this.lastTime; this.metricFrames = 0;
    this.cameraLook = new Vector3(0, 0, .2);
    this.scene = new Scene(); this.scene.background = new Color(0x071b20);
    this.scene.fog = new FogExp2(0x071b20, .018);
    this.camera = new PerspectiveCamera(36, 1, .1, 90);
    this.camera.position.set(0, 16.4, 18.6); this.camera.lookAt(this.cameraLook);
    try {
      this.renderer = this.createRenderer(canvas, quality);
      this.renderer.outputColorSpace = SRGBColorSpace;
      this.renderer.toneMapping = ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.13;
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = PCFShadowMap;
    } catch (e) {
      this.error = String(e?.message || "WebGL2 unavailable");
      canvas.dataset.renderer = "unavailable";
      this.onStatus({ available: false, renderer: "unavailable", reason: this.error });
      return;
    }
    this.rendererName = this.renderer.isSoftwareRenderer ? "CPU · 兼容三维" : "WebGL2";
    canvas.dataset.renderer = this.rendererName;
    const ambient = new HemisphereLight(0xc5e6ec, 0x314d31, 1.8);
    this.scene.add(ambient);
    const sun = new DirectionalLight(0xffe1ad, 4.2);
    sun.position.set(-7, 14, 9); sun.castShadow = true;
    sun.shadow.mapSize.set(quality === "high" ? 2048 : 1024, quality === "high" ? 2048 : 1024);
    Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 10, bottom: -10, near: 1, far: 40 });
    sun.shadow.bias = -.0003; sun.shadow.normalBias = .025;
    this.shadowLight = sun;
    this.adaptiveQuality = new AdaptiveQualityController({ baseShadowSize: quality === "high" ? 2048 : 1024 });
    this.appliedQuality = this.adaptiveQuality.profile;
    this.scene.add(sun, sun.target);
    const rim = new DirectionalLight(0x85b8cf, 2.2); rim.position.set(6, 7, -10); this.scene.add(rim);
    this.textures = new CardTextures({ onChange: () => this.requestRender() });
    const glowCanvas = document.createElement("canvas"); glowCanvas.width = glowCanvas.height = 64;
    const glow = glowCanvas.getContext("2d"), gradient = glow.createRadialGradient(32, 32, 0, 32, 32, 31);
    gradient.addColorStop(0, "#fff"); gradient.addColorStop(.17, "rgba(255,255,255,.95)"); gradient.addColorStop(.48, "rgba(255,255,255,.35)"); gradient.addColorStop(1, "rgba(255,255,255,0)");
    glow.fillStyle = gradient; glow.fillRect(0, 0, 64, 64); this.glowTexture = new CanvasTexture(glowCanvas);
    if (this.renderer.isSoftwareRenderer) {
      const shadowCanvas = document.createElement("canvas"); shadowCanvas.width = shadowCanvas.height = 128;
      const context = shadowCanvas.getContext("2d"), shade = context.createRadialGradient(64, 64, 8, 64, 64, 64);
      shade.addColorStop(0, "rgba(2,10,8,.42)"); shade.addColorStop(.5, "rgba(2,10,8,.23)"); shade.addColorStop(1, "rgba(2,10,8,0)");
      context.fillStyle = shade; context.fillRect(0, 0, 128, 128);
      this.contactShadowTexture = new CanvasTexture(shadowCanvas);
      this.contactShadowGeometry = new PlaneGeometry(2.2, 1.65);
    }
    this.library = createModelLibrary({ quality: this.quality, arenaSurface: this.renderer.isSoftwareRenderer ? 'plain' : 'stone' });
    canvas.dataset.arenaSurface = this.renderer.isSoftwareRenderer ? 'plain' : 'stone';
    this.arena = this.library.createArena({ seed: 27, slotsPerSide: 4 });
    this.arena.root.traverse(object => { object.userData.cpuStatic = true; });
    this.scene.add(this.arena.root);
    this.temporary = new Group(); this.scene.add(this.temporary);
    this.makeHeroes(); this.makeDecks(); this.makeFireflies();
    this.bind(); this.resize(); this.showGallery(); this.start();
    this.prepareEffectPrograms();
    this.onStatus({ available: true, renderer: this.rendererName, quality: this.quality });
  }

  createRenderer(canvas, quality) {
    try { return new WebGLRenderer({ canvas, antialias: quality !== "low", alpha: false, powerPreference: "default" }); }
    catch (error) {
      console.warn("WebGL unavailable; using the game's CPU compatibility renderer", error.message);
      this.quality = "low";
      return new SoftwareRenderer(canvas);
    }
  }

  prepareEffectPrograms() {
    if(this.renderer.isSoftwareRenderer||typeof this.renderer.compileAsync!=="function")return;
    const epoch=this.effectWarmupEpoch=(this.effectWarmupEpoch||0)+1,started=performance.now();
    this.canvas.dataset.effectWarmup="pending";
    this.canvas.dataset.effectWarmupDraw="pending";
    // Detached resources are compiled before use. A first draw is allowed only
    // while the actual gameplay canvas is hidden; it is never evidence footage.
    this.effectWarmupPromise=Promise.resolve().then(async()=>{
      if(this.destroyed||this.contextLost||epoch!==this.effectWarmupEpoch)return;
      this.effectWarmup ||= createEffectWarmup();
      for(const texture of this.effectWarmup.textures)this.renderer.initTexture?.(texture);
      const handle=this.effectWarmup;
      const timer=setTimeout(()=>{
        if(this.destroyed||epoch!==this.effectWarmupEpoch)return;
        this.effectWarmupEpoch++;handle.dispose();this.effectWarmup=null;
        this.canvas.dataset.effectWarmup="failed";
      },10000);
      try {await this.renderer.compileAsync(handle.root,this.camera,this.scene);}
      finally {clearTimeout(timer);}
      if(this.destroyed||this.contextLost||epoch!==this.effectWarmupEpoch)return;
      this.canvas.dataset.effectWarmup="ready";
      this.canvas.dataset.effectWarmupMs=String(Math.round(performance.now()-started));
      this.primeHiddenEffects();
    }).catch(()=>{
      if(!this.destroyed&&epoch===this.effectWarmupEpoch)this.canvas.dataset.effectWarmup="failed";
    });
  }

  primeHiddenEffects() {
    if(this.destroyed||this.contextLost||!this.effectWarmup||this.canvas.dataset.effectWarmup!=="ready"||["performed","failed"].includes(this.canvas.dataset.effectWarmupDraw))return;
    try {
      const started=performance.now();
      const result=primeHiddenEffectCanvas({renderer:this.renderer,scene:this.scene,camera:this.camera,canvas:this.canvas,handle:this.effectWarmup});
      this.canvas.dataset.effectWarmupDraw=result.status;
      this.canvas.dataset.effectWarmupDrawMs=String(Math.round(performance.now()-started));
    } catch {this.canvas.dataset.effectWarmupDraw="failed";}
  }

  makeHeroes() {
    for (const side of [0, 1]) {
      this.heroes.push(this.createHero(side, this.heroSkins?.[side ? "opponent" : "self"] || DEFAULT_HERO_SKIN));
    }
  }

  createHero(side, skinId) {
    // Low LOD is deliberate on both renderers: two heroes cost <=3,664 triangles.
    const model = createHeroModel(skinId, { quality: "low", seat: side }), root = model.root;
    root.position.set(side ? 0 : SELF_HERO_X * (this.boardWidthScale || 1), .1, side ? -4.25 : 4.5);
    root.rotation.y = side ? -.08 : .16;
    root.userData.pick = { kind: "hero", relativeSeat: side };
    model.pickProxy.userData.pick = root.userData.pick;
    this.scene.add(root);
    root.updateMatrixWorld(true);
    return { root, model, skinId: model.skinId, relativeSeat: side, poses: {}, poseTokens: {} };
  }

  /** Cosmetic-only. Call with room-frozen IDs after mapping absolute seats to self/opponent. */
  setHeroSkins(skins = {}) {
    if (this.destroyed) return;
    this.heroSkins ||= { self: DEFAULT_HERO_SKIN, opponent: DEFAULT_HERO_SKIN };
    for (const [side, key] of [[0, "self"], [1, "opponent"]]) {
      if (!Object.hasOwn(skins, key)) continue;
      const id = getHeroSkin(skins[key]).id;
      this.heroSkins[key] = id;
      const old = this.heroes[side];
      if (!old || old.skinId === id) continue;
      old.poseTokens = {}; old.poses = {}; old.model.cancel(); old.model.dispose();
      this.heroes[side] = this.createHero(side, id);
    }
    this.fitHeroSeats();
    this.pickables = [...this.units.values()].map(x => x.model.root).concat(this.cards.map(x => x.model.root), this.heroes.map(x => x.root));
    this.requestRender();
  }

  fitHeroSeats() {
    if (!this.width || !this.height) return;
    for (const hero of this.heroes) hero.root.scale.setScalar(1);
    this.heroes[0].root.position.set(SELF_HERO_X*(this.boardWidthScale||1),.1,4.5);
    this.heroes[1].root.position.set(this.compactLandscape?-SELF_HERO_X*(this.boardWidthScale||1):0,.1,this.compactLandscape?4.5:-4.25);
    if (this.portraitHeroDock) {
      this.heroes[0].root.position.set(0, .1, this.portraitHeroDock);
      this.heroes[0].root.scale.setScalar(this.splitFrontRow ? .78 : .85);
      if (this.splitFrontRow) {
        this.heroes[1].root.position.set(0,.1,-6.1);
        this.heroes[1].root.scale.setScalar(.78);
      } else this.heroes[1].root.position.set(0,.1,-5.5);
    }
    this.camera.updateMatrixWorld(true);
    for (const hero of this.heroes) for (let attempt = 0; attempt < 2; attempt++) {
      hero.root.updateMatrixWorld(true);
      const bounds = hero.model.bounds;
      let left = Infinity, right = -Infinity;
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
        const screen = this.project(new Vector3(x, y, z).applyMatrix4(hero.root.matrixWorld));
        left = Math.min(left, screen.x); right = Math.max(right, screen.x);
      }
      const shift = Math.max(0, 12 - left) - Math.max(0, right - (this.width - 12));
      if (!shift) break;
      const center = hero.root.position.clone().project(this.camera); center.x += shift * 2 / this.width;
      hero.root.position.x = center.unproject(this.camera).x;
    }
    for (const hero of this.heroes) hero.root.updateMatrixWorld(true);
  }

  heroFor(key) {
    if (!String(key).startsWith("hero:")) return null;
    const seat = Number(String(key).slice(5));
    return Number.isInteger(seat) && seat >= 0 && seat <= 1 ? this.heroes[seat === this.viewerSeat ? 0 : 1] : null;
  }

  heroPose(key, action, duration = 650) {
    const hero = this.heroFor(key);
    if (!hero || !this.renderer || this.reduced) return Promise.resolve();
    const field = `${action}Progress`, token = {};
    hero.poseTokens[field] = token;
    return this.addJob(duration, t => {
      if (hero.poseTokens[field] === token && !hero.model.disposed) hero.poses[field] = t;
    }, () => {
      if (hero.poseTokens[field] !== token) return;
      delete hero.poseTokens[field]; delete hero.poses[field];
      hero.model.applyPose(hero.poses);
    });
  }

  makeFireflies() {
    const positions = [];
    for (let i = 0; i < 38; i++) {
      const a = i * 2.39996, r = 9 + (i % 4) * .5;
      positions.push(Math.cos(a) * r, .8 + (i % 7) * .49, Math.sin(a) * r * .65);
    }
    const g = new BufferGeometry(); g.setAttribute("position", new Float32BufferAttribute(positions, 3));
    this.fireflies = new Points(g, new PointsMaterial({ color: 0xc4e49d, size: .07, transparent: true, opacity: .6, blending: AdditiveBlending, depthWrite: false }));
    this.scene.add(this.fireflies);
  }

  makeDecks() {
    for (const side of [0, 1]) {
      const root = new Group(), cards = [];
      for (let i = 0; i < 4; i++) {
        const card = this.library.createCard({ frontTexture: this.textures.back, backTexture: this.textures.back });
        card.root.position.y = .1 + i * .082;
        card.root.rotation.set(-Math.PI / 2, 0, (i % 2 ? -1 : 1) * .025);
        root.add(card.root); cards.push(card);
      }
      root.position.set(side ? -6.8 : 6.8, .1, side ? -4.35 : 4.35);
      this.scene.add(root); this.decks.push({ root, cards, side });
    }
  }

  bind() {
    this.handlers = {
      resize: () => this.resize(),
      move: (e) => {
        const r = this.canvas.getBoundingClientRect();
        this.pointer.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
        this.hover = this.pick(e); this.canvas.style.cursor = this.hover ? "pointer" : "default"; this.requestRender();
      },
      leave: () => { this.pointer.set(0, 0); this.hover = null; this.requestRender(); },
      contextlost: (e) => { e.preventDefault(); this.contextLost = true; this.effectWarmupEpoch=(this.effectWarmupEpoch||0)+1;this.effectWarmup?.dispose();this.effectWarmup=null;this.cancel(); this.stop(); this.onStatus({ available: false, renderer: "WebGL2", reason: "context-lost" }); },
      contextrestored: () => { if (!this.destroyed) { this.contextLost = false; this.frameFault = false; this.prepareEffectPrograms(); this.start(); this.onStatus({ available: true, renderer: "WebGL2", restored: true }); } },
    };
    this.boardInput = new BoardInput({element:this.canvas, pick:event=>this.pick(event),
      getRevision:()=>this.getInputRevision?.() ?? this.inputRevision,
      isEnabled:()=>!!this.renderer && !this.destroyed && !this.hidden && !this.contextLost && !this.frameFault && this.snapshot?.phase === "playing",
      onActivate:intent=>this.onPick(intent), onInspect:intent=>this.onInspect(intent)});
    window.addEventListener("resize", this.handlers.resize);
    for (const [event, fn] of [["pointermove", "move"], ["pointerleave", "leave"], ["webglcontextlost", "contextlost"], ["webglcontextrestored", "contextrestored"]]) this.canvas.addEventListener(event, this.handlers[fn]);
  }

  pick(event) {
    if (!this.renderer || this.destroyed) return null;
    const r = this.canvas.getBoundingClientRect();
    const p = new Vector2((event.clientX - r.left) / r.width * 2 - 1, -(event.clientY - r.top) / r.height * 2 + 1);
    this.raycaster.setFromCamera(p, this.camera);
    for (const hit of this.raycaster.intersectObjects(this.pickables, true)) {
      let item = hit.object;
      while (item && !item.userData.pick) item = item.parent;
      if (item?.userData.pick) return item.userData.pick;
    }
    return null;
  }

  resize() {
    this.boardInput?.cancel();
    if (!this.renderer) return;
    const r = this.canvas.getBoundingClientRect(), w = Math.max(1, r.width), h = Math.max(1, r.height);
    this.width = w; this.height = h;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, this.quality === "low" ? 1 : 1.5) * (this.appliedQuality?.pixelScale || 1));
    const scale = this.renderer.isSoftwareRenderer ? Math.min(1, Math.sqrt(720000 / (w * h))) : 1;
    this.renderer.setSize(Math.round(w * scale), Math.round(h * scale), false); this.camera.aspect = w / h;
    const compactLandscape=this.externalHand && w/h>2.2 && h<240;
    this.compactLandscape=compactLandscape;
    this.splitFrontRow=this.externalHand && w<600 && !compactLandscape && h<400;
    this.portraitHeroDock=this.externalHand && w<600 && !compactLandscape ? this.splitFrontRow?5.2:6.35 : null;
    const rowDepth=compactLandscape||this.splitFrontRow?2.8:2;
    this.rowDepth=rowDepth;
    this.enemyRowDepth=this.splitFrontRow?3.8:this.portraitHeroDock?3.2:rowDepth;
    const narrow = w < 600, portrait = !narrow && this.camera.aspect < 1.1;
    this.boardWidthScale = narrow ? .72 : portrait ? .9 : 1;
    if(this.externalHand && h < 270) this.boardWidthScale = narrow ? 1.2 : 1.35;
    this.unitScale = narrow ? .95 : portrait ? 1.25 : 1.3;
    this.arena.root.scale.x = this.boardWidthScale;
    this.heroes[0].root.position.x = SELF_HERO_X * this.boardWidthScale;
    for (const deck of this.decks) deck.root.position.x = (deck.side ? -6.8 : 6.8) * this.boardWidthScale;
    const fit = Math.max(1, (narrow ? .76 : portrait ? 1.22 : 1.48) / this.camera.aspect);
    const closeBoard = this.externalHand ? h < 270 ? .76 : .91 : 1;
    this.cameraBase = new Vector3(0, (this.externalHand ? 13.8 : 16.4) * fit * closeBoard, (this.externalHand ? 15.8 : 18.6) * fit * closeBoard);
    // A taller overhead view separates complete figures from the next row's
    // hit badges. Large hand cards keep their existing readable pixel size.
    this.cameraLook.set(0,0,compactLandscape?1.1:.2);
    if(compactLandscape)this.cameraBase.set(0,14,9);
    this.camera.position.copy(this.cameraBase); this.camera.lookAt(this.cameraLook); this.camera.updateProjectionMatrix();
    if(this.externalHand){
      this.camera.updateMatrixWorld(true);
      const center=new Vector3(0,.08,-2).project(this.camera),next=new Vector3(3.2,.08,-2).project(this.camera);
      const projectedStep=Math.abs(next.x-center.x)*w/2;
      this.boardWidthScale=Math.max(this.boardWidthScale,Math.min(62,(w-56)/3.8)/Math.max(1,projectedStep));
      this.arena.root.scale.x=this.boardWidthScale;this.heroes[0].root.position.x=SELF_HERO_X*this.boardWidthScale;
      for(const deck of this.decks)deck.root.position.x=(deck.side?-6.8:6.8)*this.boardWidthScale;
    }
    // Keep a real space for the hero on short portrait screens. Move figures,
    // projected controls and carved slot rings together, never just the DOM.
    this.frontSlotXs = this.splitFrontRow ? [.11875,.3125,.6875,.88125].map(fraction => {
      const x=w*fraction;
      const plane = new Vector3(0,.23,rowDepth+.63).project(this.camera);
      plane.x=x/w*2-1;
      return plane.unproject(this.camera).x;
    }) : null;
    this.backSlotXs = this.splitFrontRow ? [.11875,.3125,.6875,.88125].map(fraction => {
      const x=w*fraction;
      const plane = new Vector3(0,.23,-this.enemyRowDepth+.63).project(this.camera);
      plane.x=x/w*2-1;
      return plane.unproject(this.camera).x;
    }) : null;
    const arenaKey=JSON.stringify([rowDepth,this.portraitHeroDock,this.frontSlotXs,this.backSlotXs]);
    if(this.arenaLayoutKey!==arenaKey){
      this.arenaLayoutKey=arenaKey;
      this.arena.root.removeFromParent();this.arena.dispose();
      this.arena=this.library.createArena({seed:27,slotsPerSide:4,rowDepth:rowDepth+.12,
        backRowDepth:this.enemyRowDepth+.12,
        frontSlots:this.frontSlotXs?.map(x=>x/this.boardWidthScale),
        backSlots:this.backSlotXs?.map(x=>x/this.boardWidthScale),heroDockZ:this.portraitHeroDock});
      this.arena.root.scale.x=this.boardWidthScale;
      this.arena.root.traverse(object=>{object.userData.cpuStatic=true;});
      this.scene.add(this.arena.root);
    }
    this.fitHeroSeats();
    if (this.snapshot) { this.handKey = null; this.enemyHandCount=null; this.setBattle(this.snapshot, this.viewerSeat); }
    this.requestRender();
  }

  showGallery() {
    if (!this.renderer) return;
    this.setBattle({ active: 0, phase: "gallery", players: [
      { hp: 18, hand: ["fox", "turtle", "owl", "spark", "bloom"], board: [{ uid: "preview-fox", cardId: "fox", atk: 2, hp: 2, ready: true }, { uid: "preview-turtle", cardId: "turtle", atk: 1, hp: 5, ready: false }] },
      { hp: 18, handCount: 4, board: [{ uid: "preview-owl", cardId: "owl", atk: 3, hp: 3, ready: false }] },
    ] }, 0);
  }

  setBattle(state, viewerSeat = 0) {
    if (!this.renderer || this.destroyed) return;
    this.boardInput?.cancel(); this.inputRevision++;
    this.clearAim();
    this.snapshot = state; this.viewerSeat = viewerSeat;
    const wanted = new Set();
    for (const [seat, player] of state.players.entries()) {
      const relative = seat === viewerSeat ? 0 : 1;
      const board = player.board || [];
      board.forEach((unit, i) => {
        wanted.add(unit.uid);
        let item = this.units.get(unit.uid);
        if (!item) {
          const model = this.library.createCreature({ species: unit.cardId, side: relative, variantSeed: unit.uid });
          item = { model, unit, seat, base: new Vector3(), born: performance.now() };
          model.root.userData.pick = { kind: "unit", uid: unit.uid, seat };
          // Both collectible figures present a readable three-quarter face.
          // Combat travel, rather than a permanent back-facing pose, conveys sides.
          model.root.rotation.y = relative ? .12 : -.12;
          model.root.scale.setScalar(this.scaleFor(unit.cardId));
          this.scene.add(model.root); this.units.set(unit.uid, item);
          if (this.contactShadowTexture) {
            const shadow = new Mesh(this.contactShadowGeometry, new MeshBasicMaterial({ map: this.contactShadowTexture, transparent: true, opacity: .85, depthWrite: false }));
            shadow.rotation.x = -Math.PI / 2; this.scene.add(shadow); this.contactShadows.set(unit.uid, shadow);
          }
        }
        item.unit = unit; item.seat = seat;
        this.restoreFade(item);
        const slot = state.phase === "gallery" && this.width > 900 ? (relative ? 3.2 : 1.6 + i * 3.2) : slots[i];
        item.base.set(slot * (this.boardWidthScale || 1), .08, relative ? -(this.enemyRowDepth||2) : (this.rowDepth||2));
        if (!relative && this.frontSlotXs) item.base.x=this.frontSlotXs[i];
        if (relative && this.backSlotXs) item.base.x=this.backSlotXs[i];
        if (!item.animating) item.model.root.position.copy(item.base);
        if (!item.animating) item.model.root.scale.setScalar(this.scaleFor(unit.cardId));
        item.model.setVisualState?.({ selected: this.selected?.uid === unit.uid, exhausted: !unit.ready, guarded: CARD[unit.cardId]?.keyword === "guard", damaged: unit.hp < (unit.maxHp || CARD[unit.cardId]?.hp || 1) });
        if (unit.shield && !this.barriers.has(unit.uid)) {
          const badge = createBarrierBadge(); item.model.root.add(badge.root); this.barriers.set(unit.uid, badge);
        } else if (!unit.shield && this.barriers.has(unit.uid)) { this.barriers.get(unit.uid).dispose(); this.barriers.delete(unit.uid); }
      });
    }
    for (const [uid, item] of this.units) {
      if (!wanted.has(uid) && !item.animating) {
        this.scene.remove(item.model.root); item.model.dispose?.(); this.units.delete(uid);
        this.barriers.get(uid)?.dispose(); this.barriers.delete(uid);
        const shadow = this.contactShadows.get(uid); if (shadow) { shadow.removeFromParent(); shadow.material.dispose(); this.contactShadows.delete(uid); }
      }
    }
    this.syncHand(state.players[viewerSeat]?.hand || []);
    this.syncEnemyHand(state.players[1 - viewerSeat]?.handCount ?? state.players[1 - viewerSeat]?.hand?.length ?? 0);
    for (const deck of this.decks) {
      const seat = deck.side ? 1 - viewerSeat : viewerSeat;
      deck.root.visible = (state.players[seat]?.deckCount ?? 1) > 0;
    }
    this.pickables = [...this.units.values()].map((x) => x.model.root).concat(this.cards.map((x) => x.model.root), this.heroes.map((x) => x.root));
    this.requestRender();
  }

  handLayout(index, total, opponent = false) {
    const middle = index - (total - 1) / 2;
    return {
      position: opponent ? new Vector3(middle * .79, 1.15 - Math.abs(middle) * .02, -5.45)
        : new Vector3(middle * 1.63 * (this.boardWidthScale || 1), .72 - Math.abs(middle) * .035, 6.5 + middle * .22),
      rotation: new Vector3(opponent ? -.45 : -.91, middle * (opponent ? -.025 : -.017), middle * (opponent ? -.04 : -.035)),
      scale: opponent ? .83 : 1.78,
    };
  }

  setFinishes(value = {}) {
    const key = JSON.stringify(value); if (key === this.finishesKey) return;
    this.finishesKey=key; this.finishes={...value}; this.handKey=null;
    if (this.snapshot) this.syncHand(this.snapshot.players[this.viewerSeat]?.hand || []);
    this.requestRender();
  }

  syncHand(hand) {
    if (this.externalHand) hand = [];
    if (hand.join("|") === this.handKey) return;
    for (const item of this.cards) { this.scene.remove(item.model.root); item.model.dispose?.(); }
    this.cards = []; this.handKey = hand.join("|");
    hand.forEach((id, index) => {
      const model = this.library.createCard({ frontTexture: this.textures.get(id, this.finishes?.[id]), backTexture: this.textures.back });
      const layout = this.handLayout(index, hand.length), base = layout.position;
      model.root.position.copy(base); model.root.scale.setScalar(layout.scale);
      model.root.rotation.set(...layout.rotation.toArray());
      model.root.userData.pick = { kind: "card", index, cardId: id };
      this.scene.add(model.root); this.cards.push({ model, base, index, cardId: id });
    });
  }

  syncEnemyHand(count) {
    if (count === this.enemyHandCount) return;
    for (const card of this.enemyCards) card.dispose?.();
    this.enemyCards = []; this.enemyHandCount = count;
    for (let i = 0; i < Math.min(7, count); i++) {
      const card = this.library.createCard({ frontTexture: this.textures.back, backTexture: this.textures.back });
      const layout = this.handLayout(i, count, true);
      card.root.position.copy(layout.position);
      card.root.scale.setScalar(layout.scale); card.root.rotation.set(...layout.rotation.toArray());
      if(this.splitFrontRow){card.root.position.set((i-(count-1)/2)*.6,.3,-7.7);card.root.scale.setScalar(.55);}
      else if(this.portraitHeroDock){card.root.position.set((i-(count-1)/2)*.65,1.05,-7);card.root.scale.setScalar(.75);}
      this.scene.add(card.root); this.enemyCards.push(card);
    }
  }

  select(selection) {
    this.selected = selection;
    if (this.snapshot) this.setBattle(this.snapshot, this.viewerSeat);
  }

  hoverTarget(item) { this.hover = item; this.requestRender(); }

  clearAim() {
    for (const mesh of this.aimObjects) { this.scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); }
    this.aimObjects = []; this.targetKey = null;
  }

  updateTargets() {
    let preview = targetPreview(this.snapshot, this.viewerSeat, this.selected);
    const own = this.snapshot?.players[this.viewerSeat];
    if (this.selected?.kind === "card" && Array.isArray(own?.legalCardTargets)) {
      const legal = this.snapshot.phase === "playing" && this.snapshot.active === this.viewerSeat && own.controller !== "proxy"
        ? own.legalCardTargets.find(entry => entry.index === this.selected.index) : null;
      preview = { source: `hero:${this.viewerSeat}`, targets: (legal?.targets || [])
        .map(value => value?.target === "hero" && [0, 1].includes(value.seat) ? `hero:${value.seat}` : value?.target)
        .filter(key => typeof key === "string" && (this.units.has(key) || this.heroFor(key))) };
    }
    const wanted = new Set(preview.targets);
    for (const [key, ring] of this.targetRings) if (!wanted.has(key)) { this.scene.remove(ring); ring.geometry.dispose(); ring.material.dispose(); this.targetRings.delete(key); }
    const hovered = this.hover?.kind === "unit" ? this.hover.uid : this.hover?.kind === "hero" ? `hero:${this.hover.relativeSeat ? 1 - this.viewerSeat : this.viewerSeat}` : null;
    for (const key of wanted) {
      const hero = key.startsWith("hero:");
      let ring = this.targetRings.get(key);
      if (!ring) { ring = new Mesh(new TorusGeometry(hero ? 1.18 : .72, .045, 7, 40), new MeshBasicMaterial({ color: 0xffdf8c, transparent: true, opacity: .65, depthWrite: false })); ring.rotation.x = -Math.PI / 2; this.scene.add(ring); this.targetRings.set(key, ring); }
      const point = this.anchor(key, hero ? .47 : .04); if (point) ring.position.copy(point);
      ring.material.opacity = key === hovered ? .98 : .48;
      ring.scale.setScalar(key === hovered ? 1.12 : 1);
    }
    const key = wanted.has(hovered) ? `${preview.source}>${hovered}` : null;
    if (key === this.targetKey) return;
    this.clearAim(); if (!key) return;
    const from = this.aimAnchor(preview.source, false), to = this.aimAnchor(hovered, true); if (!from || !to) return;
    this.targetKey = key;
    const curve = this.aimCurve(from, to, preview.source, hovered);
    const line = curve ? new Mesh(new TubeGeometry(curve, 24, .055, 6, false), new MeshBasicMaterial({ color: 0xffde82, transparent: true, opacity: .9, depthWrite: false })) : null;
    const arrow = new Mesh(new ConeGeometry(.22, .52, 8), new MeshBasicMaterial({ color: 0xffdf8c }));
    const tangent = curve ? curve.getTangent(1).normalize() : new Vector3(0, -1, 0);
    arrow.position.copy(to).addScaledVector(tangent, -.26); arrow.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), tangent);
    this.aimObjects = line ? [line, arrow] : [arrow]; this.scene.add(...this.aimObjects);
  }

  aimCurve(from, to, sourceKey, targetKey) {
    // Pick a short readable arc that avoids the projected face area of bystanders.
    // The path is still made of world-space geometry and never changes targeting.
    this.camera.updateMatrixWorld(true);
    const obstacles = [], faces = [];
    for (const [uid, item] of this.units) {
      if (uid === sourceKey || uid === targetKey) continue;
      const box = new Box3().setFromObject(item.model.root), points = [];
      item.model.root.traverse(object => { if (object.isMesh && /head|face|seed/.test(object.name) && object.material.visible !== false) faces.push(object); });
      for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) points.push(this.project(new Vector3(x, y, z)));
      const left = Math.min(...points.map(p => p.x)), right = Math.max(...points.map(p => p.x));
      const top = Math.min(...points.map(p => p.y)), bottom = Math.max(...points.map(p => p.y));
      // Avoid the central facial silhouette without routing around every ear,
      // antler and empty corner of a large bounding box.
      obstacles.push({ left: left + (right - left) * .15, right: right - (right - left) * .15,
        top: top + (bottom - top) * .2, bottom: top + (bottom - top) * .72 });
    }
    const candidates = [];
    for (const lateral of [0, 1.8, -1.8, 3, -3]) for (const lift of [1.1, 2.0, 3.2]) {
      const control = from.clone().lerp(to, .5); control.y = Math.max(from.y, to.y) + lift; control.x += lateral;
      candidates.push({ control, extra: Math.abs(lateral) * 1.1 });
    }
    if (String(sourceKey).startsWith("hero:")) for (const rise of [3.5, 5.5]) for (const outward of [0, .8]) {
      const control = from.clone().add(new Vector3(Math.sign(from.x || -1) * outward, rise, 0));
      candidates.push({ control, extra: .2 + outward });
    }
    const ranked = [];
    for (const { control, extra } of candidates) {
      const curve = new CubicBezierCurve3(from, control, to.clone().add(new Vector3(0, .9, 0)), to);
      let score = curve.getLength() * .4 + extra;
      for (let i = 2; i < 29; i++) {
        const point = this.project(curve.getPoint(i / 30));
        for (const rect of obstacles) if (point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom) score += 10;
        if (point.x < 12 || point.x > this.width - 12 || point.y < 72 || point.y > this.height - 24) score += 12;
      }
      ranked.push({ curve, score });
    }
    ranked.sort((a, b) => a.score - b.score);
    const camera = this.camera.getWorldPosition(new Vector3()), ray = new Raycaster();
    for (const { curve } of ranked) {
      let clear = true;
      for (let i = 1; i < 128 && faces.length; i++) {
        const point = curve.getPoint(i / 128), delta = point.clone().sub(camera);
        // Only reject a visible line in front of a bystander's real head mesh.
        // A line behind an object remains naturally occluded by depth testing.
        ray.set(camera, delta.clone().normalize()); ray.near = Math.max(0, delta.length() - .03);
        if (ray.intersectObjects(faces, false).length) { clear = false; break; }
      }
      if (clear) return curve;
    }
    // A clear target ring and arrow are preferable to a line across a face.
    return null;
  }

  aimAnchor(key, target) {
    const item = this.units.get(key) || this.heroFor(key);
    if (!item) return this.anchor(key, target ? 2.0 : 1.2);
    // Keep the arrow tip above each species, including the taller rabbit/stag.
    // Anchors are owned by the model rig, so scale and side pose stay coherent.
    const anchor = item.model.anchors?.[target ? "label" : "projectile"];
    if (!anchor) return this.anchor(key, target ? 2.6 : 1.2);
    const point = anchor.getWorldPosition(new Vector3());
    if (target) point.y += .16;
    return point;
  }

  scaleFor(cardId) { return (this.unitScale || 1.3) * ({ dragon: .91, phoenix: .84, crane: .93, unicorn: .93 }[cardId] || 1); }

  anchor(key, y = 1) {
    if (String(key).startsWith("hero:")) {
      return this.heroFor(key)?.root.position.clone().add(new Vector3(0, y, 0));
    }
    const item = this.units.get(key);
    return item?.model.root.position.clone().add(new Vector3(0, y, 0));
  }

  project(point) {
    const p = point.clone().project(this.camera);
    return { x: (p.x + 1) * this.width / 2, y: (1 - p.y) * this.height / 2, visible: p.z > -1 && p.z < 1 };
  }

  labelPoint(item) {
    const point=this.project(item.model.root.position.clone().add(new Vector3(0,.15,.63)));
    if(this.externalHand){
      point.x=MathUtils.clamp(point.x,30,Math.max(30,this.width-30));
      // The transparent hand canvas overlaps the field by 10px in landscape.
      // Keep the complete 44px control above it, with a small touch gutter.
      const nearLimit=Math.max(3,this.height-58);
      point.y=MathUtils.clamp(point.y,3,nearLimit);
      if(item.seat!==this.viewerSeat){
        // Reserve two full touch rows even when perspective compresses depth.
        // Use the stable near-row plane, not a moving/attacking neighbour.
        const near=this.project(new Vector3(item.base.x,.23,(this.rowDepth||2)+.63));
        const nearY=MathUtils.clamp(near.y,3,nearLimit);
        point.y=Math.max(3,Math.min(point.y,nearY-50));
      }
    }
    return point;
  }

  addJob(duration, update, done = () => {}) {
    if (this.destroyed || this.hidden || this.contextLost || this.frameFault) { done(); return Promise.resolve(); }
    const generation = this.generation, start = performance.now();
    return new Promise((resolve) => {
      let finished = false;
      const job = { start, duration, update, finish: () => {
        if (finished) return; finished = true;
        try { done(); } catch (cleanupError) { console.warn("Scene effect cleanup failed", cleanupError.message); }
        finally { resolve(); }
      }, generation };
      this.jobs.add(job); this.start();
    });
  }

  async attack(uid, targetKey, impact = () => {}) {
    const item = this.units.get(uid), to = this.anchor(targetKey, .6);
    if (!item || !to || this.reduced) return;
    const from = item.base.clone(), destination = to.clone().lerp(from, .18);
    const generation = this.generation, token = {}; item.animating = true; item.motionToken = token;
    this.onSound("attack");
    try { await playMeleeSequence({
      runPhase: (duration, update) => this.addJob(duration, update),
      isCurrent: () => generation === this.generation && item.motionToken === token &&
        !this.destroyed && !this.hidden && !this.contextLost && !this.frameFault,
      setPose: ({ travel, progress }) => {
        item.model.root.position.copy(from).lerp(destination, travel);
        item.model.root.position.y = from.y + Math.sin(Math.max(0, travel) * Math.PI) * .62;
        item.model.applyPose?.({ idlePhase: 0, lean: Math.sin(progress * Math.PI) * .3, attackProgress: progress });
      },
      impact,
    }); } finally {
      if (generation === this.generation && item.motionToken === token && !this.destroyed) {
        item.animating = false; item.motionToken = null; item.model.root.position.copy(item.base);
        item.model.applyPose?.({ idlePhase: 0, lean: 0, attackProgress: 0 });
      }
    }
  }

  async pulse(targetKey, kind = "damage") {
    const at = this.anchor(targetKey, .65);
    if (!at || !this.renderer || this.reduced) return;
    if (kind === "heal") this.heroPose(targetKey, "heal", 650);
    const color = colorFor[kind] || colorFor.damage;
    const ring = new Mesh(new TorusGeometry(.58, .045, 8, 40), new MeshBasicMaterial({ color, transparent: true, opacity: .9, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.copy(at); this.temporary.add(ring);
    await this.addJob(650, (t) => { ring.scale.setScalar(.35 + t * 2.4); ring.position.y = at.y + t * .5; ring.material.opacity = .9 * (1 - t); }, () => { this.temporary.remove(ring); ring.geometry.dispose(); ring.material.dispose(); });
  }

  recoil(targetKey, duration = 320) {
    if (!this.renderer || this.reduced) return Promise.resolve();
    const item = this.units.get(targetKey);
    if (item) {
      const token = {}; item.hitToken = token;
      return this.addJob(duration, t => {
        if (item.hitToken === token) item.model.applyPose?.({ hitProgress: t });
      }, () => {
        if (item.hitToken === token) { item.hitToken = null; item.model.applyPose?.({ hitProgress: 0 }); }
      });
    }
    return this.heroPose(targetKey, "hit", duration);
  }

  containSprite(sprite, padding = 10) {
    if (!this.width || !this.height) return;
    this.camera.updateMatrixWorld(true);
    const at = sprite.position.clone(), ndc = at.clone().project(this.camera);
    const right = new Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0).multiplyScalar(sprite.scale.x / 2);
    const up = new Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1).multiplyScalar(sprite.scale.y / 2);
    const halfX = Math.abs(at.clone().add(right).project(this.camera).x - ndc.x);
    const halfY = Math.abs(at.clone().add(up).project(this.camera).y - ndc.y);
    const boundX = Math.max(0, 1 - halfX - padding * 2 / this.width);
    const boundY = Math.max(0, 1 - halfY - padding * 2 / this.height);
    ndc.x = MathUtils.clamp(ndc.x, -boundX, boundX); ndc.y = MathUtils.clamp(ndc.y, -boundY, boundY);
    sprite.position.copy(ndc.unproject(this.camera));
  }

  floatText(targetKey, text, color = "#fff0c5", duration = 760) {
    const at = this.anchor(targetKey, 2.35);
    if (!at || !this.renderer) return Promise.resolve();
    const lanes = this.floatLanes.get(targetKey) || new Set();
    this.floatLanes.set(targetKey, lanes);
    let lane = 0; while (lanes.has(lane)) lane++; lanes.add(lane);
    const canvas = document.createElement("canvas"); canvas.width = 384; canvas.height = 160;
    const ctx = canvas.getContext("2d"); ctx.textAlign = "center"; ctx.font = "bold 78px 'Noto Sans CJK SC',Georgia,serif";
    ctx.lineWidth = 10; ctx.strokeStyle = "#142922"; ctx.lineJoin = "round";
    ctx.strokeText(String(text), 192, 105); ctx.fillStyle = color; ctx.fillText(String(text), 192, 105);
    const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace;
    const sprite = new Sprite(new SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false }));
    sprite.scale.set(2.45, 1.02, 1); sprite.position.copy(at); sprite.renderOrder = 20; this.containSprite(sprite); this.temporary.add(sprite);
    return this.addJob(this.reduced ? 500 : duration, (t) => {
      const current = this.anchor(targetKey, 2.35) || at;
      sprite.position.copy(current); sprite.position.y += lane * .7 + (this.reduced ? 0 : t * .8);
      this.containSprite(sprite);
      sprite.material.opacity = t < .64 ? 1 : Math.max(0, (1 - t) / .36);
    }, () => { this.temporary.remove(sprite); sprite.material.dispose(); texture.dispose(); lanes.delete(lane); if (!lanes.size && this.floatLanes.get(targetKey) === lanes) this.floatLanes.delete(targetKey); });
  }

  burst(at, kind = "damage", duration = 620, element = "fire") {
    if (!at || !this.renderer || this.reduced) return Promise.resolve();
    const fx = createElementalBurst({ at, element: kind === "heal" ? "water" : kind === "grow" ? "nature" : kind === "shield" ? "arcane" : element, kind });
    this.temporary.add(fx.root);
    return this.addJob(duration, t => fx.update(t), () => fx.dispose());
  }

  async projectile(sourceKey, targetKey, impact = () => {}, element = "fire") {
    const item = this.units.get(sourceKey) || this.heroFor(sourceKey);
    const from = item?.model.anchors?.projectile?.getWorldPosition(new Vector3()) || this.anchor(sourceKey, 1.2);
    const target = this.units.get(targetKey) || this.heroFor(targetKey);
    const to = target?.model.anchors?.impact?.getWorldPosition(new Vector3()) || this.anchor(targetKey, 1.0);
    if (!from || !to || this.reduced) { impact(); return; }
    const fx = createElementalCast({ element, from, to });
    this.heroPose(sourceKey, "cast", fx.duration);
    this.temporary.add(fx.root);
    const generation = this.generation; let hit = false;
    this.onSound(element === "water" ? "heal" : element === "nature" ? "growth" : "spark");
    await this.addJob(fx.duration, t => {
      fx.update(t);
      if (t >= fx.impactAt && !hit && generation === this.generation) { hit = true; impact(); }
    }, () => fx.dispose());
  }

  shield(targetKey) {
    const at = this.anchor(targetKey, 1);
    if (!at || !this.renderer || this.reduced) return Promise.resolve();
    this.heroPose(targetKey, "armor", 620);
    const badge = createBarrierBadge(); badge.root.name = "armor-gain-emblem";
    badge.root.position.copy(at); this.temporary.add(badge.root);
    return this.addJob(620, t => { badge.root.scale.setScalar(.6 + Math.sin(t * Math.PI) * .9); badge.root.position.y = at.y + t * .3; badge.root.visible = t < .95; }, () => badge.dispose());
  }

  returnUnit(uid, seat) {
    const item = this.units.get(uid), destination = this.anchor(`hero:${seat}`, .9);
    if (!item || !destination || this.reduced) return Promise.resolve();
    const token = {}, from = item.base.clone(), scale = this.scaleFor(item.unit.cardId);
    item.animating = true; item.motionToken = token;
    return this.addJob(520, t => {
      if (item.motionToken !== token || item.model.disposed) return;
      item.model.root.position.copy(from).lerp(destination, smooth(t));
      item.model.root.position.y += Math.sin(t * Math.PI) * .7;
      item.model.root.scale.setScalar(scale * Math.max(.04, 1 - t * .96));
    }, () => {
      if (item.motionToken !== token || item.model.disposed) return;
      item.animating = false; item.motionToken = null;
      item.model.root.position.copy(item.base); item.model.root.scale.setScalar(scale);
    });
  }

  impacts(changes = [], element = "fire", contactEffect = true) {
    const work = [];
    for (const change of changes) {
      const key = change.uid || `hero:${change.seat}`;
      const at = this.anchor(key, .8);
      if (change.returned) {
        work.push(this.floatText(key, "回到手牌", "#b9ebff", 500));
        work.push(this.returnUnit(change.uid, change.seat));
        this.onSound("draw");
        continue;
      }
      if (change.hpDelta < 0 || change.armorDelta < 0) work.push(this.recoil(key));
      if (change.hpDelta < 0) {
        work.push(this.floatText(key, String(change.hpDelta), "#ffe2b6", change.removed ? 290 : 760));
        if (contactEffect) work.push(this.burst(at, "damage", change.removed ? 310 : 610, element));
        if (change.removed && !this.reduced) {
          const item = this.units.get(change.uid);
          if (item) {
            item.fadeMaterials = [];
            item.model.root.traverse((o) => { if (o.material && !o.userData.pickProxy) for (const m of Array.isArray(o.material) ? o.material : [o.material]) item.fadeMaterials.push({ material: m, opacity: m.opacity, transparent: m.transparent }); });
            work.push(this.addJob(320, (t) => {
            item.model.root.scale.setScalar(this.scaleFor(item.unit.cardId) * (1 - t * .65));
            for (const { material, opacity } of item.fadeMaterials || []) { material.transparent = true; material.opacity = opacity * (1 - t); }
          }));
          }
        }
      }
      if (change.hpDelta > 0) { work.push(this.floatText(key, `+${change.hpDelta}`, "#baf3a8")); work.push(this.burst(at, "heal")); work.push(this.pulse(key, "heal")); this.onSound("heal"); }
      if (change.armorDelta > 0) { work.push(this.floatText(key, `+${change.armorDelta}护甲`, "#b9ebff")); work.push(this.shield(key)); this.onSound("shield"); }
      if (change.armorDelta < 0) { work.push(this.floatText(key, `${change.armorDelta}护甲`, "#b9ebff")); work.push(this.burst(at, "shield", 450)); }
      if (change.shieldLost) {
        this.barriers.get(change.uid)?.dispose(); this.barriers.delete(change.uid);
        work.push(this.floatText(key, "护盾抵挡", "#bff5ff", 620));
        work.push(this.burst(at, "shield", 460)); this.onSound("shield");
      }
      if (change.shieldGained) {
        const item = this.units.get(change.uid);
        if (item && !this.barriers.has(change.uid)) { const badge = createBarrierBadge(); item.model.root.add(badge.root); this.barriers.set(change.uid, badge); }
        work.push(this.floatText(key, "获得护盾", "#bff5ff", 620));
        work.push(this.shield(key)); this.onSound("shield");
      }
      if (change.maxHpDelta > 0) { work.push(this.floatText(key, `+${change.maxHpDelta}生命上限`, "#e4f6aa")); work.push(this.burst(at, "grow")); this.onSound("growth"); }
      if (change.atkDelta > 0) { work.push(this.floatText(key, `+${change.atkDelta}攻击`, "#e4f6aa")); work.push(this.burst(at, "grow")); this.onSound("growth"); }
      if (change.atkDelta < 0) { work.push(this.floatText(key, `${change.atkDelta}攻击`, "#b9ebff")); work.push(this.burst(at, "weaken", 450, "water")); }
    }
    if (changes.some((c) => c.hpDelta < 0 || c.armorDelta < 0)) this.onSound("hit");
    if (changes.some((c) => c.removed && !c.returned)) this.onSound("death");
    return Promise.all(work);
  }

  async summon(next, event) {
    const uid = event.newUnitUid, from = this.anchor(`hero:${event.actorSeat}`, 1.4);
    // Keep existing targets until the accepted arrival effect lands. In particular,
    // a lethal salamander arrival must not delete its target before its flame flies.
    const before = this.snapshot;
    const staged = before ? { ...next, players: next.players.map((player, seat) => ({ ...player,
      board: [...(before.players[seat]?.board || []), ...player.board.filter(unit => unit.uid === uid && !before.players[seat]?.board?.some(old => old.uid === uid))],
    })) } : next;
    this.setBattle(staged, this.viewerSeat);
    const item = this.units.get(uid); if (!item) return;
    if (this.reduced) { this.onSound("summon"); return; }
    this.heroPose(`hero:${event.actorSeat}`, "cast", 680);
    const card = this.library.createCard({ frontTexture: this.textures.get(event.cardId), backTexture: this.textures.back });
    card.root.scale.setScalar(1.18); this.temporary.add(card.root);
    const to = item.base.clone().add(new Vector3(0, 1.0, 0));
    const scale = this.scaleFor(event.cardId);
    const token = {}; item.animating = true; item.motionToken = token; item.model.root.scale.setScalar(.01);
    const generation = this.generation; this.onSound("summon");
    await this.addJob(680, (t) => {
      if (item.motionToken !== token) return;
      const travel = Math.min(1, t / .67), appear = Math.max(0, (t - .5) / .5);
      card.root.position.copy(from || to).lerp(to, smooth(travel)); card.root.position.y += Math.sin(travel * Math.PI) * 1.5;
      card.root.rotation.set(-.5 + t * .5, t * .9, Math.sin(t * Math.PI) * .15);
      card.root.scale.setScalar(1.18 * Math.max(.01, 1 - appear));
      item.model.root.scale.setScalar(scale * Math.max(.01, smooth(appear)));
      item.model.root.position.y = item.base.y + Math.sin(appear * Math.PI) * .3;
    }, () => card.dispose());
    if (generation === this.generation && item.motionToken === token && !this.destroyed) { item.animating = false; item.motionToken = null; item.model.root.scale.setScalar(scale); item.model.root.position.copy(item.base); this.burst(item.base.clone().add(new Vector3(0, .2, 0)), "grow", 360); }
  }

  async drawCards(next, seat, count) {
    if (!count || this.hidden || this.contextLost || this.destroyed) return;
    const relative = seat === this.viewerSeat ? 0 : 1;
    const player = next.players[seat], total = player.hand?.length ?? player.handCount ?? 0;
    count = Math.min(count, total, 2);
    if (!count) return;
    this.onSound("draw");
    if (this.externalHand && !relative) { this.onHandDraw({ ids: player.hand, count, reduced: this.reduced }); return; }
    if (this.reduced) return;
    const from = this.decks[relative].root.position.clone().add(new Vector3(0, .55, 0));
    const existing = relative ? this.enemyCards.map((x) => x.root) : this.cards.map((x) => x.model.root);
    const hidden = existing.length === total ? existing.slice(-count) : [];
    const token = {};
    hidden.forEach((root) => { root.userData.drawHideToken = token; root.visible = false; });
    await Promise.all(Array.from({ length: count }, (_, i) => {
      const index = total - count + i, layout = this.handLayout(index, total, !!relative);
      const front = relative ? this.textures.back : this.textures.get(player.hand[index]);
      const card = this.library.createCard({ frontTexture: front, backTexture: this.textures.back });
      const to = layout.position;
      this.temporary.add(card.root);
      const duration = 550 + i * 110;
      return this.addJob(duration, (t) => {
        const p = MathUtils.clamp((t * duration - i * 110) / 550, 0, 1), travel = easeInOut(p);
        card.root.position.copy(from).lerp(to, travel); card.root.position.y += Math.sin(p * Math.PI) * 1.9;
        card.root.rotation.set(lerp(-Math.PI / 2, layout.rotation.x, travel), layout.rotation.y * travel + Math.sin(p * Math.PI) * (relative ? -.7 : .7), layout.rotation.z * travel);
        card.root.scale.setScalar(lerp(1, layout.scale, travel));
      }, () => card.dispose());
    }));
    hidden.forEach((root) => { if (root.userData.drawHideToken === token) { root.visible = true; delete root.userData.drawHideToken; } });
  }

  celebrate(won) {
    this.onSound(won ? "win" : "turn");
    if (!this.renderer || !this.temporary || this.reduced || this.hidden || this.contextLost || this.destroyed) return Promise.resolve();
    if (typeof won === "boolean") {
      this.heroPose(`hero:${this.viewerSeat}`, won ? "win" : "lose", 1150);
      this.heroPose(`hero:${1 - this.viewerSeat}`, won ? "lose" : "win", 1150);
    }
    const group = new Group(), geometry = new IcosahedronGeometry(.14, 0);
    const material = new MeshStandardMaterial({ color: won ? 0xf4d58c : 0x9cc9c3, emissive: won ? 0x80521a : 0x1a5047, emissiveIntensity: .5, metalness: .5, roughness: .3, transparent: true });
    const leaves = [];
    for (let i = 0; i < 24; i++) { const leaf = new Mesh(geometry, material); leaf.scale.set(.6, .25, 1.5); group.add(leaf); leaves.push(leaf); }
    const ring = new Mesh(new TorusGeometry(2.7, .055, 8, 64), new MeshBasicMaterial({ color: won ? 0xe9c56f : 0x86c5b4, transparent: true, opacity: .8, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; group.add(ring); this.temporary.add(group);
    return this.addJob(1150, (t) => {
      leaves.forEach((leaf, i) => { const a = i * 2.39996 + t * 1.3, r = 2.5 + Math.sin(i) * .6; leaf.position.set(Math.cos(a) * r, .7 + t * (2 + i % 5 * .35), Math.sin(a) * r * .7); leaf.rotation.set(t * 3 + i, t * 5, t * 2 + i); });
      material.opacity = t < .65 ? 1 : (1 - t) / .35;
      ring.position.y = .18 + t * .5; ring.scale.setScalar(.4 + smooth(t) * 1.1); ring.material.opacity = .8 * Math.sin(t * Math.PI);
    }, () => { this.temporary.remove(group); geometry.dispose(); material.dispose(); ring.geometry.dispose(); ring.material.dispose(); });
  }

  /** One public server event; its only authority is how to present an accepted state. */
  async present(next, event, onImpact = () => {}) {
    if (!this.renderer || !event || this.hidden || this.contextLost || this.destroyed) return;
    const eventId = event.eventId || event.id;
    if (eventId && this.presentedEvents.has(eventId)) return;
    if (eventId) { this.presentedEvents.add(eventId); if (this.presentedEvents.size > 128) this.presentedEvents.delete(this.presentedEvents.values().next().value); }
    const generation = this.generation, actor = event.actorSeat ?? event.seat;
    const sourceCard = CARD[event.cardId || this.units.get(event.sourceUid)?.unit.cardId];
    const element = sourceCard?.element || "fire";
    const ranged = new Set(["dragon", "phoenix", "owl", "firefly", "unicorn", "otter", "crane", "sprout", "sprite", "stag"]);
    const rangedAttack = event.kind === "attack" && ranged.has(sourceCard?.id);
    const draws = next.players.map((p, seat) => {
      const old = this.snapshot?.players[seat], before = old?.hand?.length ?? old?.handCount ?? 0;
      const returned = event.changes?.filter(change => change.returned && change.seat === seat).length || 0;
      return Math.max(0, (p.hand?.length ?? p.handCount ?? 0) - before + (event.kind === "play" && seat === actor ? 1 : 0) - returned);
    });
    const target = event.targetUid || (Number.isInteger(event.targetSeat) ? `hero:${event.targetSeat}` : null);
    let impact = Promise.resolve();
    let didHit = false;
    const areaEffect = sourceCard?.target?.startsWith("all-");
    const hit = () => { if (!didHit && generation === this.generation) { didHit = true; onImpact(); impact = this.impacts(event.changes || [], element, areaEffect || (!rangedAttack && sourceCard?.type !== "spell")); } };
    if (event.kind === "attack" && event.sourceUid && target && !this.reduced) {
      // A removed unit's number/fade end before the attack's return settles.
      // Longer surviving labels follow their own UID and need not lock input.
      if (rangedAttack) await this.projectile(event.sourceUid, target, hit, element);
      else await this.attack(event.sourceUid, target, hit);
    } else if (event.kind === "play" && event.newUnitUid) {
      await this.summon(next, event); if (generation !== this.generation) return;
      if (sourceCard?.keyword === "arrivalDamage" && target) await this.projectile(event.newUnitUid, target, hit, element);
      else hit();
    } else if ((event.kind === "play" && sourceCard?.type === "spell") || (event.kind === "ritual" && event.ritualKind === "spark" && event.outcome !== "wrong" && event.outcome !== "unanswered")) {
      const spellTarget = target || (areaEffect && event.changes?.find(change => change.uid)?.uid) || `hero:${sourceCard?.keyword === "damage" || event.ritualKind === "spark" ? 1 - actor : actor}`;
      await this.projectile(`hero:${actor}`, spellTarget, hit, element);
    } else { hit(); await impact; }
    if (event.changes?.some(change => change.returned)) await impact;
    if (generation === this.generation) await Promise.all(draws.map((count, seat) => this.drawCards(next, seat, count)));
    if (generation === this.generation && event.kind === "end") this.onSound("turn");
  }

  setReduced(value) { if (value && !this.reduced) this.cancel(); this.reduced = !!value;if(this.canvas?.dataset)this.canvas.dataset.reducedMotion=String(this.reduced); this.requestRender(); }
  setHidden(value) { if(this.hidden===!!value){if(value)this.primeHiddenEffects();return;}this.hidden = !!value; if (value) { this.cancel(); this.stop(); this.primeHiddenEffects(); } else {this.resize();this.start();} }
  requestRender() { this.needsRender = true; if (this.renderer && !this.hidden) this.start(); }
  start() {
    if (!this.renderer || this.running || this.destroyed || this.hidden || this.contextLost || this.frameFault) return;
    this.running = true;
    this.lastSoftwareFrame = null;
    this.metricCallbacks=0;this.metricMaxRafGap=0;this.metricLastRaf=null;
    if(this.canvas?.dataset){this.canvas.dataset.sceneState='running';this.canvas.dataset.reducedMotion=String(this.reduced);}
    const frame = (now) => {
      if (!this.running || this.destroyed) return;
      this.frame = null;
      this.metricCallbacks++;if(this.metricLastRaf!==null)this.metricMaxRafGap=Math.max(this.metricMaxRafGap,now-this.metricLastRaf);this.metricLastRaf=now;
      if (this.renderer.isSoftwareRenderer && this.lastSoftwareFrame && now - this.lastSoftwareFrame < (this.cpuRenderCost > 45 ? 66 : this.cpuRenderCost > 26 ? 49 : 32)) { this.frame = requestAnimationFrame(frame); return; }
      this.lastFrameInterval = this.lastSoftwareFrame ? now - this.lastSoftwareFrame : 0; this.lastSoftwareFrame = now; this.needsRender = false;
      try {
      const updateStarted=performance.now();
      const delta = Math.min(.05, Math.max(0, (now - this.lastTime) / 1000)); this.lastTime = now;
      if (!this.reduced) {
        // Packed portrait seats keep fixed screen-space gutters while swiping
        // the hand. Pointer parallax is retained on wider battlefields.
        const cameraX = this.renderer.isSoftwareRenderer || this.portraitHeroDock ? 0 : (this.pointer.x || 0) * .6;
        this.camera.position.x = lerp(this.camera.position.x, cameraX, Math.min(1, delta * 4));
        this.camera.lookAt(this.cameraLook);
        this.fireflies.rotation.y = Math.sin(now * .00005) * .06;
        this.fireflies.position.y = Math.sin(now * .0007) * .15;
      }
      for (const [uid, item] of this.units) {
        if (!item.animating) item.model.applyPose?.({ idlePhase: this.reduced ? 0 : now * .001 + item.born, lean: 0, attackProgress: 0 });
      }
      for (const item of this.cards) {
        const selected = this.selected?.kind === "card" && this.selected.index === item.index;
        const hovering = this.hover?.kind === "card" && this.hover.index === item.index;
        const readingHover = hovering && !this.selected && this.width > 900;
        const lift = selected ? 1.2 : readingHover ? 1.05 : hovering ? .4 : 0;
        item.model.root.position.y = this.reduced ? item.base.y + lift : lerp(item.model.root.position.y, item.base.y + lift, Math.min(1, delta * 11));
        const targetScale = selected ? 2.8 : readingHover ? 2.6 : hovering ? 1.9 : 1.78;
        const scale = this.reduced ? targetScale : lerp(item.model.root.scale.x, targetScale, Math.min(1, delta * 11));
        item.model.root.scale.setScalar(scale);
        const x = selected ? MathUtils.clamp(item.base.x, -3.2 * (this.boardWidthScale || 1), 3.2 * (this.boardWidthScale || 1)) : item.base.x;
        item.model.root.position.x = this.reduced ? x : lerp(item.model.root.position.x, x, Math.min(1, delta * 11));
      }
      this.updateTargets();
      for (const job of [...this.jobs]) {
        if (job.generation !== this.generation) { this.jobs.delete(job); job.finish(); continue; }
        const t = Math.min(1, (now - job.start) / job.duration); job.update(t);
        if (t === 1) { this.jobs.delete(job); job.finish(); }
      }
      for (const hero of this.heroes) hero.model.applyPose({ time: now * .001, ...hero.poses, reducedMotion: this.reduced });
      for (const [uid, shadow] of this.contactShadows) {
        const item = this.units.get(uid); if (!item) continue;
        shadow.position.set(item.model.root.position.x + .12, .035, item.model.root.position.z + .13);
        shadow.scale.setScalar(this.scaleFor(item.unit.cardId) / 1.3);
      }
        // Keep the target frame and effect timing stable; apply only once the
        // current animation jobs have settled, without recreating game objects.
      let qualityApplied=false;
      if(this.pendingQuality&&!this.jobs.size){
        const previous=this.appliedQuality;
        this.appliedQuality=this.pendingQuality;this.pendingQuality=null;
        if(previous.shadowMapSize!==this.appliedQuality.shadowMapSize){
          this.shadowLight.shadow.mapSize.set(this.appliedQuality.shadowMapSize,this.appliedQuality.shadowMapSize);
          this.shadowLight.shadow.needsUpdate=true;
        }
        // Three's setPixelRatio already updates the drawing buffer. A shadow-
        // only adjustment must leave that buffer untouched.
        if(previous.pixelScale!==this.appliedQuality.pixelScale)
          this.renderer.setPixelRatio(Math.min(devicePixelRatio||1,this.quality==="low"?1:1.5)*this.appliedQuality.pixelScale);
        this.adaptiveQuality.resetSamples({appliedAt:now});
        qualityApplied=true;
      }
      const renderStarted=performance.now();
      this.renderer.render(this.scene, this.camera);
      const renderFinished=performance.now();
      if (this.renderer.isSoftwareRenderer) this.cpuRenderCost = this.cpuRenderCost ? this.cpuRenderCost * .8 + this.renderer.lastRenderMs * .2 : this.renderer.lastRenderMs;
      const anchors = [...this.units.entries()].map(([uid, item]) => ({ uid, seat: item.seat, ...this.labelPoint(item) }));
      this.onAnchors(anchors);
      const anchorFinished=performance.now();
      this.frameTimings={updateMs:renderStarted-updateStarted,submitMs:renderFinished-renderStarted,anchorMs:anchorFinished-renderFinished};
      if(this.canvas?.dataset){
        this.canvas.dataset.renderUpdateMs=this.frameTimings.updateMs.toFixed(2);
        this.canvas.dataset.renderSubmitMs=this.frameTimings.submitMs.toFixed(2);
        this.canvas.dataset.renderAnchorMs=this.frameTimings.anchorMs.toFixed(2);
        this.canvas.dataset.frameGapMs=String(Math.round(this.lastFrameInterval||0));
      }
      if(!this.renderer.isSoftwareRenderer&&!this.pendingQuality&&!qualityApplied){
        const profile=this.adaptiveQuality.sample({now,frameIntervalMs:this.lastFrameInterval,
          renderMs:this.frameTimings.submitMs,active:!this.reduced&&!this.hidden&&globalThis.document?.visibilityState!=="hidden"});
        if(profile)this.pendingQuality=profile;

      }
      if(this.canvas?.dataset){
        this.canvas.dataset.qualityLevel=String(this.appliedQuality.level);
        this.canvas.dataset.pixelScale=String(this.appliedQuality.pixelScale);
        this.canvas.dataset.shadowMapSize=String(this.appliedQuality.shadowMapSize);
      }
      this.metricFrames++;
      if (now - this.metricStart >= 1500) {
        if(this.canvas?.dataset){this.canvas.dataset.sampleTime=String(Date.now());this.canvas.dataset.sampleWindowMs=String(Math.round(now-this.metricStart));this.canvas.dataset.rafCallbacks=String(this.metricCallbacks);this.canvas.dataset.paintedFrames=String(this.metricFrames);this.canvas.dataset.maxRafGapMs=String(Math.round(this.metricMaxRafGap));this.canvas.dataset.pageVisibility=globalThis.document?.visibilityState||'unknown';}
        this.onStatus({ available: true, renderer: this.rendererName || "WebGL2", quality: this.quality, fps: Math.round(this.metricFrames * 1000 / (now - this.metricStart)), triangles: this.renderer.info.render.triangles, drawCalls: this.renderer.info.render.calls, renderMs: Math.round(this.renderer.lastRenderMs ?? this.frameTimings.submitMs), frameIntervalMs: Math.round(this.lastFrameInterval || 0) });
        this.metricStart = now; this.metricFrames = 0;this.metricCallbacks=0;this.metricMaxRafGap=0;
      }
      if (this.running && !this.destroyed && !this.hidden && !this.contextLost && (!this.reduced || this.jobs.size || this.needsRender)) this.frame = requestAnimationFrame(frame);
      else {this.running = false;if(this.canvas?.dataset)this.canvas.dataset.sceneState=this.reduced?'on-demand':'idle';}
      } catch (error) {
        // A broken visual job must never hold an already accepted game action.
        // Settle the queue and retain accessible controls through the UI fallback.
        this.frameFault = true; this.stop();
        try { this.cancel(); } catch (cleanupError) { console.warn("Scene cleanup failed", cleanupError.message); }
        this.onStatus({ available: false, renderer: this.rendererName || "WebGL2", reason: "frame-error" });
      }
    };
    this.lastTime = performance.now(); this.metricStart = this.lastTime; this.metricFrames = 0;
    this.adaptiveQuality?.resetSamples();
    this.frame = requestAnimationFrame(frame);
  }

  stop() { this.running = false; if (this.frame) cancelAnimationFrame(this.frame); this.frame = null;if(this.canvas?.dataset)this.canvas.dataset.sceneState='paused'; }
  restoreFade(item) {
    if (!item.fadeMaterials) return;
    for (const { material, opacity, transparent } of item.fadeMaterials) { material.opacity = opacity; material.transparent = transparent; }
    item.fadeMaterials = null;
  }
  cancel() {
    this.boardInput?.cancel();
    this.generation++;
    for (const job of this.jobs) job.finish(); this.jobs.clear();
    for (const item of this.units.values()) { item.animating = false; item.motionToken = null; this.restoreFade(item); item.model.root.position.copy(item.base); item.model.root.scale.setScalar(this.scaleFor(item.unit.cardId)); item.model.applyPose?.({ idlePhase: 0, lean: 0, attackProgress: 0, hitProgress: 0 }); }
    for (const hero of this.heroes) { hero.poses = {}; hero.poseTokens = {}; hero.model.cancel(); hero.model.setVisualState({}); }
    this.clearAim();
  }

  dispose() {
    if (this.destroyed) return;
    this.stop(); this.cancel(); this.destroyed = true; this.boardInput?.dispose();
    this.effectWarmupEpoch=(this.effectWarmupEpoch||0)+1;
    this.effectWarmup?.dispose();this.effectWarmup=null;
    if (this.handlers) {
      window.removeEventListener("resize", this.handlers.resize);
      for (const [event, fn] of [["pointermove", "move"], ["pointerleave", "leave"], ["webglcontextlost", "contextlost"], ["webglcontextrestored", "contextrestored"]]) this.canvas.removeEventListener(event, this.handlers[fn]);
    }
    for (const badge of this.barriers.values()) badge.dispose(); this.barriers.clear();
    for (const item of this.units.values()) item.model.dispose?.();
    for (const item of this.cards) item.model.dispose?.();
    for (const item of this.enemyCards) item.dispose?.();
    for (const ring of this.targetRings.values()) { ring.geometry.dispose(); ring.material.dispose(); } this.targetRings.clear();
    for (const deck of this.decks) for (const card of deck.cards) card.dispose();
    for (const h of this.heroes) h.model.dispose();
    this.fireflies?.geometry.dispose(); this.fireflies?.material.dispose();
    this.arena?.dispose?.(); this.library?.dispose(); this.textures?.dispose(); this.glowTexture?.dispose();
    for (const shadow of this.contactShadows.values()) shadow.material.dispose(); this.contactShadows.clear();
    this.contactShadowGeometry?.dispose(); this.contactShadowTexture?.dispose();
    this.renderer?.dispose(); this.scene.clear(); this.units.clear(); this.cards = []; this.heroes = [];
    this.enemyCards = []; this.decks = []; this.pickables = []; this.arena = null;
  }
}
