import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Physics } from '../core/physics';
import type { LightManager, FlameSource } from './lights';
import { tonguesFor } from './lights';
import type { StaticBuilder } from './builder';
import type { MaterialLibrary } from './materials';
import type { DoorDef, ItemKind, ShrineDef } from './layout';
import { patchFog } from '../fx/fog';
import { clamp01, easeInOut } from '../core/math';

export type InteractKind = 'shrine' | 'door' | 'fogwall' | 'item' | 'remnant';

export interface Interactable {
  readonly kind: InteractKind;
  readonly pos: THREE.Vector3;
  readonly radius: number;
  enabled: boolean;
}

// ---------------------------------------------------------------------------
export class Shrine implements Interactable {
  readonly kind = 'shrine' as const;
  readonly pos: THREE.Vector3;
  readonly radius = 2.4;
  enabled = true;
  lit = false;
  readonly flame: FlameSource;
  readonly flamePos: THREE.Vector3;
  readonly yaw: number;

  constructor(
    readonly def: ShrineDef,
    builder: StaticBuilder,
    lights: LightManager,
  ) {
    this.pos = new THREE.Vector3(...def.p);
    this.yaw = def.yaw;
    const [x, y, z] = def.p;
    // stone plinth and steps
    builder.box([x, y + 0.2, z], [1.8, 0.4, 1.8], 'stone', { ry: def.yaw });
    builder.box([x, y + 0.55, z], [1.2, 0.3, 1.2], 'stone', { ry: def.yaw });
    // iron candle-stand and the great candle
    builder.cylinder([x, y + 0.7, z], 0.09, 0.9, 'iron', { col: false, seg: 8 });
    builder.cylinder([x, y + 1.6, z], 0.3, 0.06, 'iron', { col: false, rTop: 0.34 });
    builder.cylinder([x, y + 1.66, z], 0.17, 0.55, 'wax', { col: false, seg: 10 });
    // ring of small candles on the plinth
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      const h = 0.1 + ((i * 37) % 5) * 0.03;
      builder.cylinder([x + Math.cos(a) * 0.72, y + 0.7, z + Math.sin(a) * 0.72], 0.035, h, 'wax', { col: false, seg: 6 });
    }
    this.flamePos = new THREE.Vector3(x, y + 2.26, z);
    this.flame = lights.addFlame(this.flamePos, { color: 0xffa050, intensity: 9, distance: 14, lit: false, tongues: tonguesFor('shrine'), tag: 'shrine' });
  }

  kindle(): void {
    this.lit = true;
    this.flame.lit = true;
  }
}

// ---------------------------------------------------------------------------
export class ShortcutDoor implements Interactable {
  readonly kind = 'door' as const;
  readonly pos: THREE.Vector3;
  readonly radius = 2.3;
  enabled = true;
  open = false;
  private pivot = new THREE.Group();
  private bar: THREE.Mesh;
  private collider: RAPIER.Collider;
  private anim = -1;

