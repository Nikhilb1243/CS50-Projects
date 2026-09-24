import * as THREE from 'three';
import { Actor } from './actor';
import type { GameContext } from '../core/context';
import { G } from '../core/physics';
import { PLAYER_TUNING as T, START_ATTRIBUTES, damageMultiplier, levelOf, maxHealth, maxStamina, type Attributes } from '../data/stats';
import { attack, type AttackDef } from '../data/attacks';
import { attackPhase, attackPose } from './animator';
import { keyPose, rollPose, deathPose, STANCE_POSE } from './poses';
import { ARMS_MASK, UPPER_MASK, blendPose, makePose } from './rig';
import { clamp, clamp01, damp, lerp, wrapAngle, yawTo, smoothstep } from '../core/math';
import type { Combatant, HitInfo, HitResult, Segment } from '../combat/combat';
import { facing } from '../combat/combat';
import { Lantern } from './lantern';
import type { Enemy } from '../ai/enemy';
import { TERRAIN } from '../world/layout';
import { events } from '../core/events';
import type { Quality } from '../core/settings';

export type PState =
  | 'move'
  | 'air'
  | 'roll'
  | 'attack'
  | 'drink'
  | 'hurt'
  | 'stagger'
  | 'knockdown'
  | 'riposte'
  | 'grabbed'
  | 'rest'
  | 'interact'
  | 'fogwalk'
  | 'dead'
  | 'cinematic';

export interface Progress {
  attrs: Attributes;
  marrow: number;
  draughtsMax: number;
  dmgBonus: number;
  fuelMax: number;
}

interface ActiveAttack {
  def: AttackDef;
  frame: number;
  extra: number;
  charging: boolean;
  hitSet: Set<Combatant>;
  prev: Segment[];
  queued: boolean;
  clanged: boolean;
  victim?: Enemy;
}

type Buffered = 'light' | 'heavy' | 'roll' | 'drink' | 'jump' | null;

export class Player extends Actor {
  readonly team = 'player' as const;
  state: PState = 'move';
  stateTime = 0;
  progress: Progress = { attrs: { ...START_ATTRIBUTES }, marrow: 0, draughtsMax: T.startDraughts, dmgBonus: 0, fuelMax: T.lanternFuelMax };
  stamina = 100;
  maxStamina = 100;
  draughts = T.startDraughts;
  private vy = 0;
  private staminaDelay = 0;
  private sprintLock = false;
  sprinting = false;
  blocking = false;
  private parryTimer = 0;
  private lastBlockPress = -10;
  private atk: ActiveAttack | null = null;
  private buffered: Buffered = null;
  private bufferTimer = 0;
  private rollDir = new THREE.Vector3();
  private knock = new THREE.Vector3();
  private stateDur = 0;
  private healed = false;
  private peakY = 0;
  private stepPhase = 0;
  private hurtFlash = 0;
  private fogDir = new THREE.Vector3();
  private grabber: Enemy | null = null;
  lockTarget: Enemy | null = null;
  private lockLostTimer = 0;
  readonly lantern: Lantern;
  private t = 0;
  private pose = makePose();
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private segs: Segment[] = [{ a: new THREE.Vector3(), b: new THREE.Vector3() }];
  inWater = false;
  /** Set by the game; called when the death animation completes. */
  onDeath: (() => void) | null = null;
  private deathNotified = false;
  /** Interaction state hook (interact animation completion). */
  private interactDone: (() => void) | null = null;
  lastSafe = new THREE.Vector3();
  damageTakenFlash = 0;

