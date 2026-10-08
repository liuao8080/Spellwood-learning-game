import { CanvasTexture, SRGBColorSpace, LinearFilter } from "three";
import { CARD } from "../cards.mjs";
import { HAND_FONT } from "./hand-layout.mjs";

const individual = new Set(Object.keys(CARD).filter(id => CARD[id].art >= 6));
const finishColors = {base:["#f4d89e","#92652d","#eac887","#674928"],leaf:["#ddf2b8","#486b40","#acdc6e","#2d4b35"],silver:["#f8ffff","#738c9b","#e6fbff","#476070"],star:["#f5e3ff","#6c4397","#ceb2ff","#352449"],gold:["#fff8b0","#bd7626","#ffe477","#70441c"]};
const colors = { leaf: "#244e3d", ember: "#67392c", moon: "#343c64" };

/** Short presentation copy. Numbers come from the card data, never a second rules table. */
export function handRuleLines(cardOrId) {
  const card = typeof cardOrId === "string" ? CARD[cardOrId] : cardOrId;
  if (!card) return [];
  const number = Number(card.amount ?? String(card.text).match(/\d+/)?.[0]);
  switch (card.keyword) {
    case "rush": return ["迅捷", "登场即可攻击"];
    case "draw": return ["登场", `抽${number}张牌`];
    case "grow": return ["回合开始", `攻击+${number}`];
    case "guard": return ["守卫", "敌人优先攻击"];
    case "armor": return ["登场", `英雄护甲+${number}`];
    case "heal": return ["登场", `英雄生命+${number}`];
    case "damage": return ["任意敌人", `造成${number}伤害`];
    case "restore": return ["你的英雄", `生命+${number}`];
    case "insight": return [`抽${number}张牌`];
    case "barrier": return ["护盾", "挡首次伤害"];
    case "rally": return ["登场其余友方", `攻击+${number}`];
    default: return ["基础伙伴"];
  }
}
// Explicit phrase boundaries keep Chinese words and effect amounts together.
// Joining each layout must reproduce the rule text, or the generic wrapper wins.
const ruleLines = {
  sprout: ["小小的种子，", "也能守住森林。"],
  sprite: ["成长 · 回合开始时", "攻击+1"],
  turtle: ["守卫 · 敌人须", "优先攻击它"],
  golem: ["守卫 · 敌人须", "优先攻击它"],
  owl: ["登场 · 你的英雄", "获得2护甲"],
  stag: ["登场 · 为你的英雄", "恢复3生命"],
  spark: ["对任意敌人", "造成3点伤害"],
  bloom: ["为你的英雄", "恢复5生命"],
};


function round(ctx, x, y, w, h, r = 16) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function lines(ctx, text, width) {
  const result = [];
  let current = "";
  for (const letter of text) {
    if (current && ctx.measureText(current + letter).width > width) {
      result.push(current);
      current = "";
    }
    current += letter;
  }
  if (current) result.push(current);
  return result;
}

/** Original card faces are textures on physical meshes, never whole-board screenshots. */
export class CardTextures {
  constructor({ onChange = () => {} } = {}) {
    this.onChange = onChange;
    this.entries = new Map();
    this.images = new Map();
    this.disposed = false;
    this.back = this.makeBack();
  }

  texture(canvas) {
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.minFilter = LinearFilter;
    texture.generateMipmaps = false;
    return texture;
  }

