import * as THREE from 'three';
import { Rng, clamp01, lerp } from '../core/math';

/**
 * Procedural PBR texture generation. Every surface texture in the game is
 * synthesized here at load time from tileable noise and simple pattern
 * generators (no image files). Each texture set provides albedo, normal and
 * roughness maps.
 */
export interface TextureSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
}

type Field = Float32Array;

// ---------------------------------------------------------------------------
// Tileable value noise
// ---------------------------------------------------------------------------
function latticeHash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h & 0xffffff) / 0xffffff;
}

function tileNoise(x: number, y: number, period: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const x0 = ((ix % period) + period) % period;
  const y0 = ((iy % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y1 = (y0 + 1) % period;
  const a = latticeHash(x0, y0, seed);
  const b = latticeHash(x1, y0, seed);
  const c = latticeHash(x0, y1, seed);
  const d = latticeHash(x1, y1, seed);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
}

function fbmField(n: number, basePeriod: number, octaves: number, seed: number, gain = 0.5): Field {
  const f = new Float32Array(n * n);
  let amp = 1;
  let norm = 0;
  let period = basePeriod;
  for (let o = 0; o < octaves; o++) {
    const s = period / n;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        f[y * n + x] += amp * tileNoise(x * s, y * s, period, seed + o * 31);
      }
    }
    norm += amp;
    amp *= gain;
    period *= 2;
  }
  for (let i = 0; i < f.length; i++) f[i] /= norm;
  return f;
}

// ---------------------------------------------------------------------------
// Map output helpers
// ---------------------------------------------------------------------------
function toCanvas(n: number, fill: (i: number, out: Uint8ClampedArray, o: number) => void): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(n, n);
  for (let i = 0; i < n * n; i++) fill(i, img.data, i * 4);
  ctx.putImageData(img, 0, 0);
  return c;
}

