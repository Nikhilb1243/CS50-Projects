import * as THREE from 'three';
import type { GameContext } from '../core/context';
import type { Combatant, HitResult } from './combat';
import { patchFog } from '../fx/fog';

interface Hazard {
  kind: 'shockwave' | 'burst' | 'flamewave';
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  t: number;
  life: number;
  damage: number;
  radius: number;
  hit: Set<Combatant>;
  owner: Combatant;
  mesh: THREE.Mesh;
}

/**
 * Area attacks spawned by the boss: expanding shockwave rings (roll or jump
 * through them), rot bursts, and travelling walls of flame.
 */
export class HazardSystem {
  private list: Hazard[] = [];
  private ringGeo = new THREE.TorusGeometry(1, 0.12, 6, 48);
  private sphereGeo = new THREE.SphereGeometry(1, 20, 14);
  private waveGeo = new THREE.BoxGeometry(3.2, 1.4, 0.8);
  private tmp = new THREE.Vector3();

  constructor(private ctx: GameContext) {
    this.ringGeo.rotateX(Math.PI / 2);
  }

  private mat(color: THREE.ColorRepresentation, opacity: number): THREE.MeshBasicMaterial {
    return patchFog(
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
  }

  spawn(kind: Hazard['kind'], owner: Combatant, pos: THREE.Vector3, dir: THREE.Vector3, damage: number, radius = 12): void {
    let mesh: THREE.Mesh;
    let life = 1;
    if (kind === 'shockwave') {
      mesh = new THREE.Mesh(this.ringGeo, this.mat(new THREE.Color(1.6, 1.0, 0.6), 0.9));
      life = radius / 11;
      this.ctx.audio.playAt('shockwave', pos, { volume: 1, ref: 8 });
      this.ctx.particles.dust(pos.clone().setY(pos.y + 0.2), 24, 0x4a443c);
      this.ctx.shake(0.45);
    } else if (kind === 'burst') {
      mesh = new THREE.Mesh(this.sphereGeo, this.mat(new THREE.Color(2.4, 0.5, 0.2), 0.6));
      life = 0.55;
      this.ctx.audio.playAt('burst', pos, { volume: 1, ref: 8 });
      this.ctx.shake(0.7);
      this.ctx.flash(0.35, 0xff6030);
    } else {
      mesh = new THREE.Mesh(this.waveGeo, this.mat(new THREE.Color(2.2, 0.9, 0.3), 0.55));
      life = 2.6;
      this.ctx.audio.playAt('flame_burst', pos, { volume: 0.9, ref: 6 });
    }
    mesh.position.copy(pos);
    mesh.renderOrder = 6;
    this.ctx.scene.add(mesh);
    this.list.push({ kind, pos: pos.clone(), dir: dir.clone().setY(0).normalize(), t: 0, life, damage, radius, hit: new Set(), owner, mesh });
  }

  update(dt: number): void {
    const player = this.ctx.player;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const h = this.list[i];
      h.t += dt;
      const u = h.t / h.life;
      const mat = h.mesh.material as THREE.MeshBasicMaterial;
      if (h.kind === 'shockwave') {
        const r = h.t * 11;
        h.mesh.scale.set(r, 1 + u, r);
        h.mesh.position.y = h.pos.y + 0.25;
        mat.opacity = 0.9 * (1 - u);
        if (!h.hit.has(player) && player.alive) {
          const d = Math.hypot(player.pos.x - h.pos.x, player.pos.z - h.pos.z);
          const airborne = player.pos.y > h.pos.y + 0.75;
          if (Math.abs(d - r) < 0.9 && !airborne && Math.abs(player.pos.y - h.pos.y) < 2.5) this.damage(h, player);
        }
        if (Math.random() < 0.6) {
          const a = Math.random() * Math.PI * 2;
          this.ctx.particles.dust(this.tmp.set(h.pos.x + Math.cos(a) * r, h.pos.y + 0.2, h.pos.z + Math.sin(a) * r), 1, 0x4a443c);
        }
      } else if (h.kind === 'burst') {
        const r = h.radius * Math.min(1, u * 3);
        h.mesh.scale.setScalar(r);
        mat.opacity = 0.6 * (1 - u);
        if (u < 0.45 && !h.hit.has(player) && player.alive) {
          const d = player.center(this.tmp).distanceTo(h.pos);
          if (d < r + player.radius) this.damage(h, player);
        }
        if (u < 0.3) this.ctx.particles.rot(h.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * r, Math.random() * r * 0.5, (Math.random() - 0.5) * r)), 3);
      } else {
        h.pos.addScaledVector(h.dir, dt * 9);
        const gh = this.ctx.physics.groundHeight(h.pos.x, h.pos.z, h.pos.y + 3, 8);
        if (gh !== null) h.pos.y = gh;
        h.mesh.position.set(h.pos.x, h.pos.y + 0.6, h.pos.z);
        h.mesh.rotation.y = Math.atan2(h.dir.x, h.dir.z);
        h.mesh.scale.set(1, 0.8 + Math.sin(h.t * 20) * 0.2, 1);
        mat.opacity = 0.55 * Math.min(1, (1 - u) * 3);
        this.ctx.particles.flameBurst(this.tmp.set(h.pos.x + (Math.random() - 0.5) * 3, h.pos.y + 0.2, h.pos.z), 2);
        if (!h.hit.has(player) && player.alive) {
          // capsule across the wave front
          const px = player.pos.x - h.pos.x;
          const pz = player.pos.z - h.pos.z;
          const along = px * h.dir.x + pz * h.dir.z;
          const across = Math.abs(-px * h.dir.z + pz * h.dir.x);
          if (Math.abs(along) < 0.8 && across < 1.8 && player.pos.y < h.pos.y + 1.2) this.damage(h, player);
        }
      }
      if (h.t >= h.life) {
        this.ctx.scene.remove(h.mesh);
        mat.dispose();
        this.list.splice(i, 1);
      }
    }
  }

  private damage(h: Hazard, target: Combatant): HitResult {
    h.hit.add(target);
    const dir = this.tmp.subVectors(target.pos, h.pos).setY(0).normalize();
    return target.receiveHit({
      attacker: h.owner,
      attack: null,
      damage: h.damage,
      poise: 60,
      point: target.pos.clone().setY(target.pos.y + 1),
      dir: dir.clone(),
      kind: 'hazard',
      parryable: false,
      unblockable: h.kind !== 'flamewave',
      knockback: 5,
    });
  }

  clear(): void {
    for (const h of this.list) {
      this.ctx.scene.remove(h.mesh);
      (h.mesh.material as THREE.Material).dispose();
    }
    this.list.length = 0;
  }
}
