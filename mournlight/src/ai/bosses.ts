import * as THREE from 'three';
import type { GameContext } from '../core/context';
import type { Combatant, HitInfo, HitResult, Hurtbox } from '../combat/combat';
import type { FlameSource } from '../world/lights';
import { patchFog } from '../fx/fog';
import { events } from '../core/events';

/**
 * Bosses of the deep regions. They are not built on the humanoid rig: each is
 * a procedural assembly driven by a small scripted pattern of telegraphed
 * attacks that reuse the hazard system (shockwaves, bursts, flame waves).
 * Every boss has a weak point that takes double damage and its own arena
 * lighting.
 */
type BossState = 'dormant' | 'intro' | 'fight' | 'dead';

interface Telegraph {
  at: number;
  fn: () => void;
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export abstract class DeepBoss implements Combatant {
  readonly team = 'enemy' as const;
  alive = true;
  readonly pos = new THREE.Vector3();
  yaw = 0;
  radius = 2;
  height = 4;
  health: number;
  readonly maxHealth: number;
  phase = 1;
  state: BossState = 'dormant';
  readonly lockable = true;
  readonly def = { type: 'boss' as const };
  readonly group = new THREE.Group();
  protected weak = new THREE.Object3D();
  protected weakR = 0.9;
  protected t = 0;
  protected queue: Telegraph[] = [];
  protected nextAttack = 3;
  protected flash = 0;
  protected mats: THREE.MeshStandardMaterial[] = [];
  flames: FlameSource[] = [];
  onDefeated: (() => void) | null = null;
  onIntro: (() => void) | null = null;

  constructor(
    protected ctx: GameContext,
    readonly id: string,
    readonly displayName: string,
    readonly subtitle: string,
    readonly home: THREE.Vector3,
    readonly arenaR: number,
    hp: number,
  ) {
    this.maxHealth = this.health = hp;
    this.pos.copy(home);
    ctx.scene.add(this.group);
  }

  get fightActive(): boolean {
    return this.state === 'fight' && this.alive;
  }

  protected mat(color: number, rough = 0.7, emissive = 0x000000, map?: THREE.Texture): THREE.MeshStandardMaterial {
    const m = patchFog(new THREE.MeshStandardMaterial({ color, roughness: rough, emissive, map: map ?? null }));
    this.mats.push(m);
    return m;
  }

  center(out = new THREE.Vector3()): THREE.Vector3 {
    return out.copy(this.pos).setY(this.pos.y + this.height * 0.5);
  }

  canRiposte(): boolean {
    return false;
  }

  /** Called every simulation step by the game. */
  update(dt: number): void {
    if (!this.alive) return;
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt * 4);
    const p = this.ctx.player;
    if (this.state === 'dormant') {
      if (p.alive && Math.hypot(p.pos.x - this.home.x, p.pos.z - this.home.z) < this.arenaR * 0.75 && Math.abs(p.pos.y - this.home.y) < 6) {
        this.state = 'intro';
        this.onIntro?.();
      }
      this.idle(dt);
      return;
    }
    if (this.state === 'intro') {
      this.idle(dt);
      return;
    }
    for (let i = this.queue.length - 1; i >= 0; i--) {
      if (this.t >= this.queue[i].at) {
        const q = this.queue[i];
        this.queue.splice(i, 1);
        q.fn();
      }
    }
    this.think(dt);
    // leave the arena and the fight resets
    if (Math.hypot(p.pos.x - this.home.x, p.pos.z - this.home.z) > this.arenaR * 1.6 || !p.alive) this.reset();
  }

  startFight(): void {
    this.state = 'fight';
    this.nextAttack = this.t + 2;
  }

  protected later(delay: number, fn: () => void): void {
    this.queue.push({ at: this.t + delay, fn });
  }