function makeTex(canvas: HTMLCanvasElement, srgb: boolean): THREE.Texture {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

function normalFromHeight(n: number, h: Field, strength: number): HTMLCanvasElement {
  return toCanvas(n, (i, out, o) => {
    const x = i % n;
    const y = (i / n) | 0;
    const l = h[y * n + ((x - 1 + n) % n)];
    const r = h[y * n + ((x + 1) % n)];
    const u = h[((y - 1 + n) % n) * n + x];
    const d = h[((y + 1) % n) * n + x];
    let nx = (l - r) * strength;
    let ny = (d - u) * strength;
    let nz = 1;
    const len = Math.hypot(nx, ny, nz);
    nx /= len;
    ny /= len;
    nz /= len;
    out[o] = (nx * 0.5 + 0.5) * 255;
    out[o + 1] = (ny * 0.5 + 0.5) * 255;
    out[o + 2] = (nz * 0.5 + 0.5) * 255;
    out[o + 3] = 255;
  });
}

function finishSet(
  n: number,
  height: Field,
  color: (i: number) => [number, number, number],
  rough: (i: number) => number,
  normalStrength: number,
): TextureSet {
  const albedo = toCanvas(n, (i, out, o) => {
    const [r, g, b] = color(i);
    out[o] = clamp01(r) * 255;
    out[o + 1] = clamp01(g) * 255;
    out[o + 2] = clamp01(b) * 255;
    out[o + 3] = 255;
  });
  const rc = toCanvas(n, (i, out, o) => {
    const v = clamp01(rough(i)) * 255;
    out[o] = v;
    out[o + 1] = v;
    out[o + 2] = v;
    out[o + 3] = 255;
  });
  return {
    map: makeTex(albedo, true),
    normalMap: makeTex(normalFromHeight(n, height, normalStrength), false),
    roughnessMap: makeTex(rc, false),
  };
}

function hexToRgb(hex: number): [number, number, number] {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

function mix3(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

// ---------------------------------------------------------------------------
// Pattern generators
// ---------------------------------------------------------------------------
interface Blocks {
  height: Field;
  id: Float32Array;
  edge: Field;
}

/** Running-bond stone blocks with bevelled edges and irregular sizes. */
function blocks(n: number, rows: number, cols: number, mortar: number, seed: number, jitter = 0.25): Blocks {
  const rng = new Rng(seed);
  const height = new Float32Array(n * n);
  const id = new Float32Array(n * n);
  const edge = new Float32Array(n * n);
  const rowH = n / rows;
  // Pre-compute column splits per row for irregular widths
  const splits: number[][] = [];
  for (let r = 0; r < rows; r++) {
    const s: number[] = [];
    let acc = r % 2 === 0 ? 0 : 0.5;
    for (let c = 0; c < cols; c++) {
      s.push(acc);
      acc += 1 + (rng.next() - 0.5) * jitter;
    }
    const scale = cols / (acc - (r % 2 === 0 ? 0 : 0.5));
    splits.push(s.map((v) => v * scale));
  }
  for (let y = 0; y < n; y++) {
    const r = Math.floor(y / rowH);
    const fy = (y - r * rowH) / rowH;
    const sp = splits[r];
    for (let x = 0; x < n; x++) {
      const cx = (x / n) * cols;
      let c = 0;
      // find the block containing cx (wrap aware)
      let start = sp[0];
      let end = sp[0] + cols;
      for (let k = 0; k < sp.length; k++) {
        const s0 = sp[k];
        const s1 = k + 1 < sp.length ? sp[k + 1] : sp[0] + cols;
        let px = cx;
        if (px < s0) px += cols;
        if (px >= s0 && px < s1) {
          c = k;
          start = s0;
          end = s1;
          break;
        }
      }
      let px = cx;
      if (px < start) px += cols;
      const fx = (px - start) / (end - start);
      const bw = (end - start) * (n / cols);
      const dx = Math.min(fx, 1 - fx) * bw;
      const dy = Math.min(fy, 1 - fy) * rowH;
      const d = Math.min(dx, dy);
      const e = clamp01(d / mortar);
      const i = y * n + x;
      edge[i] = e;
      id[i] = latticeHash(r, c, seed);
      height[i] = e < 1 ? e * e * 0.6 : 0.6 + (1 - Math.exp(-(d - mortar) / (mortar * 2))) * 0.4;
    }
  }
  return { height, id, edge };
}

// ---------------------------------------------------------------------------
// Texture sets
// ---------------------------------------------------------------------------
export function stoneWall(n = 512, seed = 1): TextureSet {
  const b = blocks(n, 8, 4, 5, seed, 0.5);
  const noise = fbmField(n, 8, 5, seed + 5);
  const fine = fbmField(n, 64, 3, seed + 9);
  const h = new Float32Array(n * n);
  for (let i = 0; i < h.length; i++) h[i] = b.height[i] * 0.8 + noise[i] * 0.25 + fine[i] * 0.12;
  const c1 = hexToRgb(0x5d5a55);
  const c2 = hexToRgb(0x45423e);
  const moss = hexToRgb(0x3a4133);
  const mortar = hexToRgb(0x2a2825);
  return finishSet(
    n,
    h,
    (i) => {
      let c = mix3(c1, c2, b.id[i] * 0.8 + noise[i] * 0.4);
      c = mix3(c, moss, clamp01((noise[i] - 0.55) * 3) * 0.6);
      c = mix3(mortar, c, b.edge[i]);
      const f = 0.82 + fine[i] * 0.3;
      return [c[0] * f, c[1] * f, c[2] * f];
    },
    (i) => 0.75 + noise[i] * 0.2 - (1 - b.edge[i]) * 0.05,
    3.2,
  );
}

export function flagstone(n = 512, seed = 2): TextureSet {
  const b = blocks(n, 4, 3, 4, seed, 0.9);
  const noise = fbmField(n, 6, 5, seed + 3);
  const fine = fbmField(n, 48, 3, seed + 7);
  const h = new Float32Array(n * n);
  for (let i = 0; i < h.length; i++) h[i] = b.height[i] * 0.7 + noise[i] * 0.3 + fine[i] * 0.1;
  const c1 = hexToRgb(0x4e4b46);
  const c2 = hexToRgb(0x3b3935);
  const dirt = hexToRgb(0x2c2822);
  return finishSet(
    n,
    h,
    (i) => {
      let c = mix3(c1, c2, b.id[i] * 0.7 + fine[i] * 0.4);
      c = mix3(dirt, c, clamp01(b.edge[i] * 1.2));
      const f = 0.85 + noise[i] * 0.25;
      return [c[0] * f, c[1] * f, c[2] * f];
    },
    (i) => 0.7 + fine[i] * 0.25,
    2.6,
  );
}

export function woodPlanks(n = 512, seed = 3): TextureSet {
  const planks = 6;
  const grain = fbmField(n, 4, 4, seed);
  const fine = fbmField(n, 64, 2, seed + 1);
  const h = new Float32Array(n * n);
  const id = new Float32Array(n * n);
  const edge = new Float32Array(n * n);
  const pw = n / planks;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const p = Math.floor(x / pw);
      const fx = (x - p * pw) / pw;
      const off = latticeHash(p, 0, seed) * n;
      const seg = Math.floor(((y + off) % n) / (n / 2));
      const fy = (((y + off) % n) % (n / 2)) / (n / 2);
      const e = clamp01(Math.min(fx, 1 - fx) * pw / 2.5) * clamp01(Math.min(fy, 1 - fy) * (n / 2) / 2);
      const i = y * n + x;
      const g = Math.sin((x * 0.9 + grain[i] * 40) * 0.6) * 0.5 + 0.5;
      id[i] = latticeHash(p, seg, seed);
      edge[i] = e;
      h[i] = e * (0.6 + g * 0.15 + fine[i] * 0.1);
    }
  }
  const c1 = hexToRgb(0x4a3a2b);
  const c2 = hexToRgb(0x2e241b);
  return finishSet(
    n,
    h,
    (i) => {
      const x = i % n;
      const g = Math.sin((x * 0.9 + grain[i] * 40) * 0.6) * 0.5 + 0.5;
      let c = mix3(c1, c2, id[i] * 0.6 + g * 0.3);
      c = mix3([0.08, 0.07, 0.06], c, edge[i]);
      const f = 0.75 + fine[i] * 0.3;
      return [c[0] * f, c[1] * f, c[2] * f];
    },
    (i) => 0.8 + fine[i] * 0.15,
    2.2,
  );
}

export function plaster(n = 512, seed = 4): TextureSet {
  const noise = fbmField(n, 4, 6, seed);
  const stain = fbmField(n, 3, 4, seed + 8);
  const fine = fbmField(n, 64, 2, seed + 2);
  const h = new Float32Array(n * n);
  for (let i = 0; i < h.length; i++) h[i] = noise[i] * 0.6 + fine[i] * 0.3;
  const c1 = hexToRgb(0x6b645a);
  const c2 = hexToRgb(0x4a4238);
  const rot = hexToRgb(0x2f3228);
  return finishSet(
    n,
    h,
    (i) => {
      const y = (i / n) | 0;
      let c = mix3(c1, c2, noise[i]);
      // water line stains increasing toward the bottom
      c = mix3(c, rot, clamp01((stain[i] - 0.45) * 2 + (y / n) * 0.5) * 0.7);
      return c;
    },
    (i) => 0.85 + fine[i] * 0.1,
    1.8,
  );
}

export function bark(n = 256, seed = 5): TextureSet {
  const noise = fbmField(n, 4, 4, seed);
  const h = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const ridge = Math.abs(Math.sin((x / n) * Math.PI * 14 + noise[i] * 6));
      h[i] = ridge * 0.7 + noise[i] * 0.3;
    }
  }
  const c1 = hexToRgb(0x2d2823);
  const c2 = hexToRgb(0x171412);
  return finishSet(n, h, (i) => mix3(c2, c1, h[i]), (i) => 0.9 - h[i] * 0.1, 4);
}

