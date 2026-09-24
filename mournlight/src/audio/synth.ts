/**
 * Procedural sound synthesis. Every sound effect in MOURNLIGHT is rendered
 * here into an AudioBuffer from oscillators, filtered noise and envelopes.
 */
type Gen = (d: Float32Array, sr: number, r: () => number) => void;

// ---------------------------------------------------------------------------
// DSP helpers
// ---------------------------------------------------------------------------
function rngFrom(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 4294967296) * 2 - 1;
  };
}

class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  constructor(
    private type: 'lp' | 'hp' | 'bp' | 'peak',
    private sr: number,
    f: number,
    private q = 0.707,
    private gainDb = 0,
  ) {
    this.set(f);
  }
  set(f: number, q = this.q): void {
    const w = (2 * Math.PI * Math.min(f, this.sr * 0.45)) / this.sr;
    const cs = Math.cos(w);
    const sn = Math.sin(w);
    const alpha = sn / (2 * q);
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let a0 = 1;
    let a1 = 0;
    let a2 = 0;
    switch (this.type) {
      case 'lp':
        b0 = (1 - cs) / 2;
        b1 = 1 - cs;
        b2 = (1 - cs) / 2;
        a0 = 1 + alpha;
        a1 = -2 * cs;
        a2 = 1 - alpha;
        break;
      case 'hp':
        b0 = (1 + cs) / 2;
        b1 = -(1 + cs);
        b2 = (1 + cs) / 2;
        a0 = 1 + alpha;
        a1 = -2 * cs;
        a2 = 1 - alpha;
        break;
      case 'bp':
        b0 = alpha;
        b1 = 0;
        b2 = -alpha;
        a0 = 1 + alpha;
        a1 = -2 * cs;
        a2 = 1 - alpha;
        break;
      case 'peak': {
        const A = Math.pow(10, this.gainDb / 40);
        b0 = 1 + alpha * A;
        b1 = -2 * cs;
        b2 = 1 - alpha * A;
        a0 = 1 + alpha / A;
        a1 = -2 * cs;
        a2 = 1 - alpha / A;
        break;
      }
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }
  p(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

const exp = (t: number, tau: number): number => Math.exp(-t / tau);
const ar = (t: number, a: number, tau: number): number => (t < a ? t / a : Math.exp(-(t - a) / tau));
const bell = (t: number, len: number): number => (t < 0 || t > len ? 0 : Math.sin((Math.PI * t) / len));
const saw = (ph: number): number => 2 * (ph - Math.floor(ph + 0.5));
const tanh = Math.tanh;

function normalize(d: Float32Array, peak = 0.9): void {
  let m = 0;
  for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
  if (m < 1e-6) return;
  const k = peak / m;
  for (let i = 0; i < d.length; i++) d[i] *= k;
}

function fadeEdges(d: Float32Array, sr: number, fin = 0.003, fout = 0.02): void {
  const a = Math.floor(fin * sr);
  const b = Math.floor(fout * sr);
  for (let i = 0; i < a && i < d.length; i++) d[i] *= i / a;
  for (let i = 0; i < b && i < d.length; i++) d[d.length - 1 - i] *= i / b;
}

/** Make a loop seamless by crossfading the tail into the head. */
function makeLoop(d: Float32Array, sr: number, xf = 0.25): Float32Array<ArrayBuffer> {
  const n = Math.floor(xf * sr);
  const out = new Float32Array(d.length - n);
  for (let i = 0; i < out.length; i++) out[i] = d[i];
  for (let i = 0; i < n; i++) {
    const t = i / n;
    out[i] = d[i] * t + d[out.length + i] * (1 - t);
  }
  return out;
}

// Additive inharmonic metal
function metal(d: Float32Array, sr: number, freqs: number[], taus: number[], amp = 1, start = 0): void {
  const s0 = Math.floor(start * sr);
  for (let k = 0; k < freqs.length; k++) {
    const f = freqs[k];
    const tau = taus[k] ?? taus[taus.length - 1];
    for (let i = s0; i < d.length; i++) {
      const t = (i - s0) / sr;
      d[i] += Math.sin(2 * Math.PI * f * t) * exp(t, tau) * amp / (1 + k * 0.4);
    }
  }
}

function thump(d: Float32Array, sr: number, f0: number, f1: number, tau: number, amp = 1, start = 0): void {
  const s0 = Math.floor(start * sr);
  let ph = 0;
  for (let i = s0; i < d.length; i++) {
    const t = (i - s0) / sr;
    const f = f1 + (f0 - f1) * exp(t, tau * 0.5);
    ph += f / sr;
    d[i] += Math.sin(2 * Math.PI * ph) * ar(t, 0.002, tau) * amp;
  }
}

function noiseBurst(d: Float32Array, sr: number, r: () => number, type: 'lp' | 'hp' | 'bp', f: number, q: number, env: (t: number) => number, amp = 1, start = 0, sweep?: (t: number) => number): void {
  const flt = new Biquad(type, sr, f, q);
  const s0 = Math.floor(start * sr);
  for (let i = s0; i < d.length; i++) {
    const t = (i - s0) / sr;
    if (sweep && i % 32 === 0) flt.set(sweep(t), q);
    d[i] += flt.p(r()) * env(t) * amp;
  }
}

function formantVoice(d: Float32Array, sr: number, r: () => number, f0: (t: number) => number, formants: [number, number][], env: (t: number) => number, breath = 0.2, drive = 1): void {
  const filters = formants.map(([f, q]) => new Biquad('bp', sr, f, q));
  let ph = 0;
  for (let i = 0; i < d.length; i++) {
    const t = i / sr;
    ph += f0(t) / sr;
    const src = saw(ph % 1) * 0.8 + r() * breath;
    let y = 0;
    for (const fl of filters) y += fl.p(src);
    d[i] += tanh(y * drive) * env(t);
  }
}

// ---------------------------------------------------------------------------
// Sound catalogue
// ---------------------------------------------------------------------------
interface SoundDef {
  dur: number;
  variants?: number;
  loop?: boolean;
  gen: Gen;
  peak?: number;
  stereo?: boolean;
}

export const SOUNDS: Record<string, SoundDef> = {
  step_stone: {
    dur: 0.14, variants: 4, peak: 0.55,
    gen: (d, sr, r) => {
      noiseBurst(d, sr, r, 'bp', 900 + r() * 400, 0.9, (t) => ar(t, 0.002, 0.022));
      thump(d, sr, 140, 70, 0.03, 0.8);
    },
  },
  step_dirt: {
    dur: 0.16, variants: 4, peak: 0.45,
    gen: (d, sr, r) => {
      noiseBurst(d, sr, r, 'bp', 520 + r() * 200, 0.7, (t) => ar(t, 0.004, 0.035));
      for (let k = 0; k < 5; k++) noiseBurst(d, sr, r, 'bp', 2200, 2, (t) => ar(t, 0.001, 0.004), 0.4, 0.01 + Math.abs(r()) * 0.08);
      thump(d, sr, 110, 60, 0.03, 0.6);
    },
  },
  step_water: {
    dur: 0.38, variants: 4, peak: 0.5,
    gen: (d, sr, r) => {
      noiseBurst(d, sr, r, 'bp', 500, 1.2, (t) => ar(t, 0.015, 0.09), 1, 0, (t) => 400 + t * 3000);
      for (let k = 0; k < 4; k++) {
        const st = 0.04 + Math.abs(r()) * 0.2;
        const f0 = 500 + Math.abs(r()) * 700;
        const s0 = Math.floor(st * sr);
        let ph = 0;
        for (let i = s0; i < d.length; i++) {
          const t = (i - s0) / sr;
          ph += (f0 + t * 4000) / sr;
          d[i] += Math.sin(2 * Math.PI * ph) * ar(t, 0.002, 0.02) * 0.25;
        }
      }
    },
  },
  step_wood: {
    dur: 0.2, variants: 3, peak: 0.5,
    gen: (d, sr, r) => {
      thump(d, sr, 190, 120, 0.05, 1);
      noiseBurst(d, sr, r, 'bp', 900, 1, (t) => ar(t, 0.002, 0.02), 0.6);
      metal(d, sr, [320, 510], [0.06, 0.04], 0.2);
    },
  },
  step_drag: {
    dur: 0.42, variants: 3, peak: 0.5,
    gen: (d, sr, r) => {
      thump(d, sr, 110, 55, 0.06, 1);
      noiseBurst(d, sr, r, 'bp', 650, 1.5, (t) => bell(t - 0.05, 0.34) * (0.6 + 0.4 * Math.sin(t * 90)), 0.7);
    },
  },
  step_light: {
    dur: 0.08, variants: 3, peak: 0.3,
    gen: (d, sr, r) => noiseBurst(d, sr, r, 'bp', 1800, 1.5, (t) => ar(t, 0.001, 0.012)),
  },
  step_skitter: {
    dur: 0.25, variants: 3, peak: 0.4,
    gen: (d, sr, r) => {
      for (let k = 0; k < 7; k++) noiseBurst(d, sr, r, 'bp', 2500 + r() * 600, 3, (t) => ar(t, 0.0008, 0.005), 1, k * 0.03 + Math.abs(r()) * 0.01);
    },
  },
  step_armor: {
    dur: 0.32, variants: 3, peak: 0.6,
    gen: (d, sr, r) => {
      thump(d, sr, 120, 60, 0.05, 1);
      metal(d, sr, [1100 + r() * 50, 1650, 2310, 3120], [0.08, 0.06, 0.05, 0.04], 0.35, 0.01);
      noiseBurst(d, sr, r, 'hp', 3000, 0.7, (t) => ar(t, 0.001, 0.03), 0.3);
    },
  },
  step_boss: {
    dur: 0.9, variants: 2, peak: 0.85,
    gen: (d, sr, r) => {
      thump(d, sr, 70, 34, 0.25, 1);
      noiseBurst(d, sr, r, 'lp', 220, 0.7, (t) => ar(t, 0.005, 0.25), 0.8);
    },
  },
  swing: {
    dur: 0.32, variants: 3, peak: 0.45,
    gen: (d, sr, r) => noiseBurst(d, sr, r, 'bp', 600, 1.4, (t) => bell(t, 0.3) ** 2, 1, 0, (t) => 500 + Math.sin((t / 0.3) * Math.PI) * 1900),
  },
  swing_heavy: {
    dur: 0.5, variants: 2, peak: 0.6,
    gen: (d, sr, r) => {
      noiseBurst(d, sr, r, 'bp', 400, 1.1, (t) => bell(t, 0.48) ** 2, 1, 0, (t) => 280 + Math.sin((t / 0.48) * Math.PI) * 1100);
      noiseBurst(d, sr, r, 'lp', 200, 0.7, (t) => bell(t, 0.48) ** 2, 0.5);
    },
  },
  hit_flesh: {
    dur: 0.35, variants: 3, peak: 0.85,
    gen: (d, sr, r) => {
      thump(d, sr, 150, 55, 0.06, 1);
      noiseBurst(d, sr, r, 'lp', 1500, 0.8, (t) => ar(t, 0.001, 0.04), 0.7);
      noiseBurst(d, sr, r, 'bp', 380, 2.5, (t) => ar(t, 0.01, 0.09) * (0.6 + 0.4 * Math.sin(t * 160)), 0.8);
    },
  },
  hit_armor: {
    dur: 0.6, variants: 2, peak: 0.8,
    gen: (d, sr, r) => {
      metal(d, sr, [523 + r() * 20, 1307, 2210, 3170, 4890], [0.2, 0.14, 0.1, 0.07, 0.05], 0.6);
      noiseBurst(d, sr, r, 'hp', 2500, 0.7, (t) => ar(t, 0.001, 0.02), 0.8);
      thump(d, sr, 130, 70, 0.05, 0.7);
    },
  },
  hit_wax: {
    dur: 0.45, variants: 2, peak: 0.8,
    gen: (d, sr, r) => {
      thump(d, sr, 100, 45, 0.09, 1);
      noiseBurst(d, sr, r, 'bp', 900, 0.8, (t) => ar(t, 0.002, 0.07), 0.7);
      for (let k = 0; k < 8; k++) noiseBurst(d, sr, r, 'hp', 3000, 1, (t) => ar(t, 0.0005, 0.004), 0.3, 0.05 + Math.abs(r()) * 0.3);
    },
  },
  block: {
    dur: 0.45, variants: 2, peak: 0.75,
    gen: (d, sr, r) => {
      metal(d, sr, [410 + r() * 30, 930, 1560, 2600], [0.12, 0.09, 0.06, 0.04], 0.7);
      noiseBurst(d, sr, r, 'bp', 1800, 0.8, (t) => ar(t, 0.001, 0.03), 0.6);
      thump(d, sr, 120, 80, 0.04, 0.5);
    },
  },
  parry: {
    dur: 1.6, peak: 0.85,
    gen: (d, sr, r) => {
      metal(d, sr, [880, 1321, 2217, 3521, 5180, 6620], [0.7, 0.55, 0.45, 0.3, 0.2, 0.12], 0.8);
      noiseBurst(d, sr, r, 'hp', 4000, 0.7, (t) => ar(t, 0.0005, 0.015), 1);
      thump(d, sr, 200, 90, 0.05, 0.5);
    },
  },
  guard_break: {
    dur: 0.8, peak: 0.85,
    gen: (d, sr, r) => {
      metal(d, sr, [300, 710, 1190, 1740, 2890], [0.25, 0.18, 0.12, 0.08, 0.05], 0.7);
      noiseBurst(d, sr, r, 'bp', 1200, 0.6, (t) => ar(t, 0.001, 0.12), 0.9);
      thump(d, sr, 90, 40, 0.1, 1);
    },
  },
  roll: {
    dur: 0.45, variants: 2, peak: 0.45,
    gen: (d, sr, r) => {
      noiseBurst(d, sr, r, 'bp', 1400, 0.6, (t) => bell(t, 0.4) * (0.5 + 0.5 * Math.abs(r())), 0.7);
      thump(d, sr, 100, 60, 0.05, 0.6, 0.22);
    },
  },
  land: {
    dur: 0.3, peak: 0.6,
    gen: (d, sr, r) => {
      thump(d, sr, 95, 45, 0.07, 1);
      noiseBurst(d, sr, r, 'lp', 700, 0.7, (t) => ar(t, 0.002, 0.06), 0.6);
    },
  },
  drink: {
    dur: 1.1, peak: 0.55,
    gen: (d, sr, r) => {
      for (let k = 0; k < 3; k++) {
        const st = 0.1 + k * 0.3;
        thump(d, sr, 210, 120, 0.08, 0.7, st);
        noiseBurst(d, sr, r, 'bp', 450, 2, (t) => ar(t, 0.01, 0.08), 0.5, st);
      }
    },
  },
  heal: {
    dur: 1.6, peak: 0.45,
    gen: (d, sr) => {
      const fs = [261.6, 392, 523.3, 784];
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const env = Math.min(1, t / 0.25) * exp(Math.max(0, t - 0.25), 0.6);
        let y = 0;
        for (let k = 0; k < fs.length; k++) y += Math.sin(2 * Math.PI * fs[k] * t * (1 + 0.002 * Math.sin(t * 5 + k))) / (k + 1);
        d[i] += y * env;
      }
    },
  },
  hurt: {
    dur: 0.35, variants: 3, peak: 0.6,
    gen: (d, sr, r) => formantVoice(d, sr, r, (t) => 125 - t * 60, [[650, 5], [1150, 6]], (t) => ar(t, 0.01, 0.12), 0.3, 1.8),
  },
  player_death: {
    dur: 3, peak: 0.7,
    gen: (d, sr, r) => {
      formantVoice(d, sr, r, (t) => 100 - t * 20, [[500, 4], [850, 5]], (t) => ar(t, 0.05, 0.5) * 0.7, 0.6, 1.2);
      noiseBurst(d, sr, r, 'lp', 500, 0.7, (t) => ar(t, 0.2, 1.0), 0.6, 0.1, (t) => 600 - t * 150);
      let ph = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        ph += (110 - t * 18) / sr;
        d[i] += Math.sin(2 * Math.PI * ph) * ar(t, 0.3, 1.4) * 0.5;
      }
    },
  },
  shambler_groan: {
    dur: 1.6, variants: 3, peak: 0.7,
    gen: (d, sr, r) => {
      const base = 62 + Math.abs(r()) * 22;
      formantVoice(d, sr, r, (t) => base + Math.sin(t * 31) * 4 + t * 6, [[480, 4], [880, 5], [2400, 8]], (t) => bell(t, 1.5) ** 0.7, 0.35, 2.2);
    },
  },
  shambler_attack: {
    dur: 0.8, variants: 2, peak: 0.8,
    gen: (d, sr, r) => formantVoice(d, sr, r, (t) => 95 + t * 40, [[600, 3], [1100, 4]], (t) => ar(t, 0.05, 0.3), 0.6, 3),
  },
  stalker_creak: {
    dur: 0.9, variants: 3, peak: 0.6,
    gen: (d, sr, r) => {
      const flt = new Biquad('bp', sr, 700 + Math.abs(r()) * 500, 9);
      let next = 0;
      let rate = 0.04;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        let x = 0;
        if (t >= next) {
          x = 1;
          rate = Math.max(0.006, rate * 0.9);
          next = t + rate * (0.6 + Math.abs(r()) * 0.8);
        }
        d[i] += flt.p(x + r() * 0.02) * bell(t, 0.88);
      }
    },
  },
  // A drawn-out, many-throated wail that rises and breaks.
  screamer_wail: {
    dur: 2.2, peak: 0.85,
    gen: (d, sr, r) => {
      for (const [f, det] of [[520, 1], [610, 1.013], [760, 0.987]] as [number, number][]) {
        let ph = 0;
        for (let i = 0; i < d.length; i++) {
          const t = i / sr;
          const f0 = (f + t * 260 + Math.sin(t * 38 * det) * 22 + (t > 1.5 ? (t - 1.5) * 900 : 0)) * det;
          ph += f0 / sr;
          d[i] += tanh(Math.sin(2 * Math.PI * ph) * 3) * ar(t, 0.25, 0.9) * 0.28;
        }
      }
      noiseBurst(d, sr, r, 'bp', 2600, 1.5, (t) => ar(t, 0.2, 1.2), 0.5);
    },
  },
  // Joints snapping back into place as a corpse stands.
  mimic_crack: {
    dur: 1.0, variants: 2, peak: 0.8,
    gen: (d, sr, r) => {
      for (let k = 0; k < 9; k++) noiseBurst(d, sr, r, 'bp', 900 + Math.abs(r()) * 1500, 3, (t) => ar(t, 0.0005, 0.02), 1, Math.abs(r()) * 0.85);
      formantVoice(d, sr, r, (t) => 70 + t * 30, [[500, 4], [900, 5]], (t) => ar(t, 0.2, 0.6), 0.8, 2.5);
    },
  },
  // Dry, papery wingbeats (looped for the swarm).
  moth_flutter: {
    dur: 1.2, loop: true, peak: 0.45,
    gen: (d, sr, r) => {
      const flt = new Biquad('bp', sr, 1400, 1.2);
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const am = 0.4 + 0.6 * Math.abs(Math.sin(t * 2 * Math.PI * 34 + Math.sin(t * 7) * 2));
        d[i] += flt.p(r()) * am * 0.8;
      }
    },
  },
  // --- weapons and impacts
  hit_stone: {
    dur: 0.35, variants: 3, peak: 0.8,
    gen: (d, sr, r) => {
      noiseBurst(d, sr, r, 'bp', 2600 + r() * 600, 2, (t) => ar(t, 0.0005, 0.05), 1);
      metal(d, sr, [1900 + r() * 200, 3100, 4700], [0.03, 0.02, 0.012], 0.25);
      thump(d, sr, 180, 90, 0.04, 0.6);
    },
  },
  bow_creak: {
    dur: 0.7, variants: 2, peak: 0.45,
    gen: (d, sr, r) => {
      const flt = new Biquad('bp', sr, 420 + Math.abs(r()) * 120, 12);
      let next = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        let x = 0;
        if (t >= next) {
          x = 1;
          next = t + 0.012 + Math.abs(r()) * 0.01;
        }
        d[i] += flt.p(x) * bell(t, 0.7);
      }
    },
  },
  bow_twang: {
    dur: 0.6, variants: 2, peak: 0.8,
    gen: (d, sr, r) => {
      let ph = 0;
      const f0 = 150 + r() * 10;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        ph += (f0 * (1 + 0.4 * Math.exp(-t * 40))) / sr;
        d[i] += (Math.sin(2 * Math.PI * ph) + 0.4 * Math.sin(4 * Math.PI * ph)) * Math.exp(-t * 9) * 0.6;
      }
      noiseBurst(d, sr, r, 'hp', 3000, 0.7, (t) => ar(t, 0.0005, 0.015), 0.6);
    },
  },
  arrow_whistle: {
    dur: 0.9, peak: 0.5,
    gen: (d, sr, r) => noiseBurst(d, sr, r, 'bp', 2400, 9, (t) => ar(t, 0.02, 0.6), 1, 0, (t) => 2800 - t * 1400),
  },
  blue_roar: {
    dur: 1.6, variants: 2, peak: 0.85,
    gen: (d, sr, r) => {
      noiseBurst(d, sr, r, 'lp', 900, 0.8, (t) => ar(t, 0.06, 1.2), 1, 0, (t) => 400 + t * 1600);
      noiseBurst(d, sr, r, 'bp', 3200, 1.2, (t) => ar(t, 0.02, 0.5) * (0.6 + 0.4 * Math.sin(t * 70)), 0.4);
      thump(d, sr, 70, 40, 0.5, 0.7);
    },
  },
  stalker_shriek: {
    dur: 1.0, peak: 0.7,
    gen: (d, sr, r) => {
      let ph = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        ph += (900 + t * 800 + Math.sin(t * 60) * 40) / sr;
        d[i] += tanh(Math.sin(2 * Math.PI * ph) * 2) * ar(t, 0.03, 0.4) * 0.5;
      }
      noiseBurst(d, sr, r, 'bp', 3200, 2, (t) => ar(t, 0.02, 0.35), 0.8);
    },
  },
  crawler_skitter: {
    dur: 0.7, variants: 2, peak: 0.5,
    gen: (d, sr, r) => {
      for (let k = 0; k < 22; k++) noiseBurst(d, sr, r, 'bp', 2200 + r() * 800, 4, (t) => ar(t, 0.0005, 0.004), 1, Math.abs(r()) * 0.65);
    },
  },
  crawler_screech: {
    dur: 0.9, peak: 0.75,
    gen: (d, sr, r) => {
      let ph = 0;
      let mph = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        mph += 83 / sr;
        ph += (320 + Math.sin(2 * Math.PI * mph) * 180 - t * 100) / sr;
        d[i] += tanh(saw(ph % 1) * 3) * ar(t, 0.02, 0.35) * 0.5;
      }
      noiseBurst(d, sr, r, 'bp', 2100, 1.5, (t) => ar(t, 0.01, 0.3), 0.7);
    },
  },
  bite: {
    dur: 0.3, peak: 0.7,
    gen: (d, sr, r) => {
      noiseBurst(d, sr, r, 'bp', 1800, 1, (t) => ar(t, 0.001, 0.03), 1);
      for (let k = 0; k < 5; k++) noiseBurst(d, sr, r, 'hp', 2500, 1, (t) => ar(t, 0.0005, 0.006), 0.5, 0.02 + k * 0.025);
      thump(d, sr, 140, 70, 0.04, 0.6);
    },
  },
  knight_growl: {
    dur: 1.4, variants: 2, peak: 0.7,
    gen: (d, sr, r) => {
      formantVoice(d, sr, r, (t) => 52 + Math.sin(t * 13) * 3, [[420, 4], [700, 5]], (t) => bell(t, 1.35) * (0.6 + 0.4 * Math.abs(Math.sin(t * 23))), 0.5, 2.5);
      for (let k = 0; k < 10; k++) {
        const st = Math.abs(r()) * 1.2;
        const f0 = 300 + Math.abs(r()) * 500;
        const s0 = Math.floor(st * sr);
        let ph = 0;
        for (let i = s0; i < d.length && i < s0 + sr * 0.05; i++) {
          const t = (i - s0) / sr;
          ph += (f0 + t * 3000) / sr;
          d[i] += Math.sin(2 * Math.PI * ph) * ar(t, 0.002, 0.012) * 0.2;
        }
      }
    },
  },
  boss_roar: {
    dur: 2.6, peak: 0.95,
    gen: (d, sr, r) => {
      formantVoice(d, sr, r, (t) => 48 + t * 6 + Math.sin(t * 17) * 3, [[380, 3], [720, 4], [1500, 6]], (t) => ar(t, 0.15, 0.9), 0.5, 3);
      formantVoice(d, sr, r, (t) => 71 + Math.sin(t * 11) * 4, [[520, 3], [950, 4]], (t) => ar(t, 0.2, 0.8) * 0.6, 0.3, 2);
      noiseBurst(d, sr, r, 'lp', 400, 0.7, (t) => ar(t, 0.1, 0.8), 0.6);
    },
  },
  boss_scream: {
    dur: 2.8, peak: 0.95,
    gen: (d, sr, r) => {
      let ph = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        ph += (380 + t * 420 + Math.sin(t * 38) * 30) / sr;
        d[i] += tanh(Math.sin(2 * Math.PI * ph) * 1.5) * ar(t, 0.2, 1.1) * 0.45;
      }
      formantVoice(d, sr, r, (t) => 58, [[400, 3], [800, 4]], (t) => ar(t, 0.1, 1.2) * 0.7, 0.4, 3);
      noiseBurst(d, sr, r, 'bp', 2500, 1, (t) => ar(t, 0.1, 1.0), 0.5);
    },
  },
  boss_death: {
    dur: 5.5, peak: 0.9,
    gen: (d, sr, r) => {
      formantVoice(d, sr, r, (t) => 90 - t * 12, [[500, 3], [900, 4], [2000, 6]], (t) => ar(t, 0.2, 2.2), 0.4, 2.2);
      let ph = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        ph += (620 - t * 90) / sr;
        d[i] += Math.sin(2 * Math.PI * ph) * ar(t, 0.4, 1.8) * 0.3;
      }
      noiseBurst(d, sr, r, 'lp', 160, 0.7, (t) => ar(t, 0.5, 2.5), 0.9);
    },
  },
  breath_wet: {
    dur: 3.1, loop: true, peak: 0.5,
    gen: (d, sr, r) => {
      noiseBurst(d, sr, r, 'bp', 420, 1.2, (t) => bell(t, 1.2) ** 1.5 + bell(t - 1.4, 1.4) ** 1.5 * 0.8, 1);
      formantVoice(d, sr, r, () => 70, [[500, 5]], (t) => (bell(t - 1.4, 1.4) ** 2) * 0.25, 0.8, 1);
    },
  },
  breath_thin: {
    dur: 2.5, loop: true, peak: 0.4,
    gen: (d, sr, r) => noiseBurst(d, sr, r, 'bp', 1800, 2.5, (t) => bell(t, 0.9) ** 2 + bell(t - 1.1, 1.0) ** 2 * 0.7, 1),
  },
  breath_drowned: {
    dur: 3.4, loop: true, peak: 0.5,
    gen: (d, sr, r) => {
      noiseBurst(d, sr, r, 'lp', 500, 1, (t) => bell(t, 1.5) + bell(t - 1.7, 1.4) * 0.8, 1);
      for (let k = 0; k < 12; k++) {
        const st = Math.abs(r()) * 3.0;
        const f0 = 250 + Math.abs(r()) * 400;
        const s0 = Math.floor(st * sr);
        let ph = 0;
        for (let i = s0; i < d.length && i < s0 + sr * 0.05; i++) {
          const t = (i - s0) / sr;
          ph += (f0 + t * 2500) / sr;
          d[i] += Math.sin(2 * Math.PI * ph) * ar(t, 0.002, 0.012) * 0.3;
        }
      }
    },
  },
  breath_boss: {
    dur: 4.4, loop: true, peak: 0.6,
    gen: (d, sr, r) => {
      noiseBurst(d, sr, r, 'lp', 260, 1, (t) => bell(t, 1.9) + bell(t - 2.2, 2.0) * 0.9, 1);
      formantVoice(d, sr, r, () => 41, [[300, 4]], (t) => bell(t - 2.2, 2.0) * 0.4, 0.5, 1);
    },
  },
  whisper: {
    dur: 2.0, variants: 4, peak: 0.45,
    gen: (d, sr, r) => {
      const flt = new Biquad('bp', sr, 2200, 1.4);
      const hp = new Biquad('hp', sr, 5000, 0.7);
      const bursts: [number, number, number][] = [];
      let t0 = 0.05;
      while (t0 < 1.8) {
        const len = 0.06 + Math.abs(r()) * 0.16;
        bursts.push([t0, len, 1400 + Math.abs(r()) * 2200]);
        t0 += len + 0.02 + Math.abs(r()) * 0.1;
      }
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        let env = 0;
        let f = 2000;
        for (const [s, l, ff] of bursts) {
          const e = bell(t - s, l);
          if (e > env) {
            env = e;
            f = ff;
          }
        }
        if (i % 64 === 0) flt.set(f, 2.5);
        const n = r();
        d[i] = flt.p(n) * env + hp.p(n) * env * env * 0.4;
      }
    },
  },
  heartbeat: {
    dur: 0.7, peak: 0.9,
    gen: (d, sr, r) => {
      thump(d, sr, 70, 42, 0.07, 1);
      thump(d, sr, 62, 38, 0.09, 0.75, 0.24);
      noiseBurst(d, sr, r, 'lp', 120, 0.7, (t) => ar(t, 0.005, 0.05), 0.3);
    },
  },
  stinger: {
    dur: 3.2, variants: 2, peak: 0.8,
    gen: (d, sr, r) => {
      const fs = [110, 116.5, 155.6, 233, 311, 329.6, 466];
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const env = t < 1.4 ? (t / 1.4) ** 2 : exp(t - 1.4, 0.5);
        let y = 0;
        for (let k = 0; k < fs.length; k++) y += saw((fs[k] * t * (1 + 0.003 * k)) % 1) * 0.3 + Math.sin(2 * Math.PI * fs[k] * 2 * t) * 0.2;
        d[i] = tanh(y * 0.6) * env;
      }
      noiseBurst(d, sr, r, 'bp', 3000, 3, (t) => (t < 1.4 ? (t / 1.4) ** 3 : exp(t - 1.4, 0.3)), 0.6, 0, (t) => 1500 + t * 2000);
    },
  },
  shrine_ignite: {
    dur: 2.4, peak: 0.7,
    gen: (d, sr, r) => {
      noiseBurst(d, sr, r, 'bp', 300, 0.9, (t) => ar(t, 0.3, 0.3), 0.8, 0, (t) => 300 + t * 2500);
      const fs = [196, 293.7, 392, 587.3];
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const env = Math.max(0, Math.min(1, (t - 0.25) / 0.4)) * exp(Math.max(0, t - 0.65), 0.9);
        let y = 0;
        for (let k = 0; k < fs.length; k++) y += Math.sin(2 * Math.PI * fs[k] * t) / (1 + k * 0.5);
        d[i] += y * env * 0.4;
      }
      for (let k = 0; k < 30; k++) noiseBurst(d, sr, r, 'hp', 2000, 1, (t) => ar(t, 0.0005, 0.004), 0.2, 0.3 + Math.abs(r()) * 2);
    },
  },
  rest: {
    dur: 3.2, peak: 0.45,
    gen: (d, sr, r) => {
      const fs = [98, 147, 196, 247];
      for (const f of fs) formantVoice(d, sr, r, (t) => f * (1 + 0.003 * Math.sin(t * 4)), [[700, 5], [1100, 6]], (t) => Math.min(1, t / 0.8) * exp(Math.max(0, t - 1.4), 0.8) * 0.4, 0.05, 1);
    },
  },
  levelup: {
    dur: 1.6, peak: 0.55,
    gen: (d, sr) => {
      const notes = [392, 523.3, 659.3, 784];
      notes.forEach((f, k) => metal(d, sr, [f, f * 2.01, f * 3.02], [0.6, 0.3, 0.15], 0.5, k * 0.11));
    },
  },
  pickup: {
    dur: 1.0, peak: 0.5,
    gen: (d, sr) => metal(d, sr, [1318.5, 1975.5, 2637], [0.35, 0.25, 0.15], 0.6),
  },
  marrow: {
    dur: 1.3, peak: 0.55,
    gen: (d, sr, r) => {
      metal(d, sr, [659.3, 987.8, 1318.5], [0.4, 0.3, 0.2], 0.4, 0.05);
      noiseBurst(d, sr, r, 'bp', 700, 1, (t) => ar(t, 0.3, 0.4), 0.3, 0, (t) => 400 + t * 1500);
    },
  },
  door_creak: {
    dur: 2.4, peak: 0.75,
    gen: (d, sr, r) => {
      const flt = new Biquad('bp', sr, 420, 12);
      let next = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        let x = 0;
        if (t < 1.7 && t >= next) {
          x = 1;
          next = t + 0.008 + 0.006 * Math.sin(t * 3) + Math.abs(r()) * 0.004;
        }
        if (i % 128 === 0) flt.set(380 + Math.sin(t * 2.2) * 120, 12);
        d[i] += flt.p(x) * bell(t, 1.8);
      }
      thump(d, sr, 90, 40, 0.15, 1.4, 1.85);
      noiseBurst(d, sr, r, 'lp', 600, 0.7, (t) => ar(t, 0.002, 0.12), 0.8, 1.85);
    },
  },
  fogwall: {
    dur: 1.8, peak: 0.55,
    gen: (d, sr, r) => {
      noiseBurst(d, sr, r, 'bp', 400, 0.8, (t) => bell(t, 1.7), 1, 0, (t) => 300 + Math.sin(t * 1.8) * 900 + 500);
      metal(d, sr, [220, 330.2, 440.5], [1.2, 0.9, 0.6], 0.15, 0.2);
    },
  },
  lantern_on: {
    dur: 0.5, peak: 0.45,
    gen: (d, sr, r) => {
      metal(d, sr, [2400, 3700], [0.02, 0.015], 0.5);
      noiseBurst(d, sr, r, 'bp', 400, 0.8, (t) => ar(t, 0.05, 0.2), 0.8, 0.03, (t) => 300 + t * 3000);
    },
  },
  lantern_off: {
    dur: 0.4, peak: 0.4,
    gen: (d, sr, r) => {
      metal(d, sr, [2100, 3300], [0.02, 0.015], 0.5);
      noiseBurst(d, sr, r, 'lp', 900, 0.8, (t) => ar(t, 0.01, 0.09), 0.8, 0.02);
    },
  },
  ui_click: {
    dur: 0.06, peak: 0.35,
    gen: (d, sr, r) => {
      noiseBurst(d, sr, r, 'bp', 2400, 2, (t) => ar(t, 0.0005, 0.008));
      metal(d, sr, [1800], [0.02], 0.4);
    },
  },
  ui_move: {
    dur: 0.04, peak: 0.2,
    gen: (d, sr, r) => noiseBurst(d, sr, r, 'bp', 3000, 3, (t) => ar(t, 0.0005, 0.005)),
  },
  bell_distant: {
    dur: 7, peak: 0.6,
    gen: (d, sr) => {
      const f = 146.8;
      metal(d, sr, [f * 0.5, f, f * 1.19, f * 1.5, f * 2, f * 2.52, f * 3.01], [3.5, 3.0, 2.2, 1.8, 1.4, 1.0, 0.7], 0.5);
      const lp = new Biquad('lp', sr, 700, 0.7);
      for (let i = 0; i < d.length; i++) d[i] = lp.p(d[i]) * (1 + 0.25 * Math.sin((i / sr) * 5.5));
    },
  },
  flame_loop: {
    dur: 2.6, loop: true, peak: 0.35,
    gen: (d, sr, r) => {
      noiseBurst(d, sr, r, 'lp', 400, 0.7, () => 0.5, 1);
      for (let k = 0; k < 26; k++) noiseBurst(d, sr, r, 'hp', 1500 + Math.abs(r()) * 3000, 1, (t) => ar(t, 0.0005, 0.006), 0.8, Math.abs(r()) * 2.5);
    },
  },
  wind_loop: {
    dur: 8, loop: true, peak: 0.5, stereo: true,
    gen: (d, sr, r) => {
      const flt = new Biquad('bp', sr, 500, 1.2);
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        if (i % 64 === 0) flt.set(420 + Math.sin(t * 0.7) * 180 + Math.sin(t * 1.9) * 90, 1.2);
        d[i] = flt.p(r()) * (0.6 + 0.4 * Math.sin(t * 0.55) * Math.sin(t * 0.23 + 1));
      }
    },
  },
  water_loop: {
    dur: 6, loop: true, peak: 0.45, stereo: true,
    gen: (d, sr, r) => {
      const lp = new Biquad('lp', sr, 700, 0.7);
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        d[i] = lp.p(r()) * (0.5 + 0.5 * Math.abs(Math.sin(t * 1.3) * Math.sin(t * 0.7 + 0.4)));
      }
      for (let k = 0; k < 40; k++) {
        const st = Math.abs(r()) * 5.8;
        const f0 = 350 + Math.abs(r()) * 600;
        const s0 = Math.floor(st * sr);
        let ph = 0;
        for (let i = s0; i < d.length && i < s0 + sr * 0.04; i++) {
          const t = (i - s0) / sr;
          ph += (f0 + t * 3000) / sr;
          d[i] += Math.sin(2 * Math.PI * ph) * ar(t, 0.002, 0.01) * 0.25;
        }
      }
    },
  },
  drip: {
    dur: 0.5, variants: 3, peak: 0.35,
    gen: (d, sr, r) => {
      const f0 = 900 + Math.abs(r()) * 700;
      let ph = 0;
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        ph += (f0 + t * 1200) / sr;
        d[i] += Math.sin(2 * Math.PI * ph) * ar(t, 0.001, 0.03);
      }
    },
  },
  phantom_steps: {
    dur: 1.8, peak: 0.45,
    gen: (d, sr, r) => {
      for (let k = 0; k < 4; k++) {
        noiseBurst(d, sr, r, 'bp', 700, 0.8, (t) => ar(t, 0.003, 0.03), 1 - k * 0.1, 0.1 + k * 0.42);
        thump(d, sr, 110, 60, 0.03, 0.7, 0.1 + k * 0.42);
      }
    },
  },
  shockwave: {
    dur: 1.4, peak: 0.95,
    gen: (d, sr, r) => {
      thump(d, sr, 70, 28, 0.35, 1);
      noiseBurst(d, sr, r, 'lp', 800, 0.7, (t) => ar(t, 0.005, 0.35), 0.9, 0, (t) => 900 - t * 600);
    },
  },
  burst: {
    dur: 1.8, peak: 0.95,
    gen: (d, sr, r) => {
      thump(d, sr, 90, 30, 0.4, 1);
      noiseBurst(d, sr, r, 'lp', 1500, 0.7, (t) => ar(t, 0.01, 0.5), 1, 0, (t) => 1500 - t * 700);
      for (let k = 0; k < 40; k++) noiseBurst(d, sr, r, 'hp', 2500, 1, (t) => ar(t, 0.0005, 0.005), 0.4, 0.05 + Math.abs(r()) * 1.2);
    },
  },
  flame_burst: {
    dur: 1.3, peak: 0.85,
    gen: (d, sr, r) => {
      noiseBurst(d, sr, r, 'lp', 700, 0.8, (t) => ar(t, 0.08, 0.45), 1);
      noiseBurst(d, sr, r, 'bp', 200, 1, (t) => ar(t, 0.05, 0.4), 0.8);
    },
  },
  enemy_death: {
    dur: 1.3, variants: 2, peak: 0.7,
    gen: (d, sr, r) => {
      formantVoice(d, sr, r, (t) => 80 - t * 30, [[450, 4], [800, 5]], (t) => ar(t, 0.05, 0.35) * 0.6, 0.6, 1.5);
      thump(d, sr, 90, 40, 0.12, 1, 0.55);
      noiseBurst(d, sr, r, 'lp', 500, 0.7, (t) => ar(t, 0.003, 0.15), 0.6, 0.55);
    },
  },
  grab: {
    dur: 0.6, peak: 0.8,
    gen: (d, sr, r) => {
      noiseBurst(d, sr, r, 'bp', 350, 2, (t) => ar(t, 0.01, 0.15) * (0.6 + 0.4 * Math.sin(t * 120)), 1);
      thump(d, sr, 120, 55, 0.06, 0.8);
      for (let k = 0; k < 6; k++) noiseBurst(d, sr, r, 'hp', 2200, 1, (t) => ar(t, 0.0005, 0.008), 0.5, 0.1 + k * 0.05);
    },
  },
  riposte: {
    dur: 1.0, peak: 0.95,
    gen: (d, sr, r) => {
      thump(d, sr, 120, 35, 0.2, 1);
      noiseBurst(d, sr, r, 'bp', 320, 2, (t) => ar(t, 0.01, 0.2) * (0.6 + 0.4 * Math.sin(t * 130)), 1);
      noiseBurst(d, sr, r, 'lp', 2000, 0.7, (t) => ar(t, 0.001, 0.05), 0.8);
    },
  },
  victory: {
    dur: 5, peak: 0.55,
    gen: (d, sr, r) => {
      const chordA = [110, 130.8, 164.8, 220];
      const chordB = [110, 138.6, 164.8, 220, 277.2];
      for (let i = 0; i < d.length; i++) {
        const t = i / sr;
        const env = Math.min(1, t / 1.2) * exp(Math.max(0, t - 3), 0.8);
        const ch = t < 2 ? chordA : chordB;
        let y = 0;
        for (const f of ch) y += saw((f * t) % 1) * 0.2 + Math.sin(2 * Math.PI * f * 2 * t) * 0.15;
        d[i] = y * env;
      }
      const lp = new Biquad('lp', sr, 1400, 0.7);
      for (let i = 0; i < d.length; i++) d[i] = lp.p(d[i]) + r() * 0.002;
    },
  },
  boom: {
    dur: 2.0, peak: 0.9,
    gen: (d, sr, r) => {
      thump(d, sr, 55, 32, 0.5, 1);
      noiseBurst(d, sr, r, 'lp', 150, 0.7, (t) => ar(t, 0.01, 0.6), 0.5);
    },
  },
};