  constructor(
    readonly def: DoorDef,
    scene: THREE.Scene,
    private physics: Physics,
    mats: MaterialLibrary,
  ) {
    this.pos = new THREE.Vector3(...def.p);
    const g = new THREE.Group();
    g.position.copy(this.pos);
    g.rotation.y = def.yaw;
    // hinge on local -x edge
    this.pivot.position.set(-def.w / 2, 0, 0);
    g.add(this.pivot);
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(def.w, def.h, 0.18), mats.wood.material);
    leaf.position.set(def.w / 2, def.h / 2, 0);
    leaf.castShadow = true;
    leaf.receiveShadow = true;
    this.pivot.add(leaf);
    for (const yy of [0.5, def.h / 2, def.h - 0.5]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(def.w * 0.96, 0.12, 0.22), mats.iron.material);
      band.position.set(def.w / 2, yy, 0);
      this.pivot.add(band);
    }
    // the bar lies across the inner (openFrom) face
    const side = def.openFrom === 'front' ? 1 : -1;
    this.bar = new THREE.Mesh(new THREE.BoxGeometry(def.w + 0.8, 0.22, 0.2), mats.wood.material);
    this.bar.position.set(0, def.h * 0.5, side * 0.28);
    this.bar.castShadow = true;
    g.add(this.bar);
    for (const bx of [-def.w / 2 - 0.25, def.w / 2 + 0.25]) {
      const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.4, 0.3), mats.iron.material);
      bracket.position.set(bx, def.h * 0.5, side * 0.25);
      g.add(bracket);
    }
    scene.add(g);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, def.yaw, 0));
    const c = new THREE.Vector3(0, def.h / 2, 0).applyQuaternion(q).add(this.pos);
    this.collider = physics.addStaticBox(c, new THREE.Vector3(def.w / 2, def.h / 2, 0.12), q);
  }

  /** Which side of the door the point is on: 'front' = along yaw. */
  sideOf(p: THREE.Vector3): 'front' | 'back' {
    const fx = Math.sin(this.def.yaw);
    const fz = Math.cos(this.def.yaw);
    return (p.x - this.pos.x) * fx + (p.z - this.pos.z) * fz >= 0 ? 'front' : 'back';
  }

  canOpenFrom(p: THREE.Vector3): boolean {
    return this.sideOf(p) === this.def.openFrom;
  }

  openDoor(instant = false): void {
    if (this.open) return;
    this.open = true;
    this.enabled = false;
    this.physics.removeCollider(this.collider);
    this.bar.visible = false;
    if (instant) {
      this.pivot.rotation.y = this.targetAngle();
      this.anim = -1;
    } else this.anim = 0;
  }

  private targetAngle(): number {
    return this.def.openFrom === 'front' ? -1.75 : 1.75;
  }

  update(dt: number): void {
    if (this.anim < 0) return;
    this.anim += dt / 1.8;
    const u = clamp01(this.anim);
    this.pivot.rotation.y = this.targetAngle() * easeInOut(clamp01((u - 0.25) / 0.75));
    if (u >= 1) this.anim = -1;
  }
}