  constructor(ctx: GameContext, at: THREE.Vector3, yaw: number, quality: Quality) {
    super(ctx, 'revenant', 'revenant', T.radius, T.halfHeight * 2 + T.radius * 2, G.PLAYER, G.WORLD | G.ENEMY | G.PROP, at);
    this.yaw = this.prevYaw = yaw;
    this.lantern = new Lantern(quality);
    this.lantern.attach(this.model.sockets.get('lantern')!);
    // Tallow Draught flask shown while drinking
    const flaskSocket = this.model.sockets.get('flask');
    if (flaskSocket) {
      const flask = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.11, 8), new THREE.MeshStandardMaterial({ color: 0xd8a860, emissive: 0x6a3a10, roughness: 0.3, transparent: true, opacity: 0.85 }));
      flask.position.y = -0.03;
      flaskSocket.add(flask);
      flaskSocket.visible = false;
    }
    this.anim.carry = keyPose('carry');
    this.anim.carryMask = ARMS_MASK;
    this.anim.carryWeight = 0.85;
    this.recalcStats(true);
    this.lastSafe.copy(at);
  }

  get level(): number {
    return levelOf(this.progress.attrs);
  }

  recalcStats(fill = false): void {
    const a = this.progress.attrs;
    const hpRatio = this.maxHealth > 0 ? this.health / this.maxHealth : 1;
    this.maxHealth = maxHealth(a);
    this.maxStamina = maxStamina(a);
    this.lantern.fuelMax = this.progress.fuelMax;
    if (fill) {
      this.health = this.maxHealth;
      this.stamina = this.maxStamina;
    } else {
      this.health = Math.min(this.maxHealth, Math.max(1, Math.round(hpRatio * this.maxHealth)));
      this.stamina = Math.min(this.stamina, this.maxStamina);
    }
  }

  get damageMult(): number {
    return damageMultiplier(this.progress.attrs, this.progress.dmgBonus);
  }

  get iframes(): boolean {
    if (this.state === 'roll') return this.stateTime >= T.rollIFrames[0] && this.stateTime <= T.rollIFrames[1];
    return this.state === 'riposte' || this.state === 'rest' || this.state === 'fogwalk' || (this.state === 'knockdown' && this.stateTime > this.stateDur * 0.5) || this.state === 'cinematic';
  }

  get busy(): boolean {
    return this.state !== 'move';
  }

  get canInteract(): boolean {
    return this.state === 'move' && this.grounded;
  }

  // ---------------------------------------------------------------------------
  private setState(s: PState, dur = 0): void {
    this.state = s;
    this.stateTime = 0;
    this.stateDur = dur;
  }

  private inputDir(out: THREE.Vector3): number {
    const inp = this.ctx.input;
    const f = this.ctx.cam.forward(this.tmp2);
    const rx = -f.z;
    const rz = f.x;
    out.set(f.x * inp.moveY + rx * inp.moveX, 0, f.z * inp.moveY + rz * inp.moveX);
    return Math.min(1, Math.hypot(inp.moveX, inp.moveY));
  }

  private useStamina(n: number): void {
    if (this.ctx.debug.god) return;
    this.stamina -= n;
    this.staminaDelay = T.staminaRegenDelay;
  }

  private buffer(a: Buffered): void {
    this.buffered = a;
    this.bufferTimer = 0.4;
  }

  // ---------------------------------------------------------------------------
  update(dt: number): void {
    this.beginStep();
    this.t += dt;
    this.stateTime += dt;
    const inp = this.ctx.input;
    this.parryTimer = Math.max(0, this.parryTimer - dt);
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 3);
    this.damageTakenFlash = Math.max(0, this.damageTakenFlash - dt * 1.5);
    if (this.bufferTimer > 0) {
      this.bufferTimer -= dt;
      if (this.bufferTimer <= 0) this.buffered = null;
    }

    // Record inputs into the buffer when busy
    if (inp.pressed('light')) this.buffer('light');
    if (inp.pressed('heavy')) this.buffer('heavy');
    if (inp.pressed('roll')) this.buffer('roll');
    if (inp.pressed('drink')) this.buffer('drink');
    if (inp.pressed('jump')) this.buffer('jump');
    if (inp.pressed('block')) {
      if (this.t - this.lastBlockPress > T.parrySpamLock) this.parryTimer = T.parryWindow;
      this.lastBlockPress = this.t;
    }
    if (inp.pressed('lantern') && this.state !== 'dead' && this.state !== 'rest') {
      if (this.lantern.toggle()) this.ctx.audio.play(this.lantern.on ? 'lantern_on' : 'lantern_off', { volume: 0.8 });
      else this.ctx.message('The lantern is dry.', 2);
    }
    this.handleLockOn(dt);

    const inWaterNow = this.pos.y < TERRAIN.waterLevel - 0.1 && this.pos.x > TERRAIN.waterRect[0] && this.pos.x < TERRAIN.waterRect[2] && this.pos.z > TERRAIN.waterRect[1] && this.pos.z < TERRAIN.waterRect[3];
    this.inWater = inWaterNow;

    switch (this.state) {
      case 'move':
        this.stMove(dt);
        break;
      case 'air':
        this.stAir(dt);
        break;
      case 'roll':
        this.stRoll(dt);
        break;
      case 'attack':
      case 'riposte':
        this.stAttack(dt);
        break;
      case 'drink':
        this.stDrink(dt);
        break;
      case 'hurt':
      case 'stagger':
      case 'knockdown':
        this.stHurt(dt);
        break;
      case 'grabbed':
        this.stGrabbed(dt);
        break;
      case 'rest':
      case 'cinematic':
        this.vel.set(0, 0, 0);
        this.applyGravityMove(dt, 0, 0);
        break;
      case 'interact':
        this.vel.set(0, 0, 0);
        this.applyGravityMove(dt, 0, 0);
        if (this.stateTime >= this.stateDur) {
          const cb = this.interactDone;
          this.interactDone = null;
          this.setState('move');
          cb?.();
        }
        break;
      case 'fogwalk':
        this.applyGravityMove(dt, this.fogDir.x * 1.4, this.fogDir.z * 1.4);
        if (this.stateTime >= this.stateDur) {
          const cb = this.interactDone;
          this.interactDone = null;
          this.setState('move');
          cb?.();
        }
        break;
      case 'dead':
        this.applyGravityMove(dt, 0, 0);
        if (this.stateTime > 2.6 && !this.deathNotified) {
          this.deathNotified = true;
          this.onDeath?.();
        }
        break;
    }

    // Stamina regeneration
    if (this.ctx.debug.god) this.stamina = this.maxStamina;
    this.staminaDelay -= dt;
    if (this.staminaDelay <= 0 && !this.sprinting && this.state !== 'roll' && this.state !== 'attack') {
      const regen = T.staminaRegen * (this.blocking ? T.blockRegenFactor : 1) * (this.state === 'drink' ? 0.5 : 1);
      this.stamina = Math.min(this.maxStamina, this.stamina + regen * dt);
    }

    // Kill plane
    if (this.pos.y < -45 && this.state !== 'dead') this.die();

    this.animate(dt);
    this.syncSim();
    if (this.atk) this.attackSweep();
  }

  // ---------------------------------------------------------------------------
  private applyGravityMove(dt: number, vx: number, vz: number): void {
    if (this.grounded && this.vy <= 0) this.vy = -2;
    else this.vy = Math.max(-T.terminalVelocity, this.vy - T.gravity * dt);
    this.tmp.set(vx * dt, this.vy * dt, vz * dt);
    const wasGrounded = this.grounded;
    this.move(this.tmp, true);
    if (this.grounded && this.vy < 0) this.vy = -2;
    if (!this.grounded && wasGrounded && this.vy <= 0 && this.state === 'move') {
      // walked off a ledge
      this.peakY = this.pos.y;
      this.setState('air');
    }
  }

  private tryActions(allowMoveActions = true): boolean {
    const b = this.buffered;
    if (!b) return false;
    if (b === 'roll' && this.stamina > 1 && this.grounded) {
      this.buffered = null;
      this.startRoll();
      return true;
    }
    if (b === 'jump' && this.stamina > 1 && this.grounded && allowMoveActions) {
      this.buffered = null;
      this.useStamina(T.jumpStamina);
      this.vy = T.jumpVelocity;
      this.peakY = this.pos.y;
      this.setState('air');
      this.grounded = false;
      this.ctx.audio.play('swing', { volume: 0.25, rate: 0.6 });
      return true;
    }
    if (b === 'light' && this.stamina > 1) {
      this.buffered = null;
      if (this.tryCritical()) return true;
      this.startAttack(attack('p_light1'));
      return true;
    }
    if (b === 'heavy' && this.stamina > 1) {
      this.buffered = null;
      this.startAttack(attack('p_heavy'));
      return true;
    }
    if (b === 'drink' && allowMoveActions) {
      this.buffered = null;
      if (this.draughts > 0) {
        this.draughts--;
        this.healed = false;
        this.setState('drink', T.drinkDuration);
        this.ctx.audio.play('drink', { volume: 0.7 });
      } else {
        this.ctx.message('No Tallow Draughts remain.', 1.6);
      }
      return true;
    }
    return false;
  }

  private stMove(dt: number): void {
    const inp = this.ctx.input;
    this.blocking = inp.held('block') && this.stamina > 0;
    if (this.tryActions()) return;

    const dir = this.tmp.set(0, 0, 0);
    const mag = this.inputDir(dir);
    if (!inp.held('sprint')) this.sprintLock = false;
    this.sprinting = inp.held('sprint') && mag > 0.3 && this.stamina > 0 && !this.blocking && !this.sprintLock;
    if (this.sprinting) {
      this.useStamina(T.sprintStaminaPerSec * dt);
      if (this.stamina <= 0) {
        this.sprintLock = true;
        this.sprinting = false;
      }
    }
    let speed = 0;
    if (mag > 0.05) {
      if (this.blocking) speed = T.blockSpeed * Math.min(1, mag / 0.5);
      else if (this.sprinting) speed = T.sprintSpeed;
      else speed = mag < 0.55 ? T.walkSpeed * (mag / 0.55) : T.runSpeed * mag;
    }
    if (this.inWater) speed *= 0.62;
    if (mag > 0.05) dir.normalize();
    this.lerpVel(dir.x * speed, dir.z * speed, T.accel, dt);
    this.knock.multiplyScalar(Math.exp(-8 * dt));

    // Facing
    if (this.lockTarget && !this.sprinting) {
      this.approachYaw(yawTo(this.lockTarget.pos.x - this.pos.x, this.lockTarget.pos.z - this.pos.z), T.turnSpeed, dt);
    } else if (mag > 0.05) {
      this.approachYaw(yawTo(dir.x, dir.z), T.turnSpeed, dt);
    }
    this.applyGravityMove(dt, this.vel.x + this.knock.x, this.vel.z + this.knock.z);
    if (this.grounded) this.lastSafe.copy(this.pos);
    this.footsteps();
  }

  private footsteps(): void {
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (!this.grounded || sp < 0.4) return;
    const ph = Math.floor(this.anim.phase / Math.PI);
    if (ph !== this.stepPhase) {
      this.stepPhase = ph;
      const surface = this.inWater ? 'step_water' : this.pos.y > 10 || this.pos.y < -3 ? 'step_stone' : 'step_dirt';
      const vol = this.sprinting ? 0.8 : sp > 3 ? 0.55 : 0.35;
      this.ctx.audio.play(surface, { volume: vol });
      this.ctx.noise.emit(this.pos, this.sprinting ? 13 : sp > 3 ? 8 : 4);
      if (this.inWater) this.ctx.particles.splash(this.tmp.copy(this.pos).setY(TERRAIN.waterLevel + 0.05), 6);
      else if (this.sprinting) this.ctx.particles.dust(this.tmp.copy(this.pos).setY(this.pos.y + 0.05), 2);
    }
  }

  private stAir(dt: number): void {
    const dir = this.tmp.set(0, 0, 0);
    const mag = this.inputDir(dir);
    if (mag > 0.05) dir.normalize();
    this.vel.x += dir.x * T.airAccel * dt * mag;
    this.vel.z += dir.z * T.airAccel * dt * mag;
    const hs = Math.hypot(this.vel.x, this.vel.z);
    const cap = Math.max(T.runSpeed, hs > T.sprintSpeed ? T.sprintSpeed : hs);
    if (hs > cap) {
      this.vel.x *= cap / hs;
      this.vel.z *= cap / hs;
    }
    this.vy = Math.max(-T.terminalVelocity, this.vy - T.gravity * dt);
    this.peakY = Math.max(this.peakY, this.pos.y);
    this.tmp.set(this.vel.x * dt, this.vy * dt, this.vel.z * dt);
    this.move(this.tmp, true);
    if (this.grounded && this.vy <= 0 && this.stateTime > 0.05) this.land();
    else if (this.vy > 0 && this.lastMove.y < this.vy * dt * 0.3) this.vy = 0; // bonked head
  }

  private land(): void {
    const fall = this.peakY - this.pos.y;
    this.vy = -2;
    this.setState('move');
    this.ctx.audio.play('land', { volume: clamp(0.3 + fall * 0.08, 0.3, 1) });
    this.ctx.noise.emit(this.pos, 7 + fall);
    this.ctx.particles.dust(this.tmp.copy(this.pos).setY(this.pos.y + 0.1), 6 + Math.min(20, fall * 2));
    if (fall > T.fallDamageStart && !this.ctx.debug.god) {
      if (fall >= T.fallLethal) {
        this.health = 0;
        this.die();
        return;
      }
      const dmg = (fall - T.fallDamageStart) * T.fallDamagePerMeter;
      this.health -= dmg;
      this.ctx.shake(0.5);
      this.ctx.audio.play('hurt', { volume: 0.8 });
      this.damageTakenFlash = 1;
      events.emit('player:hurt', { amount: dmg });
      if (this.health <= 0) this.die();
      else this.setState('knockdown', 1.0);
    } else if (fall > 3) {
      this.ctx.shake(0.15);
    }
  }

  private startRoll(): void {
    const dir = this.rollDir.set(0, 0, 0);
    const mag = this.inputDir(dir);
    if (mag < 0.1) this.forward(dir);
    dir.normalize();
    this.yaw = yawTo(dir.x, dir.z);
    this.useStamina(T.rollStamina);
    this.setState('roll', T.rollDuration);
    this.atk = null;
    this.blocking = false;
    this.ctx.audio.play('roll', { volume: 0.6 });
    this.ctx.noise.emit(this.pos, 7);
    if (this.inWater) this.ctx.particles.splash(this.tmp.copy(this.pos).setY(TERRAIN.waterLevel), 14);
  }

  private stRoll(dt: number): void {
    const u = this.stateTime / T.rollDuration;
    const sp = T.rollSpeed * (u < 0.62 ? 1 - u * 0.25 : Math.max(0, (1 - u) / 0.38) * 0.84) * (this.inWater ? 0.7 : 1);
    this.vel.set(this.rollDir.x * sp, 0, this.rollDir.z * sp);
    this.applyGravityMove(dt, this.vel.x, this.vel.z);
    if (this.stateTime >= T.rollCancel && this.buffered && this.buffered !== 'roll') {
      this.setState('move');
      this.tryActions();
      return;
    }
    if (this.stateTime >= T.rollDuration) {
      this.setState('move');
      this.tryActions();
    }
  }

  // ---------------------------------------------------------------------------
  // Attacks
  // ---------------------------------------------------------------------------
  private startAttack(def: AttackDef, victim?: Enemy): void {
    if (def.stamina) this.useStamina(def.stamina);
    this.atk = { def, frame: 0, extra: 0, charging: def.id === 'p_heavy', hitSet: new Set(), prev: [], queued: false, clanged: false, victim };
    this.setState(victim ? 'riposte' : 'attack');
    this.blocking = false;
    // snap facing toward lock target or input
    if (!victim) {
      const dir = this.tmp.set(0, 0, 0);
      if (this.lockTarget) this.yaw = yawTo(this.lockTarget.pos.x - this.pos.x, this.lockTarget.pos.z - this.pos.z);
      else if (this.inputDir(dir) > 0.2) this.yaw = yawTo(dir.x, dir.z);
    }
    this.vel.multiplyScalar(0.3);
  }

  private tryCritical(): boolean {
    let best: Enemy | null = null;
    let kind: 'riposte' | 'backstab' = 'riposte';
    let bestD = Infinity;
    for (const e of this.ctx.enemies) {
      if (!e.alive || e.phantom) continue;
      const d = Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z);
      if (Math.abs(e.pos.y - this.pos.y) > 1.2) continue;
      if (e.canRiposte() && d < T.riposteRange && facing(this.pos, yawTo(e.pos.x - this.pos.x, e.pos.z - this.pos.z), e.pos, 0.5) && d < bestD) {
        const toFace = facing(this.pos, this.inputFacingYaw(), e.pos, 1.1);
        if (toFace) {
          best = e;
          kind = 'riposte';
          bestD = d;
        }
      } else if (e.canBackstab() && d < T.backstabRange && d < bestD) {
        // attacker must be behind the target and facing it
        const behind = !facing(e.pos, e.yaw, this.pos, 2.0);
        if (behind && facing(this.pos, this.inputFacingYaw(), e.pos, 1.0)) {
          best = e;
          kind = 'backstab';
          bestD = d;
        }
      }
    }
    if (!best) return false;
    this.yaw = yawTo(best.pos.x - this.pos.x, best.pos.z - this.pos.z);
    best.startCritical(this, kind);
    this.startAttack(attack('p_riposte'), best);
    this.ctx.audio.play('swing_heavy', { volume: 0.5, rate: 0.8 });
    return true;
  }

  private inputFacingYaw(): number {
    const d = this.tmp2.set(0, 0, 0);
    if (this.inputDir(d) > 0.2) return yawTo(d.x, d.z);
    return this.yaw;
  }

  private stAttack(dt: number): void {
    const a = this.atk;
    if (!a) {
      this.setState('move');
      return;
    }
    const def = a.def;
    const inp = this.ctx.input;
    // Heavy charge: holding extends the windup
    if (a.charging) {
      if (inp.held('heavy') && a.frame >= def.windup - 2 && a.extra < 36 && this.stamina > 0) {
        a.extra += 1;
        this.useStamina(0.25);
        if (a.extra % 6 === 0) this.ctx.particles.embers(this.socketWorld('weaponTip', this.tmp), 2, 0.1);
      } else if (a.frame >= def.windup - 2) a.charging = false;
    }
    const holding = a.charging && a.frame >= def.windup - 2;
    if (!holding) a.frame += 1;
    const phase = attackPhase(def, a.frame, a.extra);

    // Tracking during windup
    if (phase === 'windup' && def.track && !a.victim) {
      let target: number | null = null;
      if (this.lockTarget) target = yawTo(this.lockTarget.pos.x - this.pos.x, this.lockTarget.pos.z - this.pos.z);
      else {
        const d = this.tmp.set(0, 0, 0);
        if (this.inputDir(d) > 0.3) target = yawTo(d.x, d.z);
      }
      if (target !== null) this.approachYaw(target, def.track, dt);
    }
    // Lunge
    let fwd = 0;
    const f0 = a.frame - a.extra;
    if (def.lunge && f0 >= def.lunge.from && f0 < def.lunge.to) fwd = def.lunge.speed;
    if (a.victim) fwd = 0;
    const fx = Math.sin(this.yaw) * fwd;
    const fz = Math.cos(this.yaw) * fwd;
    this.vel.x = damp(this.vel.x, fx, 14, dt);
    this.vel.z = damp(this.vel.z, fz, 14, dt);
    this.applyGravityMove(dt, this.vel.x, this.vel.z);

    if (phase === 'windup' && a.frame === 1 && def.sound) this.ctx.audio.play(def.sound, { volume: 0.55 });
    if (phase === 'active' && a.frame === def.windup + a.extra + 1) {
      if (def.sound && def.id === 'p_heavy') this.ctx.audio.play('swing_heavy', { volume: 0.7 });
      this.ctx.noise.emit(this.pos, 12);
    }

    // Critical strike lands
    if (a.victim && a.frame === def.windup + 2) {
      const dmg = def.damage * this.damageMult * (a.victim.def.type === 'knight' ? 1.25 : 1);
      a.victim.applyCritical(dmg, this);
      this.ctx.hitstop(0.22, 0.03);
      this.ctx.shake(0.55);
      this.ctx.audio.play('riposte', { volume: 1 });
    }

    // Combo input
    if (this.buffered === 'light' && def.next && !a.victim) a.queued = true;
    const recStart = def.windup + a.extra + def.active;
    if (phase === 'recovery' || phase === 'done') {
      const rf = a.frame - recStart;
      if (a.queued && def.comboWindow && rf >= def.comboWindow[0] && rf <= def.comboWindow[1] && this.stamina > 1) {
        this.buffered = null;
        this.startAttack(attack(def.next!));
        return;
      }
      if (def.cancelFrame !== undefined && a.frame - a.extra >= def.cancelFrame) {
        if (this.buffered === 'roll' || this.buffered === 'heavy' || this.buffered === 'drink') {
          this.atk = null;
          this.setState('move');
          this.tryActions();
          return;
        }
        const d = this.tmp.set(0, 0, 0);
        if (this.inputDir(d) > 0.3 && rf > def.recovery * 0.7) {
          this.atk = null;
          this.setState('move');
          return;
        }
      }
      if (phase === 'done') {
        this.atk = null;
        this.setState('move');
        this.tryActions();
      }
    }
  }

  private attackSweep(): void {
    const a = this.atk;
    if (!a || a.victim) return;
    const def = a.def;
    const phase = attackPhase(def, a.frame, a.extra);
    const cur = this.segs[0];
    this.striker('weapon', cur);
    if (phase !== 'active') {
      a.prev = [{ a: cur.a.clone(), b: cur.b.clone() }];
      return;
    }
    const charge = a.extra / 36;
    const dmg = def.damage * this.damageMult * (1 + charge * 0.6);
    const poise = def.poiseDamage * (1 + charge * 0.5);
    this.ctx.combat.sweep(
      this,
      a.prev,
      [cur],
      def.hitbox.kind === 'striker' ? def.hitbox.radius : 0.15,
      a.hitSet,
      (target, point) => {
        const dir = this.tmp.subVectors(target.pos, this.pos).setY(0).normalize();
        const res = target.receiveHit({
          attacker: this,
          attack: def,
          damage: dmg,
          poise,
          point,
          dir: dir.clone(),
          kind: 'melee',
          parryable: false,
          unblockable: false,
          knockback: def.id === 'p_heavy' ? 2.5 : 1.2,
        });
        if (res === 'hit') {
          this.ctx.hitstop(def.id === 'p_heavy' ? 0.11 : 0.065, 0.03);
          this.ctx.shake(def.id === 'p_heavy' ? 0.35 : 0.18);
        }
      },
      (prop, point) => {
        this.tmp.subVectors(prop.curr, this.pos).setY(0.4).normalize();
        prop.impulse(this.tmp, def.id === 'p_heavy' ? 14 : 7);
        this.ctx.audio.playAt('step_wood', point, { volume: 0.8 });
        this.ctx.particles.dust(point, 4, 0x5a4a38);
      },
    );
    // blade scraping walls
    if (!a.clanged) {
      const d = this.tmp.subVectors(cur.b, cur.a);
      const len = d.length();
      d.divideScalar(len);
      const hit = this.ctx.physics.rayDistance(cur.a, d, len * 0.9);
      if (hit !== null) {
        a.clanged = true;
        const p = cur.a.clone().addScaledVector(d, hit);
        this.ctx.particles.sparks(p, d.clone().negate(), 12);
        this.ctx.audio.playAt('block', p, { volume: 0.5, rate: 1.3 });
      }
    }
    a.prev = [{ a: cur.a.clone(), b: cur.b.clone() }];
  }

  // ---------------------------------------------------------------------------
  private stDrink(dt: number): void {
    const dir = this.tmp.set(0, 0, 0);
    const mag = this.inputDir(dir);
    if (mag > 0.05) dir.normalize();
    const sp = T.drinkSpeed * Math.min(1, mag);
    this.lerpVel(dir.x * sp, dir.z * sp, T.accel, dt);
    if (mag > 0.05 && !this.lockTarget) this.approachYaw(yawTo(dir.x, dir.z), 4, dt);
    this.applyGravityMove(dt, this.vel.x, this.vel.z);
    if (!this.healed && this.stateTime >= T.drinkHealFrame) {
      this.healed = true;
      this.health = Math.min(this.maxHealth, this.health + this.maxHealth * T.healFraction + T.healFlat);
      this.ctx.audio.play('heal', { volume: 0.6 });
      this.ctx.particles.embers(this.center(this.tmp), 18, 0.4);
      events.emit('player:heal', {});
    }
    if (this.stateTime >= this.stateDur) this.setState('move');
  }

  private stHurt(dt: number): void {
    this.knock.multiplyScalar(Math.exp(-6 * dt));
    this.applyGravityMove(dt, this.knock.x, this.knock.z);
    if (this.stateTime >= this.stateDur) {
      this.setState('move');
      this.tryActions();
    }
  }

  private stGrabbed(dt: number): void {
    if (!this.grabber || !this.grabber.alive) {
      this.releaseGrab();
      return;
    }
    // held in front of the grabber
    const g = this.grabber;
    const f = g.forward(this.tmp);
    const target = this.tmp2.copy(g.pos).addScaledVector(f, g.radius + this.radius + 0.25);
    const delta = target.sub(this.pos);
    delta.y = 0;
    this.yaw = wrapAngle(g.yaw + Math.PI);
    this.applyGravityMove(dt, delta.x * 10, delta.z * 10);
  }

  grabbedBy(e: Enemy): void {
    this.grabber = e;
    this.atk = null;
    this.setState('grabbed', 99);
    this.ctx.audio.play('grab', { volume: 0.9 });
  }

  releaseGrab(): void {
    this.grabber = null;
    if (this.state === 'grabbed') {
      if (this.health <= 0) this.die();
      else {
        this.forward(this.knock).multiplyScalar(-4);
        this.setState('knockdown', T.knockdownTime);
      }
    }
  }

  // ---------------------------------------------------------------------------
  receiveHit(h: HitInfo): HitResult {
    if (!this.alive || this.state === 'dead') return 'immune';
    if (this.iframes) return 'dodged';
    if (this.state === 'grabbed' && h.kind !== 'grab') return 'immune';
    const attackerPos = h.attacker?.pos ?? h.point;
    const facingAttacker = facing(this.pos, this.yaw, attackerPos, Math.PI / 2);

    if (h.kind === 'grab') {
      if (this.state === 'rest' || this.state === 'riposte') return 'immune';
      this.grabbedBy(h.attacker as unknown as Enemy);
      return 'grabbed';
    }

    const canGuard = this.state === 'move' || (this.state === 'attack' && this.atk !== null && attackPhase(this.atk.def, this.atk.frame, this.atk.extra) === 'recovery');
    if (this.parryTimer > 0 && h.parryable && facingAttacker && h.kind === 'melee' && canGuard) {
      this.parryTimer = 0;
      h.attacker?.onParried?.(this);
      this.ctx.audio.play('parry', { volume: 1 });
      this.ctx.particles.sparks(h.point, h.dir.clone().negate().setY(0.4), 32, 0xffe0a0);
      this.ctx.hitstop(0.18, 0.02);
      this.ctx.shake(0.25);
      this.ctx.flash(0.18, 0xfff0d0);
      this.stamina = Math.min(this.maxStamina, this.stamina + 10);
      this.atk = null;
      this.setState('move');
      events.emit('player:parry', { x: h.point.x, y: h.point.y, z: h.point.z });
      return 'parried';
    }

    const guarding = (this.blocking || this.parryTimer > 0) && canGuard && facing(this.pos, this.yaw, attackerPos, T.blockAngle);
    if (guarding && !h.unblockable) {
      const cost = h.damage * T.blockStaminaFactor + 8;
      if (!this.ctx.debug.god) this.stamina -= cost;
      this.staminaDelay = T.staminaRegenDelay;
      this.ctx.particles.sparks(h.point, h.dir.clone().negate().setY(0.3), 14);
      if (this.stamina < 0) {
        this.stamina = 0;
        this.blocking = false;
        this.ctx.audio.play('guard_break', { volume: 0.9 });
        this.knock.copy(h.dir).multiplyScalar(3);
        this.setState('stagger', T.staggerTime * 1.3);
        this.ctx.shake(0.35);
        return 'guardbreak';
      }
      if (!this.ctx.debug.god) this.health -= h.damage * T.blockChip;
      this.ctx.audio.play('block', { volume: 0.8 });
      this.knock.copy(h.dir).multiplyScalar(2.2 + Math.min(3, h.damage / 30));
      this.ctx.shake(0.15);
      if (this.health <= 0) this.die();
      return 'blocked';
    }

    // Take the hit
    if (!this.ctx.debug.god) this.health -= h.damage;
    this.hurtFlash = 1;
    this.damageTakenFlash = 1;
    this.ctx.audio.play('hurt', { volume: 0.8 });
    this.ctx.audio.playAt(h.attack?.id.startsWith('kn_') ? 'hit_armor' : 'hit_flesh', h.point, { volume: 0.9 });
    this.ctx.particles.blood(h.point, h.dir.clone().setY(0.35), 16, 0x3a0a08);
    this.ctx.shake(0.3 + Math.min(0.4, h.damage / 150));
    this.ctx.hitstop(0.07, 0.05);
    events.emit('player:hurt', { amount: h.damage });
    if (this.health <= 0) {
      this.health = 0;
      this.die();
      return 'hit';
    }
    const heavyArmor = this.state === 'attack' && this.atk?.def.hyperArmor && attackPhase(this.atk.def, this.atk.frame, this.atk.extra) !== 'recovery' ? this.atk.def.hyperArmor : 0;
    if (h.poise >= T.poise + heavyArmor || h.kind === 'hazard') {
      this.atk = null;
      this.blocking = false;
      this.knock.copy(h.dir).multiplyScalar(h.knockback ?? 3);
      if (h.damage > this.maxHealth * 0.28 || h.kind === 'hazard') this.setState('knockdown', T.knockdownTime);
      else this.setState('hurt', T.hurtTime);
    }
    return 'hit';
  }

  die(): void {
    if (this.state === 'dead') return;
    this.health = 0;
    this.atk = null;
    this.grabber = null;
    this.lockTarget = null;
    this.deathNotified = false;
    this.setState('dead');
    this.ctx.audio.play('player_death', { volume: 1 });
    events.emit('player:died', {});
  }

  // ---------------------------------------------------------------------------
  // Scripted states used by the game
  // ---------------------------------------------------------------------------
  startRest(): void {
    this.atk = null;
    this.lockTarget = null;
    this.setState('rest');
  }

  endRest(): void {
    if (this.state === 'rest') this.setState('move');
  }

  startInteract(duration: number, faceYaw: number | null, done: () => void): void {
    this.atk = null;
    if (faceYaw !== null) this.yaw = faceYaw;
    this.interactDone = done;
    this.setState('interact', duration);
  }

  startFogWalk(dir: THREE.Vector3, duration: number, done: () => void): void {
    this.atk = null;
    this.fogDir.copy(dir).setY(0).normalize();
    this.yaw = yawTo(this.fogDir.x, this.fogDir.z);
    this.interactDone = done;
    this.setState('fogwalk', duration);
  }

  setCinematic(on: boolean): void {
    if (on) {
      this.atk = null;
      this.setState('cinematic');
    } else if (this.state === 'cinematic') this.setState('move');
  }

  respawn(p: THREE.Vector3, yaw: number): void {
    this.alive = true;
    this.health = this.maxHealth;
    this.stamina = this.maxStamina;
    this.draughts = this.progress.draughtsMax;
    this.lantern.refill();
    this.lantern.on = true;
    this.atk = null;
    this.grabber = null;
    this.lockTarget = null;
    this.buffered = null;
    this.vy = 0;
    this.vel.set(0, 0, 0);
    this.teleport(p, yaw);
    this.lastSafe.copy(p);
    this.setState('move');
  }

  // ---------------------------------------------------------------------------
  // Lock-on
  // ---------------------------------------------------------------------------
  private handleLockOn(dt: number): void {
    const inp = this.ctx.input;
    const lt = this.lockTarget;
    if (lt && (!lt.alive || lt.pos.distanceTo(this.pos) > 30)) this.lockTarget = null;
    if (this.lockTarget) {
      const eye = this.tmp.copy(this.pos).setY(this.pos.y + 1.5);
      const c = this.lockTarget.center(this.tmp2);
      if (!this.ctx.physics.lineOfSight(eye, c)) {
        this.lockLostTimer += dt;
        if (this.lockLostTimer > 2) this.lockTarget = null;
      } else this.lockLostTimer = 0;
    }
    if (inp.pressed('lockon')) {
      if (this.lockTarget) this.lockTarget = null;
      else {
        this.lockTarget = this.findTarget(null, 0);
        if (!this.lockTarget) this.ctx.cam.snapBehind(this.yaw);
        else this.ctx.audio.play('ui_move', { volume: 0.5 });
      }
    }
    if (this.lockTarget && (inp.pressed('targetLeft') || inp.pressed('targetRight'))) {
      const next = this.findTarget(this.lockTarget, inp.pressed('targetRight') ? 1 : -1);
      if (next) this.lockTarget = next;
    }
    inp.lockOnActive = !!this.lockTarget;
  }

  private findTarget(current: Enemy | null, side: number): Enemy | null {
    const camF = this.ctx.cam.forward(new THREE.Vector3());
    const camYaw = Math.atan2(camF.x, camF.z);
    let best: Enemy | null = null;
    let bestScore = Infinity;
    const eye = new THREE.Vector3(this.pos.x, this.pos.y + 1.5, this.pos.z);
    for (const e of this.ctx.enemies) {
      if (!e.alive || !e.lockable || e === current) continue;
      const dx = e.pos.x - this.pos.x;
      const dz = e.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 24) continue;
      const ang = wrapAngle(Math.atan2(dx, dz) - camYaw);
      if (side === 0 && Math.abs(ang) > 1.1) continue;
      if (side !== 0) {
        // want enemies on the requested side of the current target
        const curAng = current ? wrapAngle(Math.atan2(current.pos.x - this.pos.x, current.pos.z - this.pos.z) - camYaw) : 0;
        const rel = wrapAngle(ang - curAng);
        if (side > 0 && rel > -0.02) continue; // right on screen = negative yaw delta
        if (side < 0 && rel < 0.02) continue;
      }
      if (!this.ctx.physics.lineOfSight(eye, e.center(new THREE.Vector3()))) continue;
      const score = Math.abs(ang) * 12 + d;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  // Animation
  // ---------------------------------------------------------------------------
  private animate(dt: number): void {
    const hs = Math.hypot(this.vel.x, this.vel.z);
    const speedNorm = hs < T.walkSpeed ? hs / T.walkSpeed : hs < T.runSpeed ? 1 + (hs - T.walkSpeed) / (T.runSpeed - T.walkSpeed) : 2 + clamp01((hs - T.runSpeed) / (T.sprintSpeed - T.runSpeed));
    const moving = this.state === 'move' || this.state === 'drink' || this.state === 'fogwalk';
    this.anim.update(dt, moving ? speedNorm : this.state === 'roll' ? 0 : speedNorm * 0.5, moving ? hs * dt : 0);
    this.anim.carry = this.lockTarget ? keyPose('guard') : keyPose('carry');
    this.anim.carryMask = this.lockTarget ? UPPER_MASK : ARMS_MASK;
    this.anim.carryWeight = this.lockTarget ? 0.9 : 0.85;
    const p = this.pose;
    this.visualLift = 0;
    switch (this.state) {
      case 'move':
        if (this.parryTimer > 0) {
          p.set(keyPose('parry'));
          this.anim.setAction(true, UPPER_MASK, 30, 10);
        } else if (this.blocking) {
          p.set(keyPose('block'));
          this.anim.setAction(true, UPPER_MASK, 18, 10);
        } else this.anim.setAction(false);
        break;
      case 'air': {
        p.set(keyPose('fall'));
        this.anim.setAction(true, undefined, 10, 12);
        break;
      }
      case 'roll':
        rollPose(p, clamp01(this.stateTime / T.rollDuration));
        this.anim.setAction(true, undefined, 40, 10);
        if (this.stateTime < dt * 1.5) this.anim.snap();
        break;
      case 'attack':
      case 'riposte':
        if (this.atk) {
          const rest = this.lockTarget ? blendPose(makePose(), STANCE_POSE, keyPose('guard'), 1) : STANCE_POSE;
          attackPose(p, this.atk.def, this.atk.frame, rest, this.atk.extra, this.atk.charging ? 1 : 0);
          this.anim.setAction(true, undefined, 30, 10);
        }
        break;
      case 'drink':
        p.set(keyPose('drink'));
        this.anim.setAction(this.stateTime < this.stateDur - 0.25, UPPER_MASK, 10, 8);
        break;
      case 'hurt':
        p.set(keyPose('hit'));
        this.anim.setAction(this.stateTime < this.stateDur * 0.7, undefined, 30, 8);
        break;
      case 'stagger':
        p.set(keyPose('stagger'));
        this.anim.setAction(this.stateTime < this.stateDur * 0.75, undefined, 25, 6);
        break;
      case 'knockdown': {
        const u = this.stateTime / this.stateDur;
        if (u < 0.55) blendPose(p, keyPose('stagger'), keyPose('death_knees'), smoothstep(0, 0.4, u));
        else blendPose(p, keyPose('death_knees'), keyPose('kneel'), smoothstep(0.55, 0.9, u));
        this.anim.setAction(u < 0.92, undefined, 20, 6);
        break;
      }
      case 'grabbed':
        p.set(keyPose('grabbed'));
        for (let i = 0; i < p.length - 3; i += 3) p[i] += Math.sin(this.t * 17 + i) * 0.04;
        this.anim.setAction(true, undefined, 20, 8);
        break;
      case 'rest':
        p.set(keyPose('kneel'));
        this.anim.setAction(true, undefined, 3, 3);
        break;
      case 'interact':
        p.set(keyPose('interact'));
        this.anim.setAction(this.stateTime < this.stateDur - 0.3, undefined, 6, 6);
        break;
      case 'fogwalk':
        p.set(keyPose('guard'));
        this.anim.setAction(true, UPPER_MASK, 6, 6);
        break;
      case 'dead':
        deathPose(p, clamp01(this.stateTime / 1.6));
        this.anim.setAction(true, undefined, 20, 8);
        break;
      case 'cinematic':
        this.anim.setAction(false);
        break;
    }
    this.anim.action.set(p);
    this.anim.apply();
  }

  /** Per-frame visual updates (lantern, flashes). */
  renderUpdate(realDt: number, alpha: number): void {
    this.render(alpha);
    this.model.root.updateMatrixWorld(true);
    this.lantern.update(realDt, this.t, this.state === 'drink');
    this.model.flash(this.hurtFlash);
    const flask = this.model.sockets.get('flask');
    if (flask) flask.visible = this.state === 'drink';
  }

  get staggerWeight(): number {
    return lerp(0, 1, clamp01(this.hurtFlash));
  }
}