export function groundDetail(n = 512, seed = 6): TextureSet {
  const noise = fbmField(n, 8, 6, seed);
  const pebbles = fbmField(n, 64, 2, seed + 4);
  const h = new Float32Array(n * n);
  for (let i = 0; i < h.length; i++) h[i] = noise[i] * 0.6 + Math.max(0, pebbles[i] - 0.6) * 1.4;
  // grayscale albedo modulated by terrain vertex colors in the shader
  return finishSet(
    n,
    h,
    (i) => {
      const v = 0.72 + noise[i] * 0.35 + Math.max(0, pebbles[i] - 0.62) * 0.8;
      return [v, v, v];
    },
    (i) => 0.92 - Math.max(0, pebbles[i] - 0.6) * 0.3,
    2.4,
  );
}

export function rock(n = 512, seed = 7): TextureSet {
  const noise = fbmField(n, 4, 7, seed, 0.55);
  const cracks = fbmField(n, 16, 3, seed + 3);
  const h = new Float32Array(n * n);
  for (let i = 0; i < h.length; i++) h[i] = noise[i] * 0.8 - Math.max(0, 0.08 - Math.abs(cracks[i] - 0.5)) * 4;
  const c1 = hexToRgb(0x55524c);
  const c2 = hexToRgb(0x34322e);
  const lichen = hexToRgb(0x4b4f3e);
  return finishSet(
    n,
    h,
    (i) => {
      let c = mix3(c2, c1, noise[i]);
      c = mix3(c, lichen, clamp01((cracks[i] - 0.6) * 4) * 0.5);
      return c;
    },
    (i) => 0.8 + noise[i] * 0.15,
    3.5,
  );
}

