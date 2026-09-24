import * as THREE from 'three';
import { Actor } from '../entities/actor';
import type { GameContext } from '../core/context';
import { G } from '../core/physics';
import { ENEMIES, type AttackChoice, type EnemyDef } from '../data/enemies';
import { attack, type AttackDef } from '../data/attacks';
import { attackPhase, attackPose } from '../entities/animator';
import { keyPose, deathPose, STANCE_POSE, KEY_POSES } from '../entities/poses';
import { ARMS_MASK, addJoint, blendPose, makePose, type Pose } from '../entities/rig';
import { clamp, clamp01, lerp, rand, smoothstep, wrapAngle, yawTo, noise1 } from '../core/math';
import type { Combatant, HitInfo, HitResult, Segment } from '../combat/combat';
import { facing } from '../combat/combat';
import type { EnemySpawn } from '../world/layout';
import type { EntityVoice } from '../audio/audio';
import type { Player } from '../entities/player';
import { CreatureDress, DRESS } from './dress';
import { events } from '../core/events';

export type EState =
  | 'idle'
  | 'patrol'
  | 'investigate'
  | 'chase'
  | 'attack'
  | 'stagger'
  | 'parried'
  | 'riposted'
  | 'grab'
  | 'return'
  | 'cling'
  | 'drop'
  | 'dormant'
  | 'intro'
  | 'transform'
  | 'dead';

interface EnemyAttack {
  def: AttackDef;
  frame: number;
  hitSet: Set<Combatant>;
  prev: Segment[];
  segs: Segment[];
  hazardDone: boolean;
}

const SIGHT_CHECK = 0.22;

export class Enemy extends Actor {
  readonly team = 'enemy' as const;
  readonly def: EnemyDef;
  readonly spawn: EnemySpawn;
  state: EState = 'idle';
  stateTime = 0;
  protected stateDur = 0;
  poise: number;
  awareness = 0;
  readonly lastKnown = new THREE.Vector3();
  readonly home = new THREE.Vector3();
  protected atk: EnemyAttack | null = null;
  protected cooldowns = new Map<string, number>();
  protected attackTimer = 0;
  protected patrolIdx = 0;
  protected waitTimer = 0;
  protected sightTimer = Math.random() * SIGHT_CHECK;
  protected canSee = false;
  protected stuckTimer = 0;
  protected sidestep = 0;
  protected sidestepTimer = 0;
  protected strafeDir = Math.random() < 0.5 ? 1 : -1;
  protected strafeTimer = 0;
  protected knock = new THREE.Vector3();
  protected vy = 0;
  protected voice: EntityVoice;
  protected breath: EntityVoice;
  protected feet: EntityVoice;
  protected hurtFlash = 0;
  protected flinch = 0;
  protected pose: Pose = makePose();
  protected t = Math.random() * 10;
  protected stepPhase = 0;
  protected critBy: Player | null = null;
  protected critKind: 'riposte' | 'backstab' = 'riposte';
  protected deadTime = 0;
  protected grabBites = 0;
  protected grabTimer = 0;
  protected groanTimer = rand(4, 12);
  phantom = false;
  lockable = true;
  sleeping = false;
  /** Frozen stalker: world time stops for it while observed. */
  frozen = false;
  protected tmp = new THREE.Vector3();
  protected tmp2 = new THREE.Vector3();
  removed = false;
  /** Seconds after a reset during which the creature does not perceive. */
  protected grace = 0;
  protected dress: CreatureDress | null = null;
  /** Hold poses for N simulation steps: twitchy, stop-motion movement. */
  protected stopMotion = 0;
  private smCount = 0;
  /** Streaming radii, refreshed every frame from the fog range (Game.render). */
  static viewDist = 110;
  static wakeDist = 80;
  /** Out of the scene graph and physics world: beyond the fog, nothing to see or simulate. */
  streamedOut = false;
  private animStride = 1;
  private animTick = 0;
  private animAcc = 0;

  constructor(ctx: GameContext, spawn: EnemySpawn, opts: { phantom?: boolean; def?: EnemyDef } = {}) {
    const def = opts.def ?? ENEMIES[spawn.type];
    const at = new THREE.Vector3(...spawn.p);
    const phantom = !!opts.phantom;
    super(ctx, phantom ? 'phantom' : def.model, def.style, def.radius, def.height, G.ENEMY, G.WORLD | G.PLAYER | G.ENEMY | G.PROP, at, !phantom);
    this.def = def;
    this.spawn = spawn;
    this.phantom = phantom;
    this.poise = def.poise;
    this.maxHealth = this.health = def.health;
    this.yaw = this.prevYaw = spawn.yaw ?? Math.random() * Math.PI * 2;
    this.home.copy(at);
    this.voice = ctx.audio.attach(this.model.root, 3, 1.3);
    this.breath = ctx.audio.attach(this.model.root, 1.6, 1.8);
    this.feet = ctx.audio.attach(this.model.root, 2.5, 1.4);
    if (def.type === 'knight') {
      this.anim.carry = keyPose('kn_carry');
      this.anim.carryMask = ARMS_MASK;
    } else if (def.type === 'boss') {
      this.anim.carry = keyPose('bo_carry');
      this.anim.carryMask = ARMS_MASK;
    }
    this.state = spawn.patrol ? 'patrol' : 'idle';
    if (!phantom && DRESS[def.type]) this.dress = new CreatureDress(ctx, this.model, DRESS[def.type]);
    this.stopMotion = def.type === 'stalker' ? 3 : def.type === 'crawler' ? 2 : def.type === 'screamer' ? 4 : 0;
    if (phantom) {
      this.model.setOpacity(0.0);
      this.state = 'chase';
      this.awareness = 1;
    }
  }

