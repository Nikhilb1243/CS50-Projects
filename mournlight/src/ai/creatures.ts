import * as THREE from 'three';
import { Enemy } from './enemy';
import type { GameContext } from '../core/context';
import type { EnemySpawn } from '../world/layout';
import { KEY_POSES } from '../entities/poses';
import { addJoint, blendPose, OFF, type Pose } from '../entities/rig';
import { clamp, clamp01, easeIn, noise1, yawTo } from '../core/math';
import type { HitInfo, HitResult, Hurtbox } from '../combat/combat';
import { Boss } from './boss';

/** Shambler: slow, tanky, grabs. Uses the base behaviour. */
export class Shambler extends Enemy {}

/** Drowned Knight: elite with chained combos and delayed swings. */
export class DrownedKnight extends Enemy {}

/**
 * Stalker: moves only while it is outside the light or out of the player's
 * view. When observed inside the lantern's glow it freezes mid-motion.
 */
export class Stalker extends Enemy {
  private wasFrozen = false;
  private seenOnce = false;
  private camDir = new THREE.Vector3();

  protected updateFrozen(_dt: number, d: number): void {
    if (!this.alive || this.state === 'riposted' || this.state === 'stagger' || this.state === 'parried' || this.state === 'dead') {
      this.frozen = false;
      return;
    }
    const p = this.player;
    const lr = p.lantern.radius;
    const inLantern = lr > 0 && d < lr * 1.05;
    const inFlame = this.ctx.lights.lightAt(this.pos) > 0.3;
    let observed = false;
    if (inLantern || inFlame) {
      const cam = this.ctx.cam.camera;
      const c = this.center(this.tmp).sub(cam.position);
      const dist = c.length();
      c.divideScalar(dist);
      cam.getWorldDirection(this.camDir);
      const hFov = 2 * Math.atan(Math.tan((cam.fov * Math.PI) / 360) * cam.aspect);
      if (c.dot(this.camDir) > Math.cos(hFov * 0.5 * 0.92)) {
        observed = this.ctx.physics.lineOfSight(cam.position, this.center(this.tmp2));
      }
    }
    this.frozen = observed;
    if (observed !== this.wasFrozen) {
      this.wasFrozen = observed;
      this.voice.playOnce('stalker_creak', observed ? 0.9 : 0.6, observed ? 1 : 0.7);
    }
  }

  protected alert(): void {
    super.alert();
    if (!this.seenOnce) {
      this.seenOnce = true;
      this.ctx.ambience.stinger();
    }
  }

  protected animate(dt: number): void {
    super.animate(dt);
    // unnatural twitching of the head while hunting
    if (this.state === 'chase' && !this.frozen) {
      const r = this.model.rig;
      r.bone('head').rotation.z += noise1(this.t * 6, 4) * 0.35;
      r.bone('neck').rotation.x += noise1(this.t * 3, 7) * 0.2;
    }
  }

  reset(): void {
    super.reset();
    this.wasFrozen = false;
  }
}

/**
 * Crawler: waits on ceilings and walls, dropping onto the player from
 * above, then hunts low to the ground on all fours.
 */
export class Crawler extends Enemy {
  private anchor = new THREE.Vector3();
  private clingQ = new THREE.Quaternion();
  private dropFrom = new THREE.Vector3();
  private dropTo = new THREE.Vector3();
  private dropQ = new THREE.Quaternion();
  private upQ = new THREE.Quaternion();
  private curQ = new THREE.Quaternion();
  private prevQ = new THREE.Quaternion();

  constructor(ctx: GameContext, spawn: EnemySpawn) {
    super(ctx, spawn);
    this.anchor.set(...spawn.p);
    this.computeClingQ();
    if (spawn.cling) this.enterCling();
  }

  private computeClingQ(): void {
    const s = this.spawn;
    if (s.cling === 'wall' && s.n) {
      const up = new THREE.Vector3(...s.n).normalize();
      const fwd = new THREE.Vector3(0, -1, 0);
      const right = new THREE.Vector3().crossVectors(up, fwd).normalize();
      const m = new THREE.Matrix4().makeBasis(right, up, fwd);
      this.clingQ.setFromRotationMatrix(m);
    } else {
      this.clingQ.setFromEuler(new THREE.Euler(0, this.yaw, Math.PI, 'YXZ'));
    }
  }

