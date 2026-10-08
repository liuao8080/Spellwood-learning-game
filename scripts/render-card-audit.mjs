/** Offline CPU Canvas proof of authored card faces. Not a browser/GPU screenshot.
 * Requires optional @napi-rs/canvas in the Node development environment. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { CARDS } from '../src/cards.mjs';
import { CardTextures } from '../src/arena3d/card-textures.mjs';
const require = createRequire(import.meta.url);
const { createCanvas, Image } = require('@napi-rs/canvas');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv[2] || 'test-results/card-faces');
fs.mkdirSync(output, { recursive: true });
class LocalImage extends Image {
  set src(value) {
    if (!/^\/assets\/[A-Za-z0-9_./-]+\.(webp|png)$/.test(value) || value.includes('..')) throw Error('Only local project art is permitted');
    super.src = fs.readFileSync(path.join(root, 'dist', value));
  }
}
globalThis.document = { createElement(name) { if (name !== 'canvas') throw Error('CPU audit only supports canvas'); return createCanvas(1, 1); } };
globalThis.Image = LocalImage;
const textures = new CardTextures();
for (const card of CARDS) textures.get(card.id);
for (const image of textures.images.values()) await image.decode();
for (const [id, entry] of textures.entries) {
  textures.paint(id, entry, textures.images.get(entry.path));
  fs.writeFileSync(path.join(output, id + '.png'), entry.canvas.toBuffer('image/png'));
}
fs.writeFileSync(path.join(output, 'back.png'), textures.back.image.toBuffer('image/png'));
fs.writeFileSync(path.join(output, 'README.txt'), 'OFFLINE CPU CANVAS CARD TEXTURES\nDrawn by the actual CardTextures module with the project art and installed fonts.\nThese images are not browser screenshots or a WebGL rendering test.\n');
textures.dispose();
console.log(JSON.stringify({ kind: 'offline-cpu-canvas', files: CARDS.length + 1, output }));