  image(path) {
    if (this.images.has(path)) return this.images.get(path);
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      if (this.disposed) return;
      for (const [id, entry] of this.entries) {
        if (entry.path === path) this.paint(entry.cardId, entry, image);
      }
      this.onChange();
    };
    image.onerror = () => {
      if (!this.disposed) this.onChange();
    };
    this.images.set(path, image);
    image.src = path;
    return image;
  }

  get(id, finish = "base", mode = "full") {
    finish = Object.hasOwn(finishColors,finish) ? finish : "base";
    mode = mode === "hand" ? "hand" : "full";
    const key = mode === "hand" ? `${id}:${finish}:hand` : `${id}:${finish}`;
    if (this.entries.has(key)) return this.entries.get(key).texture;
    if (!CARD[id] || this.disposed) return this.back;
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 720;
    const path = individual.has(id) ? `/assets/cards/${id}.webp` : "/assets/creatures.webp";
    const entry = { canvas, texture: this.texture(canvas), path, cardId:id, finish, mode };
    this.entries.set(key, entry);
    const image = this.image(path);
    this.paint(id, entry, image.complete && image.naturalWidth ? image : null);
    return entry.texture;
  }

  paint(id, entry, image) {
    if (entry.mode === "hand") { this.paintHand(id, entry, image); return; }
    const c = CARD[id], ctx = entry.canvas.getContext("2d");
    ctx.clearRect(0, 0, 512, 720);
    const gold = ctx.createLinearGradient(0, 0, 512, 720);
    const palette = finishColors[entry.finish] || finishColors.base;
    gold.addColorStop(0, palette[0]);
    gold.addColorStop(0.45, palette[1]);
    gold.addColorStop(0.7, palette[2]);
    gold.addColorStop(1, palette[3]);
    ctx.fillStyle = gold;
    round(ctx, 0, 0, 512, 720, 28); ctx.fill();
    ctx.fillStyle = colors[c.theme] || colors.leaf;
    round(ctx, 13, 13, 486, 694, 22); ctx.fill();
    ctx.save(); round(ctx, 25, 30, 462, 398, 16); ctx.clip();
    if (image) {
      const sx = individual.has(id) ? 0 : (c.art % 3) * 512;
      const sy = individual.has(id) ? 0 : Math.floor(c.art / 3) * 512;
      const sw = individual.has(id) ? image.naturalWidth : 512;
      const sh = individual.has(id) ? image.naturalHeight : 512;
      const crop = Math.min(sw, sh * 462 / 398);
      ctx.drawImage(image, sx + (sw - crop) / 2, sy, crop, sh, 25, 30, 462, 398);
    } else {
      const bg = ctx.createRadialGradient(256, 220, 15, 256, 220, 280);
      bg.addColorStop(0, "#739c69"); bg.addColorStop(1, colors[c.theme]);
      ctx.fillStyle = bg; ctx.fillRect(25, 30, 462, 398);
      ctx.fillStyle = "#e2ca8b"; ctx.font = "100px serif"; ctx.textAlign = "center";
      ctx.fillText(c.type === "spell" ? "✦" : "❧", 256, 245);
    }
    ctx.restore();
    ctx.fillStyle = "#132d2a"; ctx.fillRect(25, 389, 462, 70);
    ctx.strokeStyle = "#c4a46a"; ctx.lineWidth = 2; ctx.strokeRect(25, 389, 462, 70);
    ctx.textAlign = "center"; ctx.fillStyle = "#fff1cb";
    ctx.font = "bold 48px 'Noto Sans CJK SC',sans-serif"; ctx.fillText(c.name, 256, 440);
    const paper = ctx.createLinearGradient(0, 459, 0, 695);
    paper.addColorStop(0, "#e9dfbd"); paper.addColorStop(1, "#b9aa83");
    ctx.fillStyle = paper; ctx.fillRect(25, 460, 462, 230);
    ctx.fillStyle = "#353c31"; ctx.font = "32px Georgia,serif";
    ctx.fillText(c.en, 256, 500);
    ctx.font = "bold 42px 'Noto Sans CJK SC',sans-serif";
    const preferred = ruleLines[id];
    const description = preferred?.join("") === c.text && preferred.every(line => ctx.measureText(line).width <= 408)
      ? preferred : lines(ctx, c.text, 408).slice(0, 3);
    description.forEach((s, i) => ctx.fillText(s, 256, 551 + i * 44));
    ctx.fillStyle = "#4d8799";
    ctx.beginPath(); ctx.arc(48, 52, 45, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#cfe6dc"; ctx.lineWidth = 5; ctx.stroke();
    ctx.fillStyle = "#fff8dd"; ctx.font = "bold 80px Georgia,serif";
    ctx.fillText(String(c.cost), 48, 81);
    if (c.type !== "spell") {
      for (const [x, value, fill] of [[47, c.atk, "#bd9447"], [465, c.hp, "#b95d4e"]]) {
        ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(x, 670, 38, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#ecd8a6"; ctx.lineWidth = 5; ctx.stroke();
        ctx.fillStyle = "#fff8dc"; ctx.font = "bold 70px Georgia,serif"; ctx.fillText(String(value), x, 693);
      }
    } else {
      ctx.fillStyle = "#5e5945"; ctx.font = "23px sans-serif"; ctx.fillText("法术", 256, 672);
    }
    if (entry.finish && entry.finish !== "base") {
      ctx.save(); ctx.translate(460,54); ctx.rotate(Math.PI/4); ctx.fillStyle=palette[2]; ctx.strokeStyle=palette[0]; ctx.lineWidth=3; ctx.fillRect(-17,-17,34,34); ctx.strokeRect(-17,-17,34,34); ctx.restore();
    }
    entry.texture.needsUpdate = true;
  }

  paintHand(id, entry, image) {
    const card = CARD[id], ctx = entry.canvas.getContext("2d"), palette = finishColors[entry.finish] || finishColors.base;
    ctx.clearRect(0, 0, 512, 720);
    const frame = ctx.createLinearGradient(0, 0, 512, 720);
    frame.addColorStop(0, palette[0]); frame.addColorStop(.5, palette[1]); frame.addColorStop(1, palette[2]);
    ctx.fillStyle = frame; round(ctx, 0, 0, 512, 720, 25); ctx.fill();
    ctx.fillStyle = colors[card.theme] || colors.leaf; round(ctx, 10, 10, 492, 700, 18); ctx.fill();
    ctx.save(); round(ctx, 20, 22, 472, 323, 12); ctx.clip();
    if (image) {
      const separate = individual.has(id), sx = separate ? 0 : card.art % 3 * 512, sy = separate ? 0 : Math.floor(card.art / 3) * 512;
      const sw = separate ? image.naturalWidth : 512, sh = separate ? image.naturalHeight : 512;
      const cropHeight = Math.min(sh, sw * 323 / 472);
      ctx.drawImage(image, sx, sy + (sh - cropHeight) * .3, sw, cropHeight, 20, 22, 472, 323);
    } else {
      const art = ctx.createRadialGradient(256, 180, 15, 256, 180, 270);
      art.addColorStop(0, "#86a77c"); art.addColorStop(1, colors[card.theme]);
      ctx.fillStyle = art; ctx.fillRect(20, 22, 472, 323);
    }
    ctx.restore(); ctx.textAlign = "center";
    ctx.fillStyle = "#102d28"; ctx.fillRect(20, 345, 472, 99);
    ctx.fillStyle = "#fff4d5"; ctx.font = `bold ${HAND_FONT.name}px 'Noto Sans CJK SC',sans-serif`;
    ctx.fillText(card.name, 256, 424, 448);
    const paper = ctx.createLinearGradient(0, 444, 0, 700);
    paper.addColorStop(0, "#f1e6c9"); paper.addColorStop(1, "#ccbb94");
    ctx.fillStyle = paper; ctx.fillRect(20, 447, 472, 253);
    ctx.fillStyle = "#28372c"; ctx.font = `bold ${HAND_FONT.description}px 'Noto Sans CJK SC',sans-serif`;
    const summary = handRuleLines(card);
    summary.forEach((line, index) => ctx.fillText(line, 256, (summary.length === 1 ? 560 : 520) + index * 77, 442));
    ctx.fillStyle = "#286b7f"; ctx.beginPath(); ctx.arc(60, 62, 53, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#d8f5ed"; ctx.lineWidth = 5; ctx.stroke();
    ctx.fillStyle = "#fff9e5"; ctx.font = `bold ${HAND_FONT.cost}px Georgia,serif`; ctx.fillText(String(card.cost), 60, 96);
    if (card.type !== "spell") {
      for (const [x, value, fill] of [[78, card.atk, "#a87629"], [434, card.hp, "#a7433c"]]) {
        ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(x, 664, 47, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#fff0c7"; ctx.lineWidth = 4; ctx.stroke();
        ctx.fillStyle = "#fff8dd"; ctx.font = `bold ${HAND_FONT.stats}px Georgia,serif`; ctx.fillText(String(value), x, 695);
      }
    } else { ctx.fillStyle = "#635940"; ctx.font = "bold 42px sans-serif"; ctx.fillText("法术", 256, 675); }
    if (entry.finish !== "base") {
      ctx.save(); ctx.translate(460, 56); ctx.rotate(Math.PI / 4); ctx.fillStyle = palette[2]; ctx.fillRect(-17, -17, 34, 34); ctx.restore();
    }
    entry.texture.needsUpdate = true;
  }

  makeBack() {
    const canvas = document.createElement("canvas");
    canvas.width = 256; canvas.height = 360;
    const c = canvas.getContext("2d"), bg = c.createLinearGradient(0, 0, 256, 360);
    bg.addColorStop(0, "#113a35"); bg.addColorStop(1, "#071d23"); c.fillStyle = bg;
    c.fillRect(0, 0, 256, 360);
    for (const gap of [8, 15]) {
      c.strokeStyle = gap === 8 ? "#c6a66b" : "#577d66"; c.lineWidth = 3;
      round(c, gap, gap, 256 - gap * 2, 360 - gap * 2, 15); c.stroke();
    }
    c.translate(128, 180); c.strokeStyle = "#c5ad73"; c.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
      c.save(); c.rotate(i * Math.PI / 4); c.beginPath();
      c.moveTo(0, -100); c.quadraticCurveTo(25, -55, 0, -20); c.quadraticCurveTo(-25, -55, 0, -100); c.stroke(); c.restore();
    }
    c.fillStyle = "#d7be7e"; c.beginPath();
    c.moveTo(0, -46); c.lineTo(30, 0); c.lineTo(0, 46); c.lineTo(-30, 0); c.closePath(); c.fill();
    c.fillStyle = "#3d8a70"; c.beginPath(); c.arc(0, 0, 14, 0, Math.PI * 2); c.fill();
    return this.texture(canvas);
  }

  /** Call only after consumers have released old meshes. The back is always retained. */
  retainTextures(textures) {
    const keep = new Set(textures), paths = new Set();
    for (const [key, entry] of this.entries) {
      if (keep.has(entry.texture)) paths.add(entry.path);
      else { entry.texture.dispose(); this.entries.delete(key); }
    }
    for (const [path, image] of this.images) if (!paths.has(path)) {
      image.onload = image.onerror = null; this.images.delete(path);
    }
  }

  dispose() {
    this.disposed = true;
    for (const image of this.images.values()) image.onload = image.onerror = null;
    for (const entry of this.entries.values()) entry.texture.dispose();
    this.back.dispose(); this.entries.clear(); this.images.clear();
  }
}
