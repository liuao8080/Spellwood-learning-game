import { Color, DataTexture, RGBAFormat, SRGBColorSpace, LinearMipmapLinearFilter, LinearFilter } from 'three';

const distanceToSegment = (x, y, segment) => {
  const [ax, ay, bx, by] = segment, dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
};

// Original leaf incisions sit only in the four corners. Soft, paired dark/bright
// strokes suggest shallow carved edges; they are colour, not displacement.
function leafIncisions() {
  const segments = [], start = [.11, .082], end = [.245, .162];
  const point = (t, side = 0) => [start[0] + (end[0] - start[0]) * t + side * .019 * Math.sin(t * Math.PI),
    start[1] + (end[1] - start[1]) * t - side * .027 * Math.sin(t * Math.PI)];
  segments.push([...start, ...end]);
  for (const side of [-1, 1]) {
    let previous = start;
    for (let i = 1; i <= 16; i++) { const next = point(i / 16, side); segments.push([...previous, ...next]); previous = next; }
    for (const t of [.32, .52, .72]) segments.push([...point(t - .09), ...point(t, side)]);
  }
  return segments;
}

const leafSegments = leafIncisions();
const stonePixels = new Map();
const softStroke = distance => Math.exp(-((distance / .0032) ** 2));
function engraving(u, v) {
  const x = (u - .5) * 1.58, y = v - .5, radius = .06;
  const borderDistance = (px, py) => {
    const qx = Math.abs(px) - (.728 - radius), qy = Math.abs(py) - (.455 - radius);
    return Math.hypot(Math.max(0, qx), Math.max(0, qy)) + Math.min(Math.max(qx, qy), 0) - radius;
  };
  let shade = -.14 * softStroke(borderDistance(x, y)) + .065 * softStroke(borderDistance(x - .0035, y + .0035));
  const cornerX = Math.min(u, 1 - u) * 1.58, cornerY = Math.min(v, 1 - v);
  if (cornerX < .27 && cornerY < .20) {
    let groove = Infinity, lip = Infinity;
    for (const segment of leafSegments) {
      groove = Math.min(groove, distanceToSegment(cornerX, cornerY, segment));
      lip = Math.min(lip, distanceToSegment(cornerX - .0035, cornerY + .0035, segment));
    }
    shade += -.17 * softStroke(groove) + .075 * softStroke(lip);
  }
  return shade;
}

// One immutable map and the same material/draw submissions. The unengraved
// centre retains the existing quiet cloud colour under units and target rings.
export function createStoneSurfaceTexture(color = '#355b55') {
  const size = 512;
  const base = new Color(color).getHex();
  const channels = [(base >> 16) & 255, (base >> 8) & 255, base & 255];
  let pixels = stonePixels.get(base);
  if (!pixels) {
   pixels = new Uint8Array(size * size * 4);
   for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / (size - 1), v = y / (size - 1);
    const cloud = .46 * Math.sin(u * 8.1 + Math.sin(v * 5.7))
      + .32 * Math.cos(v * 10.3 - u * 3.1) + .22 * Math.sin((u + v) * 14.2);
    const edge = Math.max(0, 1 - Math.min(u, v, 1 - u, 1 - v) / .12);
    const wear = edge * edge * (.012 + .011 * Math.sin(u * 19.2 + v * 16.7));
    const shade = 1 + .075 * cloud + wear + engraving(u, v);
    const i = (y * size + x) * 4;
    for (let c = 0; c < 3; c++) pixels[i + c] = Math.min(255, Math.max(0, Math.round(channels[c] * shade)));
    pixels[i + 3] = 255;
   }
   // Responsive arenas replace their owned GPU texture, not the baked artwork.
   // Bound the CPU cache; each texture receives an independent pixel array.
   if (stonePixels.size >= 4) stonePixels.delete(stonePixels.keys().next().value);
   stonePixels.set(base, pixels);
  }
  const texture = new DataTexture(pixels.slice(), size, size, RGBAFormat);
  texture.name = 'spellwood-quiet-stone';
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}
