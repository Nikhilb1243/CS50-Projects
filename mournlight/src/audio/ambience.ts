import * as THREE from 'three';
import type { AudioEngine } from './audio';
import { clamp, clamp01, rand } from '../core/math';

type Drone = 'crypt' | 'road' | 'water' | 'forest' | 'choir' | 'wound';

interface Layer {
  gain: GainNode;
  target: Partial<Record<Drone, number>>;
}

export interface AmbienceState {
  dread: number;
  health: number;
  playerPos: THREE.Vector3;
  forward: THREE.Vector3;
  bossActive: boolean;
  bossPhase: number;
  paused: boolean;
}

/**
 * Continuous procedural soundscape: region drones, wind/water beds, a
 * formant choir, boss pulse, plus scheduled horror cues (heartbeat,
 * whispers, phantom footsteps, stingers).
 */
export class Ambience {
  private layers: Layer[] = [];
  private region: Drone = 'crypt';
  private started = false;
  private heartTimer = 0;
  private whisperTimer = 8;
  private phantomTimer = 20;
  private eventTimer = 5;
  private stingerCooldown = 20;
  private bossBeat = 0;
  private bossPad: GainNode | null = null;
  private padFilter: BiquadFilterNode | null = null;
  private tmp = new THREE.Vector3();

  constructor(private engine: AudioEngine) {}

  start(): void {
    if (this.started || !this.engine.ready) return;
    this.started = true;
    const ctx = this.engine.ctx;
    const out = this.engine.amb;

    const osc = (type: OscillatorType, f: number, detune = 0): OscillatorNode => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = detune;
      o.start();
      return o;
    };
    const layer = (target: Partial<Record<Drone, number>>): GainNode => {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(out);
      this.layers.push({ gain: g, target });
      return g;
    };
    const loop = (name: string, rate = 1): AudioBufferSourceNode | null => {
      const buf = this.engine.buffer(name, 0);
      if (!buf) return null;
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.playbackRate.value = rate;
      s.start(0, Math.random() * buf.duration);
      return s;
    };