  /** A pulsing ground marker where something is about to land. */
  protected mark(pos: THREE.Vector3, r: number, dur: number, color = 0xff5030): void {
    const ring = new THREE.Mesh(new THREE.RingGeometry(r * 0.9, r, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(pos).setY(pos.y + 0.08);
    this.ctx.scene.add(ring);
    const start = this.t;
    const tick = (): void => {
      const u = (this.t - start) / dur;
      if (u >= 1 || !this.alive) {
        this.ctx.scene.remove(ring);
        ring.geometry.dispose();
        return;
      }
      (ring.material as THREE.MeshBasicMaterial).opacity = 0.4 + 0.5 * Math.abs(Math.sin(u * 20));
      this.later(0.05, tick);
    };
    tick();
  }

  protected groundAt(p: THREE.Vector3): THREE.Vector3 {
    const g = this.ctx.physics.groundHeight(p.x, p.z, p.y + 4, 12);
    if (g !== null) p.y = g;
    return p;
  }

  receiveHit(h: HitInfo): HitResult {
    if (!this.alive || this.state !== 'fight') return 'immune';
    this.weak.getWorldPosition(_w);
    const weakHit = h.point.distanceTo(_w) < this.weakR + 0.4;
    const dmg = h.damage * (weakHit ? 2 : 1);
    this.health -= dmg;
    this.flash = 1;
    this.ctx.particles.blood(h.point, h.dir.clone().setY(0.5), weakHit ? 26 : 12, 0x3a0a08);
    this.ctx.audio.playAt(weakHit ? 'riposte' : 'hit_flesh', h.point, { volume: weakHit ? 0.6 : 0.9, rate: weakHit ? 1.3 : 0.8 });
    if (weakHit) {
      this.ctx.gpu.sparks(h.point, h.dir.clone().negate().setY(0.5), 20, 0xfff0c0);
      this.ctx.message('A weak point', 0.8);
    }
    if (this.phase === 1 && this.health <= this.maxHealth * 0.5) {
      this.phase = 2;
      this.queue.length = 0;
      this.enterPhase2();
    }
    this.onDamaged(h);
    if (this.health <= 0) this.die();
    return 'hit';
  }

  protected onDamaged(_h: HitInfo): void {}

  die(): void {
    if (!this.alive) return;
    this.alive = false;
    this.health = 0;
    this.state = 'dead';
    this.queue.length = 0;
    this.ctx.hitstop(0.4, 0.15);
    this.ctx.shake(0.8);
    this.ctx.flash(0.5, 0xffe0c0);
    this.ctx.audio.play('boss_death', { volume: 1 });
    this.ctx.gpu.blueBurst(this.center(new THREE.Vector3()), 80, 1.5);
    for (const f of this.flames) f.lit = false;
    events.emit('enemy:killed', { marrow: 3000 } as never);
    this.collapse();
    this.onDefeated?.();
  }

  /** Put back as found (player died or fled). */
  reset(): void {
    if (!this.alive) return;
    this.health = this.maxHealth;
    this.phase = 1;
    this.state = 'dormant';
    this.queue.length = 0;
    this.pos.copy(this.home);
    this.resetVisual();
  }

  /** Permanently gone (loaded as defeated). */
  remove(): void {
    this.alive = false;
    this.state = 'dead';
    this.group.visible = false;
    for (const f of this.flames) f.lit = false;
  }

  render(): void {
    for (const m of this.mats) m.emissiveIntensity = 1 + this.flash * 2;
  }

  abstract hurtboxes(out: Hurtbox[]): void;
  protected abstract idle(dt: number): void;
  protected abstract think(dt: number): void;
  protected abstract enterPhase2(): void;
  protected abstract collapse(): void;
  protected abstract resetVisual(): void;
}

// =============================================================================
// The Bone Choir: a mass of fused bodies that sings. Phase 2: splits in three.
// =============================================================================
interface ChoirPart {
  group: THREE.Group;
  pos: THREE.Vector3;
  hp: number;
  alive: boolean;
  heads: THREE.Mesh[];
  angle: number;
  cool: number;
}

export class BoneChoir extends DeepBoss {
  private parts: ChoirPart[] = [];
  private mass: THREE.Group;
  private heads: THREE.Mesh[] = [];
  private singMat: THREE.MeshStandardMaterial;
  private fleshMat: THREE.MeshStandardMaterial;
  private boneMat: THREE.MeshStandardMaterial;
  private song = 0;

  constructor(ctx: GameContext, home: THREE.Vector3, flesh: THREE.Texture | undefined) {
    super(ctx, 'choir', 'The Bone Choir', 'what the catacombs sang to, sings back', home, 22, 2600);
    this.radius = 2.6;
    this.height = 4.2;
    this.fleshMat = this.mat(0x9a6e64, 0.55, 0x100000, flesh);
    this.boneMat = this.mat(0xd8ccb0, 0.7, 0x050300);
    this.singMat = this.mat(0x201010, 0.4, 0x6ab0ff);
    this.mass = this.buildMass(1, 9);
    this.group.add(this.mass);
    this.weak.position.set(0, 4.3, 0.4);
    this.mass.add(this.weak);
    this.weakR = 0.8;
    // the Cantor: the one head that leads the song (weak point)
    const cantor = new THREE.Mesh(new THREE.SphereGeometry(0.42, 12, 10), this.singMat);
    cantor.position.copy(this.weak.position);
    this.mass.add(cantor);
    this.heads.push(cantor);
    this.pos.copy(home);
    this.mass.position.copy(home);
    // cold arena lighting: blue grave-candles in a ring
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      this.flames.push(ctx.lights.addFlame(new THREE.Vector3(home.x + Math.cos(a) * 16, home.y + 1, home.z + Math.sin(a) * 16), { color: 0x6a9cff, intensity: 5, distance: 14, tag: 'candles' }));
    }
  }

  private buildMass(scale: number, nHeads: number): THREE.Group {
    const g = new THREE.Group();
    const bodies = 12 * scale + 3;
    for (let i = 0; i < bodies; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 1.6 * scale;
      const len = (1.2 + Math.random() * 1.2) * scale;
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.35 * scale + Math.random() * 0.2, len, 4, 8), i % 4 === 0 ? this.boneMat : this.fleshMat);
      m.position.set(Math.cos(a) * r, (0.8 + Math.random() * 2.6) * scale, Math.sin(a) * r);
      m.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      m.castShadow = true;
      g.add(m);
    }
    // ribcages and arms reaching out of the mass
    for (let i = 0; i < 6 * scale + 2; i++) {
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.06 * scale, 0.1 * scale, 1.6 * scale, 5), this.boneMat);
      const a = Math.random() * Math.PI * 2;
      arm.position.set(Math.cos(a) * 1.6 * scale, (0.6 + Math.random() * 2) * scale, Math.sin(a) * 1.6 * scale);
      arm.rotation.set(Math.random() - 0.5, a, 1.1 + Math.random() * 0.6);
      g.add(arm);
    }
    for (let i = 0; i < nHeads; i++) {
      const a = (i / nHeads) * Math.PI * 2 + Math.random() * 0.4;
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.28 * scale, 10, 8), this.boneMat);
      h.position.set(Math.cos(a) * 1.3 * scale, (2 + Math.random() * 1.6) * scale, Math.sin(a) * 1.3 * scale);
      const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.1 * scale, 6, 5), this.singMat);
      mouth.position.set(0, -0.08 * scale, 0.24 * scale);
      mouth.scale.set(1, 1.6, 0.5);
      h.add(mouth);
      h.lookAt(h.position.clone().multiplyScalar(3));
      g.add(h);
      this.heads.push(mouth);
    }
    return g;
  }

  hurtboxes(out: Hurtbox[]): void {
    if (this.phase === 1) {
      const hb = this.ctx.combat.newHurtbox();
      hb.a.copy(this.pos).setY(this.pos.y + 1);
      hb.b.copy(this.pos).setY(this.pos.y + 4.2);
      hb.r = 2;
      out.push(hb);
      return;
    }
    for (const p of this.parts) {
      if (!p.alive) continue;
      const hb = this.ctx.combat.newHurtbox();
      hb.a.copy(p.pos).setY(p.pos.y + 0.6);
      hb.b.copy(p.pos).setY(p.pos.y + 2.2);
      hb.r = 1.2;
      out.push(hb);
    }
  }

  protected idle(dt: number): void {
    this.song = Math.max(0.15, this.song - dt);
    this.mass.rotation.y += dt * 0.05;
  }

  private sing(k: number): void {
    this.song = Math.max(this.song, k);
  }

  protected think(dt: number): void {
    const p = this.ctx.player;
    this.song = Math.max(0.3, this.song - dt * 0.8);
    if (this.phase === 1) {
      // drags itself toward the Revenant
      _v.subVectors(p.pos, this.pos).setY(0);
      const d = _v.length();
      if (d > 4) this.pos.addScaledVector(_v.normalize(), dt * 0.9);
      this.mass.position.copy(this.pos);
      this.mass.rotation.y += dt * 0.2;
      if (this.t >= this.nextAttack) this.phase1Attack(d);
    } else {
      for (const part of this.parts) {
        if (!part.alive) continue;
        part.angle += dt * 0.35;
        const target = _v.set(this.home.x + Math.cos(part.angle) * 11, this.home.y, this.home.z + Math.sin(part.angle) * 11);
        part.pos.lerp(target, 1 - Math.exp(-dt * 0.8));
        part.group.position.copy(part.pos);
        part.group.rotation.y += dt * 0.6;
        part.cool -= dt;
        if (part.cool <= 0) this.partAttack(part);
      }
      const alive = this.parts.filter((q) => q.alive);
      if (alive.length) this.pos.copy(alive.reduce((a, q) => (q.pos.distanceTo(p.pos) < a.pos.distanceTo(p.pos) ? q : a)).pos);
    }
  }

  private phase1Attack(d: number): void {
    const p = this.ctx.player;
    const r = Math.random();
    if (d < 7 || r < 0.35) {
      // Dirge: heads rise in pitch, then a ring of sound rolls out
      this.sing(1);
      this.ctx.audio.playAt('screamer_wail', this.pos, { volume: 0.9, rate: 0.55, ref: 12 });
      this.later(1.3, () => {
        this.ctx.hazards.spawn('shockwave', this, this.pos.clone(), new THREE.Vector3(0, 0, 1), 55, 20);
        this.ctx.lights.flash(this.center(new THREE.Vector3()), 0x6ab0ff, 30, 16, 0.4);
      });
      this.nextAttack = this.t + 4;
    } else if (r < 0.75) {
      // Bone Hail: marked circles under the Revenant
      for (let i = 0; i < 3; i++) {
        this.later(i * 0.6, () => {
          const at = this.groundAt(p.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 2, (Math.random() - 0.5) * 2)));
          this.mark(at, 2.2, 1);
          this.later(1, () => {
            this.ctx.hazards.spawn('burst', this, at.clone().setY(at.y + 0.6), new THREE.Vector3(0, 0, 1), 60, 2.2);
            this.ctx.particles.dust(at, 14, 0xd8ccb0);
          });
        });
      }
      this.sing(0.7);
      this.nextAttack = this.t + 4.2;
    } else {
      // Grasp: a wave of reaching dead toward the Revenant
      this.sing(0.8);
      const dir = new THREE.Vector3().subVectors(p.pos, this.pos).setY(0).normalize();
      this.later(0.9, () => this.ctx.hazards.spawn('flamewave', this, this.pos.clone().addScaledVector(dir, 2), dir, 50));
      this.nextAttack = this.t + 3.2;
    }
  }

  private partAttack(part: ChoirPart): void {
    const p = this.ctx.player;
    part.cool = 3.5 + Math.random() * 2.5;
    this.ctx.audio.playAt('screamer_wail', part.pos, { volume: 0.6, rate: 0.8 + Math.random() * 0.3, ref: 10 });
    if (Math.random() < 0.5) {
      const at = this.groundAt(p.pos.clone().setY(p.pos.y + 2));
      this.mark(at, 2, 1.1, 0x6ab0ff);
      this.later(1.1, () => this.ctx.hazards.spawn('burst', this, at.clone().setY(at.y + 0.6), new THREE.Vector3(0, 0, 1), 45, 2));
    } else {
      const dir = new THREE.Vector3().subVectors(p.pos, part.pos).setY(0).normalize();
      this.later(0.8, () => this.ctx.hazards.spawn('flamewave', this, part.pos.clone().addScaledVector(dir, 1.5), dir, 40));
    }
  }

  protected enterPhase2(): void {
    // the mass tears itself apart into three singing parts
    this.ctx.shake(0.9);
    this.ctx.flash(0.4, 0x9fd0ff);
    this.ctx.audio.play('boss_roar', { volume: 1, rate: 0.7 });
    this.ctx.message('The Choir divides', 2.5);
    this.mass.visible = false;
    this.ctx.particles.blood(this.center(new THREE.Vector3()), new THREE.Vector3(0, 1, 0), 60, 0x3a0a08);
    const each = Math.max(1, this.health) / 3;
    for (let i = 0; i < 3; i++) {
      const g = this.buildMass(0.55, 3);
      const cantor = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), this.singMat);
      cantor.position.set(0, 2.5, 0.3);
      g.add(cantor);
      const pos = this.pos.clone();
      g.position.copy(pos);
      this.group.add(g);
      this.parts.push({ group: g, pos, hp: each, alive: true, heads: [cantor], angle: (i / 3) * Math.PI * 2, cool: 2 + i });
    }
    this.weak.position.set(0, 2.5, 0.3);
  }

  protected onDamaged(h: HitInfo): void {
    if (this.phase !== 2) return;
    // damage goes to the part that was struck
    let best: ChoirPart | null = null;
    let bd = Infinity;
    for (const p of this.parts) {
      if (!p.alive) continue;
      const d = p.pos.distanceTo(h.point);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (!best) return;
    best.hp -= h.damage;
    this.weak.parent?.remove(this.weak);
    best.group.add(this.weak);
    if (best.hp <= 0 && best.alive) {
      best.alive = false;
      best.group.visible = false;
      this.ctx.particles.blood(best.pos.clone().setY(best.pos.y + 1.5), new THREE.Vector3(0, 1, 0), 40, 0x3a0a08);
      this.ctx.audio.playAt('boss_death', best.pos, { volume: 0.7, rate: 1.3 });
      if (this.parts.every((q) => !q.alive)) this.die();
    }
    this.health = Math.max(1, this.parts.reduce((s, q) => s + Math.max(0, q.hp), 0));
    if (this.parts.every((q) => !q.alive)) this.health = 0;
  }

  protected collapse(): void {
    this.mass.visible = false;
    for (const p of this.parts) p.group.visible = false;
    this.ctx.particles.dust(this.pos, 40, 0xd8ccb0);
  }

  protected resetVisual(): void {
    for (const p of this.parts) this.group.remove(p.group);
    this.parts.length = 0;
    this.mass.visible = true;
    this.mass.position.copy(this.home);
    this.weak.parent?.remove(this.weak);
    this.weak.position.set(0, 4.3, 0.4);
    this.mass.add(this.weak);
  }

  render(): void {
    super.render();
    const k = this.song * (0.7 + 0.3 * Math.sin(this.t * 17));
    this.singMat.emissiveIntensity = 0.5 + k * 3.5;
  }
}

