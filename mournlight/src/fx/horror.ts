import * as THREE from 'three';
import type { GameContext } from '../core/context';
import { clamp, clamp01, damp, rand } from '../core/math';
import { models, type ModelInstance } from '../entities/models';
import { locomotion, STYLES } from '../entities/poses';
import { makePose } from '../entities/rig';
import { SILHOUETTES, type RegionDef } from '../world/layout';
import { Enemy } from '../ai/enemy';

interface Silhouette {
  model: ModelInstance;
  anchor: THREE.Vector3;
  opacity: number;
  hidden: boolean;
  respawn: number;
  stare: number;
  eyes: THREE.Mesh[];
}

/**
 * Drives dread: rises in darkness, near horrors and at low health. High
 * dread brings screen warping, whispers, phantom footsteps (ambience) and
 * fake enemies that vanish when struck. Also owns the distant silhouettes.
 */
export class HorrorDirector {
  dread = 0;
  private target = 0;
  private silhouettes: Silhouette[] = [];
  private phantomTimer = 25;
  private phantom: Enemy | null = null;
  private phantomLife = 0;
  private pose = makePose();
  private tmp = new THREE.Vector3();
  private t = 0;
  bossFight = false;

  constructor(private ctx: GameContext) {
    const eyeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.4, 1.35, 1.2), fog: false });
    for (const p of SILHOUETTES) {
      const model = models.create('silhouette');
      model.root.position.set(...p);
      model.setShadows(false);
      const head = model.rig.bone('head');
      const eyes: THREE.Mesh[] = [];
      for (const x of [-0.03, 0.03]) {
        const e = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 4), eyeMat);
        e.position.set(x, 0.15, 0.085);
        head.add(e);
        eyes.push(e);
      }
      ctx.scene.add(model.root);
      this.silhouettes.push({ model, anchor: new THREE.Vector3(...p), opacity: 1, hidden: false, respawn: 0, stare: 0, eyes });
    }
  }

  update(dt: number, region: RegionDef): void {
    this.t += dt;
    const ctx = this.ctx;
    const p = ctx.player;
    // --- dread inputs
    const lit = p.lantern.lit ? 1 : 0;
    const flame = clamp01(ctx.lights.lightAt(p.pos) * 1.5);
    const darkness = clamp01(1 - lit * 0.75 - flame);
    let horror = 0;
    for (const e of ctx.enemies) {
      if (!e.alive || e.phantom) continue;
      const d = e.pos.distanceTo(p.pos);
      if (d > 16) continue;
      const k = (1 - d / 16) * (e.def.type === 'stalker' ? 1.4 : e.def.type === 'boss' ? 1.2 : 1) * (e.awareness >= 1 ? 1 : 0.5);
      horror += k;
    }
    horror = clamp01(horror * 0.6);
    const hp = p.health / p.maxHealth;
    const lowHp = clamp01((0.5 - hp) / 0.5);
    this.target = clamp(region.dread + darkness * 0.42 + horror * 0.4 + lowHp * 0.35 + (this.bossFight ? 0.2 : 0) - flame * 0.3, 0, 1);
    if (p.state === 'rest' || p.state === 'dead') this.target = 0;
    const rate = this.target > this.dread ? 0.1 : 0.07;
    this.dread = clamp01(this.dread + Math.sign(this.target - this.dread) * Math.min(Math.abs(this.target - this.dread), rate * dt));

    this.updatePhantom(dt);
    this.updateSilhouettes(dt);
  }

  private updatePhantom(dt: number): void {
    const ctx = this.ctx;
    const p = ctx.player;
    if (this.phantom) {
      this.phantomLife += dt;
      const ph = this.phantom;
      if (ph.alive) ph.model.setOpacity(clamp01(this.phantomLife / 2) * 0.9);
      if (!ph.alive && ph.stateTime > 1.2) this.removePhantom();
      else if (this.phantomLife > 20 || this.dread < 0.5 || p.state === 'dead') {
        ph.vanish();
      }
      return;
    }
    if (this.dread < 0.78 || this.bossFight || p.state !== 'move') return;
    this.phantomTimer -= dt;
    if (this.phantomTimer > 0) return;
    this.phantomTimer = rand(28, 50);
    // spawn behind or beside the player, in the dark
    const f = ctx.cam.forward(this.tmp);
    const ang = Math.atan2(f.x, f.z) + Math.PI + rand(-1.2, 1.2);
    const d = rand(9, 14);
    const x = p.pos.x + Math.sin(ang) * d;
    const z = p.pos.z + Math.cos(ang) * d;
    const g = ctx.physics.groundHeight(x, z, p.pos.y + 4, 12);
    if (g === null || Math.abs(g - p.pos.y) > 3) return;
    const e = new Enemy(ctx, { type: 'shambler', p: [x, g, z] }, { phantom: true });
    e.lastKnown.copy(p.pos);
    this.phantom = e;
    this.phantomLife = 0;
    ctx.enemies.push(e);
    ctx.combat.add(e);
    ctx.ambience.stinger();
  }

  private removePhantom(): void {
    const ph = this.phantom;
    if (!ph) return;
    const i = this.ctx.enemies.indexOf(ph);
    if (i >= 0) this.ctx.enemies.splice(i, 1);
    this.ctx.combat.remove(ph);
    ph.dispose();
    ph.removed = true;
    this.phantom = null;
  }

  clearPhantoms(): void {
    this.removePhantom();
  }

  private updateSilhouettes(dt: number): void {
    const ctx = this.ctx;
    const p = ctx.player;
    const cam = ctx.cam.camera;
    const camDir = cam.getWorldDirection(new THREE.Vector3());
    for (const s of this.silhouettes) {
      const d = s.anchor.distanceTo(p.pos);
      if (s.hidden) {
        s.respawn -= dt;
        const toS = this.tmp.subVectors(s.anchor, cam.position).normalize();
        const inView = toS.dot(camDir) > 0.5;
        if (s.respawn <= 0 && d > 55 && !inView) {
          s.hidden = false;
          s.opacity = 0;
        }
        s.model.root.visible = false;
        continue;
      }
      s.model.root.visible = d < 90;
      if (!s.model.root.visible) continue;
      // face the player, barely moving
      const yaw = Math.atan2(p.pos.x - s.anchor.x, p.pos.z - s.anchor.z);
      s.model.root.rotation.y = yaw;
      locomotion(this.pose, this.t * 0.3, 0, 0, STYLES.stalker);
      this.pose[3 * 4 + 2] += Math.sin(this.t * 0.4) * 0.25; // head tilt
      s.model.rig.apply(this.pose);
      // stare check
      const toS = this.tmp.subVectors(s.anchor, cam.position).normalize();
      const looking = toS.dot(camDir) > 0.97 && d < 70;
      s.stare = looking ? s.stare + dt : Math.max(0, s.stare - dt);
      const fade = d < 30 || s.stare > 3.5;
      s.opacity = damp(s.opacity, fade ? 0 : 1, fade ? 2.5 : 0.4, dt);
      s.model.setOpacity(Math.max(0.001, s.opacity));
      for (const e of s.eyes) e.visible = s.opacity > 0.3;
      if (fade && s.opacity < 0.02) {
        s.hidden = true;
        s.respawn = rand(50, 110);
        s.stare = 0;
        if (d < 40) ctx.audio.playAt('whisper', s.anchor, { volume: 0.5, ref: 6, rate: 0.7 });
      }
    }
  }
}