  get player(): Player {
    return this.ctx.player;
  }

  protected setState(s: EState, dur = 0): void {
    this.state = s;
    this.stateTime = 0;
    this.stateDur = dur;
  }

  canRiposte(): boolean {
    return this.alive && this.state === 'parried' && this.def.canRiposte !== false;
  }

  canBackstab(): boolean {
    if (!this.alive || !this.def.canBackstab || this.phantom) return false;
    return this.state !== 'riposted' && this.state !== 'cling' && this.state !== 'drop' && this.state !== 'grab' && !(this.state === 'attack' && this.atk && attackPhase(this.atk.def, this.atk.frame) === 'active');
  }

  get observedFrozen(): boolean {
    return this.frozen;
  }

  // ---------------------------------------------------------------------------
  update(dt: number): void {
    this.beginStep();
    if (this.removed) return;
    const p = this.player;
    const distToPlayer = this.pos.distanceTo(p.pos);
    // streaming: past the fog wall the enemy leaves the scene and the physics world (hysteresis so it never flickers)
    const out = this.state !== 'dead' && (this.streamedOut ? distToPlayer > Enemy.viewDist : distToPlayer > Enemy.viewDist + 10);
    if (out !== this.streamedOut) this.setStreamed(out);
    this.sleeping = out || (distToPlayer > Enemy.wakeDist && this.state !== 'dead');
    this.model.setShadows(distToPlayer < 28);
    // animation LOD: distant enemies update their rig at a lower rate
    this.animStride = this.state === 'attack' || this.state === 'dead' || distToPlayer < 30 ? 1 : distToPlayer < 55 ? 2 : 3;
    if (this.sleeping) {
      this.breath.stop();
      return;
    }
    this.t += dt;
    this.stateTime += dt;
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 5);
    this.flinch = Math.max(0, this.flinch - dt * 4);
    this.attackTimer -= dt;
    for (const [k, v] of this.cooldowns) this.cooldowns.set(k, v - dt);

    this.updateFrozen(dt, distToPlayer);
    if (this.frozen) {
      this.anim.paused = true;
      this.syncSim();
      return;
    }
    this.anim.paused = false;

