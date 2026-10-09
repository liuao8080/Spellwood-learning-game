import { Color, DataTexture, RGBAFormat, SRGBColorSpace, LinearMipmapLinearFilter, LinearFilter } from 'three';

// One immutable, low-frequency color map. No noise shimmer, normal map or extra
// light is needed; the centre stays quiet beneath creatures and targeting rings.
export function createStoneSurfaceTexture(color = '#355b55') {
  const size = 256;
  const base = new Color(color).getHex();
  const channels = [(base >> 16) & 255, (base >> 8) & 255, base & 255];
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / (size - 1), v = y / (size - 1);
    const cloud = .46 * Math.sin(u * 8.1 + Math.sin(v * 5.7))
      + .32 * Math.cos(v * 10.3 - u * 3.1) + .22 * Math.sin((u + v) * 14.2);
    const edge = Math.max(0, 1 - Math.min(u, v, 1 - u, 1 - v) / .12);
    const wear = edge * edge * (.012 + .011 * Math.sin(u * 19.2 + v * 16.7));
    const shade = 1 + .075 * cloud + wear;
    const i = (y * size + x) * 4;
    for (let c = 0; c < 3; c++) data[i + c] = Math.min(255, Math.max(0, Math.round(channels[c] * shade)));
    data[i + 3] = 255;
  }
  const texture = new DataTexture(data, size, size, RGBAFormat);
  texture.name = 'spellwood-quiet-stone';
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}