// ---------------------------------------------------------------------------
const FOG_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWp;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWp = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const FOG_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vWp;
uniform float uTime;
uniform float uAlpha;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) { vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
float fbm(vec2 p) { float s = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { s += a * n(p); p *= 2.1; a *= 0.5; } return s; }
void main() {
  vec2 p = vUv * vec2(3.0, 3.0);
  float f = fbm(p + vec2(uTime * 0.15, -uTime * 0.35)) * 0.6 + fbm(p * 1.7 - vec2(uTime * 0.25, uTime * 0.1)) * 0.4;
  float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x) * smoothstep(0.0, 0.1, vUv.y) * smoothstep(1.0, 0.75, vUv.y);
  float a = (0.35 + f * 0.8) * edge * uAlpha;
  vec3 col = mix(vec3(0.55, 0.58, 0.62), vec3(1.2, 1.15, 1.05), f);
  gl_FragColor = vec4(col, a);
}`;

export class FogWall implements Interactable {
  readonly kind = 'fogwall' as const;
  readonly pos: THREE.Vector3;
  readonly radius = 2.6;
  enabled = true;
  active = true;
  private mesh: THREE.Mesh;
  private mat: THREE.ShaderMaterial;
  private collider: RAPIER.Collider | null;
  private fade = 1;
  readonly normal: THREE.Vector3;

  constructor(
    def: { p: [number, number, number]; yaw: number; w: number; h: number },
    scene: THREE.Scene,
    private physics: Physics,
  ) {
    this.pos = new THREE.Vector3(...def.p);
    this.normal = new THREE.Vector3(Math.sin(def.yaw), 0, Math.cos(def.yaw));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: FOG_VERT,
      fragmentShader: FOG_FRAG,
      uniforms: { uTime: { value: 0 }, uAlpha: { value: 1 } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(def.w, def.h, 1, 1), this.mat);
    this.mesh.position.set(this.pos.x, this.pos.y + def.h / 2, this.pos.z);
    this.mesh.rotation.y = def.yaw;
    this.mesh.renderOrder = 8;
    scene.add(this.mesh);
    // second layer for depth
    const m2 = this.mesh.clone();
    m2.position.addScaledVector(this.normal, -0.35);
    this.mesh.add(m2);
    m2.position.set(0, 0, -0.35);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, def.yaw, 0));
    this.colliderDef = { c: this.mesh.position.clone(), half: new THREE.Vector3(def.w / 2 + 0.2, def.h / 2, 0.35), q };
    this.collider = physics.addStaticBox(this.colliderDef.c, this.colliderDef.half, q);
  }

  private colliderDef: { c: THREE.Vector3; half: THREE.Vector3; q: THREE.Quaternion };

  setPassable(p: boolean): void {
    if (p && this.collider) {
      this.physics.removeCollider(this.collider);
      this.collider = null;
    } else if (!p && !this.collider && this.active) {
      this.collider = this.physics.addStaticBox(this.colliderDef.c, this.colliderDef.half, this.colliderDef.q);
    }
  }

  dissolve(): void {
    this.active = false;
    this.enabled = false;
    this.setPassable(true);
  }

  restore(): void {
    this.active = true;
    this.enabled = true;
    this.fade = 1;
    this.mesh.visible = true;
    this.setPassable(false);
  }

  update(dt: number, t: number): void {
    this.mat.uniforms.uTime.value = t;
    this.fade = Math.max(0, Math.min(1, this.fade + (this.active ? dt : -dt * 0.5)));
    this.mat.uniforms.uAlpha.value = this.fade;
    this.mesh.visible = this.fade > 0.01;
  }
}

// ---------------------------------------------------------------------------
export const ITEM_INFO: Record<ItemKind, { name: string; desc: string; color: number }> = {
  marrow: { name: 'Knot of Marrow', desc: 'Bundled marrow, still warm. What the dead have instead of coin.', color: 0xdfe8ff },
  vessel: { name: 'Tallow Vessel', desc: 'A clay vessel slick with rendered tallow. Holds one more Draught.', color: 0xffc070 },
  oil: { name: 'Grave-Moss Oil', desc: 'Oil pressed from grave-moss. The lantern holds more and drinks slower.', color: 0x9fe0a0 },
  whetstone: { name: 'Knucklebone Whetstone', desc: 'A whetstone carved from a knuckle. Your strikes bite deeper.', color: 0xff8870 },
};

export class Pickup implements Interactable {
  readonly kind = 'item' as const;
  readonly pos: THREE.Vector3;
  readonly radius = 1.6;
  enabled = true;
  readonly group = new THREE.Group();
  private orb: THREE.Mesh;

  constructor(
    readonly id: string,
    readonly item: ItemKind,
    readonly amount: number,
    pos: THREE.Vector3,
    scene: THREE.Scene,
  ) {
    this.pos = pos.clone();
    const c = new THREE.Color(ITEM_INFO[item].color).multiplyScalar(2.2);
    this.orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.09, 1), patchFog(new THREE.MeshBasicMaterial({ color: c })));
    this.orb.position.y = 0.5;
    this.group.add(this.orb);
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 12, 8),
      patchFog(new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(0.18), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })),
    );
    halo.position.y = 0.5;
    this.group.add(halo);
    this.group.position.copy(this.pos);
    scene.add(this.group);
  }

  take(): void {
    this.enabled = false;
    this.group.visible = false;
  }

  update(t: number): void {
    if (!this.enabled) return;
    this.orb.position.y = 0.5 + Math.sin(t * 2 + this.pos.x) * 0.06;
    this.orb.rotation.y = t;
  }
}

/** Marrow dropped on death; reclaimable once. */
export class Remnant implements Interactable {
  readonly kind = 'remnant' as const;
  readonly pos = new THREE.Vector3();
  readonly radius = 1.8;
  enabled = false;
  amount = 0;
  readonly group = new THREE.Group();

  constructor(scene: THREE.Scene, mats: MaterialLibrary) {
    const mat = patchFog(new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 1.9, 1.6) }));
    for (let i = 0; i < 6; i++) {
      const shard = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.35 + (i % 3) * 0.1, 4), i % 2 ? mat : mats.bone.material);
      const a = (i / 6) * Math.PI * 2;
      shard.position.set(Math.cos(a) * 0.12, 0.15, Math.sin(a) * 0.12);
      shard.rotation.set(Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5);
      this.group.add(shard);
    }
    this.group.visible = false;
    scene.add(this.group);
  }

  place(p: THREE.Vector3, amount: number): void {
    this.pos.copy(p);
    this.amount = amount;
    this.enabled = amount > 0;
    this.group.position.copy(p);
    this.group.visible = this.enabled;
  }

  clear(): void {
    this.enabled = false;
    this.amount = 0;
    this.group.visible = false;
  }

  update(t: number): void {
    if (!this.enabled) return;
    this.group.rotation.y = t * 0.5;
  }
}