    // Deep sub drone with slow beating
    {
      const g = layer({ crypt: 0.22, road: 0.1, water: 0.12, forest: 0.12, choir: 0.1, wound: 0.3 });
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 180;
      lp.connect(g);
      for (const [f, d] of [[41.2, 0], [41.2, 9], [61.7, -4]] as [number, number][]) osc('sawtooth', f, d).connect(lp);
      const lfo = osc('sine', 0.07);
      const lfoG = ctx.createGain();
      lfoG.gain.value = 60;
      lfo.connect(lfoG);
      lfoG.connect(lp.frequency);
    }
    // Wind bed
    {
      const g = layer({ road: 0.5, forest: 0.6, water: 0.25, choir: 0.12, wound: 0.2, crypt: 0.04 });
      loop('wind_loop')?.connect(g);
    }
    // Water bed
    {
      const g = layer({ water: 0.55, road: 0.04 });
      loop('water_loop')?.connect(g);
    }
    // Choir (formant filtered saws)
    {
      const g = layer({ choir: 0.12, wound: 0.05, crypt: 0.03 });
      const f1 = ctx.createBiquadFilter();
      f1.type = 'bandpass';
      f1.frequency.value = 760;
      f1.Q.value = 6;
      const f2 = ctx.createBiquadFilter();
      f2.type = 'bandpass';
      f2.frequency.value = 1150;
      f2.Q.value = 8;
      f1.connect(g);
      f2.connect(g);
      for (const [f, d] of [[98, 0], [146.8, 6], [174.6, -5], [196, 3]] as [number, number][]) {
        const o = osc('sawtooth', f, d);
        const vib = osc('sine', 4.5 + Math.random());
        const vg = ctx.createGain();
        vg.gain.value = 5;
        vib.connect(vg);
        vg.connect(o.detune);
        o.connect(f1);
        o.connect(f2);
      }
    }
    // Wound: throbbing low pulse
    {
      const g = layer({ wound: 0.35 });
      const am = ctx.createGain();
      am.gain.value = 0.5;
      am.connect(g);
      osc('sine', 36.7).connect(am);
      osc('sine', 55).connect(am);
      const lfo = osc('sine', 0.9);
      const lg = ctx.createGain();
      lg.gain.value = 0.5;
      lfo.connect(lg);
      lg.connect(am.gain);
    }
    // Boss pad (dissonant strings)
    {
      this.bossPad = ctx.createGain();
      this.bossPad.gain.value = 0;
      this.padFilter = ctx.createBiquadFilter();
      this.padFilter.type = 'lowpass';
      this.padFilter.frequency.value = 500;
      this.padFilter.connect(this.bossPad);
      this.bossPad.connect(out);
      for (const [f, d] of [[55, 0], [58.3, 4], [82.4, -3], [110, 7], [116.5, -6]] as [number, number][]) osc('sawtooth', f, d).connect(this.padFilter);
    }
  }

  setRegion(d: Drone): void {
    this.region = d;
  }

  stinger(force = false): void {
    if (!force && this.stingerCooldown > 0) return;
    this.stingerCooldown = 50;
    this.engine.play('stinger', { volume: 0.7, vary: 0.02 });
  }

  update(dt: number, s: AmbienceState): void {
    if (!this.started) return;
    const ctx = this.engine.ctx;
    const now = ctx.currentTime;
    for (const l of this.layers) {
      const v = s.paused ? (l.target[this.region] ?? 0) * 0.35 : l.target[this.region] ?? 0;
      l.gain.gain.setTargetAtTime(v, now, 1.8);
    }
    if (this.bossPad && this.padFilter) {
      const on = s.bossActive && !s.paused;
      this.bossPad.gain.setTargetAtTime(on ? (s.bossPhase === 2 ? 0.13 : 0.08) : 0, now, on ? 1.5 : 2.5);
      this.padFilter.frequency.setTargetAtTime(s.bossPhase === 2 ? 1100 : 480, now, 2);
    }
    if (s.paused) return;
    this.stingerCooldown -= dt;

    // Heartbeat: low health or overwhelming dread
    const hbIntensity = Math.max(clamp01((0.34 - s.health) / 0.3), clamp01((s.dread - 0.62) / 0.38));
    if (hbIntensity > 0.02) {
      this.heartTimer -= dt;
      if (this.heartTimer <= 0) {
        const bpm = 62 + hbIntensity * 70;
        this.heartTimer = 60 / bpm;
        this.engine.play('heartbeat', { volume: 0.3 + hbIntensity * 0.7, vary: 0 });
      }
    }

    // Whispers from behind
    if (s.dread > 0.45) {
      this.whisperTimer -= dt * (0.5 + s.dread);
      if (this.whisperTimer <= 0) {
        this.whisperTimer = rand(7, 15);
        this.behind(s, rand(1.5, 3.5));
        this.engine.playAt('whisper', this.tmp, { volume: 0.35 + s.dread * 0.5, ref: 2, rolloff: 1.5 });
      }
    }
    // Phantom footsteps
    if (s.dread > 0.6) {
      this.phantomTimer -= dt;
      if (this.phantomTimer <= 0) {
        this.phantomTimer = rand(14, 28);
        this.behind(s, rand(4, 7));
        this.engine.playAt('phantom_steps', this.tmp, { volume: 0.8, ref: 3 });
      }
    }

    // Regional incidental sounds
    this.eventTimer -= dt;
    if (this.eventTimer <= 0) {
      const p = s.playerPos;
      const off = (r: number): THREE.Vector3 => {
        const a = Math.random() * Math.PI * 2;
        return this.tmp.set(p.x + Math.cos(a) * r, p.y + rand(0, 3), p.z + Math.sin(a) * r);
      };
      switch (this.region) {
        case 'crypt':
          this.engine.playAt('drip', off(rand(3, 9)), { volume: 0.5, ref: 2 });
          this.eventTimer = rand(2.5, 7);
          break;
        case 'water':
          if (Math.random() < 0.35) this.engine.playAt('bell_distant', off(38), { volume: 1, ref: 30, rolloff: 0.4, rate: 0.9 });
          else this.engine.playAt('drip', off(rand(4, 10)), { volume: 0.4, rate: 0.6 });
          this.eventTimer = rand(9, 20);
          break;
        case 'forest':
          this.engine.playAt('stalker_creak', off(rand(18, 30)), { volume: 0.35, ref: 6, rate: 0.7 });
          this.eventTimer = rand(10, 22);
          break;
        case 'road':
          if (Math.random() < 0.3) this.engine.playAt('bell_distant', off(60), { volume: 0.8, ref: 40, rolloff: 0.3, rate: 1.1 });
          else this.engine.playAt('shambler_groan', off(rand(25, 40)), { volume: 0.3, ref: 5, rate: 0.8 });
          this.eventTimer = rand(14, 28);
          break;
        case 'choir':
          this.engine.playAt('whisper', off(rand(8, 16)), { volume: 0.25, ref: 4, rate: 0.8 });
          this.eventTimer = rand(12, 24);
          break;
        case 'wound':
          this.eventTimer = rand(6, 12);
          break;
      }
    }

    // Boss pulse
    if (s.bossActive) {
      this.bossBeat -= dt;
      if (this.bossBeat <= 0) {
        this.bossBeat = s.bossPhase === 2 ? 0.92 : 1.6;
        this.engine.play('boom', { volume: s.bossPhase === 2 ? 0.55 : 0.4, vary: 0.02 });
      }
    }
  }

  private behind(s: AmbienceState, dist: number): void {
    const side = (Math.random() - 0.5) * 1.4;
    this.tmp
      .copy(s.forward)
      .multiplyScalar(-dist)
      .add(new THREE.Vector3(-s.forward.z * side * dist * 0.5, 0, s.forward.x * side * dist * 0.5))
      .add(s.playerPos);
    this.tmp.y += clamp(rand(0.8, 1.8), 0, 3);
  }
}
