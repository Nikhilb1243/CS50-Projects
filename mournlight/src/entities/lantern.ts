import * as THREE from 'three';
import { buildLantern } from './models';
import { clamp, damp, noise1 } from '../core/math';
import { PLAYER_TUNING as T } from '../data/stats';
import { QUALITY_PROFILES, type Quality } from '../core/settings';

/**
 * The Revenant's lantern: the only warm light the player carries. It burns
 * fuel, can be shuttered (harder to detect, nearly blind) and swings on the
 * hand like a pendulum.
 */
export class Lantern {
  readonly pivot = new THREE.Group();
  readonly light: THREE.PointLight;
  readonly glowLight: THREE.PointLight;
  private visual = buildLantern();
  on = true;
  fuel: number = T.lanternFuelMax;
  fuelMax: number = T.lanternFuelMax;
  drainMult = 1;
  private swing = new THREE.Vector2();
  private swingVel = new THREE.Vector2();
  private lastPos = new THREE.Vector3();
  private lastVel = new THREE.Vector3();
  private tmp = new THREE.Vector3();
  private inv = new THREE.Quaternion();
  private brightness = 1;
  /** World direction the flame leans toward (the current objective), or null. */
  lean: THREE.Vector3 | null = null;
  private leanQ = new THREE.Quaternion();
  /** Flame visibility for other systems (0..1). */
  level = 1;

  constructor(quality: Quality) {
    this.pivot.add(this.visual.group);
    this.light = new THREE.PointLight(0xffa860, T.lanternIntensity, T.lanternRadius, 1.35);
    this.light.position.set(0, -0.17, 0);
    this.light.shadow.mapSize.set(512, 512);
    this.light.shadow.camera.near = 0.2;
    this.light.shadow.camera.far = T.lanternRadius;
    this.light.shadow.bias = -0.002;
    this.setShadow(QUALITY_PROFILES[quality].lanternShadow);
    this.visual.group.add(this.light);
    // a faint fill so the player's own body reads even when shuttered
    this.glowLight = new THREE.PointLight(0x6d7a90, 0.0, 3.5, 2);
    this.glowLight.position.set(0, 0.4, 0);
    this.pivot.add(this.glowLight);
  }

  setShadow(on: boolean): void {
    if (this.light.castShadow === on) return;
    this.light.castShadow = on;
    if (!on) {
      this.light.shadow.map?.dispose();
      this.light.shadow.map = null;
    }
  }

  attach(socket: THREE.Object3D): void {
    socket.add(this.pivot);
  }

  get lit(): boolean {
    return this.on && this.fuel > 0;
  }

  /** Effective light radius used for AI (stalkers freeze inside it). */
  get radius(): number {
    return this.lit ? T.lanternRadius * (0.55 + 0.45 * Math.min(1, this.fuel / 25)) : 0;
  }

  toggle(): boolean {
    if (!this.on && this.fuel <= 0) return false;
    this.on = !this.on;
    return true;
  }

  refill(): void {
    this.fuel = this.fuelMax;
  }

  worldPos(out = new THREE.Vector3()): THREE.Vector3 {
    return this.visual.glass.getWorldPosition(out);
  }

  update(dt: number, t: number, drinking: boolean): void {
    if (this.lit) this.fuel = Math.max(0, this.fuel - T.lanternDrain * this.drainMult * dt);
    if (this.fuel <= 0) this.on = false;

    const low = this.fuel < 15 ? 1 - this.fuel / 15 : 0;
    const flick = 0.88 + noise1(t * 9, 3) * 0.12 + noise1(t * 23, 5) * 0.06 - (low > 0 && noise1(t * 4, 9) > 0.3 ? low * 0.6 : 0);
    const target = this.lit ? 1 : 0;
    this.brightness = damp(this.brightness, target, this.lit ? 6 : 12, dt);
    this.level = this.brightness;
    const radiusK = 0.55 + 0.45 * Math.min(1, this.fuel / 25);
    this.light.intensity = T.lanternIntensity * this.brightness * clamp(flick, 0.2, 1.2);
    this.light.distance = T.lanternRadius * radiusK;
    this.glowLight.intensity = this.lit ? 0 : 0.45;
    const flame = this.visual.flame;
    flame.visible = this.brightness > 0.05;
    flame.scale.set(1, 0.7 + flick * 0.5, 1).multiplyScalar(Math.max(0.05, this.brightness));
    // The flame leans toward where the Revenant must go, as if drawn by a draught.
    if (flame.parent) {
      flame.parent.getWorldQuaternion(this.inv).invert();
      const up = this.tmp.set(0, 1, 0);
      if (this.lean) up.addScaledVector(this.lean, 0.55 + 0.1 * Math.sin(t * 3)).normalize();
      up.applyQuaternion(this.inv);
      this.leanQ.setFromUnitVectors(new THREE.Vector3(0, 1, 0), up);
      flame.quaternion.slerp(this.leanQ, 1 - Math.exp(-4 * dt));
    }
    const glassMat = this.visual.glass.material as THREE.MeshStandardMaterial;
    glassMat.emissiveIntensity = 0.15 + 1.6 * this.brightness * flick;

    // Pendulum: keep the lantern hanging down, swinging with hand motion
    const parent = this.pivot.parent;
    if (!parent) return;
    parent.getWorldPosition(this.tmp);
    const vel = this.tmp.clone().sub(this.lastPos).divideScalar(Math.max(dt, 1e-3));
    const acc = vel.clone().sub(this.lastVel).divideScalar(Math.max(dt, 1e-3));
    this.lastPos.copy(this.tmp);
    this.lastVel.copy(vel);
    const k = 40;
    const c = 5;
    this.swingVel.x += (-k * this.swing.x - c * this.swingVel.x - clamp(acc.z, -30, 30) * 0.6) * dt;
    this.swingVel.y += (-k * this.swing.y - c * this.swingVel.y + clamp(acc.x, -30, 30) * 0.6) * dt;
    this.swing.x = clamp(this.swing.x + this.swingVel.x * dt, -0.8, 0.8);
    this.swing.y = clamp(this.swing.y + this.swingVel.y * dt, -0.8, 0.8);
    // cancel parent rotation, then apply world-space swing
    parent.getWorldQuaternion(this.inv).invert();
    this.pivot.quaternion.copy(this.inv).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(this.swing.x, 0, this.swing.y)));
    if (drinking) this.pivot.quaternion.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, 0, 0)));
  }
}