export function roofTiles(n = 512, seed = 8): TextureSet {
  const b = blocks(n, 10, 8, 3, seed, 0.3);
  const noise = fbmField(n, 8, 4, seed + 2);
  const h = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    const fy = (y % (n / 10)) / (n / 10);
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      h[i] = b.height[i] * (0.4 + fy * 0.6) + noise[i] * 0.2;
    }
  }
  const c1 = hexToRgb(0x3a3430);
  const c2 = hexToRgb(0x26221f);
  const moss = hexToRgb(0x333a2c);
  return finishSet(
    n,
    h,
    (i) => {
      let c = mix3(c1, c2, b.id[i]);
      c = mix3(c, moss, clamp01((noise[i] - 0.5) * 3) * 0.5);
      return mix3([0.05, 0.05, 0.05], c, b.edge[i]);
    },
    (i) => 0.8 + noise[i] * 0.15,
    3,
  );
}

export function iron(n = 256, seed = 9): TextureSet {
  const noise = fbmField(n, 6, 5, seed);
  const rust = fbmField(n, 4, 4, seed + 1);
  const h = new Float32Array(n * n);
  for (let i = 0; i < h.length; i++) h[i] = noise[i] * 0.4 + Math.max(0, rust[i] - 0.5);
  const c1 = hexToRgb(0x3c3d3f);
  const r = hexToRgb(0x4d3322);
  return finishSet(n, h, (i) => mix3(c1, r, clamp01((rust[i] - 0.45) * 2.5)), (i) => 0.45 + clamp01((rust[i] - 0.45) * 2.5) * 0.45, 1.5);
}

export function cloth(n = 256, seed = 10): TextureSet {
  const noise = fbmField(n, 4, 4, seed);
  const h = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      h[i] = (Math.sin(x * 1.6) * Math.sin(y * 1.6)) * 0.15 + noise[i] * 0.5;
    }
  }
  const c1 = hexToRgb(0x3a2e2a);
  const c2 = hexToRgb(0x1e1816);
  return finishSet(n, h, (i) => mix3(c2, c1, noise[i]), () => 0.95, 1.2);
}

/** Tiling normal map for water ripples. */
export function waterNormal(n = 256, seed = 11): THREE.Texture {
  const a = fbmField(n, 8, 4, seed);
  const tex = makeTex(normalFromHeight(n, a, 6), false);
  return tex;
}

/** Canvas texture with scrawled text for environmental messages. */
export function scrawlTexture(text: string, opts: { color?: string; width?: number; height?: number; font?: string; carved?: boolean } = {}): THREE.CanvasTexture {
  const w = opts.width ?? 1024;
  const h = opts.height ?? 256;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);
  const lines = text.split('\n');
  const size = Math.min(92, (h * 0.8) / lines.length);
  ctx.font = opts.font ?? `${size}px "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const rng = new Rng(text.length * 77 + text.charCodeAt(0));
  lines.forEach((line, li) => {
    const y = h / 2 + (li - (lines.length - 1) / 2) * size * 1.05;
    // draw each glyph with jitter to look hand-scrawled
    const totalW = ctx.measureText(line).width;
    let x = w / 2 - totalW / 2;
    for (const ch of line) {
      const cw = ctx.measureText(ch).width;
      ctx.save();
      ctx.translate(x + cw / 2, y + rng.range(-3, 3));
      ctx.rotate(rng.range(-0.08, 0.08));
      if (opts.carved) {
        ctx.fillStyle = 'rgba(0,0,0,0.85)';
        ctx.fillText(ch, 1.5, 1.5);
        ctx.fillStyle = opts.color ?? 'rgba(170,160,140,0.9)';
        ctx.fillText(ch, 0, 0);
      } else {
        ctx.fillStyle = opts.color ?? 'rgba(120,20,14,0.92)';
        ctx.fillText(ch, 0, 0);
        // drips
        if (rng.chance(0.25)) {
          ctx.fillRect(rng.range(-cw / 3, cw / 3), size * 0.3, 2.5, rng.range(8, 40));
        }
      }
      ctx.restore();
      x += cw;
    }
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export interface TextureLibrary {
  stone: TextureSet;
  flag: TextureSet;
  wood: TextureSet;
  plaster: TextureSet;
  bark: TextureSet;
  ground: TextureSet;
  rock: TextureSet;
  roof: TextureSet;
  iron: TextureSet;
  cloth: TextureSet;
  water: THREE.Texture;
}

export function generateTextures(quality: 'low' | 'medium' | 'high'): TextureLibrary {
  const big = quality === 'low' ? 256 : 512;
  const small = quality === 'low' ? 128 : 256;
  return {
    stone: stoneWall(big),
    flag: flagstone(big),
    wood: woodPlanks(big),
    plaster: plaster(big),
    bark: bark(small),
    ground: groundDetail(big),
    rock: rock(big),
    roof: roofTiles(big),
    iron: iron(small),
    cloth: cloth(small),
    water: waterNormal(small),
  };
}
