// The dry-stick tooth as pixels: a seamless tile of seeded noise, encoded as a grayscale PNG data URL. White keeps the
// stroke, black takes a speck out of it. Being plain pixels laid out by the ordinary transform, it looks the same at
// every opacity, rotation, scale and render scale, which a per-stroke turbulence filter does not: browsers pick the
// space they evaluate turbulence in from the transform's kind and from whether a parent is composited, so a filtered
// chalk line changed its grain, or lost thin strokes altogether, as its object dimmed or turned.
import { random } from "./noise.ts";

/** The tile's side, in the stroke's own units: one pixel is one unit. */
export const TILE = 256;
const SPREAD = 0.3;

// Smooth value noise on a lattice that wraps every `px` by `py` cells, so the tile has no seam.
function lattice(seed: number, x: number, y: number, px: number, py: number): number {
  const [i, j] = [Math.floor(x), Math.floor(y)];
  const [fx, fy] = [x - i, y - j];
  const [sx, sy] = [fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)];
  const at = (a: number, b: number) => random(seed, (((a % px) + px) % px) * 7919 + (((b % py) + py) % py));
  const top = at(i, j) * (1 - sx) + at(i + 1, j) * sx;
  const low = at(i, j + 1) * (1 - sx) + at(i + 1, j + 1) * sx;
  return (top * (1 - sy) + low * sy) * 2 - 1;
}

/**
 * The tile's pixels, row by row, 0 to 255. `amount` is the style's grain (0 to 1): more grain takes more specks out.
 * The grain is about two units across, a little longer one way than the other, as a stick drags across a board's tooth.
 */
export function toothPixels(amount: number, seed = 5): Uint8Array {
  const out = new Uint8Array(TILE * TILE);
  const cut = 0.34 + amount * 0.14;
  const octaves = [[0.42, 0.6, 1], [0.84, 1.2, 0.5], [1.68, 2.4, 0.25]] as const;
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      let v = 0;
      for (const [k, [fx, fy, a]] of octaves.entries()) {
        const [px, py] = [Math.round(TILE * fx), Math.round(TILE * fy)];
        v += a * lattice(seed + k * 101, (x * px) / TILE, (y * py) / TILE, px, py);
      }
      const n = 0.5 + v * SPREAD; // spread like a fractal noise channel, around a half
      out[y * TILE + x] = Math.round(255 * Math.max(0, Math.min(1, 7 * (n - cut))));
    }
  }
  return out;
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (b: Uint8Array) => {
  let c = 0xffffffff;
  for (const v of b) c = CRC[(c ^ v) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const u32 = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];

// A grayscale PNG with the image data in stored (uncompressed) deflate blocks: a few dozen lines, no zlib needed, and
// the same bytes in a browser, in Node and in every render.
export function grayPng(pixels: Uint8Array, w: number, h: number): Uint8Array {
  const raw = new Uint8Array(h * (w + 1));
  for (let y = 0; y < h; y++) raw.set(pixels.subarray(y * w, y * w + w), y * (w + 1) + 1); // filter byte 0 per row
  const z: number[] = [0x78, 0x01];
  for (let at = 0; at < raw.length; at += 65535) {
    const len = Math.min(65535, raw.length - at);
    z.push(at + len >= raw.length ? 1 : 0, len & 255, len >>> 8, ~len & 255, (~len >>> 8) & 255);
    for (let i = 0; i < len; i++) z.push(raw[at + i]!);
  }
  let [a, b] = [1, 0];
  for (const v of raw) [a, b] = [(a + v) % 65521, (b + (a + v) % 65521) % 65521];
  z.push(...u32(((b << 16) | a) >>> 0));
  const chunk = (type: string, data: number[]) => {
    const body = new Uint8Array([...type].map((c) => c.charCodeAt(0)).concat(data));
    return [...u32(data.length), ...body, ...u32(crc32(body))];
  };
  return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...chunk("IHDR", [...u32(w), ...u32(h), 8, 0, 0, 0, 0]), ...chunk("IDAT", z), ...chunk("IEND", [])]);
}

const made = new Map<number, string>();
/** The tooth tile for a grain amount, as a data URL; made once per amount. */
export function toothTile(amount: number): string {
  const key = Math.round(amount * 1000) / 1000;
  let url = made.get(key);
  if (!url) {
    const png = grayPng(toothPixels(key), TILE, TILE);
    let s = "";
    for (let i = 0; i < png.length; i += 8192) s += String.fromCharCode(...png.subarray(i, i + 8192));
    url = `data:image/png;base64,${btoa(s)}`;
    made.set(key, url);
  }
  return url;
}