export interface GeneratedSound {
  name: string;
  buffers: AudioBuffer[];
  loop: boolean;
}

/** Render every sound. Yields to the event loop between sounds. */
export async function generateSounds(ctx: BaseAudioContext, onProgress?: (p: number) => void): Promise<Map<string, AudioBuffer[]>> {
  const out = new Map<string, AudioBuffer[]>();
  const names = Object.keys(SOUNDS);
  const sr = Math.min(ctx.sampleRate, 44100);
  let seed = 1234;
  for (let n = 0; n < names.length; n++) {
    const name = names[n];
    const def = SOUNDS[name];
    const list: AudioBuffer[] = [];
    const variants = def.variants ?? 1;
    for (let v = 0; v < variants; v++) {
      const r = rngFrom(seed++ * 7919);
      const len = Math.floor(def.dur * sr);
      let data: Float32Array<ArrayBuffer> = new Float32Array(len);
      def.gen(data, sr, r);
      if (def.loop) data = makeLoop(data, sr, Math.min(0.4, def.dur * 0.2));
      else fadeEdges(data, sr);
      normalize(data, def.peak ?? 0.8);
      const channels = def.stereo ? 2 : 1;
      const buf = ctx.createBuffer(channels, data.length, sr);
      buf.copyToChannel(data, 0);
      if (channels === 2) {
        // decorrelated second channel: offset copy
        const d2 = new Float32Array(data.length);
        const off = Math.floor(data.length * 0.37);
        for (let i = 0; i < data.length; i++) d2[i] = data[(i + off) % data.length];
        buf.copyToChannel(d2, 1);
      }
      list.push(buf);
    }
    out.set(name, list);
    onProgress?.((n + 1) / names.length);
    if (n % 4 === 3) await new Promise((res) => setTimeout(res, 0));
  }
  return out;
}

/** Stereo impulse response for the convolution reverb. */
/** Generated room response: `bright` sets the starting cutoff, `early` adds discrete early reflections (stone halls). */
export function makeImpulse(ctx: BaseAudioContext, seconds: number, decay: number, bright = 5000, early = 0): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.floor(seconds * sr);
  const buf = ctx.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    const r = rngFrom(99 + c * 17);
    const lp = new Biquad('lp', sr, 5000, 0.7);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      if (i % 256 === 0) lp.set(bright * Math.exp(-t * 1.2) + 400, 0.7);
      d[i] = lp.p(r()) * Math.pow(1 - t / seconds, decay) * (t < 0.01 ? t / 0.01 : 1);
      if (early > 0) for (const e of [0.013, 0.029, 0.041, 0.067, 0.089]) if (Math.abs(t - e * (1 + c * 0.07)) < 0.0007) d[i] += early * (1 - e * 5);
    }
  }
  return buf;
}
