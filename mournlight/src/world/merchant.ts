import * as THREE from 'three';
import { patchFog, rimPatch } from '../fx/fog';
import { noise1 } from '../core/math';
import type { Physics } from '../core/physics';
import type { AudioEngine } from '../audio/audio';
import type { LightManager, FlameSource } from './lights';
import type { Interactable, Shrine } from './interactables';

/**
 * The Candle-Pedlar: a stooped, hooded trader who waits beside whichever candle the player last
 * rested at. A ring of wax stubs lines its hood, a pack of wares rides its back and a lantern
 * hangs from a crooked pole. Built from primitives and animated procedurally (breathing, a slow
 * head that follows the player, a swinging lantern, the odd twitch), and it mumbles when near.
 */
export class Merchant implements Interactable {
  readonly kind = 'merchant' as const;
  readonly pos = new THREE.Vector3();
  readonly radius = 2.6;
  enabled = false;
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private head = new THREE.Group();
  private lanternPivot = new THREE.Group();
  private lanternCore: THREE.Mesh;
  private flame: FlameSource;
  private yaw = 0;
  private headYaw = 0;
  private murmurT = 2;
  private t = 0;
  private readonly tmp = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    lights: LightManager,
  ) {
    const mat = (color: number, rough = 0.9, metal = 0): THREE.MeshStandardMaterial =>
      patchFog(new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }), rimPatch, 'rim');
    const robe = mat(0x3a2e24);
    const hoodMat = mat(0x2c231c);
    const wax = mat(0xd9ceb0, 0.6);
    const wood = mat(0x4a3826, 0.85);
    const iron = mat(0x3a352e, 0.5, 0.8);
    const bundle = mat(0x5a4a34);
    const dark = new THREE.MeshBasicMaterial({ color: 0x030303 });
    const eye = new THREE.MeshBasicMaterial({ color: 0xffb35a });
    const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.Mesh => {
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(x, y, z);
      mesh.rotation.set(rx, ry, rz);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      parent.add(mesh);
      return mesh;
    };

    // robe: a wide, ragged hem narrowing to hunched shoulders
    const hem = [0.5, 0.47, 0.42, 0.36, 0.3, 0.26, 0.24, 0.2, 0.12, 0.0];
    const pts = hem.map((r, i) => new THREE.Vector2(r * (1 + (i === 0 ? 0.08 : 0)), i * 0.17 - 0.9));
    const robeGeo = new THREE.LatheGeometry(pts, 14);
    const pos = robeGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      // tattered hem and lumpy cloth
      const y = pos.getY(i);
      const a = Math.atan2(pos.getZ(i), pos.getX(i));
      const k = 1 + noise1(a * 3, y * 4) * 0.08;
      pos.setX(i, pos.getX(i) * k);
      pos.setZ(i, pos.getZ(i) * k);
      if (y < -0.85) pos.setY(i, y - Math.abs(noise1(a * 7, 1)) * 0.08);
    }
    robeGeo.computeVertexNormals();
    this.body.position.y = 0.95;
    this.root.add(this.body);
    add(this.body, robeGeo, robe, 0, 0, 0);
    // hunched shoulders and the pack of wares
    add(this.body, new THREE.SphereGeometry(0.3, 12, 8), robe, 0, 0.5, -0.04).scale.set(1.25, 0.7, 1);
    add(this.body, new THREE.BoxGeometry(0.46, 0.5, 0.26), bundle, 0, 0.42, -0.3, 0.15);
    add(this.body, new THREE.CylinderGeometry(0.09, 0.09, 0.6, 8), bundle, 0, 0.72, -0.34, 0, 0, Math.PI / 2);
    add(this.body, new THREE.BoxGeometry(0.2, 0.16, 0.16), wood, 0.18, 0.12, -0.34, 0.2, 0.3);
    for (let i = 0; i < 5; i++) add(this.body, new THREE.CylinderGeometry(0.018, 0.02, 0.14 + (i % 2) * 0.05, 6), wax, -0.2 + i * 0.1, 0.02 - (i % 3) * 0.03, -0.44);
    // head in its deep hood, candle stubs around the brim, two amber pinpricks inside
    this.head.position.set(0, 0.66, 0.08);
    this.body.add(this.head);
    const hood = add(this.head, new THREE.SphereGeometry(0.2, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), hoodMat, 0, 0, 0, -0.35);
    hood.scale.set(1, 1.15, 1.1);
    add(this.head, new THREE.ConeGeometry(0.12, 0.26, 10), hoodMat, 0, 0.2, -0.08, -0.9);
    add(this.head, new THREE.SphereGeometry(0.14, 10, 8), dark, 0, -0.02, 0.05);
    for (const x of [-0.045, 0.045]) add(this.head, new THREE.SphereGeometry(0.012, 6, 5), eye, x, 0.0, 0.17);
    for (let i = 0; i < 7; i++) {
      const a = -1.2 + (i / 6) * 2.4;
      add(this.head, new THREE.CylinderGeometry(0.016, 0.018, 0.05 + (i % 3) * 0.025, 6), wax, Math.sin(a) * 0.2, 0.11, Math.cos(a) * 0.17 - 0.02);
    }
    // crooked pole over the shoulder, lantern swinging from its end
    const pole = new THREE.Group();
    pole.position.set(0.26, 0.42, 0.12);
    pole.rotation.set(0.9, 0, -0.25);
    this.body.add(pole);
    add(pole, new THREE.CylinderGeometry(0.025, 0.03, 1.5, 6), wood, 0, 0.45, 0);
    add(pole, new THREE.CylinderGeometry(0.02, 0.025, 0.4, 6), wood, 0.06, 1.28, 0, 0, 0, -0.4);
    this.lanternPivot.position.set(0.14, 1.44, 0);
    pole.add(this.lanternPivot);
    const hang = new THREE.Group();
    hang.rotation.set(-0.9, 0, 0.25);
    this.lanternPivot.add(hang);
    add(hang, new THREE.CylinderGeometry(0.004, 0.004, 0.22, 4), iron, 0, -0.11, 0);
    add(hang, new THREE.CylinderGeometry(0.07, 0.09, 0.03, 8), iron, 0, -0.24, 0);
    add(hang, new THREE.CylinderGeometry(0.07, 0.09, 0.03, 8), iron, 0, -0.42, 0);
    for (let i = 0; i < 4; i++) add(hang, new THREE.BoxGeometry(0.012, 0.18, 0.012), iron, Math.cos((i * Math.PI) / 2) * 0.075, -0.33, Math.sin((i * Math.PI) / 2) * 0.075);
    this.lanternCore = add(hang, new THREE.SphereGeometry(0.045, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffc070 }), 0, -0.33, 0);
    this.lanternCore.castShadow = false;
    this.root.visible = false;
    scene.add(this.root);
    this.flame = lights.addFlame(new THREE.Vector3(0, -100, 0), { color: 0xffb060, intensity: 5, distance: 8, lit: false, tongues: [{ off: new THREE.Vector3(), scale: 0.07 }], tag: 'merchant' });
  }

  /** Stand beside a shrine, clear of walls, facing where the player kneels. */
  placeAt(sh: Shrine, physics: Physics): void {
    const f = new THREE.Vector3(Math.sin(sh.yaw), 0, Math.cos(sh.yaw));
    const right = new THREE.Vector3(f.z, 0, -f.x);
    const spawn = sh.pos.clone().addScaledVector(f, 2.2);
    const g0 = physics.groundHeight(spawn.x, spawn.z, spawn.y + 2, 6);
    if (g0 !== null) spawn.y = g0;
    let chosen: THREE.Vector3 | null = null;
    for (const [side, back] of [[1, 0.3], [-1, 0.3], [1, 1.4], [-1, 1.4]] as const) {
      const c = spawn.clone().addScaledVector(right, side * 1.9).addScaledVector(f, back);
      const from = spawn.clone().setY(spawn.y + 1);
      const dir = c.clone().setY(spawn.y + 1).sub(from);
      const len = dir.length();
      if (physics.rayDistance(from, dir.normalize(), len + 0.5) !== null) continue;
      const g = physics.groundHeight(c.x, c.z, spawn.y + 1.5, 4);
      if (g === null || Math.abs(g - spawn.y) > 0.8) continue;
      c.y = g;
      chosen = c;
      break;
    }
    if (!chosen) chosen = spawn.clone().addScaledVector(right, 1.6);
    this.pos.copy(chosen);
    this.yaw = Math.atan2(spawn.x - chosen.x, spawn.z - chosen.z);
    this.root.position.copy(chosen);
    this.root.rotation.y = this.yaw;
    this.root.visible = true;
    this.enabled = true;
    this.flame.lit = true;
    this.flame.level = 1;
    this.root.updateMatrixWorld(true);
    this.lanternCore.getWorldPosition(this.flame.pos);
  }

  update(dt: number, player: THREE.Vector3, audio: AudioEngine): void {
    if (!this.enabled) return;
    this.t += dt;
    const t = this.t;
    // breathing stoop, a slow sway, and the occasional twitch of the head
    this.body.rotation.x = 0.32 + Math.sin(t * 1.15) * 0.025;
    this.body.rotation.z = noise1(t * 0.3, 7) * 0.04;
    this.body.scale.y = 1 + Math.sin(t * 1.15) * 0.012;
    const d2 = this.pos.distanceToSquared(player);
    const want = d2 < 100 ? Math.atan2(player.x - this.pos.x, player.z - this.pos.z) - this.yaw : 0;
    const wrapped = Math.atan2(Math.sin(want), Math.cos(want));
    this.headYaw += (THREE.MathUtils.clamp(wrapped, -1, 1) - this.headYaw) * (1 - Math.exp(-2 * dt));
    const twitch = Math.max(0, noise1(t * 0.8, 3) - 0.6) * 1.5;
    this.head.rotation.set(-0.25 + twitch * 0.2, this.headYaw, noise1(t * 0.5, 11) * 0.12 + twitch * 0.3);
    this.lanternPivot.rotation.z = Math.sin(t * 1.7) * 0.12;
    this.lanternPivot.rotation.x = Math.sin(t * 1.1 + 1) * 0.06;
    (this.lanternCore.material as THREE.MeshBasicMaterial).color.setRGB(1, 0.72 + noise1(t * 9, 2) * 0.1, 0.4);
    // mumbling to itself when the player is near
    this.murmurT -= dt;
    if (d2 < 81 && this.murmurT <= 0) {
      this.murmurT = 3 + Math.random() * 4;
      this.head.getWorldPosition(this.tmp);
      audio.playAt('murmur', this.tmp, { volume: 0.55, ref: 2, rate: 0.9 + Math.random() * 0.15 });
    }
  }

  /** Greet the player when the shop opens. */
  greet(audio: AudioEngine): void {
    this.head.getWorldPosition(this.tmp);
    audio.playAt('murmur', this.tmp, { volume: 0.8, ref: 2, rate: 1 });
    this.murmurT = 5;
  }

  hide(): void {
    this.enabled = false;
    this.root.visible = false;
    this.flame.lit = false;
  }
}
