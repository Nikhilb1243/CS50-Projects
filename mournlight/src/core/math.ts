import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function invLerp(a: number, b: number, v: number): number {
  return a === b ? 0 : (v - a) / (b - a);
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** Frame-rate independent exponential smoothing. `rate` is roughly 1/seconds-to-settle. */
export function damp(current: number, target: number, rate: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-rate * dt));
}

export function wrapAngle(a: number): number {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

export function angleDiff(from: number, to: number): number {
  return wrapAngle(to - from);
}

export function dampAngle(current: number, target: number, rate: number, dt: number): number {
  return current + angleDiff(current, target) * (1 - Math.exp(-rate * dt));
}

export function moveTowardsAngle(current: number, target: number, maxStep: number): number {
  const d = angleDiff(current, target);
  if (Math.abs(d) <= maxStep) return target;
  return current + Math.sign(d) * maxStep;
}

export function moveTowards(current: number, target: number, maxStep: number): number {
  if (Math.abs(target - current) <= maxStep) return target;
  return current + Math.sign(target - current) * maxStep;
}

export function easeInOut(t: number): number {
  t = clamp01(t);
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export function easeOut(t: number): number {
  t = clamp01(t);
  return 1 - (1 - t) * (1 - t);
}

export function easeIn(t: number): number {
  t = clamp01(t);
  return t * t;
}

export function easeOutBack(t: number): number {
  t = clamp01(t);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

/** Yaw (rotation about +Y) that makes a model facing +Z look along (dx, dz). */
export function yawTo(dx: number, dz: number): number {
  return Math.atan2(dx, dz);
}

export function forwardFromYaw(yaw: number, out = new THREE.Vector3()): THREE.Vector3 {
  return out.set(Math.sin(yaw), 0, Math.cos(yaw));
}

/** Deterministic PRNG (mulberry32). */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }
  int(lo: number, hi: number): number {
    return Math.floor(this.range(lo, hi + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
}

export const rng = new Rng(0xc0ffee);

export function rand(lo = 0, hi = 1): number {
  return lo + Math.random() * (hi - lo);
}

// ---------------------------------------------------------------------------
// Value noise (2D / 3D) used for terrain, fog and flicker
// ---------------------------------------------------------------------------
function hash2(ix: number, iz: number): number {
  let h = ix * 374761393 + iz * 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h & 0xffffff) / 0xffffff;
}

export function valueNoise2(x: number, z: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uz) * 2 - 1;
}

export function fbm2(x: number, z: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise2(x * freq, z * freq);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** 1D smooth noise for flicker, sway, etc. */
export function noise1(t: number, seed = 0): number {
  return valueNoise2(t, seed * 17.13);
}

// ---------------------------------------------------------------------------
// Geometry helpers for combat
// ---------------------------------------------------------------------------
const _d1 = new THREE.Vector3();
const _d2 = new THREE.Vector3();
const _r = new THREE.Vector3();
const _c1 = new THREE.Vector3();
const _c2 = new THREE.Vector3();

/** Squared distance between segments p1-q1 and p2-q2. */
export function segmentSegmentDistSq(
  p1: THREE.Vector3,
  q1: THREE.Vector3,
  p2: THREE.Vector3,
  q2: THREE.Vector3,
  outC1?: THREE.Vector3,
  outC2?: THREE.Vector3,
): number {
  _d1.subVectors(q1, p1);
  _d2.subVectors(q2, p2);
  _r.subVectors(p1, p2);
  const a = _d1.dot(_d1);
  const e = _d2.dot(_d2);
  const f = _d2.dot(_r);
  let s = 0;
  let t = 0;
  const EPS = 1e-8;
  if (a <= EPS && e <= EPS) {
    s = t = 0;
  } else if (a <= EPS) {
    s = 0;
    t = clamp01(f / e);
  } else {
    const c = _d1.dot(_r);
    if (e <= EPS) {
      t = 0;
      s = clamp01(-c / a);
    } else {
      const b = _d1.dot(_d2);
      const denom = a * e - b * b;
      s = denom !== 0 ? clamp01((b * f - c * e) / denom) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp01(-c / a);
      } else if (t > 1) {
        t = 1;
        s = clamp01((b - c) / a);
      }
    }
  }
  _c1.copy(p1).addScaledVector(_d1, s);
  _c2.copy(p2).addScaledVector(_d2, t);
  if (outC1) outC1.copy(_c1);
  if (outC2) outC2.copy(_c2);
  return _c1.distanceToSquared(_c2);
}

export function pointSegmentDistSq(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, out?: THREE.Vector3): number {
  _d1.subVectors(b, a);
  const len = _d1.lengthSq();
  const t = len > 1e-8 ? clamp01(_r.subVectors(p, a).dot(_d1) / len) : 0;
  _c1.copy(a).addScaledVector(_d1, t);
  if (out) out.copy(_c1);
  return _c1.distanceToSquared(p);
}
