import * as THREE from 'three';
import type { GameContext } from '../core/context';
import type { Character } from '../core/physics';
import { Animator } from './animator';
import { models, type ModelInstance } from './models';
import { STYLES } from './poses';
import type { Combatant, HitInfo, HitResult, Hurtbox, Segment, Team } from '../combat/combat';
import { lerp, wrapAngle } from '../core/math';

/**
 * Shared base for the player and creatures: physics capsule driven by the
 * kinematic character controller, a procedural-animated model, and
 * fixed-step state with interpolated rendering.
 */
export abstract class Actor implements Combatant {
  abstract readonly team: Team;
  readonly pos = new THREE.Vector3();
  readonly prevPos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  prevYaw = 0;
  grounded = false;
  alive = true;
  health = 100;
  maxHealth = 100;
  readonly model: ModelInstance;
  readonly anim: Animator;
  char: Character | null = null;
  readonly radius: number;
  readonly height: number;
  /** Extra visual yaw offset (e.g. flinch). */
  protected visualLift = 0;
  private _move = new THREE.Vector3();

  constructor(
    protected ctx: GameContext,
    modelId: string,
    style: string,
    radius: number,
    height: number,
    member: number,
    filter: number,
    at: THREE.Vector3,
    withCollider = true,
  ) {
    this.radius = radius;
    this.height = height;
    this.model = models.create(modelId);
    this.anim = new Animator(this.model.rig, STYLES[style] ?? STYLES.revenant);
    this.anim.stepScale = this.model.scale;
    this.pos.copy(at);
    this.prevPos.copy(at);
    if (withCollider) {
      const halfH = Math.max(0.05, height / 2 - radius);
      this.char = ctx.physics.createCharacter(at, radius, halfH, member, filter);
    }
    ctx.scene.add(this.model.root);
    this.syncSim();
  }

  beginStep(): void {
    this.prevPos.copy(this.pos);
    this.prevYaw = this.yaw;
  }

  /** Move by a world-space displacement through the character controller. */
  move(delta: THREE.Vector3, isPlayer = false): void {
    if (!this.char) {
      this.pos.add(delta);
      return;
    }
    const r = this.ctx.physics.moveCharacter(this.char, this.pos, delta, isPlayer);
    this.grounded = r.grounded;
    this._move.copy(r.moved);
  }

  get lastMove(): THREE.Vector3 {
    return this._move;
  }

  teleport(p: THREE.Vector3, yaw?: number): void {
    this.pos.copy(p);
    this.prevPos.copy(p);
    if (yaw !== undefined) {
      this.yaw = yaw;
      this.prevYaw = yaw;
    }
    if (this.char) this.ctx.physics.teleportCharacter(this.char, p);
    this.vel.set(0, 0, 0);
  }

  /** Place the model at the simulation transform (for socket sampling). */
  syncSim(): void {
    this.model.root.position.copy(this.pos);
    this.model.root.position.y += this.visualLift;
    this.model.root.rotation.set(0, this.yaw, 0);
    this.model.root.updateMatrixWorld(true);
  }

  /** Interpolated visual transform. */
  render(alpha: number): void {
    this.model.root.position.lerpVectors(this.prevPos, this.pos, alpha);
    this.model.root.position.y += this.visualLift;
    this.model.root.rotation.set(0, this.prevYaw + wrapAngle(this.yaw - this.prevYaw) * alpha, 0);
  }

  forward(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }

  /** World-space striker segment (requires syncSim this step). */
  striker(name: string, out: Segment): boolean {
    const s = this.model.strikers.get(name);
    if (!s) return false;
    s[0].getWorldPosition(out.a);
    s[1].getWorldPosition(out.b);
    return true;
  }

  socketWorld(name: string, out = new THREE.Vector3()): THREE.Vector3 {
    const s = this.model.sockets.get(name);
    if (s) s.getWorldPosition(out);
    else out.copy(this.pos).setY(this.pos.y + this.height * 0.7);
    return out;
  }

  hurtboxes(out: Hurtbox[]): void {
    const hb = this.ctx.combat.newHurtbox();
    hb.a.set(this.pos.x, this.pos.y + this.radius, this.pos.z);
    hb.b.set(this.pos.x, this.pos.y + this.height - this.radius, this.pos.z);
    hb.r = this.radius;
    out.push(hb);
  }

  /** Point on the body for effects and lock-on. */
  center(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.pos.x, this.pos.y + this.height * 0.6, this.pos.z);
  }

  abstract receiveHit(h: HitInfo): HitResult;

  dispose(): void {
    this.ctx.scene.remove(this.model.root);
    if (this.char) this.ctx.physics.removeCharacter(this.char);
    this.char = null;
    this.model.dispose();
  }

  protected approachYaw(target: number, rate: number, dt: number): void {
    const d = wrapAngle(target - this.yaw);
    const step = rate * dt;
    this.yaw = wrapAngle(this.yaw + (Math.abs(d) < step ? d : Math.sign(d) * step));
  }

  protected lerpVel(tx: number, tz: number, accel: number, dt: number): void {
    const k = 1 - Math.exp(-accel * dt * 0.25);
    this.vel.x = lerp(this.vel.x, tx, k);
    this.vel.z = lerp(this.vel.z, tz, k);
  }
}
