import { clamp01, easeInOut, easeOut, lerp, clamp } from '../core/math';
import { blendPose, makePose, type Pose, Rig } from './rig';
import { keyPose, locomotion, type LocoStyle } from './poses';
import type { AttackDef } from '../data/attacks';

/**
 * Two-layer procedural animator:
 *  - base layer: speed-driven locomotion
 *  - action layer: attacks / rolls / reactions, blended in with a weight that
 *    fades in and out, optionally restricted by a per-joint mask.
 */
export class Animator {
  readonly base = makePose();
  readonly action = makePose();
  readonly out = makePose();
  phase = 0;
  t = 0;
  speed = 0;
  private weight = 0;
  private target = 0;
  private fadeInRate = 16;
  private fadeOutRate = 9;
  mask: Float32Array | undefined;
  /** Optional arms/upper override blended over locomotion (e.g. carrying a weapon). */
  carry: Pose | null = null;
  carryMask: Float32Array | undefined;
  carryWeight = 1;
  paused = false;
  /** World-space size multiplier of the model (affects stride length). */
  stepScale = 1;

  constructor(
    readonly rig: Rig,
    public style: LocoStyle,
  ) {}

  /** Declare whether an action pose is active this step. */
  setAction(active: boolean, mask?: Float32Array, fadeIn = 16, fadeOut = 9): void {
    this.target = active ? 1 : 0;
    if (active) this.mask = mask;
    this.fadeInRate = fadeIn;
    this.fadeOutRate = fadeOut;
  }

  snap(): void {
    this.weight = this.target;
  }

  get actionWeight(): number {
    return this.weight;
  }

  /**
   * Advance the base layer. `speedNorm` is 0 idle .. 3 sprint and `dist` the
   * ground distance travelled this step.
   */
  update(dt: number, speedNorm: number, dist: number): void {
    if (this.paused) return;
    this.t += dt;
    this.speed = lerp(this.speed, speedNorm, 1 - Math.exp(-10 * dt));
    const stepLen = lerp(0.72, 1.35, clamp01(this.speed - 1)) * this.stepScale;
    this.phase += (dist * Math.PI) / Math.max(0.3, stepLen);
    if (this.speed < 0.05) this.phase = lerp(this.phase, Math.round(this.phase / Math.PI) * Math.PI, 1 - Math.exp(-4 * dt));
    locomotion(this.base, this.t, this.phase, this.speed, this.style);
    if (this.carry) blendPose(this.base, this.base, this.carry, this.carryWeight, this.carryMask);
    const rate = this.target > this.weight ? this.fadeInRate : this.fadeOutRate;
    this.weight += (this.target - this.weight) * (1 - Math.exp(-rate * dt));
    if (Math.abs(this.target - this.weight) < 0.002) this.weight = this.target;
  }

  /** Compose layers and write to the rig. */
  apply(): void {
    if (this.weight > 0.001) blendPose(this.out, this.base, this.action, this.weight, this.mask);
    else this.out.set(this.base);
    this.rig.apply(this.out);
  }
}

// ---------------------------------------------------------------------------
// Attack timelines
// ---------------------------------------------------------------------------
export type AttackPhase = 'windup' | 'active' | 'recovery' | 'done';

export function attackPhase(def: AttackDef, frame: number, extraWindup = 0): AttackPhase {
  const w = def.windup + extraWindup;
  if (frame < w) return 'windup';
  if (frame < w + def.active) return 'active';
  if (frame < w + def.active + def.recovery) return 'recovery';
  return 'done';
}

/**
 * Writes the attack's full-body pose for the given frame. The weapon travels
 * windup-pose -> strike-pose during the active frames, so the blade sweeps a
 * real arc which the combat system samples for hit detection.
 */
export function attackPose(out: Pose, def: AttackDef, frame: number, rest: Pose, extraWindup = 0, tremble = 0): Pose {
  const wind = keyPose(def.poses.windup);
  const hit = keyPose(def.poses.strike);
  const w = def.windup + extraWindup;
  const reach = def.windup * 0.75;
  if (frame < w) {
    const u = clamp01(frame / Math.max(1, reach));
    blendPose(out, rest, wind, easeOut(u));
    // Delayed swings creep further back while holding
    if (frame > reach && def.holdCreep) {
      const hold = clamp01((frame - reach) / Math.max(1, w - reach));
      for (let i = 0; i < out.length; i++) out[i] += (wind[i] - rest[i]) * def.holdCreep * hold;
    }
    if (tremble > 0) {
      for (let i = 0; i < out.length - 3; i += 3) out[i] += Math.sin(frame * 1.7 + i) * 0.015 * tremble;
    }
  } else if (frame < w + def.active) {
    const u = clamp01((frame - w) / def.active);
    blendPose(out, wind, hit, easeInOut(clamp(u * 1.08, 0, 1)));
  } else {
    const u = clamp01((frame - w - def.active) / Math.max(1, def.recovery));
    const hold = 0.35;
    if (u < hold) out.set(hit);
    else blendPose(out, hit, rest, easeInOut((u - hold) / (1 - hold)));
  }
  return out;
}
