import * as THREE from 'three';
import { generateSounds, makeImpulse } from './synth';
import { settings } from '../core/settings';
import { clamp } from '../core/math';

export interface PlayOpts {
  volume?: number;
  rate?: number;
  /** Random rate variation (+/-). */
  vary?: number;
  ref?: number;
  max?: number;
  rolloff?: number;
  variant?: number;
}

/**
 * Game audio. Uses the Web Audio graph through Three's AudioListener so all
 * 3D sounds are THREE.PositionalAudio objects placed in the scene.
 *
 *   PositionalAudio / Audio -> listener.gain -> sfx bus -> master -> out
 *                                                      \-> reverb send
 *   ambience nodes -> ambience bus -> master
 */
export class AudioEngine {
  readonly listener: THREE.AudioListener;
  readonly ctx: AudioContext;
  readonly master: GainNode;
  readonly sfx: GainNode;
  readonly amb: GainNode;
  private reverb: ConvolverNode;
  private reverbB: ConvolverNode;
  private revA: GainNode;
  private revB: GainNode;
  private revUseB = false;
  private irs = new Map<string, AudioBuffer>();
  private irName = '';
  /** Set by the game: true if something solid lies between the listener and `pos`. */
  occluded: ((pos: THREE.Vector3) => boolean) | null = null;
  private voices: { obj: THREE.Object3D; audio: THREE.PositionalAudio; filter: BiquadFilterNode }[] = [];
  private occT = 0;
  private reverbSend: GainNode;
  private reverbAmb: GainNode;
  private buffers = new Map<string, AudioBuffer[]>();
  private pool: { obj: THREE.Object3D; audio: THREE.PositionalAudio; busyUntil: number; filter: BiquadFilterNode }[] = [];
  private flat: THREE.Audio[] = [];
  private flatIdx = 0;
  ready = false;

  constructor(camera: THREE.Camera) {
    this.listener = new THREE.AudioListener();
    camera.add(this.listener);
    this.ctx = this.listener.context;
    this.master = this.ctx.createGain();
    this.sfx = this.ctx.createGain();
    this.amb = this.ctx.createGain();
    this.reverb = this.ctx.createConvolver();
    this.reverbSend = this.ctx.createGain();
    this.reverbAmb = this.ctx.createGain();
    this.reverb.buffer = makeImpulse(this.ctx, 3.2, 2.6);
    this.reverbB = this.ctx.createConvolver();
    this.reverbB.buffer = this.reverb.buffer;
    this.revA = this.ctx.createGain();
    this.revB = this.ctx.createGain();
    this.revB.gain.value = 0;

    // Re-route the listener's output through our buses
    const lg = this.listener.getInput();
    lg.disconnect();
    lg.connect(this.sfx);
    this.sfx.connect(this.master);
    this.sfx.connect(this.reverbSend);
    this.reverbSend.connect(this.reverb);
    this.reverbSend.connect(this.reverbB);
    this.amb.connect(this.master);
    this.amb.connect(this.reverbAmb);
    this.reverbAmb.connect(this.reverb);
    this.reverbAmb.connect(this.reverbB);
    this.reverb.connect(this.revA);
    this.reverbB.connect(this.revB);
    this.revA.connect(this.master);
    this.revB.connect(this.master);
    // gentle limiter so stacked hits never clip
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 8;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    this.master.connect(comp);
    comp.connect(this.ctx.destination);
    this.reverbSend.gain.value = 0.15;
    this.reverbAmb.gain.value = 0.1;
    this.applyVolumes();
    settings.onChange(() => this.applyVolumes());
  }

  applyVolumes(): void {
    const s = settings.value;
    this.master.gain.value = s.masterVolume;
    this.sfx.gain.value = s.sfxVolume;
    this.amb.gain.value = s.ambienceVolume;
  }

