import { drawMesh } from "./geometry.mjs";
import {
  Scene,
  OrthographicCamera,
  WebGLRenderer,
  CanvasTexture,
  Points,
  PointsMaterial,
  BufferGeometry,
  Float32BufferAttribute,
  AdditiveBlending,
  Mesh,
  MeshBasicMaterial,
  MeshPhongMaterial,
  AmbientLight,
  DirectionalLight,
  Shape,
  ExtrudeGeometry,
  TorusGeometry,
  IcosahedronGeometry,
  Sprite,
  SpriteMaterial,
  Color,
  Group,
} from "three";
export const FX_TIMING = Object.freeze({
  unitShift: 620,
  shiftHold: 0.72,
  deathNumber: 420,
});
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ease = (t) => 1 - Math.pow(1 - t, 3);
const center = (el) => {
  if (!el) return { x: innerWidth / 2, y: innerHeight / 2, w: 80, h: 80 };
  const anchor = el.classList?.contains("hero")
    ? el.querySelector(".hero-frame") || el
    : el.classList?.contains("game-card")
      ? el.querySelector(".card-art") || el
      : el;
  const r = anchor.getBoundingClientRect();
  return {
    x: r.left + r.width / 2,
    y: r.top + r.height / 2,
    w: r.width,
    h: r.height,
  };
};
export class BattleEffects {
  constructor() {
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.jobs = [];
    this.running = false;
    this.reduced = false;
    this.texture = null;
    this.fallback = null;
    this.frameToken = 0;
    this.generation = 0;
    this.pendingCelebrations = new Set();
    this.labels = new Map();
    this.flight = null;
    this.width = 0;
    this.height = 0;
  }
  ensure() {
    if (this.renderer || this.fallback) return;
    const canvas = document.createElement("canvas");
    canvas.id = "battle-fx";
    canvas.setAttribute("aria-hidden", "true");
    document.body.appendChild(canvas);
    try {
      const context = canvas.getContext("webgl2", {
        alpha: true,
        antialias: true,
      });
      if (!context) throw new Error("WebGL2 unavailable; using Canvas effects");
      this.renderer = new WebGLRenderer({
        canvas,
        context,
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
      });
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.6));
      this.scene = new Scene();
      this.scene.add(new AmbientLight(0xc9e9ed, 1.2));
      const key = new DirectionalLight(0xffe9c0, 2.8);
      key.position.set(-200, -300, 600);
      this.scene.add(key);
      this.camera = new OrthographicCamera(
        0,
        innerWidth,
        0,
        innerHeight,
        -1000,
        1000,
      );
      this.camera.position.z = 500;
      this.camera.lookAt(0, 0, 0);
      canvas.dataset.renderer = "webgl-3d";
      const tex = document.createElement("canvas");
      tex.width = tex.height = 64;
      const c = tex.getContext("2d"),
        g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.12, "rgba(255,255,255,.95)");
      g.addColorStop(0.4, "rgba(255,255,255,.35)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      c.fillStyle = g;
      c.fillRect(0, 0, 64, 64);
      this.texture = new CanvasTexture(tex);
    } catch (e) {
      canvas.remove();
      const c = document.createElement("canvas");
      c.id = "battle-fx";
      c.dataset.renderer = "canvas-2d";
      c.setAttribute("aria-hidden", "true");
      document.body.appendChild(c);
      this.fallback = c.getContext("2d");
    }
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }
  resize() {
    this.width = innerWidth;
    this.height = innerHeight;
    if (this.renderer) {
      this.renderer.setSize(this.width, this.height);
      this.camera.left = 0;
      this.camera.right = this.width;
      this.camera.top = 0;
      this.camera.bottom = this.height;
      this.camera.updateProjectionMatrix();
    }
    if (this.fallback) {
      this.fallback.canvas.width = this.width;
      this.fallback.canvas.height = this.height;
    }
  }
  add(duration, update, dispose = () => {}) {
    this.ensure();
    this.jobs.push({ start: performance.now(), duration, update, dispose });
    if (!this.running) this.loop();
  }
  loop() {
    this.running = true;
    const token = ++this.frameToken;
    const frame = () => {
      if (token !== this.frameToken) return;
      const now = performance.now();
      if (this.fallback) this.fallback.clearRect(0, 0, this.width, this.height);
      for (let i = this.jobs.length - 1; i >= 0; i--) {
        const j = this.jobs[i],
          t = Math.min(1, (now - j.start) / j.duration);
        j.update(t);
        if (t === 1) {
          j.dispose();
          this.jobs.splice(i, 1);
        }
      }
      if (this.renderer) this.renderer.render(this.scene, this.camera);
      if (this.jobs.length) requestAnimationFrame(frame);
      else {
        this.running = false;
        if (this.renderer) this.renderer.clear();
        if (this.fallback)
          this.fallback.clearRect(0, 0, this.width, this.height);
      }
    };
    requestAnimationFrame(frame);
  }
  burst(p, color = 0xffd18a, count = 60, spread = 150, life = 700, rise = 0) {
    if (this.reduced) return;
    this.ensure();
    if (this.renderer) {
      const pts = new Float32Array(count * 3),
        vel = [];
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2,
          s = (0.25 + Math.random() * 0.75) * spread;
        vel.push({
          x: Math.cos(a) * s,
          y: Math.sin(a) * s,
          z: (Math.random() - 0.5) * 100,
        });
        pts[i * 3] = p.x;
        pts[i * 3 + 1] = p.y;
        pts[i * 3 + 2] = 0;
      }
      const geo = new BufferGeometry();
      geo.setAttribute("position", new Float32BufferAttribute(pts, 3));
      const mat = new PointsMaterial({
        color,
        size: 11,
        map: this.texture,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        sizeAttenuation: false,
      });
      const mesh = new Points(geo, mat);
      this.scene.add(mesh);
      this.add(
        life,
        (t) => {
          const a = geo.attributes.position.array;
          for (let i = 0; i < count; i++) {
            a[i * 3] = p.x + vel[i].x * ease(t);
            a[i * 3 + 1] = p.y + vel[i].y * ease(t) + 45 * t * t - rise * t;
            a[i * 3 + 2] = vel[i].z * t;
          }
          geo.attributes.position.needsUpdate = true;
          mat.opacity = Math.pow(1 - t, 1.5);
          mat.size = 12 * (1 - t) + 2;
        },
        () => {
          this.scene.remove(mesh);
          geo.dispose();
          mat.dispose();
        },
      );
    } else {
      const particles = Array.from({ length: count }, () => {
        const a = Math.random() * Math.PI * 2,
          r = Math.random() * spread;
        return {
          x: Math.cos(a) * r,
          y: Math.sin(a) * r,
          size: 2 + Math.random() * 4,
        };
      });
      this.add(life, (t) => {
        const c = this.fallback;
        c.globalCompositeOperation = "lighter";
        for (const a of particles) {
          c.globalAlpha = (1 - t) * 0.9;
          c.fillStyle = "#" + color.toString(16).padStart(6, "0");
          c.beginPath();
          c.arc(
            p.x + a.x * ease(t),
            p.y + a.y * ease(t) + 30 * t * t - rise * t,
            a.size * (1 - t),
            0,
            Math.PI * 2,
          );
          c.fill();
        }
        c.globalAlpha = 1;
        c.globalCompositeOperation = "source-over";
      });
    }
  }
  ring(p, color = 0xffd18a, size = 100, life = 600, tilt = 0) {
    if (this.reduced) return;
    this.ensure();
    if (this.renderer) {
      const geo = new TorusGeometry(size * 0.5, 2.4, 8, 80),
        mat = new MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.95,
          depthWrite: false,
          blending: AdditiveBlending,
        }),
        mesh = new Mesh(geo, mat);
      mesh.position.set(p.x, p.y, 10);
      mesh.rotation.x = tilt;
      this.scene.add(mesh);
      this.add(
        life,
        (t) => {
          mesh.scale.setScalar(0.3 + ease(t) * 1.3);
          mesh.rotation.z = t * 1.5;
          mat.opacity = (1 - t) * 0.9;
        },
        () => {
          this.scene.remove(mesh);
          geo.dispose();
          mat.dispose();
        },
      );
    } else
      this.add(life, (t) => {
        const c = this.fallback;
        c.strokeStyle = "#" + color.toString(16).padStart(6, "0");
        c.globalAlpha = 1 - t;
        c.lineWidth = 3;
        c.beginPath();
        c.ellipse(
          p.x,
          p.y,
          size * (0.3 + t) * 0.5,
          size * (0.3 + t) * 0.5 * (tilt ? 0.45 : 1),
          0,
          0,
          Math.PI * 2,
        );
        c.stroke();
        c.globalAlpha = 1;
      });
  }
  glow(p, color = 0xffcb74, size = 160, life = 500) {
    if (this.reduced) return;
    this.ensure();
    if (this.renderer) {
      const mat = new SpriteMaterial({
          map: this.texture,
          color,
          transparent: true,
          blending: AdditiveBlending,
          depthWrite: false,
        }),
        sprite = new Sprite(mat);
      sprite.position.set(p.x, p.y, 60);
      sprite.scale.set(size, size, 1);
      this.scene.add(sprite);
      this.add(
        life,
        (t) => {
          mat.opacity = Math.sin(Math.PI * t) * 0.8;
          sprite.scale.setScalar(size * (0.5 + t));
        },
        () => {
          this.scene.remove(sprite);
          mat.dispose();
        },
      );
    } else
      this.add(life, (t) => {
        const c = this.fallback,
          r = size * (0.35 + t * 0.5),
          g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        const rgb = "#" + color.toString(16).padStart(6, "0");
        g.addColorStop(0, rgb + "a0");
        g.addColorStop(0.3, rgb + "55");
        g.addColorStop(1, rgb + "00");
        c.globalCompositeOperation = "lighter";
        c.globalAlpha = Math.sin(Math.PI * t) * 0.7;
        c.fillStyle = g;
        c.beginPath();
        c.arc(p.x, p.y, r, 0, Math.PI * 2);
        c.fill();
        c.globalAlpha = 1;
        c.globalCompositeOperation = "source-over";
      });
  }
  projectile(a, b, color = 0xffab46, duration = 420) {
    if (this.reduced) return wait(70);
    this.ensure();
    this.ring(a, color, 100, 350);
    if (this.renderer) {
      const group = new Group(),
        geo = new IcosahedronGeometry(13, 1),
        mat = new MeshPhongMaterial({
          color: 0xffcc72,
          emissive: 0x6b2909,
          shininess: 100,
          flatShading: true,
        }),
        core = new Mesh(geo, mat),
        sm = new SpriteMaterial({
          map: this.texture,
          color,
          transparent: true,
          depthWrite: false,
          blending: AdditiveBlending,
        }),
        halo = new Sprite(sm);
      halo.scale.set(100, 100, 1);
      group.add(halo, core);
      this.scene.add(group);
      let last = 0;
      this.add(
        duration,
        (t) => {
          const f = ease(t);
          group.position.set(
            a.x + (b.x - a.x) * f,
            a.y + (b.y - a.y) * f - Math.sin(Math.PI * f) * 70,
            20,
          );
          core.rotation.x = t * 9;
          core.rotation.y = t * 12;
          halo.scale.setScalar(85 + Math.sin(t * 30) * 8);
          if (t - last > 0.06) {
            last = t;
            this.burst(
              { x: group.position.x, y: group.position.y },
              color,
              5,
              35,
              300,
            );
          }
        },
        () => {
          this.scene.remove(group);
          geo.dispose();
          mat.dispose();
          sm.dispose();
        },
      );
    } else
      this.add(duration, (t) => {
        const f = ease(t),
          x = a.x + (b.x - a.x) * f,
          y = a.y + (b.y - a.y) * f - Math.sin(Math.PI * f) * 70,
          c = this.fallback,
          g = c.createRadialGradient(x, y, 1, x, y, 34);
        const tint = "#" + color.toString(16).padStart(6, "0");
        c.save();
        c.globalCompositeOperation = "lighter";
        for (let i = 12; i > 0; i--) {
          const tt = Math.max(0, t - i * 0.015),
            trail = ease(tt);
          const tx = a.x + (b.x - a.x) * trail,
            ty = a.y + (b.y - a.y) * trail - Math.sin(Math.PI * trail) * 70;
          c.globalAlpha = (1 - i / 14) * 0.65;
          c.fillStyle = tint;
          c.beginPath();
          c.arc(tx, ty, 4 + (1 - i / 14) * 10, 0, Math.PI * 2);
          c.fill();
        }
        c.globalAlpha = 1;
        g.addColorStop(0, "#fff7d9");
        g.addColorStop(0.25, tint + "cc");
        g.addColorStop(1, tint + "00");
        c.fillStyle = g;
        c.beginPath();
        c.arc(x, y, 34, 0, Math.PI * 2);
        c.fill();
        c.restore();
        drawMesh(c, "crystal", { x, y }, 17, t * 9, t * 5, 0xffe2a2);
      });
    return wait(duration);
  }
  label(p, text, kind = "damage", duration, owner = null) {
    const el = document.createElement("div");
    el.className = "fx-number " + kind;
    el.textContent = text;
    el.style.left = p.x + "px";
    el.style.top = p.y + "px";
    if (duration !== undefined) el.style.animationDuration = duration + "ms";
    document.body.appendChild(el);
    this.labels.set(el, owner);
    if (owner && el.dataset) el.dataset.fxOwner = owner;
    setTimeout(
      () => {
        el.remove();
        this.labels.delete(el);
      },
      duration ?? (this.reduced ? 500 : 1300),
    );
  }
  clearUnitLabels(ids) {
    for (const [node, owner] of this.labels) {
      if (!ids.includes(owner)) continue;
      node.remove();
      this.labels.delete(node);
    }
  }
  cancel() {
    this.generation++;
    for (const node of this.labels.keys()) node.remove();
    this.labels.clear();
    this.positions = {};
    this.ghosts = {};
    for (const timer of this.pendingCelebrations) clearTimeout(timer);
    this.pendingCelebrations.clear();
    this.frameToken++;
    for (const j of this.jobs) j.dispose();
    this.jobs = [];
    this.running = false;
    if (this.renderer) this.renderer.clear();
    if (this.fallback) this.fallback.clearRect(0, 0, this.width, this.height);
    if (this.flight) {
      this.flight.wrapper.getAnimations().forEach((a) => a.cancel());
      this.flight.wrapper.remove();
      if (this.flight.original) this.flight.original.style.visibility = "";
      this.flight = null;
    }
    document
      .querySelectorAll(".fx-number,.fx-ghost,.fx-flight")
      .forEach((el) => el.remove());
  }
  async lunge(el, target) {
    if (!el || this.reduced) return;
    const p = center(el),
      dx = target.x - p.x,
      dy = target.y - p.y,
      clone = el.cloneNode(true),
      wrapper = document.createElement("div");
    wrapper.className = "duel-stage fx-flight";
    wrapper.setAttribute("aria-hidden", "true");
    Object.assign(wrapper.style, {
      left: p.x - p.w / 2 + "px",
      top: p.y - p.h / 2 + "px",
      width: p.w + "px",
      height: p.h + "px",
    });
    Object.assign(clone.style, {
      width: p.w + "px",
      height: p.h + "px",
      margin: "0",
    });
    clone.classList.remove("selected", "targetable");
    wrapper.appendChild(clone);
    document.body.appendChild(wrapper);
    el.style.visibility = "hidden";
    this.flight = { wrapper, original: el, uid: el.dataset.target, dx, dy };
    const animation = wrapper.animate(
      [
        { transform: "translate(0,0) scale(1)" },
        { transform: `translate(${-dx * 0.08}px,${-dy * 0.08}px) scale(1.1)` },
        { transform: `translate(${dx * 0.82}px,${dy * 0.82}px) scale(1.12)` },
      ],
      { duration: 370, easing: "cubic-bezier(.25,.3,.4,1)", fill: "forwards" },
    );
    await animation.finished.catch(() => {});
  }
  returnAttacker(after) {
    const f = this.flight;
    if (!f) return;
    this.flight = null;
    const alive = after.players.some((p) =>
        p.board.some((u) => u.uid === f.uid),
      ),
      newEl = document.querySelector(`[data-target="${f.uid}"]`);
    if (newEl) newEl.style.visibility = "hidden";
    const frames = alive
      ? [
          {
            transform: `translate(${f.dx * 0.82}px,${f.dy * 0.82}px) scale(1.12)`,
            opacity: 1,
          },
          { transform: "translate(0,0) scale(1)", opacity: 1 },
        ]
      : [
          {
            transform: `translate(${f.dx * 0.82}px,${f.dy * 0.82}px) scale(1.12)`,
            opacity: 1,
          },
          {
            transform: `translate(${f.dx * 0.82}px,${f.dy * 0.82 - 35}px) scale(.5)`,
            opacity: 0,
          },
        ];
    f.wrapper
      .animate(frames, {
        duration: alive ? 240 : 450,
        easing: "ease-out",
        fill: "forwards",
      })
      .finished.catch(() => {})
      .finally(() => {
        f.wrapper.remove();
        if (newEl) newEl.style.visibility = "";
      });
  }

  shake(el) {
    if (!el || this.reduced) return;
    el.animate(
      [
        { transform: "translateX(0)" },
        { transform: "translateX(-8px) rotate(-1deg)" },
        { transform: "translateX(6px) rotate(1deg)" },
        { transform: "translateX(-3px)" },
        { transform: "translateX(0)" },
      ],
      { duration: 330, easing: "ease-out" },
    );
  }
  healing(p, amount) {
    this.ring(p, 0x8cffbd, 150, 950, 0.55);
    this.ring(p, 0xffdf9b, 110, 750, 0.25);
    this.glow(p, 0x65ffc4, 210, 800);
    this.burst(p, 0x91ffbb, 72, 100, 1100, 130);
    if (amount) this.label(p, "+" + amount, "healing");
  }
  shieldShell(p) {
    if (this.reduced) return;
    this.ensure();
    if (this.renderer) {
      const shape = new Shape();
      for (let i = 0; i < 6; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 3;
        const x = Math.cos(a) * 68,
          y = Math.sin(a) * 68;
        i ? shape.lineTo(x, y) : shape.moveTo(x, y);
      }
      shape.closePath();
      const geo = new ExtrudeGeometry(shape, {
        depth: 10,
        bevelEnabled: true,
        bevelSize: 3,
        bevelThickness: 2,
        bevelSegments: 1,
        steps: 1,
      });
      const mat = new MeshPhongMaterial({
        color: 0x84dfff,
        emissive: 0x204a66,
        shininess: 100,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      });
      const mesh = new Mesh(geo, mat);
      mesh.position.set(p.x, p.y, 25);
      this.scene.add(mesh);
      this.add(
        1000,
        (t) => {
          mesh.rotation.y = Math.sin(t * Math.PI * 2) * 0.45;
          mesh.rotation.z = -0.12 + t * 0.24;
          mesh.scale.setScalar(0.75 + Math.sin(t * Math.PI) * 0.3);
          mat.opacity = Math.sin(t * Math.PI) * 0.45;
        },
        () => {
          this.scene.remove(mesh);
          geo.dispose();
          mat.dispose();
        },
      );
    } else
      this.add(1000, (t) =>
        drawMesh(
          this.fallback,
          "shield",
          p,
          68 * (0.75 + Math.sin(t * Math.PI) * 0.3),
          Math.sin(t * Math.PI * 2) * 0.45,
          -0.12 + t * 0.24,
          0x91e4ff,
          Math.sin(t * Math.PI) * 0.45,
        ),
      );
  }
  shield(p, amount) {
    this.shieldShell(p);
    this.ring(p, 0x8edfff, 150, 900);
    this.ring(p, 0xffe39c, 168, 1100, 0.65);
    this.glow(p, 0x78cbff, 180, 850);
    this.burst(p, 0xc9ecff, 48, 90, 850);
    if (amount) this.label(p, "+" + amount + " 护甲", "shielding");
  }
  growth(p, amount, owner) {
    this.ring(p, 0xe6f8a7, 125, 600, 0.7);
    this.glow(p, 0xbce88c, 150, 600);
    this.burst(p, 0xe2f8b0, 34, 64, 650, 65);
    this.label(
      { ...p, y: p.y + p.h * 0.08 },
      "+" + amount + " 攻击",
      "growth",
      undefined,
      owner,
    );
  }
  summon(p) {
    this.ring({ ...p, y: p.y + p.h * 0.3 }, 0x9df6ce, 180, 850, 1);
    this.ring(p, 0xffd995, 130, 750);
    this.burst(p, 0xa1ffd6, 90, 140, 900);
    this.glow(p, 0xb9ffce, 240, 850);
  }
  death(p) {
    this.burst(p, 0xb8c6ed, 55, 105, 900);
    this.ring(p, 0xb0afde, 95, 550);
  }
  victory() {
    const generation = this.generation;
    for (let i = 0; i < 6; i++) {
      const timer = setTimeout(() => {
        this.pendingCelebrations.delete(timer);
        if (generation !== this.generation) return;
        this.burst(
          { x: innerWidth * (0.16 + i * 0.14), y: innerHeight * 0.28 },
          [0xffd780, 0x91ffd0, 0xf8e6ba][i % 3],
          70,
          180,
          1700,
        );
      }, i * 100);
      this.pendingCelebrations.add(timer);
    }
  }
  capture(state, a) {
    this.positions = {};
    this.ghosts = {};
    for (const p of state.players)
      for (const u of p.board) {
        const el = document.querySelector(`[data-target="${u.uid}"]`);
        if (el) {
          this.positions[u.uid] = center(el);
          this.ghosts[u.uid] = el.cloneNode(true);
        }
      }
    const side = state.active,
      p = state.players[side],
      sideClass = side ? "enemy-row" : "friend-row";
    let source,
      target,
      kind = "attack";
    if (a.type === "attack") {
      source = document.querySelector(`.${sideClass} [data-target="${a.uid}"]`);
      target =
        a.target === "hero"
          ? document.querySelector(side ? ".self .hero" : ".opponent .hero")
          : document.querySelector(`[data-target="${a.target}"]`);
    } else if (a.type === "power") {
      source = document.querySelector(side ? ".opponent .hero" : ".self .hero");
      target =
        a.target === "hero"
          ? document.querySelector(side ? ".self .hero" : ".opponent .hero")
          : a.target
            ? document.querySelector(`[data-target="${a.target}"]`)
            : source;
    } else if (a.type === "play") {
      source = side
        ? document.querySelector(".opponent .hero")
        : document.querySelector(
            `[data-action="card"][data-index="${a.index}"]`,
          );
      const c = p.hand[a.index];
      target =
        a.target === "hero"
          ? document.querySelector(side ? ".self .hero" : ".opponent .hero")
          : a.target
            ? document.querySelector(`[data-target="${a.target}"]`)
            : document.querySelector(`.${sideClass} .empty-slot`);
      kind = c;
    }
    return { source, target, a: center(source), b: center(target) };
  }
  async before(state, action, card, sound) {
    const generation = this.generation;
    const c = this.capture(state, action);
    if (action.type === "attack") {
      sound("attack");
      await this.lunge(c.source, c.b);
      if (generation !== this.generation) return;
      this.glow(c.b, 0xffbc64, 200, 500);
      this.ring(c.b, 0xffdfa3, 150, 550);
      this.burst(c.b, 0xffc47c, 80, 180, 800);
      sound("hit");
    } else if (action.type === "power") {
      if (action.kind === "spark") {
        sound("spark");
        await this.projectile(c.a, c.b, 0xb8a1ff, 430);
        if (generation !== this.generation) return;
        this.burst(c.b, 0xd4baff, 80, 160, 800);
        sound("hit");
      } else {
        this.glow(c.a, action.kind === "bloom" ? 0x9dffd3 : 0xc8b1ff, 180, 450);
        sound(action.kind === "bloom" ? "heal" : "summon");
        await wait(this.reduced ? 50 : 240);
      }
    } else if (action.type === "play" && card?.keyword === "damage") {
      sound("spark");
      await this.projectile(c.a, c.b, 0xff873e, 430);
      if (generation !== this.generation) return;
      this.burst(c.b, 0xffaa65, 90, 180, 850);
      sound("hit");
    } else if (action.type === "play") {
      this.glow(c.a, 0xbfffd2, 150, 360);
      sound(card?.type === "spell" ? "heal" : "summon");
      await wait(this.reduced ? 70 : 260);
    }
    return c;
  }
  after(before, after, action, sound) {
    this.returnAttacker(after);
    for (let side = 0; side < 2; side++) {
      const p = before.players[side],
        n = after.players[side],
        hero = document.querySelector(side ? ".opponent .hero" : ".self .hero"),
        hp = center(hero);
      if (n.hp < p.hp) {
        this.label(
          n.armor < p.armor ? { ...hp, x: hp.x - 22, y: hp.y - 15 } : hp,
          "−" + (p.hp - n.hp),
        );
        this.shake(hero);
      }
      if (n.hp > p.hp) {
        this.healing(hp, n.hp - p.hp);
        sound("heal");
      }
      if (n.armor > p.armor) {
        this.shield(hp, n.armor - p.armor);
        sound("shield");
      }
      if (n.armor < p.armor) {
        this.burst(hp, 0xaceaff, 50, 120, 700);
        this.label(
          { ...hp, x: hp.x + 70, y: hp.y + 34 },
          "−" + (p.armor - n.armor),
          "shielding",
        );
        sound("break");
      }
      // A reflow invalidates old floating unit labels, including feedback from
      // an earlier fast action. Do this before creating this action's markers.
      const rowHasDeath = p.board.some(
        (old) => !n.board.some((now) => now.uid === old.uid),
      );
      if (rowHasDeath) this.clearUnitLabels(p.board.map((u) => u.uid));
      for (const u of p.board) {
        const nu = n.board.find((x) => x.uid === u.uid),
          el = document.querySelector(`[data-target="${u.uid}"]`),
          destination = center(
            el || document.querySelector(side ? ".enemy-row" : ".friend-row"),
          ),
          oldPosition = this.positions?.[u.uid],
          hasDeath = rowHasDeath,
          pos =
            hasDeath && oldPosition && !this.reduced
              ? oldPosition
              : destination;
        if (nu && el && oldPosition && hasDeath && !this.reduced) {
          const dx = oldPosition.x - destination.x,
            dy = oldPosition.y - destination.y;
          if (Math.abs(dx) + Math.abs(dy) > 1)
            el.animate(
              [
                { transform: `translate(${dx}px,${dy}px)`, offset: 0 },
                {
                  transform: `translate(${dx}px,${dy}px)`,
                  offset: FX_TIMING.shiftHold,
                  easing: "ease-out",
                },
                { transform: "translate(0,0)", offset: 1 },
              ],
              {
                duration: FX_TIMING.unitShift,
                easing: "linear",
                fill: "both",
              },
            );
        }
        if (!nu) {
          const at = this.positions?.[u.uid] || pos;
          const ghost = this.ghosts?.[u.uid];
          if (ghost && !this.reduced) {
            ghost.classList.add("fx-ghost");
            ghost.style.left = at.x - at.w / 2 + "px";
            ghost.style.top = at.y - at.h / 2 + "px";
            ghost.style.width = at.w + "px";
            ghost.style.height = at.h + "px";
            ghost.setAttribute("aria-hidden", "true");
            document.body.appendChild(ghost);
            setTimeout(() => ghost.remove(), 700);
          }
          let dealt = u.hp;
          if (action.type === "attack") {
            if (action.target === u.uid)
              dealt =
                before.players[before.active].board.find(
                  (x) => x.uid === action.uid,
                )?.atk || dealt;
            if (action.uid === u.uid)
              dealt =
                before.players[1 - before.active].board.find(
                  (x) => x.uid === action.target,
                )?.atk || dealt;
          } else if (action.type === "play" && action.target === u.uid)
            dealt = 3;
          else if (
            ["ritual", "power"].includes(action.type) &&
            action.kind === "spark" &&
            action.target === u.uid
          )
            dealt = 2;
          if (!this.reduced)
            this.label(
              at,
              "−" + dealt,
              "damage death-damage",
              FX_TIMING.deathNumber,
              u.uid,
            );
          this.death(at);
          sound("death");
        } else if (nu.hp < u.hp) {
          this.label(pos, "−" + (u.hp - nu.hp), "damage", undefined, u.uid);
          this.shake(el);
        }
        if (nu && nu.atk > u.atk) {
          this.growth(pos, nu.atk - u.atk, u.uid);
          sound("growth");
          if (el && !this.reduced)
            el.animate(
              [
                { transform: "scale(1)" },
                { transform: "scale(1.06)" },
                { transform: "scale(1)" },
              ],
              { duration: 520, easing: "ease-out" },
            );
        }
      }
      for (const u of n.board) {
        if (!p.board.some((x) => x.uid === u.uid)) {
          const el = document.querySelector(`[data-target="${u.uid}"]`);
          this.summon(center(el));
          if (el && !this.reduced)
            el.animate(
              [
                {
                  opacity: 0,
                  transform: "translateY(-55px) scale(.3) rotateY(90deg)",
                },
                { opacity: 1, transform: "translateY(0) scale(1) rotateY(0)" },
              ],
              { duration: 650, easing: "cubic-bezier(.2,.8,.3,1)" },
            );
        }
      }
    }
  }
}
export const FX = new BattleEffects();
