import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CARD } from '../src/cards.mjs';
import { CardTextures, cardArtPath, cardDisplayCost, containedArtwork } from '../src/arena3d/card-textures.mjs';

test('all explicit v4 artwork paths exist and preserve legacy art routing', () => {
  const cards = Object.values(CARD).filter(card => card.artPath);
  assert.equal(cards.length, 12);
  for (const card of cards) {
    assert.equal(cardArtPath(card), card.artPath);
    assert(fs.statSync(new URL(`../dist${card.artPath}`, import.meta.url)).size > 1000);
  }
  assert.equal(cardArtPath(CARD.fox), '/assets/creatures.webp');
  assert.equal(cardArtPath(CARD.hedgehog), '/assets/cards/hedgehog.webp');
});

test('contained illustration retains the whole square, centered inside both visible art windows', () => {
  for (const box of [[25, 30, 462, 359], [20, 22, 472, 323]]) {
    const [x, y, w, h] = containedArtwork(768, 768, ...box);
    assert.equal(w, h); assert.equal(y, box[1]); assert.equal(h, box[3]);
    assert.equal(x + w / 2, box[0] + box[2] / 2);
    assert(y + h <= (box[1] === 30 ? 389 : 345));
  }
});

test('cost face variants are bounded to base or the authorized one-cost reduction', () => {
  assert.equal(cardDisplayCost(CARD.acorn_squirrel, 0), 0);
  assert.equal(cardDisplayCost(CARD.crystal_ram, 3), 3);
  for (const value of [-1, 0, 2, 3.5, 99, '3', NaN, {}, undefined]) assert.equal(cardDisplayCost(CARD.crystal_ram, value), 4);
});

test('actual full and hand texture painting uses uncropped art and removes late callbacks on disposal', t => {
  const originals = Object.fromEntries(['document', 'Image'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const calls = [], images = [];
  const context = new Proxy({}, { get(target, key) {
    if (key === 'drawImage') return (...args) => calls.push(args);
    if (key === 'measureText') return text => ({ width: [...text].length * 25 });
    if (String(key).startsWith('create')) return () => ({ addColorStop() {} });
    return target[key] || (() => {});
  } });
  globalThis.document = { createElement: () => ({ getContext: () => context }) };
  globalThis.Image = class { constructor() { this.complete = true; this.naturalWidth = this.naturalHeight = 768; images.push(this); } };
  t.after(() => { for (const [key, descriptor] of Object.entries(originals)) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]; });
  const textures = new CardTextures();
  for (const mode of ['full', 'hand']) textures.get('mushroom_medic', 'base', mode);
  assert.equal(images.length, 1); assert.equal(images[0].src, CARD.mushroom_medic.artPath);
  assert.equal(calls.length, 2);
  for (const args of calls) assert.deepEqual(args.slice(1, 5), [0, 0, 768, 768]);
  assert.deepEqual(calls[0].slice(5), containedArtwork(768, 768, 25, 30, 462, 359));
  assert.deepEqual(calls[1].slice(5), containedArtwork(768, 768, 20, 22, 472, 323));
  const discounted = textures.get('mushroom_medic', 'base', 'hand', 1);
  assert.notEqual(discounted, textures.get('mushroom_medic', 'base', 'hand'));
  assert.equal(discounted, textures.get('mushroom_medic', 'base', 'hand', 1));
  const fullPrice = textures.get('mushroom_medic', 'base', 'hand');
  for (const invalid of [0, -1, 3, 999, 'instance-id']) assert.equal(textures.get('mushroom_medic', 'base', 'hand', invalid), fullPrice);
  assert.equal(textures.entries.size, 3);
  textures.retainTextures([discounted]); assert.equal(textures.entries.size, 1);
  textures.dispose(); assert.equal(images[0].onload, null); assert.equal(images[0].onerror, null);
});
