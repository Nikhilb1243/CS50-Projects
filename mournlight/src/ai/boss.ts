import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { Enemy } from './enemy';
import type { GameContext } from '../core/context';
import type { EnemySpawn } from '../world/layout';
import type { AttackChoice } from '../data/enemies';
import type { Combatant, HitInfo, HitResult, Hurtbox } from '../combat/combat';
import { keyPose, KEY_POSES } from '../entities/poses';
import { blendPose, type Pose } from '../entities/rig';
import { clamp01, easeInOut, smoothstep, yawTo } from '../core/math';
import { events } from '../core/events';
import { BOSS } from '../world/layout';
import type { Player } from '../entities/player';

/**
 * Oskeline, the Wick-Mother. Phase one fights with a great candelabrum; at
 * half health she sheds her porcelain mask, drops the staff, grows claws and
 * the arena's candles gutter out.
 */
export class Boss extends Enemy {
  phase: 1 | 2 = 1;
  private posture = 0;
  fightActive = false;
  onPhase2: (() => void) | null = null;
  onDefeated: (() => void) | null = null;
  private leapFrom = new THREE.Vector3();
  private leapTo = new THREE.Vector3();
  private leapSet = false;
  private maskBody: RAPIER.RigidBody | null = null;
  private maskMesh: THREE.Object3D | null = null;
  private staffBody: RAPIER.RigidBody | null = null;
  private staffMesh: THREE.Object3D | null = null;
  private transformed = false;

  constructor(ctx: GameContext, spawn: EnemySpawn) {
    super(ctx, spawn);
    this.lockable = false;
    this.setState('dormant');
  }

  get displayName(): string {
    return this.phase === 1 ? BOSS.name : BOSS.phase2Name;
  }

  hurtboxes(out: Hurtbox[]): void {
    const s = this.model.scale;
    const hb = this.ctx.combat.newHurtbox();
    hb.a.set(this.pos.x, this.pos.y + 0.9, this.pos.z);
    hb.b.set(this.pos.x, this.pos.y + 1.55 * s, this.pos.z);
    hb.r = 0.45 * s;
    out.push(hb);
    const head = this.ctx.combat.newHurtbox();
    this.socketWorld('head', head.a);
    head.b.copy(head.a);
    head.r = 0.25 * s;
    out.push(head);
  }

