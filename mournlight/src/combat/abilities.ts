import * as THREE from 'three';
import type { GameContext } from '../core/context';
import type { Combatant, HitInfo, Hurtbox } from './combat';
import type { Enemy } from '../ai/enemy';
import { BOW, type UltimateId } from '../data/weapons';
import { BLUE_FIRE } from '../fx/gpuparticles';

/**
 * Player projectiles and ultimates: arrows with gravity and headshots, the
 * four weapon ultimates, and lingering blue-fire patches. Everything that
 * damages goes through CombatSystem sphere/segment tests against the same
 * capsule hurtboxes melee uses.
 */
interface Arrow {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  damage: number;
  life: number;
  mesh: THREE.Mesh;
  stuck: boolean;
  blue: boolean;
  /** Deluge arrows burst on impact instead of sticking. */
  burst: boolean;
}

interface FirePatch {
  pos: THREE.Vector3;
  r: number;
  t: number;
  life: number;
  tick: number;
  mesh: THREE.Mesh;
}

interface Timed {
  at: number;
  fn: () => void;
}

interface Crescent {
  mesh: THREE.Mesh;
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  t: number;
  hit: Set<Combatant>;
}

interface Glow {
  mesh: THREE.Mesh;
  t: number;
  life: number;
  base: number;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();
const _c1 = new THREE.Vector3();
const _c2 = new THREE.Vector3();

function segDist2(p: THREE.Vector3, q: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
  // closest distance between segment pq and segment ab (sampled; arrows move < 1 m per step)
  let best = Infinity;
  const ab = _d.subVectors(b, a);
  const l2 = Math.max(1e-6, ab.lengthSq());
  for (let i = 0; i <= 4; i++) {
    _c1.lerpVectors(p, q, i / 4);
    const t = Math.min(1, Math.max(0, _c2.subVectors(_c1, a).dot(ab) / l2));
    _c2.copy(a).addScaledVector(ab, t);
    best = Math.min(best, _c1.distanceToSquared(_c2));
  }
  return best;
}

export class Abilities {
  private arrows: Arrow[] = [];
  private patches: FirePatch[] = [];
  private timers: Timed[] = [];
  private crescents: Crescent[] = [];
  private glows: Glow[] = [];
  private arrowGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.8, 4);
  private arrowMat: THREE.MeshStandardMaterial;
  private blueArrowMat: THREE.MeshBasicMaterial;
  private patchGeo = new THREE.CircleGeometry(1, 24);
  private cutGeo = new THREE.PlaneGeometry(1, 0.05);
  private now = 0;
  /** Marker ring drawn at the Deluge target while the arrows are in the air. */
  private marker: THREE.Mesh;

