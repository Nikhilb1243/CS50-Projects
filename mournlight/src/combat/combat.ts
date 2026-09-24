import * as THREE from 'three';
import { segmentSegmentDistSq } from '../core/math';
import type { AttackDef } from '../data/attacks';

export type Team = 'player' | 'enemy';

export interface Hurtbox {
  a: THREE.Vector3;
  b: THREE.Vector3;
  r: number;
}

export interface HitInfo {
  attacker: Combatant | null;
  attack: AttackDef | null;
  damage: number;
  poise: number;
  point: THREE.Vector3;
  /** Horizontal direction the blow travels (attacker -> target). */
  dir: THREE.Vector3;
  kind: 'melee' | 'hazard' | 'grab' | 'critical' | 'fall';
  parryable: boolean;
  unblockable: boolean;
  knockback?: number;
}

export type HitResult = 'hit' | 'blocked' | 'parried' | 'dodged' | 'immune' | 'grabbed' | 'guardbreak';

export interface Combatant {
  readonly team: Team;
  readonly alive: boolean;
  readonly pos: THREE.Vector3;
  readonly yaw: number;
  readonly radius: number;
  hurtboxes(out: Hurtbox[]): void;
  receiveHit(h: HitInfo): HitResult;
  /** Called when this combatant's attack was parried. */
  onParried?(by: Combatant): void;
}

/** A physics prop that weapon sweeps can knock around. */
export interface Knockable {
  readonly curr: THREE.Vector3;
  readonly radius: number;
  impulse(dir: THREE.Vector3, strength: number): void;
}

export interface Segment {
  a: THREE.Vector3;
  b: THREE.Vector3;
}

const SUBSTEPS = 5;
const _pa = new THREE.Vector3();
const _pb = new THREE.Vector3();
const _c1 = new THREE.Vector3();
const _c2 = new THREE.Vector3();

/**
 * Swept melee hit detection. Every simulation step during an attack's
 * active frames, each striker segment is interpolated from its previous to
 * its current pose (so fast swings cannot tunnel) and tested against the
 * capsule hurtboxes of opposing combatants.
 */
export class CombatSystem {
  readonly combatants = new Set<Combatant>();
  readonly knockables: Knockable[] = [];
  private boxes: Hurtbox[] = [];
  private pool: Hurtbox[] = [];
  /** Debug visualization data for the current step. */
  readonly debugSweeps: { a: THREE.Vector3; b: THREE.Vector3; r: number }[] = [];

  add(c: Combatant): void {
    this.combatants.add(c);
  }

  remove(c: Combatant): void {
    this.combatants.delete(c);
  }

  private collect(c: Combatant): Hurtbox[] {
    for (const hb of this.boxes) this.pool.push(hb);
    this.boxes.length = 0;
    c.hurtboxes(this.boxes);
    return this.boxes;
  }

  newHurtbox(): Hurtbox {
    return this.pool.pop() ?? { a: new THREE.Vector3(), b: new THREE.Vector3(), r: 0.3 };
  }

  /**
   * Sweep striker segments from `prev` to `curr`. Calls `onHit` once per
   * newly-hit combatant (recorded in `hitSet`).
   */
  sweep(
    attacker: Combatant,
    prev: Segment[],
    curr: Segment[],
    radius: number,
    hitSet: Set<Combatant>,
    onHit: (target: Combatant, point: THREE.Vector3) => void,
    onProp?: (prop: Knockable, point: THREE.Vector3) => void,
  ): void {
    for (let s = 0; s < curr.length; s++) {
      const p = prev[s] ?? curr[s];
      const c = curr[s];
      this.debugSweeps.push({ a: c.a.clone(), b: c.b.clone(), r: radius });
      for (const target of this.combatants) {
        if (target === attacker || target.team === attacker.team || !target.alive || hitSet.has(target)) continue;
        // broad phase
        if (target.pos.distanceToSquared(c.a) > 64 && target.pos.distanceToSquared(p.a) > 64) continue;
        const boxes = this.collect(target);
        let hit = false;
        for (let k = 0; k <= SUBSTEPS && !hit; k++) {
          const t = k / SUBSTEPS;
          _pa.lerpVectors(p.a, c.a, t);
          _pb.lerpVectors(p.b, c.b, t);
          for (const hb of boxes) {
            const rr = radius + hb.r;
            if (segmentSegmentDistSq(_pa, _pb, hb.a, hb.b, _c1, _c2) <= rr * rr) {
              hit = true;
              const point = _c1.clone().lerp(_c2, 0.5);
              hitSet.add(target);
              onHit(target, point);
              break;
            }
          }
        }
      }
      if (onProp) {
        for (const prop of this.knockables) {
          const rr = radius + prop.radius;
          for (let k = 0; k <= 2; k++) {
            _pa.lerpVectors(p.a, c.a, k / 2);
            _pb.lerpVectors(p.b, c.b, k / 2);
            if (segmentSegmentDistSq(_pa, _pb, prop.curr, prop.curr) <= rr * rr) {
              onProp(prop, prop.curr.clone());
              break;
            }
          }
        }
      }
    }
  }

  /** Sphere overlap test for area attacks. */
  sphere(attacker: Combatant | null, team: Team, center: THREE.Vector3, radius: number, hitSet: Set<Combatant>, onHit: (t: Combatant, p: THREE.Vector3) => void): void {
    this.debugSweeps.push({ a: center.clone(), b: center.clone(), r: radius });
    for (const target of this.combatants) {
      if (target === attacker || target.team === team || !target.alive || hitSet.has(target)) continue;
      const boxes = this.collect(target);
      for (const hb of boxes) {
        const rr = radius + hb.r;
        if (segmentSegmentDistSq(center, center, hb.a, hb.b, _c1, _c2) <= rr * rr) {
          hitSet.add(target);
          onHit(target, _c2.clone());
          break;
        }
      }
    }
  }

  beginStep(): void {
    this.debugSweeps.length = 0;
  }
}

/** Utility: is `target` within `halfAngle` of `from`'s facing? */
export function facing(fromPos: THREE.Vector3, fromYaw: number, target: THREE.Vector3, halfAngle: number): boolean {
  const dx = target.x - fromPos.x;
  const dz = target.z - fromPos.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-4) return true;
  const dot = (Math.sin(fromYaw) * dx + Math.cos(fromYaw) * dz) / len;
  return dot >= Math.cos(halfAngle);
}
