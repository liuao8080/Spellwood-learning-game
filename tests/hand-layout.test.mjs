import test from "node:test";
import assert from "node:assert/strict";
import { handLayout, scrollForHandIndex } from "../src/arena3d/hand-layout.mjs";
import { handRuleLines } from "../src/arena3d/card-textures.mjs";
import { CARD } from "../src/cards.mjs";

test("short landscape has seven readable whole cards independent of battlefield height", () => {
  const layout = handLayout({ width: 828, height: 168, count: 7 });
  assert.equal(layout.mode, "row"); assert.equal(layout.maxScroll, 0); assert.equal(layout.cardWidth, 112);
  assert.ok(layout.typography.name >= 16); assert.ok(layout.typography.description >= 14); assert.ok(layout.typography.cost >= 20);
  for (const card of layout.cards) { assert.ok(card.centerX - card.width / 2 >= 0); assert.ok(card.centerX + card.width / 2 <= 828); }
});
test("portrait preserves readable size and makes every card reachable, including seventh", () => {
  let layout = handLayout({ width: 304, height: 182, count: 7 });
  assert.equal(layout.mode, "scroll"); assert.ok(layout.typography.name >= 17); assert.ok(layout.typography.description >= 16);
  for (const index of [6, 3, 0]) {
    const scroll = scrollForHandIndex(layout, index); layout = handLayout({ width: 304, height: 182, count: 7, scroll });
    const card = layout.cards[index]; assert.ok(card.centerX - card.width / 2 >= 2.99); assert.ok(card.centerX + card.width / 2 <= 301.01);
  }
});
test("desktop uses a shallow seven-card fan; selection increases readability without unbounded zoom", () => {
  const normal = handLayout({ width: 884, height: 249, count: 7 });
  const selected = handLayout({ width: 884, height: 249, count: 7, selectedIndex: 6 });
  assert.equal(normal.mode, "fan"); assert.equal(normal.maxScroll, 0);
  assert.ok(normal.typography.name >= 19); assert.ok(normal.typography.description >= 17);
  assert.ok(normal.typography.name * 1.065 >= 20); assert.ok(normal.typography.description * 1.065 >= 18);
  assert.ok(Math.abs(normal.cards[6].rotationZ) < .09); assert.equal(selected.cards[6].rotationZ, 0);
  assert.ok(selected.cards[6].height < 230); assert.ok(selected.cards[6].centerY + selected.cards[6].height / 2 <= 249);
});
test("all 24 compact effects have at most two six-character lines and preserve source numbers", () => {
  for (const card of Object.values(CARD)) {
    const lines = handRuleLines(card); assert.ok(lines.length <= 2, card.id);
    assert.ok(lines.every(line => [...line].length <= 6), card.id + ": " + lines.join("/"));
    assert.ok(lines.every(line => !line.includes("NaN")), card.id);
    const sourceNumber = String(card.amount ?? String(card.text).match(/\d+/)?.[0] ?? "");
    if (sourceNumber) assert.ok(lines.join("").includes(sourceNumber), card.id);
  }
  assert.deepEqual(handRuleLines({ ...CARD.frost, amount: 8 }), ["任意敌人", "造成8伤害"]);
  assert.deepEqual(handRuleLines(CARD.boar), ["登场其余友方", "攻击+1"]);
});