  async init(scene: THREE.Scene, onProgress?: (p: number) => void): Promise<void> {
    this.buffers = await generateSounds(this.ctx, onProgress);
    for (let i = 0; i < 24; i++) {
      const obj = new THREE.Object3D();
      const audio = new THREE.PositionalAudio(this.listener);
      audio.setDistanceModel('inverse');
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 20000;
      audio.setFilter(filter);
      obj.add(audio);
      scene.add(obj);
      this.pool.push({ obj, audio, busyUntil: 0, filter });
    }
    for (let i = 0; i < 10; i++) this.flat.push(new THREE.Audio(this.listener));
    this.ready = true;
  }

  resume(): void {
    if (this.ctx.state !== 'running') void this.ctx.resume();
  }

  has(name: string): boolean {
    return this.buffers.has(name);
  }

  buffer(name: string, variant?: number): AudioBuffer | null {
    const list = this.buffers.get(name);
    if (!list || list.length === 0) return null;
    return list[variant ?? Math.floor(Math.random() * list.length)] ?? list[0];
  }

  setReverb(wet: number): void {
    const t = this.ctx.currentTime;
    this.reverbSend.gain.setTargetAtTime(clamp(wet, 0, 1) * 0.6, t, 0.8);
    this.reverbAmb.gain.setTargetAtTime(clamp(wet, 0, 1) * 0.35, t, 0.8);
  }

  /**
   * Swap to a region's generated impulse response (cross-faded between two
   * convolvers). Each IR is built once: length, decay, brightness and early
   * reflections describe the space.
   */
  setRegionReverb(id: string): void {
    if (id === this.irName) return;
    this.irName = id;
    const P: Record<string, [number, number, number, number]> = {
      crypt: [3.4, 2.2, 3800, 0.5],
      catacombs: [5.2, 1.8, 2600, 0.6],
      cathedral: [4.6, 2.0, 5200, 0.35],
      bellspire: [2.6, 3, 6000, 0.25],
      village: [1.6, 3.5, 4200, 0],
      forest: [1.3, 4, 3500, 0],
      road: [1.2, 4, 4500, 0],
      arena: [2.8, 2.6, 4000, 0.2],
    };
    let ir = this.irs.get(id);
    if (!ir) {
      const [len, dec, br, er] = P[id] ?? [2.4, 2.8, 4500, 0];
      ir = makeImpulse(this.ctx, len, dec, br, er);
      this.irs.set(id, ir);
    }
    const t = this.ctx.currentTime;
    this.revUseB = !this.revUseB;
    (this.revUseB ? this.reverbB : this.reverb).buffer = ir;
    this.revA.gain.setTargetAtTime(this.revUseB ? 0 : 1, t, 0.6);
    this.revB.gain.setTargetAtTime(this.revUseB ? 1 : 0, t, 0.6);
  }

  /** Re-check occlusion of attached voices (a few times a second). */
  updateOcclusion(dt: number): void {
    this.occT -= dt;
    if (this.occT > 0 || !this.occluded) return;
    this.occT = 0.25;
    const t = this.ctx.currentTime;
    for (const v of this.voices) {
      if (!v.audio.isPlaying) continue;
      v.obj.getWorldPosition(this.tmpV);
      const occ = this.occluded(this.tmpV);
      v.filter.frequency.setTargetAtTime(occ ? 650 : 20000, t, 0.15);
    }
  }
  private tmpV = new THREE.Vector3();

  /** Non-positional one-shot (UI, player body sounds). */
  play(name: string, opts: PlayOpts = {}): void {
    if (!this.ready) return;
    const buf = this.buffer(name, opts.variant);
    if (!buf) return;
    const a = this.flat[this.flatIdx];
    this.flatIdx = (this.flatIdx + 1) % this.flat.length;
    if (a.isPlaying) a.stop();
    a.setBuffer(buf);
    a.setVolume(opts.volume ?? 1);
    a.setPlaybackRate((opts.rate ?? 1) * (1 + (Math.random() * 2 - 1) * (opts.vary ?? 0.05)));
    a.play();
  }