    if (this.state !== 'dead') {
      if (this.poise < this.def.poise && this.state !== 'stagger') this.poise = Math.min(this.def.poise, this.poise + this.def.poiseRegen * dt);
      this.perceive(dt, distToPlayer);
    }
    this.think(dt, distToPlayer);
    this.audioUpdate(distToPlayer);
    this.animAcc += dt;
    if (this.animStride === 1 || ++this.animTick % this.animStride === 0) {
      this.animate(this.animAcc);
      this.animAcc = 0;
    }
    this.syncSim();
    if (this.atk) this.attackSweep();
  }

  private setStreamed(out: boolean): void {
    this.streamedOut = out;
    if (out) {
      this.breath.stop();
      this.model.root.removeFromParent();
    } else this.ctx.scene.add(this.model.root);
    if (this.char && this.alive) this.ctx.physics.setCharacterEnabled(this.char, !out);
  }

  /** Stalker override: freezes while observed. */
  protected updateFrozen(_dt: number, _d: number): void {
    this.frozen = false;
  }

  // ---------------------------------------------------------------------------
  // Perception
  // ---------------------------------------------------------------------------
  protected perceive(dt: number, d: number): void {
    const p = this.player;
    if (this.grace > 0) {
      this.grace -= dt;
      return;
    }
    if (!p.alive || p.state === 'dead' || p.state === 'rest') {
      this.awareness = Math.max(0, this.awareness - dt);
      return;
    }
    if (this.state === 'cling' || this.state === 'dormant' || this.state === 'intro') return;
    const lit = p.lantern.lit;
    const flame = this.ctx.lights.lightAt(p.pos);
    const visK = clamp((lit ? 1 : 0.42) + flame * 0.6, 0.3, 1.25);
    const range = this.def.sightRange * visK;
    this.sightTimer -= dt;
    if (this.sightTimer <= 0) {
      this.sightTimer = SIGHT_CHECK;
      const inFov = facing(this.pos, this.yaw, p.pos, (this.def.sightFov * Math.PI) / 360) || d < 2.2;
      const attractRange = lit ? this.def.lanternAttract : 0;
      this.canSee = false;
      if ((d < range && inFov) || d < attractRange) {
        const eye = this.tmp.copy(this.pos).setY(this.pos.y + this.height * 0.85);
        const pe = this.tmp2.copy(p.pos).setY(p.pos.y + 1.3);
        const los = this.ctx.physics.lineOfSight(eye, pe);
        if (los) {
          if (d < range && inFov) this.canSee = true;
          else if (this.state === 'idle' || this.state === 'patrol' || this.state === 'return') {
            // drawn toward the light
            this.lastKnown.copy(p.pos);
            this.setState('investigate', rand(5, 8));
          }
        }
      }
    }
    if (this.canSee) {
      this.awareness = Math.min(1.5, this.awareness + dt * (1.5 + (1 - d / Math.max(range, 1)) * 5));
      if (this.awareness >= 1) this.lastKnown.copy(p.pos);
    } else {
      this.awareness = Math.max(0, this.awareness - dt * 0.12);
      const n = this.ctx.noise.heard(this.pos, this.def.hearing);
      if (n && (this.state === 'idle' || this.state === 'patrol' || this.state === 'return' || this.state === 'investigate')) {
        this.lastKnown.copy(n.pos);
        if (this.state !== 'investigate') this.setState('investigate', rand(5, 9));
        else this.stateDur = Math.max(this.stateDur, this.stateTime + 3);
      }
    }
    if (this.awareness >= 1 && (this.state === 'idle' || this.state === 'patrol' || this.state === 'investigate' || this.state === 'return')) {
      this.alert();
    }
  }

  protected alert(): void {
    this.setState('chase');
    this.attackTimer = rand(0.3, 0.9);
    if (!this.phantom) this.voice.playOnce(this.def.voice, 0.9);
  }

  // ---------------------------------------------------------------------------
  // Brain
  // ---------------------------------------------------------------------------
  protected think(dt: number, d: number): void {
    switch (this.state) {
      case 'idle':
        this.locomote(dt, null, 0);
        if (this.stateTime > 4 && Math.random() < dt * 0.2) this.approachYaw(this.yaw + rand(-1, 1), 1, dt);
        break;
      case 'patrol': {
        const pts = this.spawn.patrol!;
        const target = this.tmp.set(...pts[this.patrolIdx % pts.length]);
        if (this.waitTimer > 0) {
          this.waitTimer -= dt;
          this.locomote(dt, null, 0);
        } else if (this.horizDist(target) < 1) {
          this.patrolIdx++;
          this.waitTimer = rand(1.5, 4);
        } else this.locomote(dt, target, this.def.walkSpeed);
        break;
      }
      case 'investigate':
        if (this.horizDist(this.lastKnown) > 1.5) this.locomote(dt, this.lastKnown, lerp(this.def.walkSpeed, this.def.runSpeed, 0.35));
        else {
          this.locomote(dt, null, 0);
          if (Math.random() < dt) this.approachYaw(this.yaw + rand(-2, 2), 2, dt);
        }
        if (this.stateTime > this.stateDur) this.setState('return');
        break;
      case 'return':
        if (this.horizDist(this.home) < 1.2) this.setState(this.spawn.patrol ? 'patrol' : 'idle');
        else this.locomote(dt, this.home, this.def.walkSpeed);
        break;
      case 'chase':
        this.chase(dt, d);
        break;
      case 'attack':
        this.stAttack(dt);
        break;
      case 'stagger':
      case 'parried':
        this.knock.multiplyScalar(Math.exp(-5 * dt));
        this.locomote(dt, null, 0, this.knock);
        if (this.stateTime >= this.stateDur) this.setState('chase');
        break;
      case 'riposted':
        this.stRiposted(dt);
        break;
      case 'grab':
        this.stGrab(dt);
        break;
      case 'dead':
        this.deadTime += dt;
        if (this.char && this.deadTime > 0.3) this.locomote(dt, null, 0);
        if (this.deadTime > 3.5) {
          const fade = 1 - clamp01((this.deadTime - 3.5) / 1.5);
          this.model.setOpacity(fade);
          if (this.deadTime > 2.6 && Math.random() < 0.4) this.ctx.particles.embers(this.center(this.tmp), 1, 0.5);
          if (fade <= 0) this.model.root.visible = false;
        }
        break;
      default:
        break;
    }
  }

  protected horizDist(p: THREE.Vector3): number {
    return Math.hypot(p.x - this.pos.x, p.z - this.pos.z);
  }

  protected chase(dt: number, d: number): void {
    const p = this.player;
    if (!p.alive || p.state === 'dead' || p.state === 'rest') {
      this.setState('return');
      return;
    }
    if (this.canSee || d < 4) this.lastKnown.copy(p.pos);
    // leash
    if (this.home.distanceTo(this.pos) > this.def.leash && !this.canSee) {
      this.awareness = 0;
      this.setState('return');
      return;
    }
    if (!this.canSee && this.horizDist(this.lastKnown) < 1.5 && d > 6) {
      this.awareness = 0.5;
      this.setState('investigate', 5);
      return;
    }
    // Phantoms vanish when they reach you
    if (this.phantom && d < 1.8) {
      this.vanish();
      return;
    }
    const choice = this.pickAttack(d);
    if (choice && this.attackTimer <= 0 && facing(this.pos, this.yaw, p.pos, 0.7) && Math.abs(p.pos.y - this.pos.y) < 2.2) {
      if (this.phantom) {
        this.vanish();
        return;
      }
      this.startAttack(attack(choice.id));
      if (choice.cooldown) this.cooldowns.set(choice.id, choice.cooldown);
      return;
    }
    const inRange = this.inAnyRange(d);
    const wantStrafe = inRange && (this.def.type === 'knight' || this.def.type === 'stalker' || this.def.type === 'boss') && this.attackTimer > 0;
    if (wantStrafe) {
      this.strafeTimer -= dt;
      if (this.strafeTimer <= 0) {
        this.strafeTimer = rand(1.2, 2.6);
        this.strafeDir = Math.random() < 0.5 ? 1 : -1;
      }
      const to = this.tmp.subVectors(p.pos, this.pos).setY(0).normalize();
      const target = this.tmp2.set(-to.z * this.strafeDir, 0, to.x * this.strafeDir).multiplyScalar(2).add(this.pos);
      this.locomote(dt, target, this.def.walkSpeed * 0.8, undefined, p.pos);
    } else if (d > this.minRange() * 0.85) {
      const speed = d > 5 ? this.def.runSpeed : lerp(this.def.walkSpeed, this.def.runSpeed, 0.5);
      this.locomote(dt, this.lastKnown, speed);
    } else {
      this.locomote(dt, null, 0, undefined, p.pos);
    }
    // occasional voice
    this.groanTimer -= dt;
    if (this.groanTimer <= 0 && !this.phantom) {
      this.groanTimer = rand(5, 11);
      this.voice.playOnce(this.def.voice, 0.7);
    }
  }

  protected minRange(): number {
    let m = Infinity;
    for (const a of this.def.attacks) m = Math.min(m, a.max);
    return m;
  }

  protected inAnyRange(d: number): boolean {
    return this.def.attacks.some((a) => d >= a.min && d <= a.max + 0.5);
  }

  protected availableAttacks(): AttackChoice[] {
    return this.def.attacks;
  }

  protected pickAttack(d: number): AttackChoice | null {
    const opts = this.availableAttacks().filter((a) => d >= a.min && d <= a.max && (this.cooldowns.get(a.id) ?? 0) <= 0);
    if (!opts.length) return null;
    let total = 0;
    for (const o of opts) total += o.weight;
    let r = Math.random() * total;
    for (const o of opts) {
      r -= o.weight;
      if (r <= 0) return o;
    }
    return opts[0];
  }

  /**
   * Steering: walk toward `target` (or stand) with simple obstacle
   * side-stepping and ledge avoidance, then resolve through the KCC.
   */
  protected locomote(dt: number, target: THREE.Vector3 | null, speed: number, extra?: THREE.Vector3, faceAt?: THREE.Vector3): void {
    let tx = 0;
    let tz = 0;
    if (target && speed > 0) {
      const dx = target.x - this.pos.x;
      const dz = target.z - this.pos.z;
      const len = Math.hypot(dx, dz);
      if (len > 0.05) {
        let dirx = dx / len;
        let dirz = dz / len;
        if (this.sidestepTimer > 0) {
          this.sidestepTimer -= dt;
          const sx = -dirz * this.sidestep;
          const sz = dirx * this.sidestep;
          dirx = dirx * 0.3 + sx;
          dirz = dirz * 0.3 + sz;
          const l = Math.hypot(dirx, dirz);
          dirx /= l;
          dirz /= l;
        }
        // ledge check
        const probe = this.tmp2.set(this.pos.x + dirx * 1.2, this.pos.y + 1, this.pos.z + dirz * 1.2);
        const gh = this.ctx.physics.groundHeight(probe.x, probe.z, probe.y, 5);
        if (gh === null || gh < this.pos.y - 3) {
          dirx = 0;
          dirz = 0;
        }
        tx = dirx * speed;
        tz = dirz * speed;
      }
    }
    const k = 1 - Math.exp(-8 * dt);
    this.vel.x += (tx - this.vel.x) * k;
    this.vel.z += (tz - this.vel.z) * k;
    const faceTarget = faceAt ?? (Math.hypot(tx, tz) > 0.1 ? this.tmp2.set(this.pos.x + tx, 0, this.pos.z + tz) : null);
    if (faceTarget) this.approachYaw(yawTo(faceTarget.x - this.pos.x, faceTarget.z - this.pos.z), this.def.turnSpeed, dt);
    this.physMove(dt, this.vel.x + (extra?.x ?? 0), this.vel.z + (extra?.z ?? 0));
    // stuck detection
    const want = Math.hypot(tx, tz) * dt;
    const got = Math.hypot(this.lastMove.x, this.lastMove.z);
    if (want > 0.01 && got < want * 0.25) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 0.45) {
        this.stuckTimer = 0;
        this.sidestep = Math.random() < 0.5 ? 1 : -1;
        this.sidestepTimer = rand(0.5, 1.1);
      }
    } else this.stuckTimer = Math.max(0, this.stuckTimer - dt);
  }

  protected physMove(dt: number, vx: number, vz: number): void {
    if (this.grounded && this.vy <= 0) this.vy = -2;
    else this.vy = Math.max(-30, this.vy - 22 * dt);
    this.tmp.set(vx * dt, this.vy * dt, vz * dt);
    this.move(this.tmp);
    if (this.pos.y < -60) this.die(null);
  }

  // ---------------------------------------------------------------------------
  // Attacks
  // ---------------------------------------------------------------------------
  protected startAttack(def: AttackDef): void {
    this.atk = { def, frame: 0, hitSet: new Set(), prev: [], segs: [], hazardDone: false };
    this.setState('attack');
    if (def.voice) this.voice.playOnce(def.voice, 1);
  }

  protected stAttack(dt: number): void {
    const a = this.atk;
    if (!a) {
      this.setState('chase');
      return;
    }
    const def = a.def;
    a.frame += 1;
    const phase = attackPhase(def, a.frame);
    const p = this.player;
    if (phase === 'windup' && def.track) this.approachYaw(yawTo(p.pos.x - this.pos.x, p.pos.z - this.pos.z), def.track, dt);
    let fwd = 0;
    if (def.lunge && a.frame >= def.lunge.from && a.frame < def.lunge.to) {
      const d = this.horizDist(p.pos);
      fwd = d > this.radius + p.radius + 0.4 ? def.lunge.speed : def.lunge.speed * 0.2;
    }
    this.customAttackMotion(a, dt);
    const fx = Math.sin(this.yaw) * fwd;
    const fz = Math.cos(this.yaw) * fwd;
    this.vel.x += (fx - this.vel.x) * (1 - Math.exp(-14 * dt));
    this.vel.z += (fz - this.vel.z) * (1 - Math.exp(-14 * dt));
    if (!this.attackOwnsMovement(a)) this.physMove(dt, this.vel.x, this.vel.z);
    if (phase === 'active' && a.frame === def.windup + 1 && def.sound) this.ctx.audio.playAt(def.sound, this.pos, { volume: 0.8, rate: this.def.type === 'boss' ? 0.6 : 1 });
    if (def.hazard && !a.hazardDone && a.frame >= def.hazard.frame) {
      a.hazardDone = true;
      this.spawnHazard(def);
    }
    if (phase === 'done') {
      this.atk = null;
      if (def.chain && Math.random() < def.chain.chance && this.horizDist(p.pos) < 4.5 && p.alive) {
        this.startAttack(attack(def.chain.id));
        return;
      }
      this.attackTimer = rand(this.def.attackCooldown[0], this.def.attackCooldown[1]);
      this.setState('chase');
    }
  }

  /** Subclass hook (boss leap). */
  protected customAttackMotion(_a: EnemyAttack, _dt: number): void {}
  protected attackOwnsMovement(_a: EnemyAttack): boolean {
    return false;
  }

  protected spawnHazard(def: AttackDef): void {
    const hz = def.hazard!;
    const off = hz.offset ?? [0, 0, 0];
    const f = this.forward(this.tmp);
    const pos = new THREE.Vector3(this.pos.x + f.x * off[2], this.pos.y + off[1], this.pos.z + f.z * off[2]);
    if (hz.kind === 'flamewave') {
      for (const ang of [-0.35, 0, 0.35]) {
        const dir = new THREE.Vector3(Math.sin(this.yaw + ang), 0, Math.cos(this.yaw + ang));
        this.ctx.hazards.spawn('flamewave', this, pos.clone().addScaledVector(dir, 1.5), dir, hz.damage);
      }
    } else {
      this.ctx.hazards.spawn(hz.kind, this, pos, f.clone(), hz.damage, hz.radius ?? 12);
    }
  }

  protected attackSweep(): void {
    const a = this.atk;
    if (!a || this.state !== 'attack') return;
    const def = a.def;
    const phase = attackPhase(def, a.frame);
    const hb = def.hitbox;
    if (hb.kind === 'striker') {
      while (a.segs.length < hb.names.length) a.segs.push({ a: new THREE.Vector3(), b: new THREE.Vector3() });
      for (let i = 0; i < hb.names.length; i++) this.striker(hb.names[i], a.segs[i]);
      if (phase === 'active') {
        this.ctx.combat.sweep(this, a.prev, a.segs, hb.radius * (this.def.type === 'boss' ? 1 : 1), a.hitSet, (target, point) => this.onStrike(target, point, def));
      }
      a.prev = a.segs.map((s) => ({ a: s.a.clone(), b: s.b.clone() }));
    } else if (phase === 'active') {
      const f = this.forward(this.tmp);
      const c = this.tmp2.set(
        this.pos.x + f.x * hb.offset[2] + Math.cos(this.yaw) * hb.offset[0],
        this.pos.y + hb.offset[1],
        this.pos.z + f.z * hb.offset[2] - Math.sin(this.yaw) * hb.offset[0],
      );
      this.ctx.combat.sphere(this, 'enemy', c, hb.radius, a.hitSet, (target, point) => this.onStrike(target, point, def));
    }
  }

  protected onStrike(target: Combatant, point: THREE.Vector3, def: AttackDef): void {
    const dir = this.tmp.subVectors(target.pos, this.pos).setY(0).normalize();
    const res = target.receiveHit({
      attacker: this,
      attack: def,
      damage: def.damage,
      poise: def.poiseDamage,
      point,
      dir: dir.clone(),
      kind: def.grab ? 'grab' : 'melee',
      parryable: def.parryable !== false,
      unblockable: !!def.unblockable,
      knockback: this.def.type === 'boss' ? 5 : 2.5,
    });
    if (res === 'grabbed') {
      this.atk = null;
      this.grabBites = 0;
      this.grabTimer = 0.5;
      this.setState('grab', 3);
    } else if (res === 'blocked' && this.def.type !== 'knight' && this.def.type !== 'boss') {
      // light recoil for weaker creatures
      this.knock.copy(dir).multiplyScalar(-1.5);
    }
  }

  onParried(_by: Combatant): void {
    if (this.def.type === 'boss') return;
    this.atk = null;
    this.forward(this.knock).multiplyScalar(-1.5);
    this.setState('parried', this.def.parriedTime);
    this.voice.playOnce(this.def.voice, 0.8, 1.2);
  }

  protected stGrab(dt: number): void {
    const p = this.player;
    this.locomote(dt, null, 0, undefined, p.pos);
    this.grabTimer -= dt;
    if (p.state !== 'grabbed') {
      this.setState('chase');
      return;
    }
    if (this.grabTimer <= 0 && this.grabBites < 3) {
      this.grabBites++;
      this.grabTimer = 0.7;
      const dmg = 34;
      if (!this.ctx.debug.god) p.health -= dmg;
      p.damageTakenFlash = 1;
      const mouth = this.socketWorld('mouth', this.tmp);
      this.ctx.particles.blood(mouth, this.tmp2.set(0, 1, 0), 18, 0x3a0a08);
      this.ctx.audio.playAt('bite', mouth, { volume: 1 });
      this.ctx.audio.play('hurt', { volume: 0.7 });
      this.ctx.shake(0.25);
      events.emit('player:hurt', { amount: dmg });
      if (p.health <= 0) {
        p.releaseGrab();
        this.setState('chase');
        return;
      }
    }
    if (this.grabBites >= 3 && this.grabTimer <= 0.2) {
      p.releaseGrab();
      this.attackTimer = 1.5;
      this.setState('stagger', 0.8);
    }
  }

  // ---------------------------------------------------------------------------
  // Criticals
  // ---------------------------------------------------------------------------
  startCritical(by: Player, kind: 'riposte' | 'backstab'): void {
    this.atk = null;
    this.critBy = by;
    this.critKind = kind;
    this.setState('riposted', 2.6);
    if (this.player.state === 'grabbed') this.player.releaseGrab();
  }

  applyCritical(damage: number, by: Player): void {
    this.health -= damage * this.def.armor;
    this.hurtFlash = 1;
    const c = this.center(this.tmp);
    this.bleed(c, by.forward(this.tmp2), 40);
    this.ctx.audio.playAt(this.def.hitSound, c, { volume: 1 });
    if (this.health <= 0) this.die(by);
  }

  protected stRiposted(dt: number): void {
    const by = this.critBy;
    if (by) {
      // held in place relative to the attacker
      const f = by.forward(this.tmp);
      const want = this.tmp2.copy(by.pos).addScaledVector(f, by.radius + this.radius + 0.35);
      const delta = want.sub(this.pos).setY(0);
      this.yaw = this.critKind === 'riposte' ? wrapAngle(by.yaw + Math.PI) : by.yaw;
      if (this.stateTime < 0.5) this.physMove(dt, delta.x * 10, delta.z * 10);
      else this.physMove(dt, 0, 0);
    }
    if (this.stateTime >= this.stateDur) {
      this.critBy = null;
      this.attackTimer = 0.8;
      this.setState('chase');
      this.awareness = 1.2;
    }
  }

  // ---------------------------------------------------------------------------
  // Damage
  // ---------------------------------------------------------------------------
  receiveHit(h: HitInfo): HitResult {
    if (!this.alive) return 'immune';
    if (this.phantom) {
      this.vanish();
      return 'immune';
    }
    if (this.state === 'riposted') return 'immune';
    const dmg = h.damage * this.def.armor;
    this.health -= dmg;
    this.hurtFlash = 1;
    this.flinch = 1;
    this.awareness = 1.3;
    this.lastKnown.copy(this.player.pos);
    this.bleed(h.point, h.dir, 14);
    this.ctx.audio.playAt(this.def.hitSound, h.point, { volume: 0.9 });
    this.onHurt(h);
    if (this.health <= 0) {
      this.die(this.player);
      return 'hit';
    }
    const armor = this.state === 'attack' && this.atk && attackPhase(this.atk.def, this.atk.frame) !== 'recovery' ? this.atk.def.hyperArmor ?? 0 : 0;
    this.poise -= h.poise * (armor > 0 ? 0.5 : 1);
    if (this.poise <= 0 && this.def.staggerTime > 0) {
      this.poise = this.def.poise;
      this.atk = null;
      this.knock.copy(h.dir).multiplyScalar(h.knockback ?? 2);
      this.setState('stagger', this.def.staggerTime);
      this.voice.playOnce(this.def.voice, 0.8, 1.15);
    } else if (this.state !== 'attack' && this.state !== 'grab') {
      this.knock.copy(h.dir).multiplyScalar((h.knockback ?? 1) * 0.5);
      if (this.state !== 'chase') this.alert();
    }
    return 'hit';
  }

  protected onHurt(_h: HitInfo): void {}

  /** Bleed build-up: filling the gauge opens the wound for a burst of damage. */
  bleedBuild = 0;
  addBleed(amount: number, by: Player): void {
    if (!this.alive || this.phantom) return;
    this.bleedBuild += amount;
    if (this.bleedBuild < 100) return;
    this.bleedBuild = 0;
    const dmg = Math.max(60, this.maxHealth * 0.14);
    this.health -= dmg;
    const c = this.center(new THREE.Vector3());
    this.ctx.particles.blood(c, new THREE.Vector3(0, 1, 0), 40, 0x6a0a08);
    this.ctx.gpu.emit(this.ctx.gpu.add, { pos: c, count: 24, speed: [1, 5], life: [0.3, 0.7], size: [0.05, 0.1], color: 0xff2a20, color2: 0x801010, gravity: 9, drag: 1.5, stretch: 0.04 });
    this.ctx.audio.playAt(this.def.hitSound, c, { volume: 1, rate: 0.7 });
    this.ctx.message('Bloodletting', 1);
    if (this.health <= 0) this.die(by);
  }

  protected bleed(point: THREE.Vector3, dir: THREE.Vector3, n: number): void {
    const d = dir.clone().setY(0.4);
    switch (this.def.type) {
      case 'shambler':
        this.ctx.particles.ichor(point, d, n);
        break;
      case 'knight':
        this.ctx.particles.sparks(point, d, Math.round(n * 0.8));
        this.ctx.particles.ichor(point, d, Math.round(n * 0.5));
        break;
      case 'boss':
        this.ctx.particles.wax(point, d, n);
        this.ctx.particles.embers(point, 6, 0.3);
        break;
      default:
        this.ctx.particles.blood(point, d, n);
    }
  }

  die(by: Player | null): void {
    if (!this.alive) return;
    this.alive = false;
    this.health = 0;
    this.atk = null;
    this.deadTime = 0;
    this.setState('dead');
    this.breath.stop();
    this.voice.playOnce('enemy_death', 0.9, this.def.type === 'shambler' ? 0.8 : 1);
    if (this.char) this.ctx.physics.setCharacterEnabled(this.char, false);
    if (this.player.lockTarget === this) this.player.lockTarget = null;
    if (by && !this.phantom) {
      events.emit('enemy:killed', { type: this.def.type, marrow: this.def.marrow, x: this.pos.x, y: this.pos.y, z: this.pos.z });
    }
  }

  vanish(): void {
    if (!this.alive) return;
    this.alive = false;
    this.setState('dead');
    this.deadTime = 3.5;
    this.ctx.particles.wisps(this.center(this.tmp), 20, 0x9fb0c0);
    this.ctx.audio.playAt('whisper', this.center(this.tmp), { volume: 0.8, rate: 0.8 });
    if (this.player.lockTarget === this) this.player.lockTarget = null;
  }

  dispose(): void {
    this.voice.dispose();
    this.breath.dispose();
    this.feet.dispose();
    super.dispose();
  }

  /** Restore to spawn (on rest / player death). */
  reset(): void {
    this.alive = true;
    this.health = this.maxHealth;
    this.poise = this.def.poise;
    this.awareness = 0;
    this.atk = null;
    this.critBy = null;
    this.frozen = false;
    this.knock.set(0, 0, 0);
    this.vel.set(0, 0, 0);
    this.vy = 0;
    this.cooldowns.clear();
    this.model.setOpacity(1);
    this.model.root.visible = true;
    if (this.char) this.ctx.physics.setCharacterEnabled(this.char, !this.streamedOut);
    this.teleport(this.home, this.spawn.yaw ?? this.yaw);
    this.setState(this.spawn.patrol ? 'patrol' : 'idle');
    this.patrolIdx = 0;
    this.grace = 4;
  }

  // ---------------------------------------------------------------------------
  // Audio
  // ---------------------------------------------------------------------------
  protected audioUpdate(d: number): void {
    if (this.phantom || !this.alive || this.state === 'cling') {
      if (this.state !== 'cling') this.breath.stop();
      return;
    }
    if (d < 24) this.breath.loop(this.def.breath, clamp01(1 - d / 24) * (this.state === 'chase' ? 1 : 0.6));
    else this.breath.stop();
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp > 0.3 && this.grounded && d < 35) {
      const ph = Math.floor(this.anim.phase / Math.PI);
      if (ph !== this.stepPhase) {
        this.stepPhase = ph;
        this.feet.playOnce(this.def.step, clamp(0.3 + sp * 0.12, 0.3, 1));
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Animation
  // ---------------------------------------------------------------------------
  protected locomotionOverride(_out: Pose, _dt: number): boolean {
    return false;
  }

  protected animate(dt: number): void {
    const hs = Math.hypot(this.vel.x, this.vel.z);
    const w = this.def.walkSpeed;
    const r = this.def.runSpeed;
    const speedNorm = hs < w ? hs / w : 1 + clamp01((hs - w) / Math.max(0.1, r - w)) * 1.2;
    this.anim.update(dt, speedNorm, hs * dt);
    this.locomotionOverride(this.anim.base, dt);
    const p = this.pose;
    switch (this.state) {
      case 'attack':
        if (this.atk) {
          attackPose(p, this.atk.def, this.atk.frame, this.restPose());
          this.anim.setAction(true, undefined, 24, 8);
        }
        break;
      case 'stagger':
      case 'parried': {
        blendPose(p, keyPose('stagger'), this.restPose(), smoothstep(this.stateDur * 0.6, this.stateDur, this.stateTime));
        if (this.state === 'parried') for (let i = 0; i < p.length - 3; i += 3) p[i] += Math.sin(this.t * 13 + i) * 0.02;
        this.anim.setAction(true, undefined, 25, 6);
        break;
      }
      case 'riposted': {
        const u = this.stateTime;
        if (u < 0.45) p.set(keyPose('stagger'));
        else if (u < 1.9) blendPose(p, keyPose('death_knees'), keyPose('death_down'), smoothstep(0.45, 1.2, u));
        else blendPose(p, keyPose('death_down'), keyPose('death_knees'), smoothstep(1.9, 2.4, u));
        this.anim.setAction(true, undefined, 20, 6);
        break;
      }
      case 'grab':
        p.set(keyPose('sh_grab_hold'));
        addPoseJitter(p, this.t);
        this.anim.setAction(true, undefined, 12, 8);
        break;
      case 'dead':
        this.deadPose(p);
        this.anim.setAction(true, undefined, 20, 8);
        break;
      default:
        this.anim.setAction(false);
    }
    if (this.flinch > 0 && this.state !== 'dead') {
      this.anim.action.set(p);
      const f = this.flinch * 0.25;
      addJoint(this.anim.base, 'spine', -f, 0, f * 0.3);
      addJoint(this.anim.base, 'head', -f, 0, 0);
    }
    // unsettling idles: sudden head snaps and a crooked lean
    if ((this.state === 'idle' || this.state === 'patrol') && this.alive) {
      const snap = Math.max(0, noise1(this.t * 0.9, this.home.x) - 0.55) * 3;
      addJoint(this.anim.base, 'head', 0, snap * 0.6 * Math.sign(noise1(this.t * 0.2, 3)), snap * 0.5);
      addJoint(this.anim.base, 'spine', 0, 0, noise1(this.t * 0.3, this.home.z) * 0.12);
    }
    this.anim.action.set(p);
    this.smCount++;
    const hold = this.stopMotion > 0 && this.state !== 'dead' && this.state !== 'attack' && this.smCount % this.stopMotion !== 0;
    if (!hold) this.anim.apply();
    this.model.flash(this.hurtFlash);
  }

  override render(alpha: number): void {
    super.render(alpha);
    this.dress?.update(1 / 60, this.t, this.alive, this.state === 'chase' || this.state === 'attack', this.model.root.visible);
  }

  /** Called by a Screamer's wail: come running. */
  summon(to: THREE.Vector3): void {
    if (!this.alive || this.phantom || this.state === 'dead' || this.state === 'dormant' || this.state === 'cling') return;
    this.awareness = 1.3;
    this.lastKnown.copy(to);
    if (this.state !== 'attack' && this.state !== 'chase') this.alert();
  }

  protected deadPose(p: Pose): void {
    if (this.critBy) p.set(keyPose('death_down'));
    else deathPose(p, clamp01(this.deadTime / 1.4));
  }

  protected restPose(): Pose {
    if (this.def.type === 'crawler') return KEY_POSES.cr_base;
    return STANCE_POSE;
  }
}

function addPoseJitter(p: Pose, t: number): void {
  for (let i = 0; i < p.length - 3; i += 3) p[i] += noise1(t * 9 + i, i) * 0.05;
}