  private enterCling(): void {
    this.setState('cling');
    this.pos.copy(this.anchor);
    this.prevPos.copy(this.anchor);
    if (this.char) this.ctx.physics.setCharacterEnabled(this.char, false);
    this.curQ.copy(this.clingQ);
    this.prevQ.copy(this.clingQ);
    this.lockable = true;
  }

  hurtboxes(out: Hurtbox[]): void {
    const hb = this.ctx.combat.newHurtbox();
    if (this.state === 'cling' || this.state === 'drop') {
      hb.a.copy(this.pos);
      this.center(hb.b);
      hb.r = 0.45;
    } else {
      const f = this.forward(this.tmp);
      hb.a.set(this.pos.x - f.x * 0.45, this.pos.y + 0.42, this.pos.z - f.z * 0.45);
      hb.b.set(this.pos.x + f.x * 0.55, this.pos.y + 0.48, this.pos.z + f.z * 0.55);
      hb.r = 0.36;
    }
    out.push(hb);
  }

  canBackstab(): boolean {
    return false;
  }

  protected perceive(dt: number, d: number): void {
    if (this.state === 'cling') {
      const p = this.player;
      const hd = Math.hypot(p.pos.x - this.anchor.x, p.pos.z - this.anchor.z);
      const below = p.pos.y < this.anchor.y;
      const trigger = this.spawn.cling === 'wall' ? d < 5.5 : hd < 4.2 && below && this.anchor.y - p.pos.y < 9;
      if (trigger && p.alive && p.state !== 'rest') this.startDrop();
      return;
    }
    if (this.state === 'drop') return;
    super.perceive(dt, d);
  }

  private startDrop(): void {
    const p = this.player;
    this.dropFrom.copy(this.anchor);
    // land between our anchor and the player
    const tx = this.anchor.x + (p.pos.x - this.anchor.x) * 0.55;
    const tz = this.anchor.z + (p.pos.z - this.anchor.z) * 0.55;
    const gh = this.ctx.physics.groundHeight(tx, tz, this.anchor.y - 0.6, 30);
    this.dropTo.set(tx, gh ?? p.pos.y, tz);
    this.yaw = yawTo(p.pos.x - tx, p.pos.z - tz);
    this.upQ.setFromEuler(new THREE.Euler(0, this.yaw, 0));
    this.dropQ.copy(this.curQ);
    this.setState('drop', 0.55);
    this.voice.playOnce('crawler_screech', 1);
    this.ctx.ambience.stinger();
    this.awareness = 1.2;
    this.lastKnown.copy(p.pos);
  }

  protected think(dt: number, d: number): void {
    if (this.state === 'cling') {
      this.pos.copy(this.anchor);
      if (Math.random() < dt * 0.15) this.voice.playOnce('crawler_skitter', 0.25);
      return;
    }
    if (this.state === 'drop') {
      const u = clamp01(this.stateTime / this.stateDur);
      this.pos.lerpVectors(this.dropFrom, this.dropTo, easeIn(u));
      this.pos.y += Math.sin(u * Math.PI) * 0.4;
      this.curQ.slerpQuaternions(this.dropQ, this.upQ, clamp01(u * 1.4));
      if (u >= 1) {
        this.teleport(this.dropTo, this.yaw);
        if (this.char) this.ctx.physics.setCharacterEnabled(this.char, true);
        this.ctx.particles.dust(this.pos.clone().setY(this.pos.y + 0.1), 14);
        this.ctx.audio.playAt('land', this.pos, { volume: 0.9 });
        this.ctx.shake(0.2);
        this.attackTimer = 0.4;
        this.setState('chase');
      }
      return;
    }
    super.think(dt, d);
  }