// =============================================================================
// The Hanged Warden: a giant on chains. Phase 2: it falls and swings its bell.
// =============================================================================
export class HangedWarden extends DeepBoss {
  private body = new THREE.Group();
  private chains: THREE.Mesh[] = [];
  private bell: THREE.Mesh;
  private heartMat: THREE.MeshStandardMaterial;
  private anchor: THREE.Vector3;
  private swingAxis = 0;
  private fallen = 0;
  private walkTarget = new THREE.Vector3();
  private low = false;

  constructor(ctx: GameContext, home: THREE.Vector3) {
    super(ctx, 'warden', 'The Hanged Warden', 'it rang the bell for every hanging, until they hanged it', home, 14, 3200);
    this.radius = 1.6;
    this.height = 6;
    this.anchor = home.clone().setY(home.y + 17);
    const hide = this.mat(0x4a4038, 0.8, 0x000000);
    const iron = this.mat(0x3a3a3c, 0.4, 0x000000);
    iron.metalness = 0.85;
    this.heartMat = this.mat(0x301008, 0.3, 0xffa040);
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, p: [number, number, number], r: [number, number, number] = [0, 0, 0]): THREE.Mesh => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(...p);
      mesh.rotation.set(...r);
      mesh.castShadow = true;
      this.body.add(mesh);
      return mesh;
    };
    // a giant, gaunt, hooded body (origin at its feet)
    add(new THREE.CylinderGeometry(0.9, 0.6, 3, 8), hide, [0, 3.6, 0]);
    add(new THREE.SphereGeometry(0.75, 10, 8), hide, [0, 5.6, 0.1]);
    add(new THREE.ConeGeometry(0.95, 1.4, 8), hide, [0, 6.2, -0.1], [-0.2, 0, 0]);
    add(new THREE.CylinderGeometry(0.28, 0.2, 2.6, 6), hide, [-0.4, 1.2, 0], [0, 0, 0.08]);
    add(new THREE.CylinderGeometry(0.28, 0.2, 2.6, 6), hide, [0.4, 1.2, 0], [0, 0, -0.08]);
    add(new THREE.CylinderGeometry(0.22, 0.16, 3.2, 6), hide, [-1.2, 3.6, 0], [0, 0, 0.35]);
    add(new THREE.CylinderGeometry(0.22, 0.16, 3.2, 6), hide, [1.2, 3.6, 0], [0, 0, -0.35]);
    // caged heart: the weak point
    for (let i = 0; i < 6; i++) add(new THREE.BoxGeometry(0.06, 1, 0.06), iron, [Math.cos(i) * 0.5, 4.2, 0.55 + Math.sin(i) * 0.1]);
    add(new THREE.SphereGeometry(0.32, 10, 8), this.heartMat, [0, 4.2, 0.6]);
    this.weak.position.set(0, 4.2, 0.6);
    this.body.add(this.weak);
    this.weakR = 0.7;
    // the bell
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 10; i++) {
      const u = i / 10;
      pts.push(new THREE.Vector2(0.4 + u * u * 1.1 + (u > 0.9 ? 0.15 : 0), 2.2 - u * 2.2));
    }
    const bronze = this.mat(0x6d5732, 0.35, 0x000000);
    bronze.metalness = 0.9;
    this.bell = new THREE.Mesh(new THREE.LatheGeometry(pts, 20), bronze);
    this.bell.castShadow = true;
    this.bell.position.set(1.9, 0.6, 0);
    this.body.add(this.bell);
    // chains
    for (let k = 0; k < 2; k++) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 1, 5), iron);
      this.chains.push(c);
      this.group.add(c);
    }
    this.group.add(this.body);
    // gibbet beam overhead
    const beam = new THREE.Mesh(new THREE.BoxGeometry(24, 1, 1), iron);
    beam.position.copy(this.anchor).setY(this.anchor.y + 0.5);
    this.group.add(beam);
    for (const [dx, dz] of [[-10, -10], [10, -10], [-10, 10], [10, 10]]) {
      this.flames.push(ctx.lights.addFlame(new THREE.Vector3(home.x + dx, home.y + 1.2, home.z + dz), { color: 0xc8d8ff, intensity: 6, distance: 15, tag: 'torch' }));
    }
    this.resetVisual();
  }

  hurtboxes(out: Hurtbox[]): void {
    const hb = this.ctx.combat.newHurtbox();
    const b = this.body.position;
    hb.a.set(b.x, b.y + 1, b.z);
    hb.b.set(b.x, b.y + 5.8, b.z);
    hb.r = 1.1;
    out.push(hb);
  }

  protected idle(dt: number): void {
    this.swing(dt, 0.25);
  }

  /** Pendulum from the gibbet: sweeps low through the arena. */
  private swing(dt: number, amp: number): void {
    this.swingAxis += dt * 0.12;
    const ang = Math.sin(this.t * 0.9) * amp * 1.2;
    const L = 14;
    const ax = Math.cos(this.swingAxis);
    const az = Math.sin(this.swingAxis);
    const off = Math.sin(ang) * L;
    const drop = Math.cos(ang) * L;
    this.body.position.set(this.anchor.x + ax * off, this.anchor.y - drop - 3.2 + (amp > 0.5 ? 0 : 3), this.anchor.z + az * off);
    this.body.rotation.set(0, Math.atan2(-az, ax), -ang * 0.8);
    this.pos.copy(this.body.position);
    this.updateChains();
  }

  private updateChains(): void {
    this.chains.forEach((c, i) => {
      const s = i === 0 ? -1 : 1;
      const top = _v.set(this.anchor.x + s * 1.2, this.anchor.y, this.anchor.z);
      const bottom = _w.set(s * 0.9, 5.2, 0).applyMatrix4(this.body.matrixWorld);
      if (this.fallen > 0) bottom.copy(top).setY(top.y - 3 - this.fallen * 2);
      c.position.lerpVectors(top, bottom, 0.5);
      c.scale.set(1, top.distanceTo(bottom), 1);
      c.lookAt(bottom);
      c.rotateX(Math.PI / 2);
    });
  }

  protected think(dt: number): void {
    const p = this.ctx.player;
    if (this.phase === 1) {
      this.swing(dt, 0.75);
      // the low pass: the body scythes through the arena
      const lowNow = this.body.position.y < this.home.y + 1.2;
      if (lowNow && !this.low) this.ctx.audio.playAt('swing_heavy', this.pos, { volume: 1, rate: 0.4, ref: 14 });
      this.low = lowNow;
      if (lowNow && p.alive && p.center(_v).distanceTo(this.center(_w)) < 3.2) {
        const dir = new THREE.Vector3().subVectors(p.pos, this.pos).setY(0).normalize();
        p.receiveHit({ attacker: this, attack: null, damage: 70, poise: 80, point: p.pos.clone().setY(p.pos.y + 1), dir, kind: 'hazard', parryable: false, unblockable: false, knockback: 6 });
      }
      if (this.t >= this.nextAttack) {
        // Toll: it strikes its bell against its own ribs
        this.ctx.audio.playAt('shockwave', this.pos, { volume: 1, rate: 0.5, ref: 16 });
        this.heartMat.emissiveIntensity = 4;
        this.later(1.2, () => {
          const at = this.groundAt(this.pos.clone().setY(this.home.y + 3));
          this.ctx.hazards.spawn('shockwave', this, at, new THREE.Vector3(0, 0, 1), 55, 16);
          this.ctx.lights.flash(at.clone().setY(at.y + 2), 0xffd8a0, 20, 14, 0.3);
        });
        this.nextAttack = this.t + 5;
      }
    } else {
      // fallen: walks and fights with the bell
      this.fallen = Math.min(1, this.fallen + dt);
      _v.subVectors(p.pos, this.body.position).setY(0);
      const d = _v.length();
      this.body.rotation.set(0, Math.atan2(_v.x, _v.z), 0);
      if (d > 5) this.body.position.addScaledVector(_v.normalize(), dt * 1.8);
      this.groundAt(this.walkTarget.copy(this.body.position).setY(this.body.position.y + 2));
      this.body.position.y = this.walkTarget.y;
      this.pos.copy(this.body.position);
      this.bell.rotation.z = Math.sin(this.t * 2) * 0.3;
      this.updateChains();
      if (this.t >= this.nextAttack) this.phase2Attack(d);
    }
  }

  private phase2Attack(d: number): void {
    const p = this.ctx.player;
    const r = Math.random();
    const fwd = new THREE.Vector3().subVectors(p.pos, this.pos).setY(0).normalize();
    if (d < 6 && r < 0.5) {
      // bell slam in front
      const at = this.groundAt(this.pos.clone().addScaledVector(fwd, 3.5).setY(this.pos.y + 3));
      this.mark(at, 3, 1.1);
      this.later(1.1, () => {
        this.ctx.hazards.spawn('burst', this, at.clone().setY(at.y + 0.8), fwd, 80, 3);
        this.ctx.audio.playAt('shockwave', at, { volume: 1, rate: 0.6, ref: 14 });
        this.ctx.shake(0.6);
      });
      this.nextAttack = this.t + 3;
    } else if (r < 0.8) {
      // Knell: a long toll, then the ring
      this.heartMat.emissiveIntensity = 5;
      this.ctx.audio.playAt('shockwave', this.pos, { volume: 1, rate: 0.35, ref: 20 });
      this.later(1.6, () => this.ctx.hazards.spawn('shockwave', this, this.pos.clone(), fwd, 65, 22));
      this.nextAttack = this.t + 4.5;
    } else {
      this.later(0.8, () => this.ctx.hazards.spawn('flamewave', this, this.pos.clone().addScaledVector(fwd, 2), fwd, 55));
      this.nextAttack = this.t + 3.2;
    }
  }

  protected enterPhase2(): void {
    // the chains snap; it crashes down
    this.ctx.shake(1);
    this.ctx.flash(0.4, 0xfff0e0);
    this.ctx.audio.play('guard_break', { volume: 1, rate: 0.5 });
    this.ctx.message('The chains give way', 2.5);
    this.later(0.1, () => {
      const at = this.groundAt(this.pos.clone().setY(this.home.y + 4));
      this.body.position.copy(at);
      this.ctx.hazards.spawn('shockwave', this, at, new THREE.Vector3(0, 0, 1), 40, 14);
      this.ctx.particles.dust(at, 50, 0x5a544c);
    });
    this.bell.position.set(1.4, 2.6, 0.8);
    this.nextAttack = this.t + 3;
  }

  protected collapse(): void {
    this.body.rotation.x = -1.4;
    this.body.position.y = this.home.y + 0.6;
    this.heartMat.emissive.setRGB(0, 0, 0);
  }

  protected resetVisual(): void {
    this.fallen = 0;
    this.bell.position.set(1.9, 0.6, 0);
    this.body.rotation.set(0, 0, 0);
    this.heartMat.emissive.setHex(0xffa040);
    this.body.updateMatrixWorld(true);
    this.swing(0, 0.25);
  }

  render(): void {
    super.render();
    this.heartMat.emissiveIntensity = Math.max(1.2 + Math.sin(this.t * 3) * 0.5, this.heartMat.emissiveIntensity - 0.05);
    this.body.updateMatrixWorld(true);
  }
}