  /** Positional one-shot at a world position using the PositionalAudio pool. */
  playAt(name: string, pos: THREE.Vector3, opts: PlayOpts = {}): void {
    if (!this.ready) return;
    const buf = this.buffer(name, opts.variant);
    if (!buf) return;
    const now = this.ctx.currentTime;
    let slot = this.pool.find((p) => p.busyUntil <= now);
    if (!slot) slot = this.pool.reduce((a, b) => (a.busyUntil < b.busyUntil ? a : b));
    const a = slot.audio;
    if (a.isPlaying) a.stop();
    slot.obj.position.copy(pos);
    slot.obj.updateMatrixWorld();
    // muffle sounds behind walls
    const occ = this.occluded ? this.occluded(pos) : false;
    slot.filter.frequency.setValueAtTime(occ ? 650 : 20000, now);
    a.setBuffer(buf);
    a.setRefDistance(opts.ref ?? 3);
    a.setMaxDistance(opts.max ?? 60);
    a.setRolloffFactor(opts.rolloff ?? 1.2);
    a.setVolume((opts.volume ?? 1) * (occ ? 0.6 : 1));
    const rate = (opts.rate ?? 1) * (1 + (Math.random() * 2 - 1) * (opts.vary ?? 0.06));
    a.setPlaybackRate(rate);
    a.play();
    slot.busyUntil = now + buf.duration / rate + 0.05;
  }

  /**
   * Creates an entity-attached PositionalAudio for loops or repeated
   * one-shots (breathing, footsteps, voice).
   */
  attach(obj: THREE.Object3D, ref = 2.5, rolloff = 1.4): EntityVoice {
    const a = new THREE.PositionalAudio(this.listener);
    a.setRefDistance(ref);
    a.setRolloffFactor(rolloff);
    a.setDistanceModel('inverse');
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 20000;
    a.setFilter(filter);
    obj.add(a);
    this.voices.push({ obj, audio: a, filter });
    return new EntityVoice(this, a);
  }
}

/** A PositionalAudio bound to an entity. */
export class EntityVoice {
  private loopName: string | null = null;
  constructor(
    private engine: AudioEngine,
    readonly audio: THREE.PositionalAudio,
  ) {}

  playOnce(name: string, volume = 1, rate = 1): void {
    const buf = this.engine.buffer(name);
    if (!buf || !this.engine.ready) return;
    if (this.audio.isPlaying) this.audio.stop();
    this.loopName = null;
    this.audio.setLoop(false);
    this.audio.setBuffer(buf);
    this.audio.setVolume(volume);
    this.audio.setPlaybackRate(rate * (0.94 + Math.random() * 0.12));
    this.audio.play();
  }

  loop(name: string, volume = 1, rate = 1): void {
    if (!this.engine.ready) return;
    if (this.loopName === name && this.audio.isPlaying) {
      this.audio.setVolume(volume);
      return;
    }
    const buf = this.engine.buffer(name, 0);
    if (!buf) return;
    if (this.audio.isPlaying) this.audio.stop();
    this.loopName = name;
    this.audio.setBuffer(buf);
    this.audio.setLoop(true);
    this.audio.setVolume(volume);
    this.audio.setPlaybackRate(rate);
    this.audio.offset = Math.random() * buf.duration * 0.9;
    this.audio.play();
  }

  setVolume(v: number): void {
    this.audio.setVolume(v);
  }

  stop(): void {
    if (this.audio.isPlaying) this.audio.stop();
    this.loopName = null;
  }

  get playing(): boolean {
    return this.audio.isPlaying;
  }

  /** Stop and detach from the audio graph (entity removed for good). */
  dispose(): void {
    this.stop();
    this.audio.removeFromParent();
    this.audio.gain.disconnect();
  }

  get looping(): string | null {
    return this.loopName;
  }
}