  receiveHit(h: HitInfo): HitResult {
    if (this.state === 'cling') {
      const r = super.receiveHit(h);
      if (this.alive) this.startDrop();
      return r;
    }
    return super.receiveHit(h);
  }

  syncSim(): void {
    if (this.state === 'cling' || this.state === 'drop') {
      this.model.root.position.copy(this.pos);
      this.model.root.quaternion.copy(this.curQ);
      this.model.root.updateMatrixWorld(true);
      this.prevQ.copy(this.curQ);
      return;
    }
    super.syncSim();
  }

  render(alpha: number): void {
    if (this.state === 'cling' || this.state === 'drop') {
      this.model.root.position.lerpVectors(this.prevPos, this.pos, alpha);
      this.model.root.quaternion.copy(this.curQ);
      return;
    }
    super.render(alpha);
  }

  protected locomotionOverride(out: Pose): boolean {
    out.set(KEY_POSES.cr_base);
    const s = clamp(this.anim.speed, 0, 2.2) / 2.2;
    const ph = this.anim.phase * 1.25;
    const a = Math.sin(ph);
    const b = -a;
    const la = Math.max(0, Math.cos(ph));
    const lb = Math.max(0, -Math.cos(ph));
    addJoint(out, 'upperArmR', -a * 0.5 * s, 0, 0);
    addJoint(out, 'forearmR', -la * 0.7 * s, 0, 0);
    addJoint(out, 'thighL', -a * 0.5 * s, 0, 0);
    addJoint(out, 'shinL', la * 0.8 * s, 0, 0);
    addJoint(out, 'upperArmL', -b * 0.5 * s, 0, 0);
    addJoint(out, 'forearmL', -lb * 0.7 * s, 0, 0);
    addJoint(out, 'thighR', -b * 0.5 * s, 0, 0);
    addJoint(out, 'shinR', lb * 0.8 * s, 0, 0);
    addJoint(out, 'hips', 0, a * 0.12 * s, 0);
    addJoint(out, 'head', noise1(this.t * 7, 1) * 0.25, noise1(this.t * 5, 2) * 0.4, noise1(this.t * 9, 3) * 0.6);
    out[OFF + 1] -= Math.abs(a) * 0.03 * s;
    if (this.state === 'cling') {
      // idle twitching while waiting
      addJoint(out, 'forearmR', noise1(this.t * 4, 9) * 0.2, 0, 0);
      addJoint(out, 'forearmL', noise1(this.t * 4.3, 8) * 0.2, 0, 0);
    }
    return true;
  }

  protected deadPose(p: Pose): void {
    const u = clamp01(this.deadTime / 0.8);
    const splay = KEY_POSES.cr_base.slice() as Pose;
    splay[OFF + 1] = -0.82;
    blendPose(p, KEY_POSES.cr_base, splay, u);
    addJoint(p, 'upperArmR', 0.6 * u, 0, -0.4 * u);
    addJoint(p, 'upperArmL', 0.6 * u, 0, 0.4 * u);
    addJoint(p, 'thighR', 0.4 * u, 0, -0.3 * u);
    addJoint(p, 'thighL', 0.4 * u, 0, 0.3 * u);
    addJoint(p, 'head', 0.5 * u, 0.6 * u, 0);
  }

  center(out = new THREE.Vector3()): THREE.Vector3 {
    if (this.state === 'cling') return out.copy(this.pos).addScaledVector(new THREE.Vector3(0, 1, 0).applyQuaternion(this.curQ), 0.45);
    return out.set(this.pos.x, this.pos.y + 0.5, this.pos.z);
  }

  reset(): void {
    super.reset();
    if (this.spawn.cling) this.enterCling();
  }
}

export function createEnemy(ctx: GameContext, spawn: EnemySpawn): Enemy {
  switch (spawn.type) {
    case 'shambler':
      return new Shambler(ctx, spawn);
    case 'stalker':
      return new Stalker(ctx, spawn);
    case 'crawler':
      return new Crawler(ctx, spawn);
    case 'knight':
      return new DrownedKnight(ctx, spawn);
    case 'boss':
      return new Boss(ctx, spawn);
  }
}
