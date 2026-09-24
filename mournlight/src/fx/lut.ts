import * as THREE from 'three';

/**
 * Procedural colour-grading LUTs. Each region has a grade (slope/offset/power
 * per channel, saturation, contrast, split toning) that is baked into a small
 * 3D texture. The grade pass samples the LUT in gamma space so the darks,
 * where this game lives, get most of the precision.
 */
export interface GradeDef {
  slope: [number, number, number];
  offset: [number, number, number];
  power: [number, number, number];
  sat: number;
  contrast: number;
  shadowTint: [number, number, number];
  highTint: [number, number, number];
  split: number;
}

const N: GradeDef = { slope: [1, 1, 1], offset: [0, 0, 0], power: [1, 1, 1], sat: 1, contrast: 1, shadowTint: [0.5, 0.5, 0.5], highTint: [0.5, 0.5, 0.5], split: 0 };
const g = (d: Partial<GradeDef>): GradeDef => ({ ...N, ...d });

export const REGION_GRADES: Record<string, GradeDef> = {
  neutral: N,
  // bone-dust green shadows, crushed and airless
  crypt: g({ slope: [0.98, 1.02, 0.97], offset: [0.004, 0.01, 0.006], power: [1.06, 1.0, 1.04], sat: 0.85, contrast: 1.08, shadowTint: [0.42, 0.52, 0.46], highTint: [0.55, 0.52, 0.44], split: 0.35 }),
  // cold moonlit slate
  road: g({ slope: [0.97, 1.0, 1.05], offset: [0, 0.004, 0.012], power: [1.02, 1.0, 0.98], sat: 0.95, contrast: 1.04, shadowTint: [0.42, 0.47, 0.58], highTint: [0.52, 0.52, 0.5], split: 0.3 }),
  // brine: teal murk, lifted wet shadows
  village: g({ slope: [0.94, 1.02, 1.02], offset: [0.0, 0.014, 0.014], power: [1.05, 0.98, 0.98], sat: 0.9, contrast: 1.02, shadowTint: [0.36, 0.52, 0.52], highTint: [0.54, 0.54, 0.46], split: 0.45 }),
  // rot-sick olive with amber highlights
  forest: g({ slope: [1.0, 1.02, 0.92], offset: [0.006, 0.01, 0.0], power: [1.0, 0.98, 1.08], sat: 0.88, contrast: 1.06, shadowTint: [0.44, 0.52, 0.4], highTint: [0.6, 0.52, 0.38], split: 0.4 }),
  // steel shadows, candle-amber highlights, deep blacks
  cathedral: g({ slope: [1.03, 1.0, 0.98], offset: [-0.004, -0.002, 0.004], power: [1.02, 1.02, 1.0], sat: 0.95, contrast: 1.14, shadowTint: [0.4, 0.46, 0.58], highTint: [0.62, 0.52, 0.38], split: 0.45 }),
  // drowned: green-black water light
  catacombs: g({ slope: [0.92, 1.0, 1.0], offset: [0, 0.008, 0.01], power: [1.08, 1.02, 1.0], sat: 0.75, contrast: 1.12, shadowTint: [0.34, 0.48, 0.5], highTint: [0.5, 0.56, 0.6], split: 0.5 }),
  // storm: steel and bone white
  bellspire: g({ slope: [0.98, 1.0, 1.06], offset: [0, 0.004, 0.012], power: [1.0, 1.0, 0.97], sat: 0.8, contrast: 1.1, shadowTint: [0.4, 0.44, 0.56], highTint: [0.56, 0.56, 0.6], split: 0.35 }),
  // bruised violet shadows, arterial highlights
  arena: g({ slope: [1.06, 0.96, 0.98], offset: [0.008, 0.0, 0.01], power: [0.98, 1.04, 1.0], sat: 1.0, contrast: 1.1, shadowTint: [0.52, 0.4, 0.56], highTint: [0.64, 0.44, 0.38], split: 0.5 }),
};

export const LUT_SIZE = 24;

function applyGrade(d: GradeDef, rgb: [number, number, number]): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) out[c] = Math.pow(Math.max(0, rgb[c] * d.slope[c] + d.offset[c]), d.power[c]);
  const l = out[0] * 0.2126 + out[1] * 0.7152 + out[2] * 0.0722;
  for (let c = 0; c < 3; c++) {
    let v = l + (out[c] - l) * d.sat;
    v = 0.42 + (v - 0.42) * d.contrast;
    // split toning: soft-light style tint by luminance
    const tint = d.shadowTint[c] + (d.highTint[c] - d.shadowTint[c]) * Math.min(1, Math.max(0, l * 1.6));
    v += (tint - 0.5) * d.split * (1 - Math.abs(l - 0.35)) * 0.35;
    out[c] = Math.min(1, Math.max(0, v));
  }
  return out;
}

/** Bake a grade into a LUT_SIZE^3 RGBA8 3D texture. Domain and range are gamma encoded. */
export function bakeLut(d: GradeDef): THREE.Data3DTexture {
  const n = LUT_SIZE;
  const data = new Uint8Array(n * n * n * 4);
  let o = 0;
  for (let b = 0; b < n; b++)
    for (let gg = 0; gg < n; gg++)
      for (let r = 0; r < n; r++) {
        const res = applyGrade(d, [r / (n - 1), gg / (n - 1), b / (n - 1)]);
        data[o++] = Math.round(res[0] * 255);
        data[o++] = Math.round(res[1] * 255);
        data[o++] = Math.round(res[2] * 255);
        data[o++] = 255;
      }
  const tex = new THREE.Data3DTexture(data, n, n, n);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

const cache = new Map<string, THREE.Data3DTexture>();
export function regionLut(id: string): THREE.Data3DTexture {
  const key = id in REGION_GRADES ? id : 'neutral';
  let t = cache.get(key);
  if (!t) {
    t = bakeLut(REGION_GRADES[key]);
    cache.set(key, t);
  }
  return t;
}