  center(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.pos.x, this.pos.y + this.height * 0.55, this.pos.z);
  }

  canRiposte(): boolean {
    return this.alive && this.state === 'parried';
  }

  canBackstab(): boolean {
    return false;
  }

  wake(): void {
    if (this.state !== 'dormant') return;
    this.setState('intro', 3.4);
    this.awareness = 2;
  }

  protected perceive(_dt: number, _d: number): void {
    if (!this.fightActive) return;
    this.awareness = 2;
    this.canSee = true;
    this.lastKnown.copy(this.player.pos);
  }

  protected availableAttacks(): AttackChoice[] {
    return this.def.attacks.filter((a) => (a.phase ?? 1) === this.phase);
  }

  protected think(dt: number, d: number): void {
    switch (this.state) {
      case 'dormant':
        this.locomote(dt, null, 0);
        return;
      case 'intro':
        this.locomote(dt, null, 0, undefined, this.player.pos);
        if (this.stateTime > 1.0 && this.stateTime - dt <= 1.0) {
          this.voice.playOnce('boss_roar', 1);
          this.ctx.shake(0.6);
        }
        if (this.stateTime >= this.stateDur) {
          this.fightActive = true;
          this.lockable = true;
          this.attackTimer = 0.6;
          this.setState('chase');
        }
        return;
      case 'transform':
        this.stTransform(dt);
        return;
    }
    if (this.fightActive && !this.player.alive) {
      this.locomote(dt, null, 0);
      return;
    }
    super.think(dt, d);
    if (this.phase === 2 && this.alive && Math.random() < 0.3) this.ctx.particles.rot(this.socketWorld('chest', this.tmp), 1);
    if (this.phase === 1 && this.alive && Math.random() < 0.2) this.ctx.particles.embers(this.socketWorld('crown', this.tmp), 1, 0.3);
  }

  // ---------------------------------------------------------------------------
  protected customAttackMotion(a: { def: { id: string; windup: number; active: number }; frame: number }, _dt: number): void {
    if (a.def.id !== 'bo_leap') return;
    if (a.frame === a.def.windup - 4) {
      this.leapFrom.copy(this.pos);
      const p = this.player.pos;
      const dx = p.x - this.pos.x;
      const dz = p.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      const stop = Math.max(0, d - 2.2);
      this.leapTo.set(this.pos.x + (dx / d) * stop, p.y, this.pos.z + (dz / d) * stop);
      // stay inside the arena
      const c = BOSS.arena;
      const ox = this.leapTo.x - c[0];
      const oz = this.leapTo.z - c[2];
      const od = Math.hypot(ox, oz);
      if (od > BOSS.radius - 3) {
        this.leapTo.x = c[0] + (ox / od) * (BOSS.radius - 3);
        this.leapTo.z = c[2] + (oz / od) * (BOSS.radius - 3);
      }
      this.leapSet = true;
      this.yaw = yawTo(dx, dz);
    }
  }

  protected attackOwnsMovement(a: { def: { id: string; windup: number; active: number }; frame: number }): boolean {
    if (a.def.id !== 'bo_leap' || !this.leapSet) return false;
    const f = a.frame - a.def.windup;
    if (f < 0 || f > a.def.active) return false;
    const u = clamp01(f / a.def.active);
    const p = this.tmp.lerpVectors(this.leapFrom, this.leapTo, easeInOut(u));
    p.y += Math.sin(u * Math.PI) * 5.5;
    this.pos.copy(p);
    if (this.char) this.ctx.physics.teleportCharacter(this.char, this.pos);
    if (u >= 1) {
      this.leapSet = false;
      this.ctx.shake(0.8);
      this.ctx.audio.playAt('step_boss', this.pos, { volume: 1, rate: 0.7 });
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  receiveHit(h: HitInfo): HitResult {
    if (this.state === 'dormant' || this.state === 'intro' || this.state === 'transform') return 'immune';
    const r = super.receiveHit(h);
    if (!this.alive) return r;
    this.posture += h.poise;
    if (this.posture >= 380 && this.state !== 'parried') this.breakPosture();
    if (this.phase === 1 && this.health < this.maxHealth * 0.5) this.startTransform();
    return r;
  }

  private breakPosture(): void {
    this.posture = 0;
    this.atk = null;
    this.setState('parried', 2.8);
    this.voice.playOnce('boss_roar', 0.8, 1.3);
    this.ctx.audio.playAt('guard_break', this.center(this.tmp), { volume: 1, rate: 0.7 });
  }

  onParried(_by: Combatant): void {
    this.posture += 150;
    if (this.posture >= 380) this.breakPosture();
    else {
      this.atk = null;
      this.setState('stagger', 0.7);
    }
  }

  applyCritical(damage: number, by: Player): void {
    super.applyCritical(damage * 1.2, by);
    if (this.alive && this.phase === 1 && this.health < this.maxHealth * 0.5) {
      this.critBy = null;
      this.startTransform();
    }
  }

  startCritical(by: Player, kind: 'riposte' | 'backstab'): void {
    super.startCritical(by, kind);
    this.stateDur = 3.0;
  }

  // ---------------------------------------------------------------------------
  private startTransform(): void {
    if (this.transformed) return;
    this.transformed = true;
    this.atk = null;
    this.setState('transform', 4.2);
    this.lockable = true;
  }

  private stTransform(dt: number): void {
    this.locomote(dt, null, 0, undefined, this.player.pos);
    const t = this.stateTime;
    const crossed = (x: number): boolean => t >= x && t - dt < x;
    if (crossed(0.2)) this.voice.playOnce('boss_scream', 1);
    if (crossed(0.7)) this.detachMask();
    if (crossed(1.0)) {
      this.phase = 2;
      this.onPhase2?.();
      events.emit('boss:phase', { name: this.displayName });
      this.ctx.flash(0.5, 0xff3010);
      this.ctx.shake(0.9);
      this.model.extras.get('ribs')!.visible = true;
      this.ctx.audio.playAt('burst', this.center(this.tmp), { volume: 1 });
    }
    if (crossed(1.3)) this.dropStaff();
    const clawGrow = smoothstep(1.5, 3.2, t);
    for (const k of ['clawsR', 'clawsL']) {
      const c = this.model.extras.get(k)!;
      c.visible = clawGrow > 0.01;
      c.scale.setScalar(Math.max(0.01, clawGrow));
    }
    if (t > 1 && Math.random() < 0.6) this.ctx.particles.rot(this.socketWorld('chest', this.tmp), 3);
    this.updateDetached(dt);
    if (t >= this.stateDur) {
      this.attackTimer = 0.4;
      this.posture = 0;
      this.setState('chase');
    }
  }

  private detachMask(): void {
    const mask = this.model.extras.get('mask');
    if (!mask) return;
    const wp = mask.getWorldPosition(new THREE.Vector3());
    const wq = mask.getWorldQuaternion(new THREE.Quaternion());
    const ws = mask.getWorldScale(new THREE.Vector3());
    mask.removeFromParent();
    mask.position.copy(wp);
    mask.quaternion.copy(wq);
    mask.scale.copy(ws);
    this.ctx.scene.add(mask);
    this.maskMesh = mask;
    this.maskBody = this.ctx.physics.createDynamicBall(wp, 0.3, 0.5);
    this.maskBody.wakeUp();
    const f = this.forward(this.tmp);
    this.maskBody.applyImpulse({ x: f.x * 2, y: 1.5, z: f.z * 2 }, true);
    this.ctx.audio.playAt('block', wp, { volume: 0.8, rate: 1.5 });
  }

  private dropStaff(): void {
    const staff = this.model.extras.get('staff');
    if (!staff) return;
    const wp = staff.getWorldPosition(new THREE.Vector3());
    const wq = staff.getWorldQuaternion(new THREE.Quaternion());
    const ws = staff.getWorldScale(new THREE.Vector3());
    staff.removeFromParent();
    staff.position.copy(wp);
    staff.quaternion.copy(wq);
    staff.scale.copy(ws);
    this.ctx.scene.add(staff);
    this.staffMesh = staff;
    const center = new THREE.Vector3(0, -0.85 * ws.y, 0).applyQuaternion(wq).add(wp);
    this.staffBody = this.ctx.physics.createDynamicCylinder(center, 1.25 * ws.y, 0.09 * ws.x, wq, 2);
    this.staffBody.wakeUp();
    this.staffCenterOffset = new THREE.Vector3(0, 0.85 * ws.y, 0);
    this.ctx.audio.playAt('hit_armor', wp, { volume: 1, rate: 0.5 });
  }

  private staffCenterOffset = new THREE.Vector3();

  private updateDetached(_dt: number): void {
    if (this.maskBody && this.maskMesh) {
      const t = this.maskBody.translation();
      const r = this.maskBody.rotation();
      this.maskMesh.position.set(t.x, t.y, t.z);
      this.maskMesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
    if (this.staffBody && this.staffMesh) {
      const t = this.staffBody.translation();
      const r = this.staffBody.rotation();
      const q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
      this.staffMesh.quaternion.copy(q);
      this.staffMesh.position.copy(this.staffCenterOffset.clone().applyQuaternion(q)).add(new THREE.Vector3(t.x, t.y, t.z));
    }
  }

  update(dt: number): void {
    super.update(dt);
    if (this.state !== 'transform') this.updateDetached(dt);
  }

  die(by: Player | null): void {
    if (!this.alive) return;
    super.die(by);
    this.fightActive = false;
    this.voice.playOnce('boss_death', 1);
    this.ctx.shake(0.8);
    events.emit('boss:defeated', { name: this.displayName });
    this.onDefeated?.();
  }

  protected deadPose(p: Pose): void {
    const u = clamp01(this.deadTime / 3.5);
    blendPose(p, keyPose('death_knees'), keyPose('death_down'), smoothstep(0.35, 1, u));
    if (u < 0.35) blendPose(p, keyPose('bo_roar'), keyPose('death_knees'), u / 0.35);
    if (Math.random() < 0.5) this.ctx.particles.embers(this.center(this.tmp).add(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3)), 2, 0.6);
    if (Math.random() < 0.4) this.ctx.particles.rot(this.center(this.tmp), 1);
  }

  protected animate(dt: number): void {
    if (this.state === 'dormant' || this.state === 'intro' || this.state === 'transform') {
      this.anim.update(dt, 0, 0);
      const p = this.pose;
      if (this.state === 'dormant') p.set(keyPose('kneel'));
      else if (this.state === 'intro') {
        const u = clamp01(this.stateTime / 1.4);
        blendPose(p, keyPose('kneel'), keyPose('bo_roar'), smoothstep(0, 1, u));
        if (this.stateTime > 2.4) blendPose(p, keyPose('bo_roar'), KEY_POSES.bo_carry, smoothstep(2.4, 3.4, this.stateTime));
      } else {
        p.set(keyPose('bo_roar'));
        for (let i = 0; i < p.length - 3; i += 3) p[i] += Math.sin(this.t * 25 + i) * 0.03 * (this.stateTime < 3 ? 1 : 0);
      }
      this.anim.setAction(true, undefined, 6, 4);
      this.anim.action.set(p);
      this.anim.apply();
      this.model.flash(this.hurtFlash);
      return;
    }
    // phase two moves are clawed: no staff carry pose
    this.anim.carry = this.phase === 1 ? keyPose('bo_carry') : null;
    super.animate(dt);
  }

  /** Called when the player dies during the fight. */
  resetFight(): void {
    if (!this.alive) return;
    this.reset();
    this.phase = 1;
    this.transformed = false;
    this.posture = 0;
    this.fightActive = false;
    this.lockable = false;
    this.setState('dormant');
    this.model.extras.get('ribs')!.visible = false;
    for (const k of ['clawsR', 'clawsL']) {
      const c = this.model.extras.get(k)!;
      c.visible = false;
      c.scale.setScalar(0.01);
    }
    // re-attach mask and staff
    if (this.maskMesh) {
      this.ctx.physics.world.removeRigidBody(this.maskBody!);
      this.maskBody = null;
      const head = this.model.rig.bone('head');
      head.add(this.maskMesh);
      this.maskMesh.position.set(0, 0.08, 0.01);
      this.maskMesh.quaternion.identity();
      this.maskMesh.scale.setScalar(1);
      this.maskMesh = null;
    }
    if (this.staffMesh) {
      this.ctx.physics.world.removeRigidBody(this.staffBody!);
      this.staffBody = null;
      const hand = this.model.rig.bone('handR');
      hand.add(this.staffMesh);
      this.staffMesh.position.set(0, 0, 0);
      this.staffMesh.quaternion.identity();
      this.staffMesh.scale.setScalar(1);
      this.staffMesh = null;
    }
  }
}