  constructor(private ctx: GameContext) {
    this.arrowGeo.rotateX(Math.PI / 2);
    this.patchGeo.rotateX(-Math.PI / 2);
    this.arrowMat = new THREE.MeshStandardMaterial({ color: 0x5a4a38, roughness: 0.7 });
    this.blueArrowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1.2, 3), fog: false });
    const ring = new THREE.RingGeometry(0.94, 1, 48);
    ring.rotateX(-Math.PI / 2);
    this.marker = new THREE.Mesh(ring, this.additive(new THREE.Color(0.4, 0.9, 2.4), 0.9));
    this.marker.visible = false;
    ctx.scene.add(this.marker);
  }

  private additive(color: THREE.Color, opacity: number): THREE.MeshBasicMaterial {
    return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  }

  private after(delay: number, fn: () => void): void {
    this.timers.push({ at: this.now + delay, fn });
  }

  private hitEnemy(target: Combatant, point: THREE.Vector3, damage: number, poise: number, kind: HitInfo['kind'] = 'hazard'): void {
    const p = this.ctx.player;
    const dir = new THREE.Vector3().subVectors(target.pos, p.pos).setY(0).normalize();
    const res = target.receiveHit({ attacker: p, attack: null, damage, poise, point: point.clone(), dir, kind: kind === 'hazard' ? 'melee' : kind, parryable: false, unblockable: true, knockback: 1.5 });
    if (res === 'hit') p.gainUlt(0); // damage dealt by ultimates does not refill the meter
  }

  private area(center: THREE.Vector3, r: number, damage: number, poise: number, hit = new Set<Combatant>()): void {
    this.ctx.combat.sphere(this.ctx.player, 'player', center, r, hit, (t, pt) => this.hitEnemy(t, pt, damage, poise));
  }

  // ---------------------------------------------------------------------------
  // Arrows
  // ---------------------------------------------------------------------------
  fireArrow(from: THREE.Vector3, dir: THREE.Vector3, speed: number, damage: number, opts: { blue?: boolean; burst?: boolean } = {}): void {
    const mesh = new THREE.Mesh(this.arrowGeo, opts.blue ? this.blueArrowMat : this.arrowMat);
    mesh.position.copy(from);
    this.ctx.scene.add(mesh);
    this.arrows.push({ pos: from.clone(), vel: dir.clone().normalize().multiplyScalar(speed), damage, life: 0, mesh, stuck: false, blue: !!opts.blue, burst: !!opts.burst });
    if (this.arrows.length > 90) this.removeArrow(0);
  }

  private removeArrow(i: number): void {
    const a = this.arrows[i];
    this.ctx.scene.remove(a.mesh);
    this.arrows.splice(i, 1);
  }

  private stepArrows(dt: number): void {
    const phys = this.ctx.physics;
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i];
      a.life += dt;
      if (a.stuck) {
        if (a.life > 8) this.removeArrow(i);
        continue;
      }
      if (a.life > 6) {
        this.removeArrow(i);
        continue;
      }
      a.vel.y -= BOW.gravity * dt * (a.burst ? 0.3 : 1);
      _a.copy(a.pos);
      _b.copy(a.pos).addScaledVector(a.vel, dt);
      // enemies
      let hitSomething = false;
      for (const c of this.ctx.combat.combatants) {
        if (c.team !== 'enemy' || !c.alive || c.pos.distanceToSquared(_a) > 100) continue;
        const boxes: Hurtbox[] = [];
        c.hurtboxes(boxes);
        for (const hb of boxes) {
          const rr = hb.r + 0.05;
          if (segDist2(_a, _b, hb.a, hb.b) <= rr * rr) {
            const e = c as unknown as Enemy;
            const head = _c1.y > e.pos.y + e.height * 0.76;
            const dmg = a.damage * (head ? BOW.headshot : 1);
            if (a.burst) this.delugeImpact(_c1.clone());
            else {
              this.hitEnemy(c, _c1, dmg, head ? 30 : 14, 'melee');
              this.ctx.player.gainUlt(dmg * 0.14);
              if (head) {
                this.ctx.message('Headshot', 0.8);
                this.ctx.audio.play('riposte', { volume: 0.45, rate: 1.4 });
                this.ctx.gpu.sparks(_c1, a.vel.clone().negate().normalize(), 16, 0xfff0c0);
              }
            }
            hitSomething = true;
            break;
          }
        }
        if (hitSomething) break;
      }
      if (hitSomething) {
        this.removeArrow(i);
        continue;
      }
      // world
      const len = _b.distanceTo(_a);
      _d.subVectors(_b, _a).divideScalar(Math.max(1e-6, len));
      const hd = phys.rayDistance(_a, _d, len);
      if (hd !== null) {
        a.pos.copy(_a).addScaledVector(_d, hd);
        if (a.burst) {
          this.delugeImpact(a.pos.clone());
          this.removeArrow(i);
          continue;
        }
        a.stuck = true;
        a.life = 0;
        this.ctx.particles.dust(a.pos, 5, 0x4a443c);
        this.ctx.audio.playAt('step_wood', a.pos, { volume: 0.5, rate: 1.6 });
      } else a.pos.copy(_b);
      a.mesh.position.copy(a.pos);
      a.mesh.lookAt(_b.copy(a.pos).add(a.vel));
      if (a.blue || a.burst) this.ctx.gpu.streak(a.pos, a.vel, BLUE_FIRE, a.burst ? 0.3 : 0.1, a.burst ? 0.35 : 0.18);
    }
  }

  // ---------------------------------------------------------------------------
  // Ultimates
  // ---------------------------------------------------------------------------
  /** Returns the cast duration the player is rooted for. */
  cast(id: UltimateId, target: THREE.Vector3 | null): number {
    const ctx = this.ctx;
    const p = ctx.player;
    ctx.hitstop(0.45, 0.25); // a held breath before the release
    ctx.flash(0.25, 0x9fd0ff);
    ctx.shake(0.2);
    ctx.audio.play('flame_burst', { volume: 0.9, rate: 0.7 });
    ctx.lights.flash(p.center(new THREE.Vector3()), 0x6aa8ff, 30, 12, 0.6);
    ctx.gpu.blueBurst(p.center(new THREE.Vector3()), 50, 0.8);
    switch (id) {
      case 'deluge':
        return this.deluge(target);
      case 'crescent':
        return this.crescent();
      case 'rift':
        return this.rift();
      case 'hushstep':
        return this.hushstep();
    }
  }

  private deluge(target: THREE.Vector3 | null): number {
    const ctx = this.ctx;
    const p = ctx.player;
    const center = target?.clone() ?? p.pos.clone().addScaledVector(p.forward(new THREE.Vector3()), 12);
    const g = ctx.physics.groundHeight(center.x, center.z, center.y + 6, 20);
    if (g !== null) center.y = g;
    const R = 6.5;
    // the signal arrow
    const from = p.center(new THREE.Vector3()).add(new THREE.Vector3(0, 0.6, 0));
    this.after(0.25, () => {
      this.fireArrow(from, new THREE.Vector3(0, 1, 0).addScaledVector(p.forward(new THREE.Vector3()), 0.12), 60, 0, { blue: true, burst: false });
      ctx.audio.play('swing', { volume: 0.8, rate: 1.5 });
    });
    this.marker.visible = true;
    this.marker.position.copy(center).setY(center.y + 0.06);
    this.marker.scale.setScalar(R);
    // the rain
    const N = 46;
    for (let i = 0; i < N; i++) {
      this.after(1.1 + (i / N) * 1.7 + Math.random() * 0.05, () => {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * R;
        const land = new THREE.Vector3(center.x + Math.cos(a) * r, center.y, center.z + Math.sin(a) * r);
        const start = land.clone().add(new THREE.Vector3(-3 + Math.random() * 1.5, 26, -2 + Math.random()));
        this.fireArrow(start, land.clone().sub(start), 40, 0, { blue: true, burst: true });
      });
    }
    this.after(3.4, () => (this.marker.visible = false));
    return 0.8;
  }

  private delugeImpact(pos: THREE.Vector3): void {
    const ctx = this.ctx;
    ctx.gpu.blueBurst(pos, 26, 0.7);
    ctx.gpu.blueFire(pos, 6, 0.3, 1.2);
    ctx.lights.flash(pos, 0x5aa0ff, 16, 7, 0.3);
    ctx.shake(0.06);
    if (Math.random() < 0.3) ctx.audio.playAt('burst', pos, { volume: 0.35, rate: 1.4 + Math.random() * 0.3, ref: 6 });
    this.area(pos, 1.7, 38, 20);
    // lingering blue fire where arrows cluster
    if (!this.patches.some((f) => f.pos.distanceToSquared(pos) < 4) && this.patches.length < 14) {
      const mesh = new THREE.Mesh(this.patchGeo, this.additive(new THREE.Color(0.2, 0.45, 1.3), 0.5));
      mesh.position.copy(pos).setY(pos.y + 0.04);
      mesh.scale.setScalar(1.8);
      mesh.renderOrder = 5;
      ctx.scene.add(mesh);
      this.patches.push({ pos: pos.clone(), r: 1.8, t: 0, life: 6, tick: 0, mesh });
    }
  }

  private crescent(): number {
    const ctx = this.ctx;
    const p = ctx.player;
    this.after(0.2, () => {
      const geo = new THREE.TorusGeometry(1.7, 0.12, 6, 32, Math.PI * 0.9);
      geo.rotateX(Math.PI / 2);
      geo.rotateY(Math.PI * 0.05 + Math.PI);
      const mesh = new THREE.Mesh(geo, this.additive(new THREE.Color(0.5, 1.1, 3.2), 0.95));
      const dir = p.forward(new THREE.Vector3());
      const pos = p.pos.clone().setY(p.pos.y + 1.1).addScaledVector(dir, 1);
      mesh.position.copy(pos);
      mesh.rotation.y = p.yaw;
      mesh.rotation.z = 0.3;
      ctx.scene.add(mesh);
      this.crescents.push({ mesh, pos, dir, t: 0, hit: new Set() });
      ctx.audio.play('swing_heavy', { volume: 1, rate: 0.8 });
      ctx.audio.play('flame_burst', { volume: 0.7, rate: 1.2 });
    });
    return 0.55;
  }

  private rift(): number {
    const ctx = this.ctx;
    const p = ctx.player;
    const dir = p.forward(new THREE.Vector3());
    const origin = p.pos.clone();
    this.after(0.45, () => {
      ctx.shake(0.8);
      ctx.flash(0.3, 0xff7030);
      ctx.audio.play('shockwave', { volume: 1 });
      ctx.particles.dust(origin, 30, 0x4a443c);
    });
    for (let i = 0; i < 9; i++) {
      this.after(0.5 + i * 0.07, () => {
        const pt = origin.clone().addScaledVector(dir, 1.6 + i * 1.5);
        const g = ctx.physics.groundHeight(pt.x, pt.z, pt.y + 3, 8);
        if (g !== null) pt.y = g;
        // the fissure: a glowing seam that cools over a few seconds
        const crack = new THREE.Mesh(this.cutGeo, this.additive(new THREE.Color(2.4, 0.7, 0.2), 1));
        crack.rotation.set(-Math.PI / 2, 0, -p.yaw + Math.PI / 2 + (Math.random() - 0.5) * 0.5);
        crack.scale.set(1.8, 3 + Math.random() * 3, 1);
        crack.position.copy(pt).setY(pt.y + 0.05);
        ctx.scene.add(crack);
        this.glows.push({ mesh: crack, t: 0, life: 4, base: 1 });
        for (let k = 0; k < 3; k++) ctx.gpu.emit(ctx.gpu.add, { pos: pt, count: 14, jitter: 0.4, vel: new THREE.Vector3(0, 7, 0), spread: 0.35, speed: [3, 9], life: [0.4, 0.9], size: [0.3, 0.7], grow: -0.5, color: 0xff8a30, color2: 0xff3010, gravity: 6, drag: 1.5 });
        ctx.gpu.smoke(pt, 3, 0x201814);
        ctx.gpu.heatHaze(pt, 2);
        ctx.lights.flash(pt, 0xff6a20, 26, 8, 0.45);
        ctx.shake(0.15);
        this.area(pt.clone().setY(pt.y + 0.8), 1.9, 115, 90);
        if (i % 3 === 0) ctx.audio.playAt('burst', pt, { volume: 0.8, rate: 0.8 + i * 0.05, ref: 8 });
      });
    }
    return 1.1;
  }

  private hushstep(): number {
    const ctx = this.ctx;
    const p = ctx.player;
    const targets = ctx.enemies
      .filter((e) => e.alive && !e.phantom && e.pos.distanceTo(p.pos) < 13 && Math.abs(e.pos.y - p.pos.y) < 3)
      .sort((a, b) => a.pos.distanceTo(p.pos) - b.pos.distanceTo(p.pos))
      .slice(0, 5);
    const steps = targets.length ? targets.length : 1;
    const start = p.pos.clone();
    for (let i = 0; i < steps; i++) {
      this.after(0.12 + i * 0.16, () => {
        const e = targets[i];
        const from = p.pos.clone();
        let to: THREE.Vector3;
        if (e && e.alive) {
          const away = new THREE.Vector3().subVectors(e.pos, from).setY(0).normalize();
          to = e.pos.clone().addScaledVector(away, e.radius + 0.9);
          this.area(e.center(new THREE.Vector3()), 0.6, 72, 30);
          e.addBleed(55, p);
          this.cut(e.center(new THREE.Vector3()));
        } else to = from.clone().addScaledVector(p.forward(new THREE.Vector3()), 8);
        const g = ctx.physics.groundHeight(to.x, to.z, to.y + 2, 5);
        if (g !== null) to.y = g;
        // afterimage along the path
        for (let k = 0; k <= 8; k++) ctx.gpu.emit(ctx.gpu.add, { pos: _a.lerpVectors(from, to, k / 8).setY(from.y + 1), count: 3, jitter: 0.3, speed: [0.1, 0.5], life: [0.3, 0.6], size: [0.2, 0.4], color: 0x9fd0ff, alpha: 0.6 });
        if (e) p.yaw = Math.atan2(e.pos.x - to.x, e.pos.z - to.z);
        p.teleport(to);
        ctx.audio.play('swing', { volume: 0.8, rate: 1.7 });
        ctx.lights.flash(to.clone().setY(to.y + 1), 0x9fd0ff, 14, 6, 0.25);
      });
    }
    void start;
    return 0.2 + steps * 0.16;
  }

  private cut(at: THREE.Vector3): void {
    for (let k = 0; k < 3; k++) {
      const mesh = new THREE.Mesh(this.cutGeo, this.additive(new THREE.Color(0.8, 1.6, 3.2), 1));
      mesh.position.copy(at);
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      mesh.scale.set(2.4, 1, 1);
      this.ctx.scene.add(mesh);
      this.glows.push({ mesh, t: 0, life: 1.3, base: 1 });
    }
    this.ctx.gpu.blueBurst(at, 20, 0.5);
    this.ctx.hitstop(0.05, 0.1);
  }

  /** Fixed-step update. */
  step(dt: number): void {
    this.now += dt;
    for (let i = this.timers.length - 1; i >= 0; i--) {
      if (this.now >= this.timers[i].at) {
        const t = this.timers[i];
        this.timers.splice(i, 1);
        t.fn();
      }
    }
    this.stepArrows(dt);
    for (let i = this.crescents.length - 1; i >= 0; i--) {
      const c = this.crescents[i];
      c.t += dt;
      c.pos.addScaledVector(c.dir, 17 * dt);
      c.mesh.position.copy(c.pos);
      c.mesh.scale.setScalar(1 + c.t * 0.5);
      (c.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - c.t / 1.3);
      const side = new THREE.Vector3(c.dir.z, 0, -c.dir.x);
      for (const s of [-1.3, 0, 1.3]) {
        const pt = _a.copy(c.pos).addScaledVector(side, s * (1 + c.t * 0.5));
        this.ctx.combat.sphere(this.ctx.player, 'player', pt, 1.1, c.hit, (t, hp) => this.hitEnemy(t, hp, 140, 70));
        this.ctx.gpu.blueFire(pt, 2, 0.2, 0.9);
      }
      if (Math.random() < 0.5) this.ctx.lights.flash(c.pos, 0x6aa8ff, 14, 7, 0.15);
      if (c.t > 1.3 || this.ctx.physics.rayDistance(c.pos, c.dir, 0.6) !== null) {
        this.ctx.gpu.blueBurst(c.pos, 30, 0.8);
        this.ctx.scene.remove(c.mesh);
        c.mesh.geometry.dispose();
        this.crescents.splice(i, 1);
      }
    }
    for (let i = this.patches.length - 1; i >= 0; i--) {
      const f = this.patches[i];
      f.t += dt;
      f.tick -= dt;
      if (f.tick <= 0) {
        f.tick = 0.5;
        this.area(f.pos.clone().setY(f.pos.y + 0.5), f.r, 7, 2);
      }
      if (Math.random() < dt * 14) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * f.r;
        this.ctx.gpu.blueFire(_a.set(f.pos.x + Math.cos(a) * r, f.pos.y + 0.05, f.pos.z + Math.sin(a) * r), 2, 0.1, 0.8);
      }
      const k = 1 - f.t / f.life;
      (f.mesh.material as THREE.MeshBasicMaterial).opacity = 0.5 * k * (0.8 + 0.2 * Math.sin(f.t * 9));
      if (f.t >= f.life) {
        this.ctx.scene.remove(f.mesh);
        this.patches.splice(i, 1);
      }
    }
    for (let i = this.glows.length - 1; i >= 0; i--) {
      const g = this.glows[i];
      g.t += dt;
      const k = Math.max(0, 1 - g.t / g.life);
      (g.mesh.material as THREE.MeshBasicMaterial).opacity = g.base * k * k;
      if (g.t >= g.life) {
        this.ctx.scene.remove(g.mesh);
        this.glows.splice(i, 1);
      }
    }
  }

  /** Visual-only pulse of the Deluge marker. */
  render(t: number): void {
    if (this.marker.visible) (this.marker.material as THREE.MeshBasicMaterial).opacity = 0.5 + 0.4 * Math.sin(t * 10);
  }

  clear(): void {
    while (this.arrows.length) this.removeArrow(0);
    for (const f of this.patches) this.ctx.scene.remove(f.mesh);
    for (const g of this.glows) this.ctx.scene.remove(g.mesh);
    for (const c of this.crescents) this.ctx.scene.remove(c.mesh);
    this.patches.length = this.glows.length = this.crescents.length = this.timers.length = 0;
    this.marker.visible = false;
  }
}
