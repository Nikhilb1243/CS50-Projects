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
  private reverbSend: GainNode;
  private reverbAmb: GainNode;
  private buffers = new Map<string, AudioBuffer[]>();
  private pool: { obj: THREE.Object3D; audio: THREE.PositionalAudio; busyUntil: number }[] = [];
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

    // Re-route the listener's output through our buses
    const lg = this.listener.getInput();
    lg.disconnect();
    lg.connect(this.sfx);
    this.sfx.connect(this.master);
    this.sfx.connect(this.reverbSend);
    this.reverbSend.connect(this.reverb);
    this.amb.connect(this.master);
    this.amb.connect(this.reverbAmb);
    this.reverbAmb.connect(this.reverb);
    this.reverb.connect(this.master);
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
      obj.add(audio);
      scene.add(obj);
      this.pool.push({ obj, audio, busyUntil: 0 });
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
    a.setBuffer(buf);
    a.setRefDistance(opts.ref ?? 3);
    a.setMaxDistance(opts.max ?? 60);
    a.setRolloffFactor(opts.rolloff ?? 1.2);
    a.setVolume(opts.volume ?? 1);
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
    obj.add(a);
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

  get looping(): string | null {
    return this.loopName;
  }
}
